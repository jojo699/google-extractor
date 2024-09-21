const express = require('express');
const puppeteer = require('puppeteer');
const cors = require('cors');
const path = require('path');

// Delay queries
const getRandomDelay = (min, max) => Math.floor(Math.random() * (max - min + 1) * 1000) + min * 1000;

const app = express();
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

const extractLinksFromPage = async (page) => {
  return page.evaluate(() => {
    const results = [];
    const items = document.querySelectorAll('div.g');
    items.forEach((item) => {
      const anchor = item.querySelector('a');
      const title = item.querySelector('h3');
      if (anchor && title) {
        results.push({
          url: anchor.href,
          text: title.textContent
        });
      }
    });
    return results;
  });
};

const extractEmailsAndPhonesFromPage = async (page, url, retries, timeout) => {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await page.goto(url, { timeout: timeout, waitUntil: 'domcontentloaded' });

      // Wait for the body to be available
      await page.waitForSelector('body', { timeout: timeout });

      return await page.evaluate(() => {
        const emailRegex = /([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+)/gi;
        const phoneRegex = /(?:\+?(\d{1,3}))?[-. (]*(\d{3})[-. )]*(\d{3})[-. ]*(\d{4})(?: *x(\d+))?/g;
        
        const visibleText = document.body.innerText;
        
        const emails = [...new Set(visibleText.match(emailRegex) || [])];
        const phoneNumbers = [...new Set(visibleText.match(phoneRegex) || [])];
        
        // Check for mailto and tel links
        const links = document.getElementsByTagName('a');
        for (let link of links) {
          const href = link.getAttribute('href');
          if (href) {
            if (href.startsWith('mailto:')) {
              const email = href.replace('mailto:', '');
              if (!emails.includes(email)) emails.push(email);
            } else if (href.startsWith('tel:')) {
              const phone = href.replace('tel:', '');
              if (!phoneNumbers.includes(phone)) phoneNumbers.push(phone);
            }
          }
        }
        
        return { emails, phoneNumbers };
      });
    } catch (error) {
      console.error(`Attempt ${attempt} - Error extracting data from ${url}:`, error.message);
      if (attempt === retries) {
        console.error(`All ${retries} attempts failed for ${url}`);
        return { emails: [], phoneNumbers: [] };
      }
      // Wait before retrying
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
};


let finalResults = [];

app.post('/api/extract-google-links-and-emails', async (req, res) => {
  let browser;
  try {
    const { query, limit, minDelay, maxDelay, timeout, retries } = req.body;

    if (!query) {
      return res.status(400).json({ error: 'Search query is required' });
    }

    const queries = query.split(';').map(q => q.trim()).filter(q => q);

    if (queries.length === 0) {
      return res.status(400).json({ error: 'At least one valid search query is required' });
    }

    console.log(`Starting search for queries: "${queries.join('", "')}" with limit: ${limit}, timeout: ${timeout}ms, retries: ${retries}`);

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    });

    finalResults = []; // Final Results

    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');

    for (const [queryIndex, currentQuery] of queries.entries()) {
      res.write(`data: ${JSON.stringify({ message: `Starting search for query ${queryIndex + 1}: "${currentQuery}"` })}\n\n`);

      const allResults = [];
      const pagesToScrape = Math.ceil(limit / 10);
      const minSitesToVisit = limit;

      for (let i = 0; i < pagesToScrape; i++) {
        const pageNum = i * 10;
        console.log(`Searching Google page ${i + 1} for query: "${currentQuery}"`);
        res.write(`data: ${JSON.stringify({ message: `Searching Google page ${i + 1} for query: "${currentQuery}"` })}\n\n`);
        
        const delay = getRandomDelay(minDelay, maxDelay);
        console.log(`Waiting for ${delay}ms before searching...`);
        res.write(`data: ${JSON.stringify({ message: `Waiting for ${delay}ms before searching...` })}\n\n`);
        await new Promise(resolve => setTimeout(resolve, delay));

        await page.goto(`https://www.google.com/search?q=${encodeURIComponent(currentQuery)}&start=${pageNum}`, { waitUntil: 'networkidle0' });

        const links = await extractLinksFromPage(page);
        allResults.push(...links);

        console.log(`Found ${links.length} links on this page`);
        res.write(`data: ${JSON.stringify({ message: `Found ${links.length} links on this page` })}\n\n`);

        if (allResults.length >= minSitesToVisit) break;

        const nextButton = await page.$('a#pnnext');
        if (!nextButton) break;

        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      const sitesToVisit = allResults.slice(0, Math.min(minSitesToVisit, allResults.length));

      console.log(`Visiting ${sitesToVisit.length} sites to extract emails and phone numbers for query: "${currentQuery}"`);
      res.write(`data: ${JSON.stringify({ message: `Visiting ${sitesToVisit.length} sites to extract emails and phone numbers for query: "${currentQuery}"` })}\n\n`);

      for (const [index, link] of sitesToVisit.entries()) {
        console.log(`Visiting site ${index + 1}/${sitesToVisit.length}: ${link.url}`);
        res.write(`data: ${JSON.stringify({ message: `Visiting site ${index + 1}/${sitesToVisit.length}: ${link.url}` })}\n\n`);
        const { emails, phoneNumbers } = await extractEmailsAndPhonesFromPage(page, link.url, retries, timeout);
        const result = { query: currentQuery, rank: index + 1, ...link, emails, phoneNumbers };
        
        finalResults.push(result);
        console.log(`Found ${emails.length} emails and ${phoneNumbers.length} phone numbers`);
        res.write(`data: ${JSON.stringify({ result })}\n\n`);
        
        const delay = getRandomDelay(minDelay, maxDelay);
        console.log(`Waiting for ${delay}ms before next site...`);
        res.write(`data: ${JSON.stringify({ message: `Waiting for ${delay}ms before next site...` })}\n\n`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }

      console.log(`Search completed for query: "${currentQuery}". Found data for ${sitesToVisit.length} sites.`);
      res.write(`data: ${JSON.stringify({ message: `Search completed for query: "${currentQuery}". Found data for ${sitesToVisit.length} sites.` })}\n\n`);
    }

    console.log(`All searches completed. Found data for ${finalResults.length} sites across all queries.`);
    res.write(`data: ${JSON.stringify({ message: `All searches completed. Found data for ${finalResults.length} sites across all queries.` })}\n\n`);
    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
  } catch (error) {
    console.error('Error:', error);
    res.write(`data: ${JSON.stringify({ error: 'An unexpected error occurred while fetching search results, emails, and phone numbers' })}\n\n`);
    res.end();
  } finally {
    if (browser) {
      await browser.close();
    }
  }
});

app.get('/api/get-final-results', (req, res) => {
  res.json({ results: finalResults });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
