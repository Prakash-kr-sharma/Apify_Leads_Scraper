
import { Actor } from 'apify';
import { CheerioCrawler } from 'crawlee';

await Actor.init();

try {
    const input = await Actor.getInput() ?? {};

    const startUrls = input.startUrls ?? [];
    const maxRequestsPerCrawl = Number(
        input.maxRequestsPerCrawl ?? 50
    );

    if (!Array.isArray(startUrls) || startUrls.length === 0) {
        throw new Error(
            'Please provide at least one website URL in Company Website URLs.'
        );
    }

    const leads = new Map();

    const crawler = new CheerioCrawler({
        maxRequestsPerCrawl,
        maxConcurrency: 1,
        maxRequestRetries: 1,

        async requestHandler({ request, $, log, enqueueLinks }) {
            const pageUrl = request.loadedUrl || request.url;
            const website = new URL(pageUrl).origin;
            const key = website.toLowerCase();

            const title = $('title').first().text().trim();
            const description =
                $('meta[name="description"]').attr('content') || '';

            const emails = new Set();
            const phones = new Set();

            $('a[href^="mailto:"]').each((_, element) => {
                const href = $(element).attr('href') || '';

                const email = href
                    .replace(/^mailto:/i, '')
                    .split('?')[0]
                    .trim()
                    .toLowerCase();

                if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
                    emails.add(email);
                }
            });

            $('a[href^="tel:"]').each((_, element) => {
                const href = $(element).attr('href') || '';
                const phone = href.replace(/^tel:/i, '').trim();
                const digits = phone.replace(/\D/g, '');

                if (digits.length >= 10 && digits.length <= 13) {
                    phones.add(phone);
                }
            });

            if (!leads.has(key)) {
                leads.set(key, {
                    businessName: title,
                    website,
                    description,
                    emails: [],
                    phones: [],
                    pagesVisited: [],
                    source: 'Company Website',
                    collectedAt: new Date().toISOString()
                });
            }

            const lead = leads.get(key);

            if (!lead.businessName && title) {
                lead.businessName = title;
            }

            if (!lead.description && description) {
                lead.description = description;
            }

            lead.emails = [
                ...new Set([...lead.emails, ...emails])
            ];

            lead.phones = [
                ...new Set([...lead.phones, ...phones])
            ];

            lead.pagesVisited = [
                ...new Set([...lead.pagesVisited, pageUrl])
            ];

            // Find contact and about pages on the same website.
            await enqueueLinks({
                selector: 'a[href*="contact"], a[href*="about"]',
                strategy: 'same-domain'
            });

            log.info(`Processed: ${pageUrl}`);
        },

        async failedRequestHandler({ request, log }) {
            log.warning(`Could not process: ${request.url}`);
        }
    });

    const urls = startUrls.map(item =>
        typeof item === 'string' ? item : item.url
    );

    await crawler.run(urls);

    const dataset = await Actor.openDataset();

    for (const lead of leads.values()) {
        if (lead.emails.length || lead.phones.length) {
            await dataset.pushData(lead);
        }
    }

    log.info(`Total leads collected: ${leads.size}`);

} finally {
    await Actor.exit();
}
