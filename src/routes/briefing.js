const express = require('express');
const router = express.Router();
const Anthropic = require('@anthropic-ai/sdk');
const { db, setMemory, getMemory } = require('../db/init');
const { getTodayEvents } = require('../google/calendar');
const { getUnreadEmails } = require('../google/gmail');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Inline life score calculation (mirrors life-score.js logic)
function getLifeScore() {
  const now = new Date();
  const weekAgo = new Date(now - 7 * 86400000).toISOString().split('T')[0];

  const satSessions = db.prepare('SELECT COUNT(*) as c FROM sat_sessions WHERE date >= ?').get(weekAgo).c;
  const mlSessions = db.prepare('SELECT COUNT(*) as c FROM ml_sessions WHERE created_at >= ?').get(weekAgo).c;
  const tasksDone = db.prepare('SELECT COUNT(*) as c FROM tasks WHERE done=1 AND created_at >= ?').get(weekAgo).c;
  const tasksTotal = db.prepare('SELECT COUNT(*) as c FROM tasks WHERE created_at >= ?').get(weekAgo).c;
  const healthLatest = JSON.parse(getMemory('ios_health_latest') || '{}');
  const steps = parseInt(healthLatest.steps) || 0;

  const satScore = Math.min(20, satSessions * 5);
  const mlScore = Math.min(15, mlSessions * 5);
  const taskScore = tasksTotal > 0 ? Math.round((tasksDone / tasksTotal) * 25) : 12;
  const stepsScore = steps >= 8000 ? 10 : Math.round((steps / 8000) * 10);
  const sleepScore = 12;

  const total = satScore + mlScore + taskScore + stepsScore + sleepScore;
  const grade = total >= 85 ? 'S' : total >= 70 ? 'A' : total >= 55 ? 'B' : total >= 40 ? 'C' : 'D';
  return { score: total, grade };
}

// GET /briefing/morning
router.get('/morning', async (req, res) => {
  try {
    // SGT today date (UTC+8)
    const sgtOffset = 8 * 60 * 60 * 1000;
    const todaySGT = new Date(Date.now() + sgtOffset).toISOString().split('T')[0];

    // Gather all context in parallel where possible
    const lifeScore = getLifeScore();

    let calendarEvents = [];
    try { calendarEvents = await getTodayEvents(); } catch (_) {}

    let unreadCount = 0;
    try {
      const emails = await getUnreadEmails(50);
      unreadCount = emails.length;
    } catch (_) {}

    const gametimeBetaUsers = getMemory('gametime_beta_users') || '0';
    const mlCurrentDay = getMemory('ml_current_day') || '1';
    const satLastRaw = getMemory('sat_last_session');
    const satLast = satLastRaw ? JSON.parse(satLastRaw) : null;

    let tasksDueToday = [];
    try {
      tasksDueToday = db.prepare('SELECT * FROM tasks WHERE done=0 AND due_date=?').all(todaySGT);
    } catch (_) {}

    // SAT staleness
    let satDaysSince = null;
    if (satLast?.date) {
      satDaysSince = Math.floor((Date.now() - new Date(satLast.date).getTime()) / 86400000);
    }

    const topEvent = calendarEvents?.[0] || null;

    const contextBlock = [
      `Life score: ${lifeScore.score}/82 (${lifeScore.grade})`,
      topEvent ? `Top calendar event: ${topEvent.summary || topEvent.title || JSON.stringify(topEvent)}` : 'No calendar events today',
      `Unread emails: ${unreadCount}`,
      `Tasks due today: ${tasksDueToday.length} (${tasksDueToday.map(t => t.title).join(', ') || 'none'})`,
      `Gametime beta families: ${gametimeBetaUsers}/20`,
      `ML training day: ${mlCurrentDay}`,
      satDaysSince !== null ? `Days since last SAT session: ${satDaysSince}` : 'No SAT sessions logged',
    ].join('\n');

    const msg = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      messages: [{
        role: 'user',
        content: `Generate a terse JARVIS morning briefing for Rehan. 5 bullet points max. Each point max 15 words. Lead with the highest priority item. Be direct, no fluff. Include: life score, top calendar event if any, urgent tasks, Gametime progress (X/20 families), any SAT staleness warning (>7 days since last session).\n\nContext:\n${contextBlock}`
      }]
    });

    const briefing = msg.content[0].text;
    const generatedAt = new Date().toISOString();

    setMemory('cached_briefing', JSON.stringify({ briefing, generatedAt }));

    res.json({ briefing, generatedAt });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /briefing/cached
router.get('/cached', (req, res) => {
  try {
    const raw = getMemory('cached_briefing');
    if (!raw) return res.json({ briefing: null });
    const { briefing, generatedAt } = JSON.parse(raw);
    res.json({ briefing, generatedAt });
  } catch (e) {
    res.json({ briefing: null });
  }
});

module.exports = router;
