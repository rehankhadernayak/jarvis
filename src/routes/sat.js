const express = require('express');
const router = express.Router();
const Anthropic = require('@anthropic-ai/sdk');
const { db, setMemory, getMemory } = require('../db/init');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// GET /sat/drill?count=5
router.get('/drill', async (req, res) => {
  const count = parseInt(req.query.count) || 5;
  try {
    const msg = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2048,
      messages: [{
        role: 'user',
        content: `Generate exactly ${count} SAT Reading & Writing multiple choice questions. Focus on: transition words, comma splices, rhetoric, sentence boundaries. Format each as JSON with fields: q (question text), choices (array of 4 strings A-D), answer (letter A-D), explanation (1 sentence). Return a JSON array only.`
      }]
    });

    const raw = msg.content[0].text;
    let questions;
    try {
      const match = raw.match(/\[[\s\S]*\]/);
      if (!match) throw new Error('No JSON array found');
      questions = JSON.parse(match[0]);
    } catch (parseErr) {
      return res.status(500).json({ error: 'Failed to parse Claude response', raw });
    }

    res.json({ questions });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /sat/grade
router.post('/grade', (req, res) => {
  try {
    const { questions, responses } = req.body;
    if (!questions || !responses) return res.status(400).json({ error: 'questions and responses required' });

    const TOPIC_KEYWORDS = {
      'transition words': /transition|however|therefore|furthermore|moreover|consequently|nevertheless/i,
      'comma splices': /comma splice|independent clause|run-on/i,
      'rhetoric': /rhetoric|tone|purpose|author|audience|persuasive|argumentative/i,
      'sentence boundaries': /sentence boundary|fragment|complete sentence|period|semicolon/i,
    };

    let correct = 0;
    const wrong = [];
    const weakAreaSet = new Set();

    questions.forEach((q, i) => {
      const given = responses[i] || responses[String(i)];
      if (given === q.answer) {
        correct++;
      } else {
        wrong.push({ q: q.q, correct: q.answer, given: given || null, explanation: q.explanation });
        // Detect weak areas from explanation text
        for (const [topic, pattern] of Object.entries(TOPIC_KEYWORDS)) {
          if (pattern.test(q.explanation || '') || pattern.test(q.q || '')) {
            weakAreaSet.add(topic);
          }
        }
      }
    });

    const total = questions.length;
    const pct = total > 0 ? Math.round((correct / total) * 100) : 0;

    res.json({
      score: correct,
      total,
      pct,
      wrong,
      weakAreas: Array.from(weakAreaSet)
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /sat/log
router.post('/log', (req, res) => {
  try {
    const { date, attempted, score, weakAreas, notes } = req.body;
    if (!date || attempted == null || score == null) {
      return res.status(400).json({ error: 'date, attempted, score required' });
    }
    const weakAreasStr = Array.isArray(weakAreas) ? weakAreas.join(', ') : (weakAreas || '');
    const result = db.prepare(
      'INSERT INTO sat_sessions (date, attempted, score, weak_areas, notes) VALUES (?,?,?,?,?)'
    ).run(date, attempted, score, weakAreasStr, notes || '');

    setMemory('sat_last_session', JSON.stringify({ date, attempted, score, weakAreas: weakAreasStr }));

    res.json({ ok: true, id: result.lastInsertRowid });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /sat/history
router.get('/history', (req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM sat_sessions ORDER BY date DESC LIMIT 10').all();
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /sat/status
router.get('/status', (req, res) => {
  try {
    const lastSessionRaw = getMemory('sat_last_session');
    const lastSession = lastSessionRaw ? JSON.parse(lastSessionRaw) : null;

    const now = new Date();
    const weekAgo = new Date(now - 7 * 86400000).toISOString().split('T')[0];
    const sessionsThisWeek = db.prepare('SELECT COUNT(*) as c FROM sat_sessions WHERE date >= ?').get(weekAgo).c;

    let daysSinceLast = null;
    let stale = false;
    if (lastSession?.date) {
      const last = new Date(lastSession.date);
      daysSinceLast = Math.floor((now - last) / 86400000);
      stale = daysSinceLast > 7;
    } else {
      stale = true;
    }

    res.json({
      lastSessionDate: lastSession?.date || null,
      daysSinceLast,
      weakAreas: lastSession?.weakAreas || null,
      sessionsThisWeek,
      stale
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
