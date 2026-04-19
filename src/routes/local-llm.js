const express = require('express');
const router = express.Router();
const Anthropic = require('@anthropic-ai/sdk');

const OLLAMA_BASE = 'http://localhost:11434';
const JARVIS_SYSTEM =
  "You are JARVIS, Rehan's personal AI OS. Rehan is 17, Singapore, entrepreneur and student. Direct, British-toned, no fluff.";

// Preferred model order for auto-selection
const PREFERRED_MODELS = ['gemma3', 'llama3.2', 'mistral', 'phi3'];

async function getAvailableModels() {
  const r = await fetch(`${OLLAMA_BASE}/api/tags`, { signal: AbortSignal.timeout(5000) });
  if (!r.ok) throw new Error(`Ollama /api/tags HTTP ${r.status}`);
  const data = await r.json();
  return data.models || [];
}

async function selectModel(preferredModel) {
  if (preferredModel) return preferredModel;

  const models = await getAvailableModels();
  if (!models.length) throw new Error('No Ollama models available');

  const names = models.map((m) => m.name);

  for (const pref of PREFERRED_MODELS) {
    const match = names.find((n) => n.startsWith(pref));
    if (match) return match;
  }

  return names[0];
}

async function callOllama(model, messages) {
  const r = await fetch(`${OLLAMA_BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages, stream: false }),
    signal: AbortSignal.timeout(30000),
  });
  if (!r.ok) throw new Error(`Ollama /api/chat HTTP ${r.status}`);
  const data = await r.json();
  return data.message?.content || '';
}

// GET /local-llm/models
router.get('/models', async (req, res) => {
  try {
    const models = await getAvailableModels();
    res.json(models.map((m) => ({ name: m.name, size: m.size })));
  } catch (e) {
    res.status(502).json({ error: 'Local LLM unavailable', fallback: true });
  }
});

// POST /local-llm/chat
router.post('/chat', async (req, res) => {
  try {
    const { message, model: requestedModel, system } = req.body;
    if (!message || typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({ error: 'Body must include a non-empty "message" string.' });
    }

    let model;
    try {
      model = await selectModel(requestedModel || null);
    } catch (e) {
      return res.status(503).json({ error: 'Local LLM unavailable', fallback: true });
    }

    const messages = [
      { role: 'system', content: system || JARVIS_SYSTEM },
      { role: 'user', content: message },
    ];

    const start = Date.now();
    let response;
    try {
      response = await callOllama(model, messages);
    } catch (e) {
      return res.status(503).json({ error: 'Local LLM unavailable', fallback: true });
    }
    const duration_ms = Date.now() - start;

    res.json({ response, model, duration_ms });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /local-llm/classify
router.post('/classify', async (req, res) => {
  try {
    const { text } = req.body;
    if (!text || typeof text !== 'string' || !text.trim()) {
      return res.status(400).json({ error: 'Body must include a non-empty "text" string.' });
    }

    let model;
    try {
      model = await selectModel(null);
    } catch (e) {
      return res.json({ intent: 'api' });
    }

    const prompt = `Classify this task as "local" or "api". Local=factual lookups, summaries, simple Q&A. API=creative writing, complex reasoning, code. Reply with ONLY "local" or "api".\n\nTask: ${text}`;

    let raw;
    try {
      raw = await callOllama(model, [{ role: 'user', content: prompt }]);
    } catch (e) {
      return res.json({ intent: 'api' });
    }

    const intent = raw.trim().toLowerCase().startsWith('local') ? 'local' : 'api';
    res.json({ intent, model });
  } catch (e) {
    res.json({ intent: 'api' });
  }
});

// POST /local-llm/smart-chat
router.post('/smart-chat', async (req, res) => {
  try {
    const { message, system } = req.body;
    if (!message || typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({ error: 'Body must include a non-empty "message" string.' });
    }

    // Step 1: classify intent
    let intent = 'api';
    try {
      const classifyRes = await fetch(`http://localhost:3001/local-llm/classify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: message }),
        signal: AbortSignal.timeout(10000),
      });
      if (classifyRes.ok) {
        const classifyData = await classifyRes.json();
        intent = classifyData.intent || 'api';
      }
    } catch (e) {
      intent = 'api';
    }

    // Step 2: route based on intent
    if (intent === 'local') {
      let model;
      try {
        model = await selectModel(null);
      } catch (e) {
        return res.status(503).json({ error: 'Local LLM unavailable', fallback: true });
      }

      const messages = [
        { role: 'system', content: system || JARVIS_SYSTEM },
        { role: 'user', content: message },
      ];

      try {
        const response = await callOllama(model, messages);
        return res.json({ response, source: 'local', model });
      } catch (e) {
        // fall through to API
        intent = 'api';
      }
    }

    // Step 3: call Anthropic (intent === 'api' or local fallback)
    try {
      const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      const msg = await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 500,
        system: system || JARVIS_SYSTEM,
        messages: [{ role: 'user', content: message }],
      });
      const response = msg.content[0].text;
      return res.json({ response, source: 'api', model: 'claude-haiku-4-5-20251001' });
    } catch (e) {
      // Step 4: Anthropic failed — fall back to Ollama
      let model;
      try {
        model = await selectModel(null);
      } catch (ollamaErr) {
        return res.status(503).json({ error: 'Both Anthropic and local LLM unavailable', fallback: true });
      }

      const messages = [
        { role: 'system', content: system || JARVIS_SYSTEM },
        { role: 'user', content: message },
      ];

      try {
        const response = await callOllama(model, messages);
        return res.json({ response, source: 'local', model });
      } catch (ollamaErr) {
        return res.status(503).json({ error: 'Both Anthropic and local LLM unavailable', fallback: true });
      }
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
