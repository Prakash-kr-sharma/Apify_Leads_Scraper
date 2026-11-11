
import { Actor } from 'apify';
import { CheerioCrawler } from 'crawlee';

await Actor.init();

const input = await Actor.getInput() ?? {};

const startUrls = input.startUrls ?? [];
const maxRequestsPerCrawl = input.maxRequestsPerCrawl ?? 100;

if (!Array.isArray(startUrls) || startUrls.length === 0) {
    throw new Error(
        'Please provide at least one company website URL in startUrls.'
    );
}

const leads = new Map();

const normalizePhone = (phone) =>
    phone.replace(/\D/g, '');

const crawler = new CheerioCrawler({
    maxRequestsPerCrawl,

    async requestHandler({ request, $, log }) {
        const website = request.loadedUrl || request.url;
        const title = $('title').first().text().trim();
        const description = $('meta[name="description"]')
            .attr('content') || '';

        const emails = new Set();
        const phones = new Set();

        // Collect public email links
        $('a[href^="mailto:"]').each((_, element) => {
            const email = $(element)
                .attr('href')
                .replace(/^mailto:/i, '')
                .split('?')[0]
                .trim()
                .toLowerCase();

            if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
                emails.add(email);
            }
        });

        // Collect public phone links
        $('a[href^="tel:"]').each((_, element) => {
            const phone = $(element)
                .attr('href')
                .replace(/^tel:/i, '')
                .trim();

            const digits = normalizePhone(phone);

            if (digits.length >= 10 && digits.length <= 13) {
                phones.add(phone);
            }
        });

        const lead = {
            businessName: title,
            website,
            description,
            emails: [...emails],
            phones: [...phones],
            source: 'Company Website',
            collectedAt: new Date().toISOString()
        };

        const key = website.toLowerCase();

        if (emails.size || phones.size) {
            if (!leads.has(key)) {
                leads.set(key, lead);
            } else {
                const existing = leads.get(key);

                existing.emails = [
                    ...new Set([...existing.emails, ...lead.emails])
                ];

                existing.phones = [
                    ...new Set([...existing.phones, ...lead.phones])
                ];
            }
        }

        // Find contact and about pages
        await request.enqueueLinks({
    selector: 'a[href*="contact"], a[href*="about"]',
    transformRequestFunction: (req) => {
        if (req.url.startsWith('http')) return req;
        return null;
    },
    strategy: 'same-domain'
});

        log.info(`Processed: ${website}`);
    },

    async failedRequestHandler({ request, log }) {
        log.warning(`Could not process: ${request.url}`);
    }
});

await crawler.run(
    startUrls.map(item =>
        typeof item === 'string' ? item : item.url
    )
);

const dataset = await Actor.openDataset();

for (const lead of leads.values()) {
    await dataset.pushData(lead);
}

console.log(`Total leads collected: ${leads.size}`);

await Actor.exit();
