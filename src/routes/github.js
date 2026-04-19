const express = require('express');
const router = express.Router();
const { db } = require('../db/init');
const Anthropic = require('@anthropic-ai/sdk');

const HAIKU = 'claude-haiku-4-5-20251001';

// GET /github/activity?repo=OWNER/REPO
router.get('/activity', async (req, res) => {
  try {
    const repo = req.query.repo || 'Gametime/gametime';
    if (!repo.includes('/')) {
      return res.status(400).json({ error: 'repo must be in OWNER/REPO format' });
    }

    const headers = { 'User-Agent': 'JARVIS-v2' };
    if (process.env.GITHUB_TOKEN) {
      headers['Authorization'] = `Bearer ${process.env.GITHUB_TOKEN}`;
    }

    const response = await fetch(
      `https://api.github.com/repos/${repo}/commits?per_page=10`,
      { headers }
    );

    if (!response.ok) {
      const errBody = await response.text();
      return res.status(response.status).json({ error: `GitHub API error: ${response.status}`, detail: errBody });
    }

    const rawCommits = await response.json();

    const insert = db.prepare(`
      INSERT OR IGNORE INTO github_events (repo, event_type, title, sha, author, url, event_at)
      VALUES (?, 'commit', ?, ?, ?, ?, ?)
    `);

    const insertMany = db.transaction((commits) => {
      for (const c of commits) {
        insert.run(
          repo,
          c.commit.message.split('\n')[0].slice(0, 500),
          c.sha,
          c.commit.author?.name || 'unknown',
          c.html_url,
          c.commit.author?.date || null
        );
      }
    });
    insertMany(rawCommits);

    const commits = rawCommits.map((c) => ({
      sha: c.sha.slice(0, 8),
      message: c.commit.message.split('\n')[0],
      author: c.commit.author?.name || 'unknown',
      date: c.commit.author?.date || null,
      url: c.html_url,
    }));

    res.json({ repo, commits });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /github/events
router.get('/events', (req, res) => {
  try {
    const events = db
      .prepare(
        `SELECT id, repo, event_type, title, sha, author, url, event_at, created_at
         FROM github_events ORDER BY created_at DESC LIMIT 20`
      )
      .all();
    res.json({ events });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /github/summary
router.get('/summary', async (req, res) => {
  try {
    const events = db
      .prepare(
        `SELECT repo, title, author, event_at FROM github_events
         ORDER BY created_at DESC LIMIT 30`
      )
      .all();

    if (!events.length) {
      return res.json({ summary: 'No commits found in the database yet.', commit_count: 0, last_activity: null });
    }

    const commitLines = events
      .map((e, i) => `${i + 1}. [${e.repo}] ${e.title} — by ${e.author} at ${e.event_at || 'unknown time'}`)
      .join('\n');

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const msg = await client.messages.create({
      model: HAIKU,
      max_tokens: 400,
      messages: [
        {
          role: 'user',
          content: `You are JARVIS, an AI assistant for Rehan's startup Gametime. Summarize the following recent GitHub commits in 2-3 sentences. Focus on what has been worked on and any notable patterns.\n\nCommits:\n${commitLines}`,
        },
      ],
    });

    const summary = msg.content[0].text.trim();
    const last_activity = events[0].event_at || null;

    res.json({ summary, commit_count: events.length, last_activity });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
