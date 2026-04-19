const express = require('express');
const router = express.Router();
const { db } = require('../db/init');

function todaySGT() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Singapore' });
}

// GET /habits — list all habits with streak and whether done today
router.get('/', (req, res) => {
  try {
    const today = todaySGT();
    const habits = db.prepare('SELECT * FROM habits ORDER BY created_at ASC').all();
    const result = habits.map(h => {
      const log = db.prepare(
        'SELECT 1 FROM habit_logs WHERE habit_id = ? AND done_date = ?'
      ).get(h.id, today);
      return {
        id: h.id,
        name: h.name,
        frequency: h.frequency,
        streak: h.streak,
        total_completed: h.total_completed,
        done_today: !!log,
        last_done: h.last_done
      };
    });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /habits — add a habit
router.post('/', (req, res) => {
  try {
    const { name, frequency, target_days } = req.body;
    if (!name || !frequency) {
      return res.status(400).json({ error: 'name and frequency are required' });
    }
    if (!['daily', 'weekly'].includes(frequency)) {
      return res.status(400).json({ error: "frequency must be 'daily' or 'weekly'" });
    }
    const stmt = db.prepare(
      'INSERT INTO habits (name, frequency, target_days, streak, total_completed, created_at) VALUES (?, ?, ?, 0, 0, ?)'
    );
    const info = stmt.run(name, frequency, target_days || null, strftime());
    res.status(201).json({ id: info.lastInsertRowid, name, message: 'Habit added' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

function strftime() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

// POST /habits/:id/check — mark habit done for today
router.post('/:id/check', (req, res) => {
  try {
    const { id } = req.params;
    const today = todaySGT();

    const habit = db.prepare('SELECT * FROM habits WHERE id = ?').get(id);
    if (!habit) return res.status(404).json({ error: 'Habit not found' });

    const insert = db.prepare(
      'INSERT OR IGNORE INTO habit_logs (habit_id, done_date) VALUES (?, ?)'
    );
    const info = insert.run(id, today);

    if (info.changes === 0) {
      return res.json({ already_done: true, id: habit.id, streak: habit.streak });
    }

    db.prepare(
      'UPDATE habits SET streak = streak + 1, total_completed = total_completed + 1, last_done = ? WHERE id = ?'
    ).run(today, id);

    const updated = db.prepare('SELECT streak FROM habits WHERE id = ?').get(id);
    res.json({ id: Number(id), streak: updated.streak, message: 'Checked in' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /habits/:id/stats — get habit stats
router.get('/:id/stats', (req, res) => {
  try {
    const { id } = req.params;
    const habit = db.prepare('SELECT * FROM habits WHERE id = ?').get(id);
    if (!habit) return res.status(404).json({ error: 'Habit not found' });

    let completion_rate = null;
    if (habit.created_at) {
      const created = new Date(habit.created_at);
      const now = new Date();
      const diffMs = now - created;
      const daysSinceCreated = Math.max(1, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
      completion_rate = parseFloat((habit.total_completed / daysSinceCreated).toFixed(4));
    }

    res.json({
      id: habit.id,
      name: habit.name,
      streak: habit.streak,
      total_completed: habit.total_completed,
      last_done: habit.last_done,
      completion_rate
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /habits/:id — delete a habit and its logs
router.delete('/:id', (req, res) => {
  try {
    const { id } = req.params;
    const habit = db.prepare('SELECT id FROM habits WHERE id = ?').get(id);
    if (!habit) return res.status(404).json({ error: 'Habit not found' });

    db.prepare('DELETE FROM habit_logs WHERE habit_id = ?').run(id);
    db.prepare('DELETE FROM habits WHERE id = ?').run(id);

    res.json({ message: 'Deleted' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
