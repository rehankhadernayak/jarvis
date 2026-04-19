// JARVIS v2 Custom Web Server
// Serves the JARVIS UI and proxies chat to OpenClaw gateway via CLI
const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { db } = require('./src/db/init');

const app = express();
const PORT = 3001;

const OPENCLAW_BIN = path.join(__dirname, 'node_modules/openclaw/dist/index.js');
const NODE_BIN = '/Users/28rehank/.nvm/versions/node/v24.13.1/bin/node';
const HOME = '/Users/28rehank';

// Explicit env for child processes — ensures correct HOME, PATH, and node version
const SPAWN_ENV = {
  ...process.env,
  HOME,
  PATH: `/Users/28rehank/.nvm/versions/node/v24.13.1/bin:/Users/28rehank/homebrew/bin:/usr/local/bin:/usr/bin:/bin`,
  OPENCLAW_STATE_DIR: `${HOME}/.openclaw`,
};

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// POST /chat — SSE stream from openclaw agent
app.post('/chat', (req, res) => {
  const { message, sessionId = 'jarvis-phone' } = req.body;
  if (!message?.trim()) return res.status(400).json({ error: 'No message' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const proc = spawn(NODE_BIN, [
    OPENCLAW_BIN,
    'agent',
    '--agent', 'main',
    '--session-id', sessionId,
    '-m', message
  ], { env: SPAWN_ENV });

  let buffer = '';

  proc.stdout.on('data', (chunk) => {
    const text = chunk.toString();
    buffer += text;
    // Stream each chunk as SSE
    const lines = text.split('\n');
    lines.forEach((line) => {
      if (line.trim()) {
        res.write(`data: ${JSON.stringify({ text: line + '\n' })}\n\n`);
      }
    });
  });

  proc.stderr.on('data', (chunk) => {
    // Suppress deprecation warnings, only log real errors
    const err = chunk.toString();
    if (!err.includes('DeprecationWarning') && !err.includes('punycode')) {
      console.error('[openclaw stderr]', err.trim());
    }
  });

  proc.on('close', (code) => {
    // Log conversation to episodic memory
    try {
      db.prepare('INSERT INTO conversations (role, content) VALUES (?,?)').run('user', message);
      if (buffer.trim()) db.prepare('INSERT INTO conversations (role, content) VALUES (?,?)').run('assistant', buffer.trim());
    } catch {}
    res.write(`data: ${JSON.stringify({ done: true, code })}\n\n`);
    res.end();
  });

  res.on('close', () => {
    if (!proc.killed) proc.kill();
  });
});

// GET /status
app.get('/status', (req, res) => {
  res.json({ status: 'ok', version: 'JARVIS v2', time: new Date().toISOString() });
});

// GET /status/full — service health + circuit breaker states + route inventory
app.get('/status/full', (req, res) => {
  const { CircuitBreaker } = require('./src/utils/circuit-breaker');
  const routes = [
    '/auth','/calendar','/gmail','/shortcuts','/memory','/life-score','/vision','/gametime',
    '/sat','/briefing','/news','/essay','/travel','/decisions','/finance','/github',
    '/docs','/research','/transcribe','/memory-recall','/context','/managebac',
    '/self-repair','/emotional','/computer-use','/local-llm','/predict',
    '/habits','/reading-list','/uni','/crm','/meals'
  ];
  res.json({
    status: 'ok',
    version: 'JARVIS v2',
    time: new Date().toISOString(),
    uptime_s: Math.floor(process.uptime()),
    routes,
    circuit_breakers: CircuitBreaker.getAllStates(),
    memory_mb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
  });
});

// Native v2 routes
const authRouter = require('./src/routes/auth');
const calendarRouter = require('./src/routes/calendar');
const gmailRouter = require('./src/routes/gmail');
const shortcutsRouter = require('./src/routes/shortcuts');
const memoryRouter = require('./src/routes/memory');
const lifeScoreRouter = require('./src/routes/life-score');
const visionRouter = require('./src/routes/vision');
const gametimeRouter = require('./src/routes/gametime');

app.use('/auth', authRouter);
app.use('/calendar', calendarRouter);
app.use('/gmail', gmailRouter);
app.use('/shortcuts', shortcutsRouter);
app.use('/memory', memoryRouter);
app.use('/life-score', lifeScoreRouter);
app.use('/vision', visionRouter);
app.use('/gametime', gametimeRouter);

const satRouter = require('./src/routes/sat');
const briefingRouter = require('./src/routes/briefing');
const newsRouter = require('./src/routes/news');

app.use('/sat', satRouter);
app.use('/briefing', briefingRouter);
app.use('/news', newsRouter);

// Feature routes
const essayRouter = require('./src/routes/essay');
const travelRouter = require('./src/routes/travel');
const decisionsRouter = require('./src/routes/decisions');
const financeRouter = require('./src/routes/finance');
const githubRouter = require('./src/routes/github');
const docsRouter = require('./src/routes/docs');
const researchRouter = require('./src/routes/research');
const transcribeRouter = require('./src/routes/transcribe');

const memoryRecallRouter = require('./src/routes/memory-recall');

app.use('/essay', essayRouter);
app.use('/travel', travelRouter);
app.use('/decisions', decisionsRouter);
app.use('/finance', financeRouter);
app.use('/github', githubRouter);
app.use('/docs', docsRouter);
app.use('/research', researchRouter);
app.use('/transcribe', transcribeRouter);
app.use('/memory-recall', memoryRecallRouter);

const contextRouter = require('./src/routes/context');
const managebacRouter = require('./src/routes/managebac');

app.use('/context', contextRouter);
app.use('/managebac', managebacRouter);

const selfRepairRouter = require('./src/routes/self-repair');
app.use('/self-repair', selfRepairRouter);

const emotionalRouter = require('./src/routes/emotional');
app.use('/emotional', emotionalRouter);

const computerUseRouter = require('./src/routes/computer-use');
app.use('/computer-use', computerUseRouter);

const localLlmRouter = require('./src/routes/local-llm');
app.use('/local-llm', localLlmRouter);

const predictRouter = require('./src/routes/predict');
app.use('/predict', predictRouter);

const habitsRouter = require('./src/routes/habits');
app.use('/habits', habitsRouter);

const readingListRouter = require('./src/routes/reading-list');
app.use('/reading-list', readingListRouter);

const uniRouter = require('./src/routes/uni');
app.use('/uni', uniRouter);

const crmRouter = require('./src/routes/crm');
app.use('/crm', crmRouter);

const mealsRouter = require('./src/routes/meals');
app.use('/meals', mealsRouter);

// v1 removed — JARVIS is fully v2

// Proactive daemon — the heartbeat
const { startProactiveDaemon } = require('./src/daemon/proactive');
startProactiveDaemon();

// ManageBac auto-sync cron
const { startManageBacSync } = require('./src/daemon/managebac-cron');
startManageBacSync();

// Telegram bot — long-polling, non-blocking
const { poll: startTelegramBot } = require('./src/telegram/bot');
startTelegramBot().catch(e => console.error('[telegram] Fatal:', e.message));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`JARVIS v2 server running on port ${PORT}`);
});

// OAuth shim on port 3000 — forwards Google callback to port 3001
// Google Cloud Console has localhost:3000 registered as redirect URI
const http = require('http');
http.createServer((req, res) => {
  if (req.url.startsWith('/auth/google/callback')) {
    res.writeHead(302, { Location: `http://localhost:3001${req.url}` });
    res.end();
  } else {
    res.writeHead(200); res.end('JARVIS OAuth shim');
  }
}).listen(3000, '127.0.0.1', () => {
  console.log('OAuth shim listening on port 3000 → forwarding to 3001');
});
