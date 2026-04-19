const express = require('express');
const router = express.Router();
const Anthropic = require('@anthropic-ai/sdk');
const { db, setMemory, getMemory } = require('../db/init');
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// In-memory store for recent predictions (keyed by timestamp, last 10)
const predictionLog = [];

// ─── Helpers ────────────────────────────────────────────────────────────────

function getSGTHour() {
  const now = new Date();
  // SGT = UTC+8
  const sgtMs = now.getTime() + 8 * 60 * 60 * 1000;
  return new Date(sgtMs).getUTCHours();
}

async function extractTopics(messages, hour) {
  if (!messages.length) return [];
  const sample = messages.slice(0, 40).map(m => m.content).join('\n---\n');
  try {
    const res = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      system: [{ type: 'text', text: 'You extract topic labels from conversation messages. Respond with a JSON array of exactly 3 short topic strings (e.g. ["SAT prep","calendar review","Gametime metrics"]). No prose.', cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: `Hour ${hour} SGT messages:\n${sample}\n\nReturn JSON array of top 3 topics.` }]
    });
    const raw = res.content[0].text.trim();
    const match = raw.match(/\[[\s\S]*?\]/);
    if (match) return JSON.parse(match[0]);
    return [];
  } catch {
    return [];
  }
}

// ─── GET /predict/patterns ───────────────────────────────────────────────────

router.get('/patterns', async (req, res) => {
  try {
    // Fetch last 500 user messages with SGT hour
    const rows = db.prepare(
      `SELECT content, strftime('%H', datetime(created_at, '+8 hours')) as sgt_hour
       FROM conversations
       WHERE role='user'
       ORDER BY created_at DESC
       LIMIT 500`
    ).all();

    // Group by hour
    const hourMap = {};
    for (let h = 0; h < 24; h++) {
      hourMap[h] = { hour: h, messageCount: 0, messages: [], topTopics: [] };
    }

    for (const row of rows) {
      const h = parseInt(row.sgt_hour, 10);
      if (!isNaN(h) && h >= 0 && h < 24) {
        hourMap[h].messageCount++;
        hourMap[h].messages.push({ content: row.content });
      }
    }

    // Find top 3 busiest hours
    const sorted = Object.values(hourMap).sort((a, b) => b.messageCount - a.messageCount);
    const top3 = sorted.slice(0, 3);

    // Extract topics for top 3 hours in parallel
    await Promise.all(
      top3.map(async (entry) => {
        entry.topTopics = await extractTopics(entry.messages, entry.hour);
      })
    );

    // Build final array (strip internal messages array)
    const patterns = Object.values(hourMap)
      .sort((a, b) => a.hour - b.hour)
      .map(({ hour, messageCount, topTopics }) => ({ hour, messageCount, topTopics }));

    res.json({ patterns });
  } catch (err) {
    console.error('[predict] /patterns error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /predict/next ──────────────────────────────────────────────────────

router.post('/next', async (req, res) => {
  try {
    const lookahead = parseInt(req.body?.lookahead_minutes, 10) || 30;
    const currentHour = getSGTHour();

    // Get pattern for current hour
    const hourRows = db.prepare(
      `SELECT content
       FROM conversations
       WHERE role='user'
         AND strftime('%H', datetime(created_at, '+8 hours')) = ?
       ORDER BY created_at DESC
       LIMIT 50`
    ).all(String(currentHour).padStart(2, '0'));

    const patternSummary = hourRows.length
      ? hourRows.slice(0, 15).map(r => r.content).join(' | ')
      : 'No historical pattern for this hour.';

    // Get last 5 conversation messages
    const recent = db.prepare(
      `SELECT role, content FROM conversations ORDER BY created_at DESC LIMIT 5`
    ).all().reverse();

    const recentContext = recent.length
      ? recent.map(r => `${r.role}: ${r.content}`).join('\n')
      : 'No recent conversation context.';

    // Ask Claude haiku for prediction
    const prompt = `Current SGT hour: ${currentHour}:00. Lookahead: ${lookahead} minutes.

Historical pattern for this hour (sample of past messages):
${patternSummary}

Recent conversation context:
${recentContext}

Based on these patterns and recent context, what is Rehan most likely to want in the next ${lookahead} minutes?

Return ONLY valid JSON in this exact shape:
{
  "prediction": "string describing what he will likely want",
  "confidence": 0.0,
  "suggested_action": "string describing what JARVIS should do proactively",
  "route": "/route/to/prefetch or null"
}`;

    const claudeRes = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      system: [{ type: 'text', text: 'You are JARVIS, a predictive intelligence layer. You analyze Rehan Khadernayak\'s behavior patterns and predict his next request. Return only valid JSON, no prose.', cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: prompt }]
    });

    let prediction;
    try {
      const raw = claudeRes.content[0].text.trim();
      const match = raw.match(/\{[\s\S]*\}/);
      prediction = match ? JSON.parse(match[0]) : JSON.parse(raw);
    } catch {
      prediction = {
        prediction: claudeRes.content[0].text.trim(),
        confidence: 0.5,
        suggested_action: 'Monitor and wait.',
        route: null
      };
    }

    prediction.hour = currentHour;
    prediction.lookahead_minutes = lookahead;
    prediction.timestamp = new Date().toISOString();

    // Store in memory table
    const key = `prediction_${Date.now()}`;
    setMemory(key, JSON.stringify(prediction));

    // Keep in-memory log (last 10)
    predictionLog.push({ key, ...prediction });
    if (predictionLog.length > 10) predictionLog.shift();

    // Prefetch if confident and has a route
    if (prediction.route && typeof prediction.route === 'string' && prediction.confidence > 0.7) {
      fetch(`http://localhost:3001${prediction.route}`).catch(() => {});
    }

    res.json(prediction);
  } catch (err) {
    console.error('[predict] /next error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /predict/prefetch ──────────────────────────────────────────────────

router.post('/prefetch', async (req, res) => {
  try {
    const targets = [
      { name: 'calendar', path: '/calendar/today' },
      { name: 'gmail',    path: '/gmail/unread' },
      { name: 'gametime', path: '/gametime/status' }
    ];

    // Fire all in parallel — warm the cache, ignore failures
    await Promise.allSettled(
      targets.map(t => fetch(`http://localhost:3001${t.path}`).catch(() => {}))
    );

    const timestamp = new Date().toISOString();
    res.json({
      prefetched: targets.map(t => t.name),
      timestamp
    });
  } catch (err) {
    console.error('[predict] /prefetch error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /predict/history ────────────────────────────────────────────────────

router.get('/history', (req, res) => {
  try {
    // Pull last 10 prediction_* keys from memory table
    const rows = db.prepare(
      `SELECT key, value, updated_at
       FROM memory
       WHERE key LIKE 'prediction_%'
       ORDER BY updated_at DESC
       LIMIT 10`
    ).all();

    const history = rows.map(row => {
      try {
        return { key: row.key, ...JSON.parse(row.value), stored_at: row.updated_at };
      } catch {
        return { key: row.key, raw: row.value, stored_at: row.updated_at };
      }
    });

    res.json({ history, count: history.length });
  } catch (err) {
    console.error('[predict] /history error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
