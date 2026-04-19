const express = require('express');
const router = express.Router();
const { db } = require('../db/init');
const Anthropic = require('@anthropic-ai/sdk');

const HAIKU = 'claude-haiku-4-5-20251001';

// POST /decisions — Log a decision
router.post('/', (req, res) => {
  try {
    const { title, context = null, decision, tags = null } = req.body;
    if (!title || typeof title !== 'string' || title.trim().length === 0) {
      return res.status(400).json({ error: 'title is required' });
    }
    if (!decision || typeof decision !== 'string' || decision.trim().length === 0) {
      return res.status(400).json({ error: 'decision is required' });
    }

    const tagsStr = Array.isArray(tags) ? tags.join(',') : (tags || null);

    const stmt = db.prepare(
      `INSERT INTO decisions (title, context, decision, tags) VALUES (?, ?, ?, ?)`
    );
    const result = stmt.run(title.trim(), context || null, decision.trim(), tagsStr);

    const saved = db.prepare('SELECT * FROM decisions WHERE id = ?').get(result.lastInsertRowid);
    if (saved.tags) saved.tags = saved.tags.split(',').map((t) => t.trim());

    return res.status(201).json(saved);
  } catch (err) {
    console.error('[decisions POST]', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// GET /decisions — Last 20 decisions, newest first
router.get('/', (req, res) => {
  try {
    const rows = db.prepare(
      `SELECT * FROM decisions ORDER BY created_at DESC LIMIT 20`
    ).all();

    const parsed = rows.map((r) => ({
      ...r,
      tags: r.tags ? r.tags.split(',').map((t) => t.trim()) : [],
    }));

    return res.json(parsed);
  } catch (err) {
    console.error('[decisions GET]', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// GET /decisions/stats — Stats overview
router.get('/stats', (req, res) => {
  try {
    const total = db.prepare('SELECT COUNT(*) as count FROM decisions').get().count;
    const pendingOutcomes = db.prepare(
      `SELECT COUNT(*) as count FROM decisions WHERE outcome IS NULL OR outcome = ''`
    ).get().count;

    const recent = db.prepare(
      `SELECT * FROM decisions ORDER BY created_at DESC LIMIT 5`
    ).all().map((r) => ({
      ...r,
      tags: r.tags ? r.tags.split(',').map((t) => t.trim()) : [],
    }));

    return res.json({
      total,
      pending_outcomes: pendingOutcomes,
      recent,
    });
  } catch (err) {
    console.error('[decisions/stats]', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// POST /decisions/analyze — Claude analysis of options
router.post('/analyze', async (req, res) => {
  try {
    const { title, context = '', options } = req.body;
    if (!title || typeof title !== 'string' || title.trim().length === 0) {
      return res.status(400).json({ error: 'title is required' });
    }
    if (!Array.isArray(options) || options.length < 2) {
      return res.status(400).json({ error: 'options must be an array with at least 2 items' });
    }

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const systemPrompt = `You are a sharp decision analyst. Analyze the given decision scenario and recommend the best option.
Return ONLY a valid JSON object with exactly these fields:
{
  "recommended": "<the exact option you recommend from the list>",
  "reasoning": "<clear and concise explanation of why this option is best>",
  "risks": ["<risk 1>", "<risk 2>", "<risk 3>"],
  "considerations": ["<consideration 1>", "<consideration 2>", "<consideration 3>"]
}
Return ONLY valid JSON, no markdown, no extra text.`;

    const userPrompt = `Decision to make: ${title}
${context ? `Context: ${context}` : ''}

Options to evaluate:
${options.map((o, i) => `${i + 1}. ${o}`).join('\n')}

Analyze these options and recommend the best one.`;

    const message = await client.messages.create({
      model: HAIKU,
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const rawText = message.content[0].text.trim();
    let parsed;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return res.status(500).json({ error: 'Failed to parse Claude response' });
      parsed = JSON.parse(jsonMatch[0]);
    }

    return res.json({
      recommended: parsed.recommended,
      reasoning: parsed.reasoning,
      risks: parsed.risks,
      considerations: parsed.considerations,
    });
  } catch (err) {
    console.error('[decisions/analyze]', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// PATCH /decisions/:id/outcome — Record outcome
router.patch('/:id/outcome', (req, res) => {
  try {
    const { id } = req.params;
    const { outcome } = req.body;

    if (!outcome || typeof outcome !== 'string' || outcome.trim().length === 0) {
      return res.status(400).json({ error: 'outcome is required' });
    }

    const existing = db.prepare('SELECT id FROM decisions WHERE id = ?').get(id);
    if (!existing) {
      return res.status(404).json({ error: 'Decision not found' });
    }

    db.prepare('UPDATE decisions SET outcome = ? WHERE id = ?').run(outcome.trim(), id);

    const updated = db.prepare('SELECT * FROM decisions WHERE id = ?').get(id);
    if (updated.tags) updated.tags = updated.tags.split(',').map((t) => t.trim());

    return res.json(updated);
  } catch (err) {
    console.error('[decisions/:id/outcome]', err.message);
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
