const express = require('express');
const router = express.Router();
const https = require('https');
const http = require('http');
const { db } = require('../db/init');

const FEEDS = [
  { url: 'https://feeds.bbci.co.uk/news/world/rss.xml', source: 'BBC', category: 'world' },
  { url: 'https://hnrss.org/frontpage', source: 'HackerNews', category: 'tech' },
];

function fetchUrl(urlStr) {
  return new Promise((resolve, reject) => {
    const lib = urlStr.startsWith('https') ? https : http;
    lib.get(urlStr, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

function parseItems(xml, limit = 5) {
  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;
  while ((match = itemRegex.exec(xml)) !== null && items.length < limit) {
    const block = match[1];
    const titleMatch = block.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/);
    const linkMatch = block.match(/<link>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/link>/) ||
                      block.match(/<link[^>]*href="([^"]+)"/);
    const pubDateMatch = block.match(/<pubDate>([\s\S]*?)<\/pubDate>/);

    const title = titleMatch ? titleMatch[1].trim() : null;
    const url = linkMatch ? linkMatch[1].trim() : null;
    const publishedAt = pubDateMatch ? pubDateMatch[1].trim() : null;

    if (title && url) {
      items.push({ title, url, publishedAt });
    }
  }
  return items;
}

// GET /news/fetch
router.get('/fetch', async (req, res) => {
  try {
    const insertStmt = db.prepare(
      'INSERT OR IGNORE INTO news_items (title, url, source, category, published_at) VALUES (?,?,?,?,?)'
    );

    let totalFetched = 0;
    const allItems = [];

    for (const feed of FEEDS) {
      try {
        const xml = await fetchUrl(feed.url);
        const items = parseItems(xml, 5);
        for (const item of items) {
          const result = insertStmt.run(item.title, item.url, feed.source, feed.category, item.publishedAt || null);
          if (result.changes > 0) totalFetched++;
          allItems.push({ ...item, source: feed.source, category: feed.category });
        }
      } catch (feedErr) {
        console.error(`[news] Failed to fetch ${feed.url}:`, feedErr.message);
      }
    }

    res.json({ fetched: totalFetched, items: allItems });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /news/latest?limit=10&category=
router.get('/latest', (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const category = req.query.category || '';

    let rows;
    if (category) {
      rows = db.prepare(
        'SELECT * FROM news_items WHERE category=? ORDER BY published_at DESC LIMIT ?'
      ).all(category, limit);
    } else {
      rows = db.prepare(
        'SELECT * FROM news_items ORDER BY published_at DESC LIMIT ?'
      ).all(limit);
    }

    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
