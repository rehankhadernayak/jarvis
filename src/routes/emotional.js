const express = require('express');
const router = express.Router();
const Anthropic = require('@anthropic-ai/sdk');
const { db } = require('../db/init');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const JARVIS_SYSTEM = `You are JARVIS, Rehan's personal AI operating system. Rehan is a 17-year-old entrepreneur and student in Singapore. He runs Gametime (sports scheduling startup), studies for the SAT (target 1550+), and learns ML. Be direct, British-toned, no fluff.`;

function extractJSON(text) {
  try {
    const match = text.match(/\{[\s\S]*\}/);
    return match ? JSON.parse(match[0]) : null;
  } catch { return null; }
}

// POST /emotional/analyze
router.post('/analyze', async (req, res) => {
  const { text } = req.body;
  if (!text?.trim()) return res.status(400).json({ error: 'text required' });

  try {
    const msg = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      messages: [{
        role: 'user',
        content: `Analyze the emotional state in this text. Return ONLY valid JSON (no markdown):\n{"stress_level": 1-10, "emotions": ["string"], "energy": "high|medium|low", "recommendation": "string"}\n\nText: "${text.slice(0, 1000)}"`
      }]
    });

    const result = extractJSON(msg.content[0].text) || {
      stress_level: 5, emotions: ['neutral'], energy: 'medium', recommendation: 'Continue as normal.'
    };
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /emotional/log
router.post('/log', (req, res) => {
  const { mood, notes, context, stress_level } = req.body;
  if (!mood || mood < 1 || mood > 10) return res.status(400).json({ error: 'mood must be 1-10' });

  try {
    const result = db.prepare(
      'INSERT INTO mood_logs (mood, notes, context, stress_level) VALUES (?,?,?,?)'
    ).run(Math.round(mood), notes || null, context || null, stress_level || null);

    const row = db.prepare('SELECT * FROM mood_logs WHERE id=?').get(result.lastInsertRowid);
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /emotional/trends
router.get('/trends', async (req, res) => {
  try {
    const logs = db.prepare(
      "SELECT * FROM mood_logs WHERE created_at >= datetime('now', '-14 days') ORDER BY created_at ASC"
    ).all();

    if (!logs.length) return res.json({ logs: [], avgMood: null, avgStress: null, insight: 'No mood data in the last 14 days.' });

    const avgMood = +(logs.reduce((s, l) => s + l.mood, 0) / logs.length).toFixed(2);
    const stressLogs = logs.filter(l => l.stress_level != null);
    const avgStress = stressLogs.length
      ? +(stressLogs.reduce((s, l) => s + l.stress_level, 0) / stressLogs.length).toFixed(2)
      : null;

    const recentNotes = logs.slice(-3).map(l => l.notes).filter(Boolean).join('; ');

    const msg = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      system: JARVIS_SYSTEM,
      messages: [{
        role: 'user',
        content: `Rehan's mood trend (last 14 days): avg mood ${avgMood}/10${avgStress ? `, avg stress ${avgStress}/10` : ''}, ${logs.length} entries logged.${recentNotes ? ` Recent notes: "${recentNotes}"` : ''} Give exactly 2 sentences of insight. Direct and actionable.`
      }]
    });

    res.json({ logs, avgMood, avgStress, insight: msg.content[0].text.trim() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /emotional/journal
router.post('/journal', async (req, res) => {
  const { entry } = req.body;
  if (!entry?.trim()) return res.status(400).json({ error: 'entry required' });

  try {
    const msg = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 600,
      system: JARVIS_SYSTEM,
      messages: [{
        role: 'user',
        content: `Analyze this journal entry emotionally and respond as JARVIS. Return ONLY valid JSON (no markdown):\n{"stress_level": 1-10, "emotions": ["string"], "energy": "high|medium|low", "recommendation": "string", "jarvis_response": "exactly 2 sentences — direct, honest, supportive without being sappy"}\n\nJournal entry: "${entry.slice(0, 2000)}"`
      }]
    });

    const analysis = extractJSON(msg.content[0].text) || {
      stress_level: 5, emotions: ['reflective'], energy: 'medium',
      recommendation: 'Keep journaling regularly.',
      jarvis_response: 'Noted. Keep moving forward — one thing at a time.'
    };

    // Auto-save mood log (invert stress → mood: stress 10 = mood 1, stress 1 = mood 10)
    const moodVal = Math.max(1, Math.min(10, 11 - analysis.stress_level));
    db.prepare('INSERT INTO mood_logs (mood, notes, context, stress_level) VALUES (?,?,?,?)').run(
      moodVal, entry.slice(0, 500), 'journal', analysis.stress_level
    );

    res.json(analysis);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
