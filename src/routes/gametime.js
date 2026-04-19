const express = require('express');
const router = express.Router();
const { getMemory, setMemory } = require('../db/init');
const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SPRINT_START = new Date('2026-03-09');
const SPRINT_END = new Date('2026-05-09');
const TARGET = 20;

function getStatus() {
  const users = parseInt(getMemory('gametime_beta_users') || '3');
  const nextMilestone = getMemory('gametime_next_milestone') || '';

  const now = new Date();
  const totalMs = SPRINT_END - SPRINT_START;
  const passedMs = now - SPRINT_START;
  const daysPassed = Math.max(0, Math.floor(passedMs / 86400000));
  const daysLeft = Math.max(0, Math.ceil((SPRINT_END - now) / 86400000));

  // 1 family per 3 days pace for 20 families in 60 days
  const expectedPace = daysPassed / 3;

  let paceStatus;
  if (users >= expectedPace + 1) {
    paceStatus = 'ahead';
  } else if (users >= expectedPace - 1) {
    paceStatus = 'on-track';
  } else if (users >= expectedPace - 3) {
    paceStatus = 'behind';
  } else {
    paceStatus = 'critical';
  }

  return { users, target: TARGET, daysLeft, daysPassed, expectedPace: Math.round(expectedPace * 10) / 10, paceStatus, nextMilestone };
}

// GET /gametime/status
router.get('/status', (req, res) => {
  try {
    res.json(getStatus());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /gametime/update
router.post('/update', (req, res) => {
  try {
    const { users, milestone, notes } = req.body || {};

    if (users !== undefined) {
      setMemory('gametime_beta_users', String(users));
    }
    if (milestone !== undefined) {
      setMemory('gametime_next_milestone', milestone);
    }

    res.json({
      ok: true,
      updated: {
        users: users !== undefined ? users : parseInt(getMemory('gametime_beta_users') || '3'),
        milestone: milestone !== undefined ? milestone : getMemory('gametime_next_milestone')
      }
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /gametime/advice
router.get('/advice', async (req, res) => {
  try {
    const status = getStatus();
    const { users, daysLeft, paceStatus } = status;

    const prompt = `Rehan is building Gametime, a sports scheduling app. Sprint ends 2026-05-09.
Current: ${users}/20 beta families. Days left: ${daysLeft}. Pace: ${paceStatus}.

Give 3 bullet points of concrete, actionable advice for today to improve beta user acquisition.
Be direct. No fluff. Max 12 words per bullet.`;

    const response = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 300,
      messages: [{ role: 'user', content: prompt }]
    });

    const advice = response.content[0]?.text || '';
    res.json({ advice, status });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /gametime/history
router.get('/history', (req, res) => {
  try {
    const status = getStatus();
    res.json({ current: status, note: 'Historical tracking not yet implemented' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
