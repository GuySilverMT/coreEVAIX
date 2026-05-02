import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import * as fs from 'fs/promises';

async function fetchAndParse(url: string) {
  try {
    console.log(`Fetching URL: ${url}`);

    // 1. Fetch raw HTML using native fetch
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'EVAIX-Core-Fetcher/1.0',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5'
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch. Status: ${response.status} ${response.statusText}`);
    }

    const htmlContent = await response.text();

    // 2. Parse HTML using jsdom
    console.log(`Parsing HTML content...`);
    const dom = new JSDOM(htmlContent, { url });

    // 3. Extract readable text using Readability
    const reader = new Readability(dom.window.document);
    const article = reader.parse();

    if (!article) {
      throw new Error('Readability failed to parse the document content.');
    }

    // 4. Write pure text to temp_research.md
    const markdownContent = `# ${article.title}\n\n${article.textContent?.trim() || ''}`;
    await fs.writeFile('temp_research.md', markdownContent, 'utf-8');

    console.log(`Successfully extracted content and wrote to temp_research.md`);
  } catch (error: any) {
    console.error(`Error in fetcher: ${error.message}`);
    process.exit(1);
  }
}

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error("Usage: npx tsx src/evaix-fetch.ts <URL>");
  process.exit(1);
}

const targetUrl = args[0] as string;
fetchAndParse(targetUrl).catch(console.error);
