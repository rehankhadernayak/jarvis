/* iOS Shortcut Setup:
 * 1. Open Shortcuts app on iPhone
 * 2. Create new Automation: "Time of Day" → 10 PM daily
 * 3. Add action: "Get My Steps" → set variable "steps"
 * 4. Add "Get Heart Rate" → variable "hr"
 * 5. Add "Get HRV" → variable "hrv"
 * 6. Add "Get Calories" → variable "cal"
 * 7. Add "Get Sleep Analysis" → variable "sleep"
 * 8. Add "Get Current IP" or use static: URL = http://YOUR_MAC_IP:3001/shortcuts/health
 * 9. Add "Get Contents of URL": Method POST, JSON body with all variables
 */

const express = require('express');
const router = express.Router();
const { db, setMemory, getMemory } = require('../db/init');
const Anthropic = require('@anthropic-ai/sdk');

// ── DB migration: add extra columns if they don't exist yet ─────────────────
const extraCols = [
  'hrv REAL',
  'sleep_hours REAL',
  'sleep_quality TEXT',
  'weight_kg REAL',
  'systolic INTEGER',
  'diastolic INTEGER',
  'spo2 REAL',
  'respiratory_rate REAL',
  'vo2max REAL',
  'mindful_minutes INTEGER',
  'stand_hours INTEGER'
];
for (const col of extraCols) {
  try { db.exec(`ALTER TABLE health_data ADD COLUMN ${col}`); } catch {}
}

// ── Helper: today's date string ──────────────────────────────────────────────
function today() {
  return new Date().toISOString().split('T')[0];
}

// ── Helper: fetch last N days of health rows ─────────────────────────────────
function getRecentDays(n) {
  return db.prepare(
    `SELECT * FROM health_data ORDER BY date DESC LIMIT ?`
  ).all(n);
}

// ════════════════════════════════════════════════════════════════════════════
// POST /shortcuts/health  (enhanced — accepts all health fields)
// ════════════════════════════════════════════════════════════════════════════
router.post('/health', (req, res) => {
  const {
    steps, heart_rate, hrv, calories, distance_km, active_minutes,
    sleep_hours, sleep_quality, weight_kg,
    systolic, diastolic, spo2, respiratory_rate,
    vo2max, mindful_minutes, stand_hours,
    date
  } = req.body;

  const d = date || today();

  // Count how many fields were actually provided
  const allFields = {
    steps, heart_rate, hrv, calories, distance_km, active_minutes,
    sleep_hours, sleep_quality, weight_kg,
    systolic, diastolic, spo2, respiratory_rate,
    vo2max, mindful_minutes, stand_hours
  };
  const fields_received = Object.values(allFields).filter(v => v !== undefined && v !== null).length;

  // Upsert into health_data
  db.prepare(`
    INSERT INTO health_data
      (date, steps, heart_rate, hrv, calories, distance_km, active_minutes,
       sleep_hours, sleep_quality, weight_kg,
       systolic, diastolic, spo2, respiratory_rate,
       vo2max, mindful_minutes, stand_hours)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(date) DO UPDATE SET
      steps            = COALESCE(excluded.steps,            steps),
      heart_rate       = COALESCE(excluded.heart_rate,       heart_rate),
      hrv              = COALESCE(excluded.hrv,              hrv),
      calories         = COALESCE(excluded.calories,         calories),
      distance_km      = COALESCE(excluded.distance_km,      distance_km),
      active_minutes   = COALESCE(excluded.active_minutes,   active_minutes),
      sleep_hours      = COALESCE(excluded.sleep_hours,      sleep_hours),
      sleep_quality    = COALESCE(excluded.sleep_quality,    sleep_quality),
      weight_kg        = COALESCE(excluded.weight_kg,        weight_kg),
      systolic         = COALESCE(excluded.systolic,         systolic),
      diastolic        = COALESCE(excluded.diastolic,        diastolic),
      spo2             = COALESCE(excluded.spo2,             spo2),
      respiratory_rate = COALESCE(excluded.respiratory_rate, respiratory_rate),
      vo2max           = COALESCE(excluded.vo2max,           vo2max),
      mindful_minutes  = COALESCE(excluded.mindful_minutes,  mindful_minutes),
      stand_hours      = COALESCE(excluded.stand_hours,      stand_hours)
  `).run(
    d, steps, heart_rate, hrv, calories, distance_km, active_minutes,
    sleep_hours, sleep_quality, weight_kg,
    systolic, diastolic, spo2, respiratory_rate,
    vo2max, mindful_minutes, stand_hours
  );

  // Store as JSON blob in memory table for quick access
  const bodyWithDate = { ...req.body, date: d };
  setMemory('ios_health_latest', JSON.stringify(bodyWithDate));
  setMemory(`ios_health_${d}`, JSON.stringify(bodyWithDate));

  res.json({ ok: true, date: d, fields_received });
});

// ════════════════════════════════════════════════════════════════════════════
// GET /shortcuts/health/today
// ════════════════════════════════════════════════════════════════════════════
router.get('/health/today', (req, res) => {
  const d = req.query.date || today();
  const row = db.prepare('SELECT * FROM health_data WHERE date = ?').get(d);
  if (!row) return res.json({ ok: true, date: d, data: null, message: 'No data logged for today yet.' });
  res.json({ ok: true, date: d, data: row });
});

// ════════════════════════════════════════════════════════════════════════════
// GET /shortcuts/health/week
// ════════════════════════════════════════════════════════════════════════════
router.get('/health/week', (req, res) => {
  const rows = getRecentDays(7);
  res.json({ ok: true, days: rows.length, data: rows });
});

// ════════════════════════════════════════════════════════════════════════════
// GET /shortcuts/health/streak
// ════════════════════════════════════════════════════════════════════════════
router.get('/health/streak', (req, res) => {
  // Pull all rows ordered most-recent first
  const rows = db.prepare('SELECT * FROM health_data ORDER BY date DESC').all();

  if (!rows.length) {
    return res.json({ ok: true, steps_streak: 0, logged_streak: 0, last_logged: null });
  }

  const last_logged = rows[0].date;

  // Helper: consecutive streak counting back from today
  function calcStreak(passFunc) {
    let streak = 0;
    let cursor = new Date(today());

    for (let i = 0; i < rows.length; i++) {
      const rowDate = new Date(rows[i].date);
      const cursorStr = cursor.toISOString().split('T')[0];
      const rowStr = rows[i].date;

      if (rowStr === cursorStr) {
        if (passFunc(rows[i])) {
          streak++;
          cursor.setDate(cursor.getDate() - 1);
        } else {
          break;
        }
      } else if (rowDate < cursor) {
        // Gap — streak broken
        break;
      }
      // rowDate > cursor shouldn't happen with DESC sort, skip
    }
    return streak;
  }

  const steps_streak = calcStreak(r => r.steps != null && r.steps >= 5000);
  const logged_streak = calcStreak(r => r.steps != null || r.heart_rate != null || r.calories != null);

  res.json({ ok: true, steps_streak, logged_streak, last_logged });
});

// ════════════════════════════════════════════════════════════════════════════
// GET /shortcuts/health/insights  — Claude Haiku analysis of last 7 days
// ════════════════════════════════════════════════════════════════════════════
router.get('/health/insights', async (req, res) => {
  try {
    const rows = getRecentDays(7);

    if (!rows.length) {
      return res.json({
        ok: false,
        message: 'No health data available yet. Log at least one day first.'
      });
    }

    const client = new Anthropic();

    const dataStr = JSON.stringify(rows, null, 2);

    const prompt = `You are a health analyst reviewing 7 days of Apple Health data for a teenager.

Here is the raw data (most recent first):
${dataStr}

Respond with ONLY valid JSON in exactly this shape — no markdown, no extra text:
{
  "score": <integer 0-100 reflecting overall health quality>,
  "summary": "<2-3 sentence plain-English summary>",
  "highlights": ["<positive finding>", "..."],
  "concerns": ["<area needing attention>", "..."],
  "recommendation": "<one concrete, actionable tip for tomorrow>"
}`;

    const message = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 512,
      messages: [{ role: 'user', content: prompt }]
    });

    const raw = message.content[0].text.trim();
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // If Claude wrapped it in markdown fences, strip them
      const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
      parsed = jsonMatch ? JSON.parse(jsonMatch[1]) : { raw };
    }

    res.json({ ok: true, days_analyzed: rows.length, ...parsed });
  } catch (err) {
    console.error('[health/insights]', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// Existing routes (unchanged)
// ════════════════════════════════════════════════════════════════════════════

// POST /shortcuts/battery
router.post('/battery', (req, res) => {
  setMemory('ios_battery_level', req.body.level);
  setMemory('ios_battery_charging', req.body.charging ? '1' : '0');
  res.json({ ok: true });
});

// POST /shortcuts/focus
router.post('/focus', (req, res) => {
  setMemory('ios_focus_mode', req.body.mode);
  res.json({ ok: true });
});

// POST /shortcuts/location
router.post('/location', (req, res) => {
  const { lat, lon, address } = req.body;
  setMemory('ios_location_lat', lat);
  setMemory('ios_location_lon', lon);
  if (address) setMemory('ios_location_address', address);
  res.json({ ok: true });
});

// POST /shortcuts/expense
router.post('/expense', (req, res) => {
  const { amount, category, description, date } = req.body;
  db.prepare('INSERT INTO expenses (amount, category, description, date) VALUES (?,?,?,?)').run(
    amount, category, description, date || today()
  );
  res.json({ ok: true });
});

// POST /shortcuts/screen-time
router.post('/screen-time', (req, res) => {
  setMemory('ios_screen_time_latest', JSON.stringify(req.body));
  res.json({ ok: true });
});

// GET /shortcuts/context
router.get('/context', (req, res) => {
  res.json({
    battery: getMemory('ios_battery_level'),
    charging: getMemory('ios_battery_charging') === '1',
    focus: getMemory('ios_focus_mode'),
    location: getMemory('ios_location_address'),
    health: getMemory('ios_health_latest'),
    screen_time: getMemory('ios_screen_time_latest')
  });
});

// GET /shortcuts/status
router.get('/status', (req, res) => res.json({ ok: true, version: 'v2' }));

module.exports = router;
