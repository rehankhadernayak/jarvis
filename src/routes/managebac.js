/**
 * ManageBac Routes
 * All routes under /managebac — login, sync, grades, assignments, status, deadlines.
 */

'use strict';

const express = require('express');
const router  = express.Router();
const scraper = require('../scrapers/managebac');
const { getMemory } = require('../db/init');

// ── POST /managebac/login ─────────────────────────────────────────────────────
// Body: { email, password }
// Launches headless browser, logs in, saves cookies.
// IMPORTANT: password is never logged or returned.
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'email and password are required' });
  }

  try {
    const result = await scraper.login(email, password);
    if (result.error) return res.status(401).json({ error: result.error });
    return res.json({ ok: true, email: result.email });
  } catch (e) {
    console.error('[route/managebac/login]', e.message);
    return res.status(500).json({ error: e.message });
  }
});

// ── POST /managebac/sync ──────────────────────────────────────────────────────
// Triggers a full dashboard sync (grades + assignments).
// Long-running — can take up to 60s. Responds once done.
router.post('/sync', async (req, res) => {
  // Give the route up to 60s before the client times out
  req.setTimeout(65000);
  res.setTimeout(65000);

  try {
    const result = await scraper.getDashboard();
    if (result.error === 'auth_required') {
      return res.status(401).json({ error: 'auth_required', message: 'Call POST /managebac/login first.' });
    }
    if (result.error) {
      return res.status(500).json({ error: result.error });
    }
    return res.json(result);
  } catch (e) {
    console.error('[route/managebac/sync]', e.message);
    return res.status(500).json({ error: e.message });
  }
});

// ── GET /managebac/grades ─────────────────────────────────────────────────────
// Returns cached grades from DB (populated by /sync).
router.get('/grades', (req, res) => {
  try {
    const raw      = getMemory('managebac_grades');
    const last_sync = getMemory('managebac_last_sync');
    const grades   = raw ? JSON.parse(raw) : [];
    return res.json({ grades, last_sync: last_sync || null });
  } catch (e) {
    console.error('[route/managebac/grades]', e.message);
    return res.status(500).json({ error: e.message });
  }
});

// ── GET /managebac/assignments ────────────────────────────────────────────────
// Returns all cached upcoming assignments from DB.
router.get('/assignments', (req, res) => {
  try {
    const raw        = getMemory('managebac_assignments');
    const last_sync  = getMemory('managebac_last_sync');
    const assignments = raw ? JSON.parse(raw) : [];
    return res.json({ assignments, last_sync: last_sync || null });
  } catch (e) {
    console.error('[route/managebac/assignments]', e.message);
    return res.status(500).json({ error: e.message });
  }
});

// ── GET /managebac/status ─────────────────────────────────────────────────────
// Returns auth status, last sync time, and record counts.
router.get('/status', (req, res) => {
  try {
    const cookies      = getMemory('managebac_cookies');
    const last_sync    = getMemory('managebac_last_sync');
    const rawGrades    = getMemory('managebac_grades');
    const rawAssign    = getMemory('managebac_assignments');

    const grades      = rawGrades ? JSON.parse(rawGrades)    : [];
    const assignments = rawAssign ? JSON.parse(rawAssign)    : [];

    return res.json({
      authenticated:    !!cookies,
      last_sync:        last_sync || null,
      grade_count:      grades.length,
      assignment_count: assignments.length,
    });
  } catch (e) {
    console.error('[route/managebac/status]', e.message);
    return res.status(500).json({ error: e.message });
  }
});

// ── GET /managebac/deadlines ──────────────────────────────────────────────────
// Filters cached assignments into:
//   upcoming — due in the next 14 days, sorted by due_date asc
//   overdue  — due before today, sorted by due_date desc
router.get('/deadlines', (req, res) => {
  try {
    const raw        = getMemory('managebac_assignments');
    const last_sync  = getMemory('managebac_last_sync');
    const assignments = raw ? JSON.parse(raw) : [];

    const now     = new Date();
    const todayMs = new Date(now.toISOString().split('T')[0]).getTime(); // start of today UTC
    const in14Ms  = todayMs + 14 * 24 * 60 * 60 * 1000;

    const upcoming = [];
    const overdue  = [];

    for (const a of assignments) {
      if (!a.due_date) continue;

      // Attempt to parse due_date — ManageBac may return various formats
      const parsed = new Date(a.due_date);
      if (isNaN(parsed.getTime())) continue; // skip unparseable dates

      const dueMs = parsed.getTime();

      if (dueMs < todayMs) {
        overdue.push(a);
      } else if (dueMs <= in14Ms) {
        upcoming.push(a);
      }
    }

    // Sort upcoming ascending (soonest first), overdue descending (most recent first)
    upcoming.sort((a, b) => new Date(a.due_date) - new Date(b.due_date));
    overdue.sort((a, b)  => new Date(b.due_date) - new Date(a.due_date));

    return res.json({ upcoming, overdue, last_sync: last_sync || null });
  } catch (e) {
    console.error('[route/managebac/deadlines]', e.message);
    return res.status(500).json({ error: e.message });
  }
});

module.exports = router;
