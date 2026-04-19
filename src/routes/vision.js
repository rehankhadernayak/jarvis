const express = require('express');
const router = express.Router();
const { execSync } = require('child_process');
const fs = require('fs');
const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const SNAP_PATH = '/tmp/jarvis-vision-snap.png';

// GET /vision/status
router.get('/status', (req, res) => {
  res.json({ ok: true, note: 'POST /vision/analyze to capture + analyze screen' });
});

// POST /vision/analyze
router.post('/analyze', async (req, res) => {
  const { prompt } = req.body || {};

  try {
    // Take screenshot
    execSync(`/usr/sbin/screencapture -x -t png ${SNAP_PATH}`);
  } catch (e) {
    return res.status(500).json({ error: 'screencapture failed', detail: e.message });
  }

  try {
    const base64data = fs.readFileSync(SNAP_PATH).toString('base64');

    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 500,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: base64data } },
          { type: 'text', text: prompt || "Describe what is on screen. Be concise (3-5 sentences). Flag anything that needs Rehan's attention." }
        ]
      }]
    });

    const analysis = response.content[0]?.text || '';

    // Clean up temp file
    try { fs.unlinkSync(SNAP_PATH); } catch (_) {}

    res.json({ analysis, capturedAt: new Date().toISOString() });
  } catch (e) {
    // Clean up on error too
    try { fs.unlinkSync(SNAP_PATH); } catch (_) {}
    res.status(500).json({ error: 'Vision analysis failed', detail: e.message });
  }
});

module.exports = router;
