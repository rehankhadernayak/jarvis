'use strict';

const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const os = require('os');
const Anthropic = require('@anthropic-ai/sdk');
const { db, getMemory } = require('../db/init');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const HAIKU = 'claude-haiku-4-5-20251001';

// ─────────────────────────────────────────────────────────────────────────────
// POST /memory-recall/log
// Body: { role: 'user'|'assistant', content: string, session_id?: string }
// ─────────────────────────────────────────────────────────────────────────────
router.post('/log', (req, res) => {
  try {
    const { role, content, session_id } = req.body;
    if (!role || !content) return res.status(400).json({ error: '"role" and "content" are required' });
    if (!['user', 'assistant'].includes(role)) return res.status(400).json({ error: '"role" must be "user" or "assistant"' });

    // conversations table has (id, role, content, created_at) — session_id stored in content prefix if provided
    const stored = session_id ? content : content;
    const result = db.prepare(
      'INSERT INTO conversations (role, content) VALUES (?,?)'
    ).run(role, stored);

    res.status(201).json({ id: result.lastInsertRowid, ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /memory-recall/recent?limit=20
// ─────────────────────────────────────────────────────────────────────────────
router.get('/recent', (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 200);
    const rows = db.prepare(
      'SELECT id, role, content, created_at FROM conversations ORDER BY id DESC LIMIT ?'
    ).all(limit);
    res.json({ count: rows.length, conversations: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /memory-recall/search
// Body: { query: string, limit?: number }
// ─────────────────────────────────────────────────────────────────────────────
router.post('/search', async (req, res) => {
  try {
    const { query, limit: rawLimit } = req.body;
    if (!query?.trim()) return res.status(400).json({ error: '"query" is required' });
    const limit = Math.min(parseInt(rawLimit, 10) || 10, 50);

    // Pull the last 100 conversations from the DB
    const pool = db.prepare(
      'SELECT id, role, content, created_at FROM conversations ORDER BY id DESC LIMIT 100'
    ).all();

    if (pool.length < 5) {
      return res.json({
        query,
        matches: pool.slice(0, limit),
        total_searched: pool.length,
        note: 'Not enough conversation history for semantic search — returning most recent entries.',
      });
    }

    // Build a numbered snippet list for Claude
    const snippets = pool
      .map((row, i) => `[${i}] (${row.role}, ${row.created_at}): ${row.content.slice(0, 200)}`)
      .join('\n');

    const prompt = `You are a memory retrieval assistant. Given a user query, identify the most relevant past conversations from the list below.

Query: "${query}"

Past conversations (indexed 0–${pool.length - 1}):
${snippets}

Return a JSON object with exactly two fields:
- "indices": an array of integer indices (up to ${limit}) of the most relevant conversations, ordered by relevance (most relevant first).
- "explanation": a 1-2 sentence explanation of why these were chosen.

Return only valid JSON, no extra text.`;

    const msg = await client.messages.create({
      model: HAIKU,
      max_tokens: 512,
      messages: [{ role: 'user', content: prompt }],
    });

    let indices = [];
    let explanation = '';
    try {
      const raw = msg.content[0].text.trim();
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON object in response');
      const parsed = JSON.parse(jsonMatch[0]);
      indices = Array.isArray(parsed.indices) ? parsed.indices.filter(i => Number.isInteger(i) && i >= 0 && i < pool.length) : [];
      explanation = parsed.explanation || '';
    } catch (parseErr) {
      // Fall back: return recent entries
      console.warn('[memory-recall/search] Failed to parse Claude response:', parseErr.message);
      return res.json({
        query,
        matches: pool.slice(0, limit).map(r => ({ ...r, relevance: 'fallback — parse error' })),
        total_searched: pool.length,
        explanation: 'Semantic ranking unavailable, returning most recent.',
      });
    }

    const matches = indices.slice(0, limit).map(i => ({
      ...pool[i],
      relevance: explanation,
    }));

    res.json({
      query,
      matches,
      total_searched: pool.length,
      explanation,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /memory-recall/stats
// ─────────────────────────────────────────────────────────────────────────────
router.get('/stats', (req, res) => {
  try {
    const total = db.prepare('SELECT COUNT(*) AS c FROM conversations').get().c;
    const first = db.prepare('SELECT created_at FROM conversations ORDER BY id ASC LIMIT 1').get();
    const last = db.prepare('SELECT created_at FROM conversations ORDER BY id DESC LIMIT 1').get();
    const userCount = db.prepare("SELECT COUNT(*) AS c FROM conversations WHERE role='user'").get().c;
    const assistantCount = db.prepare("SELECT COUNT(*) AS c FROM conversations WHERE role='assistant'").get().c;

    res.json({
      total_messages: total,
      first_message: first?.created_at ?? null,
      last_message: last?.created_at ?? null,
      user_messages: userCount,
      assistant_messages: assistantCount,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /memory-recall/forget
// Body: { before_date: string }  e.g. "2026-01-01" or "2026-01-01T00:00:00Z"
// ─────────────────────────────────────────────────────────────────────────────
router.post('/forget', (req, res) => {
  try {
    const { before_date } = req.body;
    if (!before_date) return res.status(400).json({ error: '"before_date" is required' });

    // Validate that it parses as a real date
    const ts = new Date(before_date);
    if (isNaN(ts.getTime())) return res.status(400).json({ error: `"${before_date}" is not a valid date` });

    const isoDate = ts.toISOString().replace('T', ' ').slice(0, 19); // SQLite datetime format
    const result = db.prepare("DELETE FROM conversations WHERE created_at < ?").run(isoDate);

    res.json({ deleted: result.changes });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// buildContextSnapshot — writes CONTEXT.md to ~/.openclaw/workspace/
// Called on load and every 5 minutes.
// ─────────────────────────────────────────────────────────────────────────────
const OPENCLAW_WORKSPACE = path.join(os.homedir(), '.openclaw', 'workspace');
const CONTEXT_FILE = path.join(OPENCLAW_WORKSPACE, 'CONTEXT.md');

async function buildContextSnapshot() {
  try {
    // 1. Current date/time in SGT (UTC+8)
    const nowUtc = new Date();
    const sgtOffset = 8 * 60 * 60 * 1000;
    const sgtDate = new Date(nowUtc.getTime() + sgtOffset);
    const sgtStr = sgtDate.toISOString().replace('T', ' ').slice(0, 19) + ' SGT';

    // 2. Memory key-values
    const mlCurrentDay = getMemory('ml_current_day') ?? 'unknown';
    const gametimeBetaUsers = getMemory('gametime_beta_users') ?? 'unknown';
    const satLastSessionRaw = getMemory('sat_last_session');
    let satLastSession = 'none';
    if (satLastSessionRaw) {
      try {
        const parsed = JSON.parse(satLastSessionRaw);
        satLastSession = `${parsed.date ?? '?'} — score ${parsed.score}/${parsed.attempted}, weak: ${parsed.weakAreas || parsed.weak_areas || 'n/a'}`;
      } catch (_) {
        satLastSession = satLastSessionRaw;
      }
    }

    // 3. Last 5 conversation turns
    const recentConvos = db.prepare(
      'SELECT role, content, created_at FROM conversations ORDER BY id DESC LIMIT 5'
    ).all().reverse(); // chronological order

    const convoBlock = recentConvos.length > 0
      ? recentConvos.map(r => `**${r.role}** (${r.created_at})\n${r.content.slice(0, 300)}${r.content.length > 300 ? '…' : ''}`).join('\n\n---\n\n')
      : '_No conversations yet._';

    // 4. Stats
    const total = db.prepare('SELECT COUNT(*) AS c FROM conversations').get().c;
    const userCount = db.prepare("SELECT COUNT(*) AS c FROM conversations WHERE role='user'").get().c;
    const assistantCount = db.prepare("SELECT COUNT(*) AS c FROM conversations WHERE role='assistant'").get().c;

    // 5. Assemble markdown
    const md = `# JARVIS Context Snapshot

_Auto-generated. Last updated: ${sgtStr}_

---

## Current Date & Time
${sgtStr}

---

## Memory Highlights

| Key | Value |
|-----|-------|
| ml_current_day | ${mlCurrentDay} |
| gametime_beta_users | ${gametimeBetaUsers} |
| sat_last_session | ${satLastSession} |

---

## Last 5 Conversation Turns

${convoBlock}

---

## Conversation Stats

- Total messages: ${total}
- User messages: ${userCount}
- Assistant messages: ${assistantCount}
`;

    // Write atomically: write to tmp then rename
    fs.mkdirSync(OPENCLAW_WORKSPACE, { recursive: true });
    const tmpFile = CONTEXT_FILE + '.tmp';
    fs.writeFileSync(tmpFile, md, 'utf8');
    fs.renameSync(tmpFile, CONTEXT_FILE);
  } catch (err) {
    console.error('[memory-recall] buildContextSnapshot error:', err.message);
  }
}

// Refresh every 5 minutes + immediately on load
setInterval(buildContextSnapshot, 5 * 60 * 1000);
buildContextSnapshot();

// ─────────────────────────────────────────────────────────────────────────────
// Exports — router as default, buildContextSnapshot as named property
// ─────────────────────────────────────────────────────────────────────────────
module.exports = router;
module.exports.buildContextSnapshot = buildContextSnapshot;
