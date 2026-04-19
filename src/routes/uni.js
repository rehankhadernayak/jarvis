const express = require('express');
const router = express.Router();
const { db } = require('../db/init');

// SGT date helper — returns 'YYYY-MM-DD' in Asia/Singapore (UTC+8)
function getSGTDate() {
  return new Date(Date.now() + 8 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}

// Days between today (SGT) and a deadline date string (YYYY-MM-DD)
function daysLeft(deadlineDate) {
  const today = getSGTDate();
  const msPerDay = 86400000;
  return Math.round(
    (new Date(deadlineDate).getTime() - new Date(today).getTime()) / msPerDay
  );
}

// GET /uni/deadlines — list all deadlines sorted by deadline_date ASC
// Optional query param: ?status=pending|submitted|accepted|rejected
router.get('/deadlines', (req, res) => {
  try {
    const { status } = req.query;
    let rows;

    if (status) {
      rows = db
        .prepare(
          'SELECT * FROM university_deadlines WHERE status = ? ORDER BY deadline_date ASC'
        )
        .all(status);
    } else {
      rows = db
        .prepare('SELECT * FROM university_deadlines ORDER BY deadline_date ASC')
        .all();
    }

    const result = rows.map((r) => ({ ...r, days_left: daysLeft(r.deadline_date) }));
    res.json(result);
  } catch (e) {
    console.error('[uni] GET /deadlines error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /uni/deadlines — add a deadline
router.post('/deadlines', (req, res) => {
  try {
    const { school, program, deadline_date, type, notes } = req.body;

    if (!school || !deadline_date) {
      return res.status(400).json({ error: 'school and deadline_date are required' });
    }

    const validTypes = ['application', 'scholarship', 'sat', 'interview', 'financial_aid'];
    const resolvedType = validTypes.includes(type) ? type : 'application';

    const stmt = db.prepare(
      `INSERT INTO university_deadlines (school, program, deadline_date, type, notes)
       VALUES (?, ?, ?, ?, ?)`
    );
    const info = stmt.run(
      school,
      program || null,
      deadline_date,
      resolvedType,
      notes || null
    );

    res.status(201).json({
      id: info.lastInsertRowid,
      school,
      deadline_date,
      message: 'Added',
    });
  } catch (e) {
    console.error('[uni] POST /deadlines error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// PUT /uni/deadlines/:id — update status and/or notes
router.put('/deadlines/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { status, notes } = req.body;

    const validStatuses = ['pending', 'submitted', 'accepted', 'rejected', 'waitlisted'];
    if (status && !validStatuses.includes(status)) {
      return res.status(400).json({ error: `status must be one of: ${validStatuses.join(', ')}` });
    }

    const existing = db
      .prepare('SELECT id FROM university_deadlines WHERE id = ?')
      .get(id);
    if (!existing) {
      return res.status(404).json({ error: 'Deadline not found' });
    }

    db.prepare(
      `UPDATE university_deadlines
       SET status = COALESCE(?, status),
           notes  = COALESCE(?, notes)
       WHERE id = ?`
    ).run(status || null, notes !== undefined ? notes : null, id);

    res.json({ message: 'Updated' });
  } catch (e) {
    console.error('[uni] PUT /deadlines/:id error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// DELETE /uni/deadlines/:id — remove a deadline
router.delete('/deadlines/:id', (req, res) => {
  try {
    const { id } = req.params;

    const info = db
      .prepare('DELETE FROM university_deadlines WHERE id = ?')
      .run(id);

    if (info.changes === 0) {
      return res.status(404).json({ error: 'Deadline not found' });
    }

    res.json({ message: 'Deleted' });
  } catch (e) {
    console.error('[uni] DELETE /deadlines/:id error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /uni/countdown — dashboard view
router.get('/countdown', (req, res) => {
  try {
    const rows = db
      .prepare('SELECT * FROM university_deadlines ORDER BY deadline_date ASC')
      .all();

    const deadlines_sorted = rows.map((r) => ({
      ...r,
      days_left: daysLeft(r.deadline_date),
    }));

    const upcoming_30_days = deadlines_sorted.filter(
      (r) => r.days_left >= 0 && r.days_left <= 30
    );
    const urgent = deadlines_sorted.filter((r) => r.days_left >= 0 && r.days_left <= 14);
    const overdue = deadlines_sorted.filter((r) => r.days_left < 0);

    res.json({
      total: rows.length,
      upcoming_30_days: upcoming_30_days.length,
      deadlines_sorted,
      urgent,
      overdue,
    });
  } catch (e) {
    console.error('[uni] GET /countdown error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
