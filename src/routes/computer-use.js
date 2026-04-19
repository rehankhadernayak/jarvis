require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const express = require('express');
const router = express.Router();
const { execSync } = require('child_process');
const fs = require('fs');
const Anthropic = require('@anthropic-ai/sdk');
const { db } = require('../db/init');

// ---------------------------------------------------------------------------
// DB table
// ---------------------------------------------------------------------------
db.exec(`
  CREATE TABLE IF NOT EXISTS computer_use_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task TEXT,
    result TEXT,
    steps INTEGER,
    status TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// ---------------------------------------------------------------------------
// Anthropic client
// ---------------------------------------------------------------------------
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const SCREEN_PATH = '/tmp/jarvis-cu-screen.png';
const DISPLAY_WIDTH = 2560;
const DISPLAY_HEIGHT = 1600;
const MAX_ITERATIONS = 10;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function takeScreenshot() {
  try {
    execSync(`/usr/sbin/screencapture -x ${SCREEN_PATH}`, { timeout: 10000 });
  } catch (e) {
    throw new Error(`screencapture failed — check Screen Recording permission in System Settings. Detail: ${e.message}`);
  }
  // Downscale to max 1280px wide to stay under 5MB API limit (retina screens produce ~12MB PNGs)
  try {
    execSync(`/usr/bin/sips -Z 1280 ${SCREEN_PATH} --out ${SCREEN_PATH}`, { timeout: 10000 });
  } catch {} // sips failure is non-fatal — try sending full size
  try {
    return fs.readFileSync(SCREEN_PATH).toString('base64');
  } catch (e) {
    throw new Error(`Could not read screenshot file: ${e.message}`);
  }
}

function doLeftClick(x, y) {
  try {
    execSync(`cliclick c:${x},${y}`, { timeout: 5000 });
    return 'cliclick';
  } catch (_) {
    // cliclick not installed or failed — fall back to osascript
    try {
      execSync(
        `osascript -e 'tell application "System Events" to click at {${x}, ${y}}'`,
        { timeout: 5000 }
      );
      return 'osascript';
    } catch (e2) {
      // Log and skip — do not crash the loop
      console.error(`[computer-use] left_click at (${x},${y}) failed: ${e2.message}`);
      return 'failed';
    }
  }
}

function doType(text) {
  const escaped = text.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  try {
    execSync(
      `osascript -e 'tell application "System Events" to keystroke "${escaped}"'`,
      { timeout: 10000 }
    );
  } catch (e) {
    console.error(`[computer-use] type failed: ${e.message}`);
  }
}

function doKey(keyText) {
  // Map common key names to osascript key codes
  const keyCodes = {
    Return: 36,
    Tab: 48,
    Escape: 53,
    Delete: 51,
    BackSpace: 51,
    space: 49,
    Up: 126,
    Down: 125,
    Left: 123,
    Right: 124,
  };

  const code = keyCodes[keyText];
  try {
    if (code !== undefined) {
      execSync(
        `osascript -e 'tell application "System Events" to key code ${code}'`,
        { timeout: 5000 }
      );
    } else {
      // Try as a raw keystroke
      const escaped = keyText.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      execSync(
        `osascript -e 'tell application "System Events" to keystroke "${escaped}"'`,
        { timeout: 5000 }
      );
    }
  } catch (e) {
    console.error(`[computer-use] key "${keyText}" failed: ${e.message}`);
  }
}

function doScroll(x, y, direction, amount) {
  // Positive deltaY = scroll down, negative = scroll up
  const lines = amount || 3;
  const deltaY =
    direction === 'down' ? -lines :
    direction === 'up'   ?  lines :
    0;
  const deltaX =
    direction === 'right' ? -lines :
    direction === 'left'  ?  lines :
    0;

  try {
    execSync(
      `osascript -e 'tell application "System Events" to scroll (every scroll area of (every window of (first application process whose frontmost is true))) by {${deltaX}, ${deltaY}}'`,
      { timeout: 5000 }
    );
  } catch (_) {
    // osascript scroll is unreliable — try cliclick scroll if available
    try {
      const dir = direction === 'down' ? 'd' : direction === 'up' ? 'u' : 'u';
      execSync(`cliclick kd:${dir}:${lines} kp:${x},${y}`, { timeout: 5000 });
    } catch (e2) {
      console.error(`[computer-use] scroll failed: ${e2.message}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Core vision-based action loop (async, non-blocking)
// claude-sonnet-4-6 has vision but not computer-use tools —
// so we use a vision + JSON action prompt loop instead.
// ---------------------------------------------------------------------------
const ACTION_PROMPT = `You are controlling a Mac computer via screenshot analysis.
Each turn you will see the current screen and the task. Respond with ONLY valid JSON (no markdown):
{
  "done": true|false,
  "observation": "what you see on screen",
  "action": "click|type|key|scroll|none",
  "x": number (pixel x for click/scroll, 0 if not needed),
  "y": number (pixel y for click/scroll, 0 if not needed),
  "text": "text to type or key name (Return/Tab/Escape/Delete/Up/Down)",
  "direction": "up|down|left|right (for scroll only)",
  "explanation": "why this action"
}
If the task is complete, set done:true. If you cannot proceed, set done:true with explanation.`;

async function runComputerUseLoop(logId, task) {
  const actionLog = [];
  let steps = 0;
  let finalText = '';
  let status = 'error';

  try {
    let screenshotB64;
    try {
      screenshotB64 = takeScreenshot();
    } catch (e) {
      db.prepare('UPDATE computer_use_logs SET result=?, status=?, steps=? WHERE id=?')
        .run(e.message, 'error', 0, logId);
      return;
    }

    while (steps < MAX_ITERATIONS) {
      steps++;

      const response = await client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 512,
        system: ACTION_PROMPT,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/png', data: screenshotB64 } },
            { type: 'text', text: `Task: ${task}\nStep ${steps}/${MAX_ITERATIONS}. What action next?` }
          ]
        }]
      });

      const raw = response.content[0]?.text || '';
      let parsed;
      try {
        const match = raw.match(/\{[\s\S]*\}/);
        parsed = JSON.parse(match ? match[0] : raw);
      } catch {
        finalText = raw;
        status = 'done';
        break;
      }

      finalText = parsed.observation || raw;
      actionLog.push({ step: steps, ...parsed });

      if (parsed.done) { status = 'done'; break; }

      // Execute action
      const act = parsed.action;
      if (act === 'click') {
        doLeftClick(parsed.x || 0, parsed.y || 0);
        await new Promise(r => setTimeout(r, 500));
      } else if (act === 'type') {
        doType(parsed.text || '');
        await new Promise(r => setTimeout(r, 300));
      } else if (act === 'key') {
        doKey(parsed.text || 'Return');
        await new Promise(r => setTimeout(r, 300));
      } else if (act === 'scroll') {
        doScroll(parsed.x || 0, parsed.y || 0, parsed.direction || 'down', 3);
        await new Promise(r => setTimeout(r, 300));
      }
      // 'none' or unknown — take new screenshot and continue

      // Take fresh screenshot for next iteration
      try { screenshotB64 = takeScreenshot(); } catch {}
    }

    if (steps >= MAX_ITERATIONS && status !== 'done') {
      status = 'max_iterations';
      finalText = finalText || 'Reached maximum iterations.';
    }
  } catch (e) {
    console.error('[computer-use] loop error:', e.message);
    finalText = `Loop error: ${e.message}`;
    status = 'error';
  }

  db.prepare('UPDATE computer_use_logs SET result=?, steps=?, status=? WHERE id=?')
    .run(finalText, steps, status, logId);
  console.log(`[computer-use] task=${logId} done in ${steps} step(s), status=${status}`);
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

// POST /computer-use/run
router.post('/run', (req, res) => {
  const { task } = req.body || {};

  if (!task || typeof task !== 'string' || !task.trim()) {
    return res.status(400).json({ error: 'task is required' });
  }

  // Verify screencapture is accessible before starting (quick check)
  try {
    execSync('ls /usr/sbin/screencapture', { timeout: 3000 });
  } catch (_) {
    return res.status(500).json({
      error: 'screencapture not found — is this macOS?',
    });
  }

  // Insert a pending log row
  const insert = db.prepare(
    'INSERT INTO computer_use_logs (task, result, steps, status) VALUES (?,?,?,?)'
  );
  const info = insert.run(task.trim(), null, 0, 'running');
  const logId = info.lastInsertRowid;

  // Respond immediately — loop runs async
  res.json({ status: 'running', logId });

  // Fire and forget
  runComputerUseLoop(logId, task.trim()).catch((e) => {
    console.error('[computer-use] unhandled loop error:', e.message);
    try {
      db.prepare(
        'UPDATE computer_use_logs SET result=?, status=? WHERE id=?'
      ).run(`Unhandled error: ${e.message}`, 'error', logId);
    } catch (_) {}
  });
});

// GET /computer-use/status/:id
router.get('/status/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    return res.status(400).json({ error: 'Invalid id' });
  }

  const row = db.prepare('SELECT * FROM computer_use_logs WHERE id=?').get(id);
  if (!row) {
    return res.status(404).json({ error: 'Log not found' });
  }

  res.json(row);
});

// GET /computer-use/history
router.get('/history', (req, res) => {
  const rows = db
    .prepare(
      'SELECT * FROM computer_use_logs ORDER BY created_at DESC LIMIT 20'
    )
    .all();
  res.json({ history: rows });
});

module.exports = router;
