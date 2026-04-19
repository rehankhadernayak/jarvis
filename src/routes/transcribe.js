'use strict';

const express = require('express');
const router = express.Router();
const multer = require('multer');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const Anthropic = require('@anthropic-ai/sdk');
const { db } = require('../db/init');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const HAIKU = 'claude-haiku-4-5-20251001';
const PYTHON_BIN = '/Users/28rehank/.jarvis-voice/bin/python3';

// Accept audio in memory only — written to /tmp ourselves so we control cleanup
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 200 * 1024 * 1024 }, // 200 MB
  fileFilter: (_req, file, cb) => {
    const allowed = ['audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/mp4',
                     'audio/x-m4a', 'audio/m4a', 'video/mp4', 'application/octet-stream'];
    const ext = path.extname(file.originalname).toLowerCase();
    const allowedExt = ['.mp3', '.wav', '.m4a', '.mp4'];
    if (allowed.includes(file.mimetype) || allowedExt.includes(ext)) return cb(null, true);
    cb(new Error(`Unsupported file type: ${file.mimetype} / ${ext}`));
  },
});

// ── Helper: run faster-whisper via Python subprocess ─────────────────────────
/**
 * @param {string} filepath  Absolute path to audio file on disk.
 * @returns {Promise<{ text: string, duration: number }>}
 */
function runWhisper(filepath) {
  return new Promise((resolve, reject) => {
    // Single-quoted filepath is interpolated inside a double-quoted shell string —
    // use JSON.stringify to safely escape the path for Python string literals.
    const pyCode = `
from faster_whisper import WhisperModel
import sys
model = WhisperModel('tiny.en', device='cpu', compute_type='int8')
segments, info = model.transcribe(${JSON.stringify(filepath)}, beam_size=5)
text = ' '.join([s.text.strip() for s in segments])
print('DURATION:' + str(info.duration))
print(text)
`.trim();

    const proc = spawn(PYTHON_BIN, ['-c', pyCode], {
      env: { ...process.env, HOME: os.homedir() },
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

    proc.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(`Whisper exited with code ${code}: ${stderr.slice(0, 500)}`));
      }

      const lines = stdout.trim().split('\n');
      let duration = 0;
      let textLines = [];
      for (const line of lines) {
        if (line.startsWith('DURATION:')) {
          duration = parseFloat(line.replace('DURATION:', '')) || 0;
        } else {
          textLines.push(line);
        }
      }
      const text = textLines.join(' ').replace(/\s+/g, ' ').trim();
      resolve({ text, duration });
    });

    proc.on('error', (err) => {
      reject(new Error(`Failed to spawn Python: ${err.message}`));
    });
  });
}

// ── Helper: summarise transcript with Claude haiku ────────────────────────────
async function summariseTranscript(transcript) {
  const msg = await client.messages.create({
    model: HAIKU,
    max_tokens: 512,
    messages: [{
      role: 'user',
      content: `Summarise this meeting transcript in exactly 3 concise bullet points. Each bullet should capture a distinct key point, decision, or action item. Use plain text, no markdown headers.\n\nTranscript:\n${transcript}`,
    }],
  });
  return msg.content[0].text.trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /transcribe/upload
// ─────────────────────────────────────────────────────────────────────────────
router.post('/upload', upload.single('audio'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No audio file provided. Use multipart field name "audio".' });
  }

  const ext = path.extname(req.file.originalname).toLowerCase() || '.mp3';
  const tmpPath = path.join('/tmp', `jarvis-trans-${Date.now()}${ext}`);

  try {
    // Write buffer to temp file
    fs.writeFileSync(tmpPath, req.file.buffer);

    // Transcribe
    let whisperResult;
    try {
      whisperResult = await runWhisper(tmpPath);
    } catch (whisperErr) {
      console.error('[transcribe] Whisper error:', whisperErr.message);
      return res.status(500).json({ error: 'Transcription failed', detail: whisperErr.message });
    }

    const { text: transcript, duration } = whisperResult;

    if (!transcript) {
      return res.status(422).json({ error: 'Whisper returned empty transcript. File may be silent or corrupted.' });
    }

    // Summarise
    let summary = '';
    try {
      summary = await summariseTranscript(transcript);
    } catch (summaryErr) {
      console.error('[transcribe] Summary error:', summaryErr.message);
      summary = '(Summary unavailable)';
    }

    // Persist
    const insert = db.prepare(
      'INSERT INTO transcriptions (filename, transcript, summary, duration_s) VALUES (?,?,?,?)'
    );
    const result = insert.run(req.file.originalname, transcript, summary, duration);
    const row = db.prepare('SELECT id, filename, transcript, summary, created_at FROM transcriptions WHERE id=?').get(result.lastInsertRowid);

    return res.status(201).json(row);
  } finally {
    // Always clean up temp file
    try { fs.unlinkSync(tmpPath); } catch (_) { /* ignore */ }
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /transcribe  — list all transcriptions (light: no full transcript)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/', (req, res) => {
  try {
    const rows = db.prepare(
      'SELECT id, filename, summary, duration_s, created_at FROM transcriptions ORDER BY id DESC'
    ).all();
    res.json({ total: rows.length, transcriptions: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /transcribe/:id  — full transcript
// ─────────────────────────────────────────────────────────────────────────────
router.get('/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });

    const row = db.prepare(
      'SELECT id, filename, transcript, summary, duration_s, created_at FROM transcriptions WHERE id=?'
    ).get(id);

    if (!row) return res.status(404).json({ error: 'Transcription not found' });
    res.json(row);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
