const fs = require("fs");
const path = require("path");
const fetch = require("node-fetch");
const xml2js = require("xml2js");

const CACHE_FILE = path.join(__dirname, "data", "news_cache.json");
const CACHE_TTL = 6 * 60 * 60 * 1000; // 6 hours

const GOOGLE_NEWS_WORLD =
  "https://news.google.com/rss?hl=en&gl=US&ceid=US:en";

const GOOGLE_NEWS_PH =
  "https://news.google.com/rss/search?q=Philippines&hl=en-PH&gl=PH&ceid=PH:en";

async function fetchRSS(url) {
  const res = await fetch(url);
  const xml = await res.text();
  const parsed = await xml2js.parseStringPromise(xml);
  const items = parsed?.rss?.channel?.[0]?.item || [];
  return items.slice(0, 5);

}

function formatItems(items) {
  return items.map((item) => ({
    title: item.title[0],
    link: item.link[0],
    source: item.source?.[0]?._ || "Unknown"
  }));
}

function loadCache() {
  try {
    if (!fs.existsSync(CACHE_FILE)) return null;
    const raw = fs.readFileSync(CACHE_FILE, "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function saveCache(data) {
  fs.writeFileSync(CACHE_FILE, JSON.stringify(data, null, 2));
}

async function getNews() {
  const cache = loadCache();

  if (cache && Date.now() - cache.timestamp < CACHE_TTL) {
    return cache.data;
  }

  try {
    const world = await fetchRSS(GOOGLE_NEWS_WORLD);
    const ph = await fetchRSS(GOOGLE_NEWS_PH);

    const data = {
      world: formatItems(world),
      philippines: formatItems(ph)
    };

    saveCache({
      timestamp: Date.now(),
      data
    });

    return data;
  } catch (err) {
    console.error("NEWS FETCH ERROR:", err);
    return null;
  }
}

module.exports = { getNews };
