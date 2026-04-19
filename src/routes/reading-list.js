'use strict';

const { Router } = require('express');
const { db } = require('../db/init');

const router = Router();

// GET /reading-list — list all items, optional ?status filter
router.get('/', (req, res) => {
  try {
    const { status } = req.query;
    const validStatuses = ['unread', 'reading', 'done'];

    let rows;
    if (status && validStatuses.includes(status)) {
      rows = db.prepare(
        'SELECT * FROM reading_list WHERE status = ? ORDER BY added_at DESC'
      ).all(status);
    } else {
      rows = db.prepare(
        'SELECT * FROM reading_list ORDER BY added_at DESC'
      ).all();
    }

    res.json(rows);
  } catch (e) {
    console.error('[reading-list] GET / failed:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /reading-list/stats — reading stats
// Must be declared before /:id to avoid route conflict
router.get('/stats', (req, res) => {
  try {
    const total = db.prepare('SELECT COUNT(*) AS c FROM reading_list').get().c;

    const byStatus = db.prepare(
      'SELECT status, COUNT(*) AS c FROM reading_list GROUP BY status'
    ).all();

    const statusMap = { unread: 0, reading: 0, done: 0 };
    for (const row of byStatus) {
      if (row.status in statusMap) statusMap[row.status] = row.c;
    }

    const booksThisMonth = db.prepare(`
      SELECT COUNT(*) AS c
      FROM reading_list
      WHERE status = 'done'
        AND type = 'book'
        AND strftime('%Y-%m', finished_at) = strftime('%Y-%m', 'now')
    `).get().c;

    res.json({
      total,
      by_status: statusMap,
      books_done_this_month: booksThisMonth
    });
  } catch (e) {
    console.error('[reading-list] GET /stats failed:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /reading-list — add an item
router.post('/', (req, res) => {
  try {
    const { title, author, type, url, notes } = req.body || {};
    const validTypes = ['book', 'article', 'paper', 'course'];

    if (!title || typeof title !== 'string' || !title.trim()) {
      return res.status(400).json({ error: 'title is required' });
    }

    const resolvedType = validTypes.includes(type) ? type : 'book';

    const result = db.prepare(`
      INSERT INTO reading_list (title, author, type, url, notes, added_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
    `).run(
      title.trim(),
      author ? String(author).trim() : null,
      resolvedType,
      url ? String(url).trim() : null,
      notes ? String(notes).trim() : null
    );

    res.status(201).json({
      id: result.lastInsertRowid,
      title: title.trim(),
      message: 'Added'
    });
  } catch (e) {
    console.error('[reading-list] POST / failed:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// PUT /reading-list/:id — update status and/or notes
router.put('/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'Invalid id' });
    }

    const { status, notes } = req.body || {};
    const validStatuses = ['unread', 'reading', 'done'];

    if (status && !validStatuses.includes(status)) {
      return res.status(400).json({ error: `status must be one of: ${validStatuses.join(', ')}` });
    }

    const existing = db.prepare('SELECT id FROM reading_list WHERE id = ?').get(id);
    if (!existing) {
      return res.status(404).json({ error: 'Item not found' });
    }

    if (status && notes !== undefined) {
      const finishedAt = status === 'done' ? "datetime('now')" : 'NULL';
      db.prepare(`
        UPDATE reading_list
        SET status = ?, notes = ?, finished_at = ${finishedAt}
        WHERE id = ?
      `).run(status, String(notes).trim(), id);
    } else if (status) {
      const finishedAt = status === 'done' ? "datetime('now')" : 'NULL';
      db.prepare(`
        UPDATE reading_list
        SET status = ?, finished_at = ${finishedAt}
        WHERE id = ?
      `).run(status, id);
    } else if (notes !== undefined) {
      db.prepare('UPDATE reading_list SET notes = ? WHERE id = ?')
        .run(String(notes).trim(), id);
    } else {
      return res.status(400).json({ error: 'Provide at least one of: status, notes' });
    }

    res.json({ message: 'Updated' });
  } catch (e) {
    console.error('[reading-list] PUT /:id failed:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// DELETE /reading-list/:id — remove
router.delete('/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'Invalid id' });
    }

    const result = db.prepare('DELETE FROM reading_list WHERE id = ?').run(id);
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Item not found' });
    }

    res.json({ message: 'Deleted' });
  } catch (e) {
    console.error('[reading-list] DELETE /:id failed:', e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
