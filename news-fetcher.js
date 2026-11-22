const fs = require("fs");
const path = require("path");
const fetch = require("node-fetch");
const xml2js = require("xml2js");
const { countryCode, countryName } = require("./user-context");

const CACHE_FILE = path.join(__dirname, "data", "news_cache.json");
const CACHE_TTL = 6 * 60 * 60 * 1000; // 6 hours

const GOOGLE_NEWS_WORLD =
  "https://news.google.com/rss?hl=en&gl=US&ceid=US:en";

const GOOGLE_NEWS_PH =
  "https://news.google.com/rss/search?q=Philippines&hl=en-PH&gl=PH&ceid=PH:en";

async function fetchRSS(url) {
  const res = await fetch(url, { timeout: 4000, size: 2 * 1024 * 1024 });
  if (!res.ok) throw new Error(`RSS status ${res.status}`);
  const xml = await res.text();
  const parsed = await xml2js.parseStringPromise(xml);
  const items = parsed?.rss?.channel?.[0]?.item || [];
  return items.slice(0, 5);

}

function formatItems(items) {
  return items.filter((item) => item.title?.[0] && item.link?.[0]).map((item) => ({
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
    const [world, ph] = await Promise.all([
      fetchRSS(GOOGLE_NEWS_WORLD), fetchRSS(GOOGLE_NEWS_PH).catch(() => [])
    ]);

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

const countryFeeds = new Map();

function countryFeed(country) {
  const now = Date.now();
  const cached = countryFeeds.get(country);
  if (cached?.expires > now) return cached.items;
  const url = new URL("https://news.google.com/rss/search");
  url.search = new URLSearchParams({
    q: countryName(country), hl: "en", gl: country, ceid: `${country}:en`
  }).toString();
  const items = fetchRSS(url).then(formatItems).catch(() => {
    countryFeeds.delete(country);
    return [];
  });
  if (countryFeeds.size >= 64) countryFeeds.delete(countryFeeds.keys().next().value);
  countryFeeds.set(country, { expires: now + CACHE_TTL, items });
  return items;
}

async function getCountryNews(value) {
  const country = countryCode(value);
  const [base, regional] = await Promise.all([
    getNews(),
    country && country !== "PH" ? countryFeed(country) : []
  ]);
  return {
    world: base?.world || [],
    regional: country === "PH" ? base?.philippines || [] : regional,
    country
  };
}

function isNewsRequest(text) {
  return /\b(?:news|balita|actualités|noticias|nachrichten|notizie)\b|happening now|latest events|latest updates|what['’]?s going on|ano(?:ng)? nangyayari|ニュース|新闻|أخبار/iu.test(text);
}

module.exports = { getNews, getCountryNews, isNewsRequest };
