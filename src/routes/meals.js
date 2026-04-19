const express = require('express');
const router = express.Router();
const { db } = require('../db/init');

function getSGTDate() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Singapore' });
}

// GET /meals/today
router.get('/today', (req, res) => {
  try {
    const date = getSGTDate();
    const meals = db.prepare(
      'SELECT * FROM meals WHERE date = ? ORDER BY created_at ASC'
    ).all(date);

    const total_calories = meals.reduce((sum, m) => sum + (m.calories || 0), 0);
    const total_protein_g = meals.reduce((sum, m) => sum + (m.protein_g || 0), 0);

    res.json({ date, meals, total_calories, total_protein_g });
  } catch (e) {
    console.error('[meals] GET /today error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /meals
router.post('/', (req, res) => {
  try {
    const { meal_type = 'meal', description, calories, protein_g, date } = req.body;
    const mealDate = date || getSGTDate();

    const result = db.prepare(
      'INSERT INTO meals (meal_type, description, calories, protein_g, date) VALUES (?, ?, ?, ?, ?)'
    ).run(meal_type, description, calories ?? null, protein_g ?? null, mealDate);

    res.json({ id: result.lastInsertRowid, message: 'Logged' });
  } catch (e) {
    console.error('[meals] POST / error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /meals/week
router.get('/week', (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT
        date,
        SUM(calories)  AS total_calories,
        SUM(protein_g) AS total_protein_g,
        COUNT(*)       AS meal_count
      FROM meals
      WHERE date >= date(?, '-6 days')
      GROUP BY date
      ORDER BY date DESC
    `).all(getSGTDate());

    const days = rows.map(r => ({
      date: r.date,
      total_calories: r.total_calories || 0,
      total_protein_g: r.total_protein_g || 0,
      meal_count: r.meal_count
    }));

    const avg_calories = days.length
      ? Math.round(days.reduce((s, d) => s + d.total_calories, 0) / days.length)
      : 0;
    const avg_protein = days.length
      ? Math.round((days.reduce((s, d) => s + d.total_protein_g, 0) / days.length) * 10) / 10
      : 0;

    res.json({ days, avg_calories, avg_protein });
  } catch (e) {
    console.error('[meals] GET /week error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// DELETE /meals/:id
router.delete('/:id', (req, res) => {
  try {
    const { id } = req.params;
    const result = db.prepare('DELETE FROM meals WHERE id = ?').run(id);

    if (result.changes === 0) {
      return res.status(404).json({ error: 'Meal not found' });
    }
    res.json({ message: 'Deleted' });
  } catch (e) {
    console.error('[meals] DELETE /:id error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /meals/stats
router.get('/stats', (req, res) => {
  try {
    const totals = db.prepare(`
      SELECT
        COUNT(*)       AS total_logged,
        AVG(daily_cal) AS avg_daily_calories
      FROM (
        SELECT date, SUM(calories) AS daily_cal
        FROM meals
        GROUP BY date
      )
    `).get();

    const commonType = db.prepare(`
      SELECT meal_type, COUNT(*) AS cnt
      FROM meals
      GROUP BY meal_type
      ORDER BY cnt DESC
      LIMIT 1
    `).get();

    res.json({
      total_logged: totals?.total_logged || 0,
      avg_daily_calories: Math.round(totals?.avg_daily_calories || 0),
      most_common_meal_type: commonType?.meal_type || null
    });
  } catch (e) {
    console.error('[meals] GET /stats error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
