const express = require('express');
const router = express.Router();
const { db } = require('../db/init');

// GET /crm/contacts
router.get('/contacts', (req, res) => {
  try {
    const { status } = req.query;
    const validStatuses = ['prospect', 'contacted', 'interested', 'beta_user', 'declined'];

    let query = 'SELECT * FROM gametime_crm';
    const params = [];

    if (status) {
      if (!validStatuses.includes(status)) {
        return res.status(400).json({ error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
      }
      query += ' WHERE status = ?';
      params.push(status);
    }

    query += ' ORDER BY created_at DESC';

    const contacts = db.prepare(query).all(...params);
    res.json(contacts);
  } catch (e) {
    console.error('[crm] GET /contacts error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /crm/contacts
router.post('/contacts', (req, res) => {
  try {
    const { name, contact_info, family_size, source, status, notes } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'name is required' });
    }

    const validSources = ['referral', 'cold', 'event', 'social'];
    const validStatuses = ['prospect', 'contacted', 'interested', 'beta_user', 'declined'];

    if (source && !validSources.includes(source)) {
      return res.status(400).json({ error: `Invalid source. Must be one of: ${validSources.join(', ')}` });
    }

    if (status && !validStatuses.includes(status)) {
      return res.status(400).json({ error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
    }

    const result = db.prepare(`
      INSERT INTO gametime_crm (name, contact_info, family_size, source, status, notes, created_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(
      name,
      contact_info || null,
      family_size || null,
      source || null,
      status || 'prospect',
      notes || null
    );

    res.status(201).json({ id: result.lastInsertRowid, name, message: 'Added to CRM' });
  } catch (e) {
    console.error('[crm] POST /contacts error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// PUT /crm/contacts/:id
router.put('/contacts/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { status, notes, next_followup, last_contact, contact_info } = req.body;

    const validStatuses = ['prospect', 'contacted', 'interested', 'beta_user', 'declined'];
    if (status && !validStatuses.includes(status)) {
      return res.status(400).json({ error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
    }

    const existing = db.prepare('SELECT id FROM gametime_crm WHERE id = ?').get(id);
    if (!existing) {
      return res.status(404).json({ error: 'Contact not found' });
    }

    const fields = [];
    const params = [];

    if (status !== undefined)        { fields.push('status = ?');        params.push(status); }
    if (notes !== undefined)         { fields.push('notes = ?');          params.push(notes); }
    if (next_followup !== undefined) { fields.push('next_followup = ?');  params.push(next_followup); }
    if (last_contact !== undefined)  { fields.push('last_contact = ?');   params.push(last_contact); }
    if (contact_info !== undefined)  { fields.push('contact_info = ?');   params.push(contact_info); }

    if (fields.length === 0) {
      return res.status(400).json({ error: 'No updatable fields provided' });
    }

    params.push(id);
    db.prepare(`UPDATE gametime_crm SET ${fields.join(', ')} WHERE id = ?`).run(...params);

    res.json({ message: 'Updated' });
  } catch (e) {
    console.error('[crm] PUT /contacts/:id error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /crm/contacts/:id/log
router.post('/contacts/:id/log', (req, res) => {
  try {
    const { id } = req.params;
    const { note, outcome } = req.body;

    const validOutcomes = ['interested', 'no_response', 'declined', 'scheduled_call', 'converted'];

    if (!note) {
      return res.status(400).json({ error: 'note is required' });
    }
    if (!outcome) {
      return res.status(400).json({ error: 'outcome is required' });
    }
    if (!validOutcomes.includes(outcome)) {
      return res.status(400).json({ error: `Invalid outcome. Must be one of: ${validOutcomes.join(', ')}` });
    }

    const existing = db.prepare('SELECT id FROM gametime_crm WHERE id = ?').get(id);
    if (!existing) {
      return res.status(404).json({ error: 'Contact not found' });
    }

    db.prepare(`
      INSERT INTO crm_logs (contact_id, note, outcome, logged_at)
      VALUES (?, ?, ?, datetime('now'))
    `).run(id, note, outcome);

    db.prepare(`
      UPDATE gametime_crm SET last_contact = datetime('now') WHERE id = ?
    `).run(id);

    res.json({ message: 'Logged' });
  } catch (e) {
    console.error('[crm] POST /contacts/:id/log error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /crm/pipeline
router.get('/pipeline', (req, res) => {
  try {
    const total = db.prepare('SELECT COUNT(*) as count FROM gametime_crm').get().count;

    const statusCounts = db.prepare(`
      SELECT status, COUNT(*) as count FROM gametime_crm GROUP BY status
    `).all();

    const by_status = {
      prospect: 0,
      contacted: 0,
      interested: 0,
      beta_user: 0,
      declined: 0
    };

    for (const row of statusCounts) {
      if (row.status in by_status) {
        by_status[row.status] = row.count;
      }
    }

    const conversion_rate = total > 0
      ? parseFloat((by_status.beta_user / total).toFixed(4))
      : 0;

    const overdue_followups = db.prepare(`
      SELECT * FROM gametime_crm
      WHERE next_followup IS NOT NULL
        AND next_followup < date('now')
        AND status NOT IN ('beta_user', 'declined')
      ORDER BY next_followup ASC
    `).all();

    res.json({
      total,
      by_status,
      conversion_rate,
      overdue_followups
    });
  } catch (e) {
    console.error('[crm] GET /pipeline error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// DELETE /crm/contacts/:id
router.delete('/contacts/:id', (req, res) => {
  try {
    const { id } = req.params;

    const existing = db.prepare('SELECT id FROM gametime_crm WHERE id = ?').get(id);
    if (!existing) {
      return res.status(404).json({ error: 'Contact not found' });
    }

    db.prepare('DELETE FROM crm_logs WHERE contact_id = ?').run(id);
    db.prepare('DELETE FROM gametime_crm WHERE id = ?').run(id);

    res.json({ message: 'Deleted' });
  } catch (e) {
    console.error('[crm] DELETE /contacts/:id error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
