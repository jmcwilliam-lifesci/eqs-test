const puppeteer = require("puppeteer");
const fs = require('fs');
const cheerio = require('cheerio');
require("dotenv").config();

// Utility function to sleep
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Function to load existing news data
function loadExistingData(language = 'en') {
  const filename = `news_data_${language}.json`;
  try {
    if (fs.existsSync(filename)) {
      return JSON.parse(fs.readFileSync(filename, 'utf8'));
    }
  } catch (error) {
    console.error(`Error loading existing data: ${error}`);
  }
  return [];
}

// Function to save a single news item
function saveNewsItem(item, language = 'en') {
  const filename = `news_data_${language}.json`;
  try {
    // Load current data
    let currentData = loadExistingData(language);
    
    // Remove any existing item with the same URL if it exists
    currentData = currentData.filter(existing => existing.url !== item.url);
    
    // Add the new item
    currentData.push(item);
    
    // Sort by date and time (newest first)
    currentData.sort((a, b) => {
      const dateA = new Date(`${a.date} ${a.time}`);
      const dateB = new Date(`${b.date} ${b.time}`);
      return dateB - dateA;
    });
    
    // Save back to file
    fs.writeFileSync(filename, JSON.stringify(currentData, null, 2));
    console.log(`Updated ${filename} with item: ${item.headline}`);
  } catch (error) {
    console.error(`Error saving to ${filename}:`, error);
  }
}

// Function to parse the news list HTML
function parseNewsData(html) {
  const $ = cheerio.load(html);
  const newsItems = [];
  
  $('.news__list').each((i, element) => {
    const $item = $(element);
    const date = $item.prevAll('.news__date').first().text().trim();
    
    const newsItem = {
      date: date,
      time: $item.find('.news__time').text().trim(),
      company: $item.find('.news__company').text().trim(),
      type: $item.find('.news__type').first().text().trim(),
      headline: $item.find('.news__heading').text().trim(),
      url: $item.attr('href'),
      newsId: $item.attr('data-news-item'),
      languages: JSON.parse($item.attr('data-news-languages') || '[]'),
      isin: $item.attr('data-news-isin'),
      content: {}, // Will store content for different languages
      scrapedAt: new Date().toISOString() // Add timestamp for when this was scraped
    };
    
    newsItems.push(newsItem);
  });
  
  return newsItems;
}

// Function to get detailed content for a news item
async function getNewsDetail(page, url, language) {
  try {
    // Modify URL for different language if needed
    const targetUrl = language === 'de' ? url.replace('_en', '_de') : url;
    
    console.log(`Fetching detailed content for: ${targetUrl}`);
    await page.goto(targetUrl, { waitUntil: 'networkidle0' });
    
    // Wait for the content to load
    await page.waitForSelector('.news-details__content');
    
    const content = await page.evaluate(() => {
      const contentElement = document.querySelector('.news-details__content');
      
      // Extract only the headline text content (without the company name)
      // This targets the text content after the <br> tag in the h1
      let headline = '';
      const titleElement = document.querySelector('.news-details__title');
      if (titleElement && titleElement.innerHTML) {
        const parts = titleElement.innerHTML.split('<br>');
        if (parts.length > 1) {
          headline = parts[1].replace(/<[^>]*>/g, '').trim();
        }
      }
      
      return {
        content: contentElement ? contentElement.innerHTML : '',
        headline: headline
      };
    });
    
    return content;
  } catch (error) {
    console.error(`Error fetching detail for ${url}: ${error}`);
    return null;
  }
}

// Main scraping function
async function scrapeNews(page) {
  try {
    // Load the main news page
    console.log('Loading main news page...');
    await page.goto('https://www.eqs-news.com/company/curevac/news/db2ecefe-75b1-1014-b5b2-42d716257b19', {
      waitUntil: 'networkidle0'
    });
    
    // Get the initial news list
    const htmlContent = await page.content();
    const newsItems = parseNewsData(htmlContent);
    
    // Just get the latest 2 items regardless of whether they've been seen before
    const latestItems = newsItems.slice(0, 2);
    
    console.log(`Found ${latestItems.length} latest items to return`);
    
    // Process each news item to get content
    for (let i = 0; i < latestItems.length; i++) {
      const item = latestItems[i];
      console.log(`Processing item ${i + 1} of ${latestItems.length}: ${item.headline}`);
      
      try {
        // Get English content
        const enResult = await getNewsDetail(page, item.url, 'en');
        item.content.en = enResult.content;
        await sleep(5000); // 5 second delay
        
        // If German version exists, get it too
        if (item.languages.includes('de')) {
          const deResult = await getNewsDetail(page, item.url, 'de');
          item.content.de = deResult.content;
          item.headlineDE = deResult.headline;
          await sleep(5000);
        }
        
        console.log(`Completed processing item ${i + 1}`);
      } catch (error) {
        console.error(`Error processing item ${item.headline}:`, error);
        // Continue with next item even if this one fails
        continue;
      }
    }
    
    return { status: 'success', message: `Returning ${latestItems.length} latest news items`, data: latestItems };
  } catch (error) {
    console.error('Error during scraping:', error);
    return { status: 'error', message: `Error during scraping: ${error.message}` };
  }
}

const scrapeLogic = async (res) => {
  const browser = await puppeteer.launch({
    args: [
      "--disable-setuid-sandbox",
      "--no-sandbox",
      "--single-process",
      "--no-zygote",
    ],
    executablePath:
      process.env.NODE_ENV === "production"
        ? process.env.PUPPETEER_EXECUTABLE_PATH
        : puppeteer.executablePath(),
  });
  try {
    const page = await browser.newPage();

    // Set screen size
    await page.setViewport({ width: 1080, height: 1024 });

    // Run the news scraper
    const result = await scrapeNews(page);
    
    // Send the result back in the response
    res.send(result);
    
  } catch (e) {
    console.error(e);
    res.send(`Something went wrong while running Puppeteer: ${e}`);
  } finally {
    await browser.close();
  }
};

module.exports = { scrapeLogic };
