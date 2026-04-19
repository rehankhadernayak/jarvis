const express = require('express');
const router = express.Router();
const { getTodayEvents, getUpcomingEvents, createEvent, blockTime } = require('../google/calendar');

router.get('/today', async (req, res) => {
  try { res.json(await getTodayEvents()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/upcoming', async (req, res) => {
  const days = parseInt(req.query.days) || 7;
  try { res.json(await getUpcomingEvents(days)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/create', async (req, res) => {
  try { res.json(await createEvent(req.body)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /calendar/block — create a time block
// Body: { title, startDate, endDate, blockType, description }
// startDate/endDate: ISO date string (YYYY-MM-DD for all-day, or full ISO for timed)
router.post('/block', async (req, res) => {
  const { title, startDate, endDate, blockType = 'focus', description = '' } = req.body;
  if (!title || !startDate || !endDate) return res.status(400).json({ error: 'title, startDate, endDate required' });
  try { res.json(await blockTime({ title, startDate, endDate, blockType, description })); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/blocks', (req, res) => {
  const { db } = require('../db/init');
  const blocks = db.prepare('SELECT * FROM time_blocks ORDER BY start_time DESC LIMIT 20').all();
  res.json(blocks);
});

module.exports = router;
