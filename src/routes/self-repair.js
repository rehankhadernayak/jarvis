const express = require('express');
const router = express.Router();
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const Anthropic = require('@anthropic-ai/sdk');
const { db } = require('../db/init');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const LOG_PATH = '/tmp/jarvis-v2-server.log';
const CLAUDE_BIN = '/Users/28rehank/.nvm/versions/node/v24.13.1/bin/claude';
const JARVIS_DIR = '/Users/28rehank/Documents/jarvis-v2';

// POST /self-repair/analyze
router.post('/analyze', async (req, res) => {
  try {
    let logContent = '(no log file found)';
    if (fs.existsSync(LOG_PATH)) {
      const lines = fs.readFileSync(LOG_PATH, 'utf8').split('\n');
      logContent = lines.slice(-100).join('\n');
    }

    const msg = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 600,
      messages: [{
        role: 'user',
        content: `Analyze these Node.js server log lines and identify real errors (not deprecation warnings, not DeprecationWarning, not punycode warnings). Return ONLY valid JSON with no markdown:\n{ "errors": [{"message": "string", "file": "string or null", "line": "number or null", "severity": "critical|error|warning"}], "hasFixes": true|false }\n\nLog (last 100 lines):\n${logContent}`
      }]
    });

    let result = { errors: [], hasFixes: false };
    try {
      const text = msg.content[0].text;
      const match = text.match(/\{[\s\S]*\}/);
      if (match) result = JSON.parse(match[0]);
    } catch {}

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /self-repair/fix
router.post('/fix', async (req, res) => {
  const { errors = [], prompt: customPrompt } = req.body;

  const promptText = customPrompt || (errors.length
    ? `Fix the following errors in the JARVIS v2 server at ${JARVIS_DIR}:\n${errors.map(e => `- ${e.message}${e.file ? ` in ${e.file}` : ''}${e.line ? ` at line ${e.line}` : ''}`).join('\n')}\n\nFix only what is clearly broken. Be conservative.`
    : `Review the JARVIS v2 server at ${JARVIS_DIR} for any obvious errors and fix them.`);

  let logId;
  try {
    logId = db.prepare('INSERT INTO repair_logs (errors, fix_applied, status) VALUES (?,?,?)').run(
      JSON.stringify(errors), promptText, 'running'
    ).lastInsertRowid;
  } catch (err) {
    return res.status(500).json({ error: 'DB insert failed: ' + err.message });
  }

  const proc = spawn(CLAUDE_BIN, [
    '--print',
    '--dangerously-skip-permissions',
    '-p', promptText
  ], {
    cwd: JARVIS_DIR,
    env: {
      ...process.env,
      HOME: '/Users/28rehank',
      PATH: '/Users/28rehank/.nvm/versions/node/v24.13.1/bin:/Users/28rehank/homebrew/bin:/usr/local/bin:/usr/bin:/bin'
    }
  });

  let output = '';
  proc.stdout.on('data', d => { output += d.toString(); });
  proc.stderr.on('data', d => { output += '[err] ' + d.toString(); });
  proc.on('close', (code) => {
    const status = code === 0 ? 'success' : 'failed';
    try {
      db.prepare('UPDATE repair_logs SET status=?, output=? WHERE id=?').run(status, output.slice(0, 4000), logId);
      if (code === 0) {
        execSync('launchctl kickstart -k "gui/$(id -u)/ai.jarvis.v2server" 2>/dev/null || true', { shell: '/bin/zsh' });
      }
    } catch {}
  });

  res.json({ status: 'started', logId, message: 'Claude Code spawned — fix running in background' });
});

// GET /self-repair/status/:id
router.get('/status/:id', (req, res) => {
  try {
    const row = db.prepare('SELECT * FROM repair_logs WHERE id=?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /self-repair/history
router.get('/history', (req, res) => {
  try {
    const logs = db.prepare('SELECT * FROM repair_logs ORDER BY created_at DESC LIMIT 20').all();
    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
