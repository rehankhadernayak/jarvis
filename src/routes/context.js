/**
 * JARVIS Context Routes
 * Active app + screen awareness — what is Rehan currently doing on his Mac.
 */

const express = require('express');
const router = express.Router();
const { execSync, execFile } = require('child_process');
const fs = require('fs');
const Anthropic = require('@anthropic-ai/sdk');
const { setMemory, getMemory } = require('../db/init');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Browser app names that support URL fetching
const CHROME_LIKE = ['Google Chrome', 'Arc', 'Brave Browser'];
const SAFARI_LIKE = ['Safari'];

// ── GET /context/active ───────────────────────────────────────────────────────
// Returns active app, window title, URL (for browsers), and timestamp
router.get('/active', (req, res) => {
  const timestamp = new Date().toISOString();

  // 1. Get active app name
  let app = null;
  try {
    app = execSync(
      `osascript -e 'tell application "System Events" to get name of first application process whose frontmost is true'`,
      { timeout: 5000 }
    ).toString().trim();
  } catch {}

  // 2. Get window title
  let window_title = null;
  try {
    window_title = execSync(
      `osascript -e 'tell application "System Events" to get title of front window of (first application process whose frontmost is true)'`,
      { timeout: 5000 }
    ).toString().trim() || null;
  } catch {}

  // 3. Get URL for browser apps
  let url = null;
  if (app) {
    if (CHROME_LIKE.includes(app)) {
      // Chrome, Arc, and Brave all use Google Chrome AppleScript interface
      const appTarget = app === 'Google Chrome' ? 'Google Chrome' : app;
      try {
        url = execSync(
          `osascript -e 'tell application "${appTarget}" to get URL of active tab of front window'`,
          { timeout: 5000 }
        ).toString().trim() || null;
      } catch {}
    } else if (SAFARI_LIKE.includes(app)) {
      try {
        url = execSync(
          `osascript -e 'tell application "Safari" to get URL of current tab of front window'`,
          { timeout: 5000 }
        ).toString().trim() || null;
      } catch {}
    }
  }

  const result = { app, window_title, url, timestamp };

  // Save to DB
  try {
    setMemory('active_app_context', JSON.stringify(result));
  } catch {}

  res.json(result);
});

// ── POST /context/screen ──────────────────────────────────────────────────────
// Capture screenshot, analyse with Claude Vision, return analysis
router.post('/screen', async (req, res) => {
  const timestamp = new Date().toISOString();
  const screenshotPath = `/tmp/jarvis-screen-${Date.now()}.png`;

  // 1. Capture screenshot (no shutter sound, -x flag)
  await new Promise((resolve) => {
    execFile('screencapture', ['-x', screenshotPath], (err) => resolve(err));
  });

  let analysis = null;
  try {
    // 2. Read PNG into buffer
    const imageBuffer = fs.readFileSync(screenshotPath);
    const base64Image = imageBuffer.toString('base64');

    // 3. Send to Claude Vision
    const msg = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 300,
      system: 'You are JARVIS analyzing Rehan\'s screen. Be specific and concise.',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/png',
                data: base64Image
              }
            },
            {
              type: 'text',
              text: 'Describe what Rehan is working on. What app, what content, what task? 3 sentences max.'
            }
          ]
        }
      ]
    });

    analysis = msg.content[0].text.trim();
  } catch (e) {
    console.error('[context] Screen analysis failed:', e.message);
  }

  // 4. Delete temp screenshot
  try { fs.unlinkSync(screenshotPath); } catch {}

  const result = { analysis, timestamp };

  // 5. Save to DB
  try {
    setMemory('screen_context', JSON.stringify(result));
  } catch {}

  // 6. Return
  res.json(result);
});

// ── GET /context/current ──────────────────────────────────────────────────────
// Return both active_app_context and screen_context from memory
router.get('/current', (req, res) => {
  let app = null;
  let screen = null;

  try {
    const raw = getMemory('active_app_context');
    if (raw) app = JSON.parse(raw);
  } catch {}

  try {
    const raw = getMemory('screen_context');
    if (raw) screen = JSON.parse(raw);
  } catch {}

  res.json({ app, screen });
});

module.exports = router;
