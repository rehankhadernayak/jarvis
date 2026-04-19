const express = require('express');
const router = express.Router();
const { db, getMemory } = require('../db/init');

router.get('/current', (req, res) => {
  try {
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
    const sleepScore = 12; // default — no sleep tracking yet

    const total = satScore + mlScore + taskScore + stepsScore + sleepScore;
    const grade = total >= 85 ? 'S' : total >= 70 ? 'A' : total >= 55 ? 'B' : total >= 40 ? 'C' : 'D';

    res.json({
      score: total, grade, max: 82,
      components: { sat: satScore, ml: mlScore, tasks: taskScore, steps: stepsScore, sleep: sleepScore },
      week: { from: weekAgo, to: now.toISOString().split('T')[0] }
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
