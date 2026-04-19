const express = require('express');
const router = express.Router();
const { db } = require('../db/init');
const Anthropic = require('@anthropic-ai/sdk');

const SONNET = 'claude-sonnet-4-6';

async function fetchDuckDuckGo(query) {
  const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_redirect=1&no_html=1`;
  const res = await fetch(url, { headers: { 'User-Agent': 'JARVIS-v2' }, signal: AbortSignal.timeout(6000) });
  if (!res.ok) throw new Error(`DuckDuckGo HTTP ${res.status}`);
  const data = await res.json();
  const parts = [];
  if (data.AbstractText) parts.push(`Abstract: ${data.AbstractText}`);
  if (data.Answer) parts.push(`Answer: ${data.Answer}`);
  if (data.Definition) parts.push(`Definition: ${data.Definition}`);
  if (data.RelatedTopics?.length) {
    const topics = data.RelatedTopics
      .filter((t) => t.Text)
      .slice(0, 5)
      .map((t) => `- ${t.Text}`);
    if (topics.length) parts.push(`Related:\n${topics.join('\n')}`);
  }
  if (!parts.length) throw new Error('DuckDuckGo returned no useful content');
  return { source: 'DuckDuckGo', content: parts.join('\n\n'), url: data.AbstractURL || null };
}

async function fetchWikipedia(query) {
  const slug = encodeURIComponent(query.split(' ').slice(0, 3).join('_'));
  const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${slug}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'JARVIS-v2' }, signal: AbortSignal.timeout(6000) });
  if (!res.ok) throw new Error(`Wikipedia HTTP ${res.status}`);
  const data = await res.json();
  if (!data.extract) throw new Error('Wikipedia returned no extract');
  return {
    source: 'Wikipedia',
    content: data.extract,
    url: data.content_urls?.desktop?.page || null,
    title: data.title || null,
  };
}

// POST /research/search
router.post('/search', async (req, res) => {
  try {
    const { query, depth = 'quick' } = req.body;
    if (!query || typeof query !== 'string' || !query.trim()) {
      return res.status(400).json({ error: 'Body must include a non-empty "query" string.' });
    }

    const sources = [];
    const sourceParts = [];

    // Fetch DuckDuckGo
    try {
      const ddg = await fetchDuckDuckGo(query);
      sources.push({ name: ddg.source, url: ddg.url });
      sourceParts.push(`[DuckDuckGo]\n${ddg.content}`);
    } catch (e) {
      // DuckDuckGo failed — continue with Wikipedia only
    }

    // Fetch Wikipedia
    try {
      const wiki = await fetchWikipedia(query);
      sources.push({ name: wiki.source, url: wiki.url });
      sourceParts.push(`[Wikipedia${wiki.title ? ` — ${wiki.title}` : ''}]\n${wiki.content}`);
    } catch (e) {
      // Wikipedia also failed — will use Claude's knowledge
    }

    const hasExternalData = sourceParts.length > 0;
    const sourceBlock = hasExternalData
      ? `Use the following source data to inform your answer:\n\n${sourceParts.join('\n\n---\n\n')}\n\n`
      : `No external source data was available. Use your own knowledge to answer.\n\n`;

    const depthInstruction =
      depth === 'deep'
        ? 'Provide a thorough, detailed research report with 5-8 key facts.'
        : 'Provide a concise research report with 3-5 key facts.';

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const msg = await client.messages.create({
      model: SONNET,
      max_tokens: depth === 'deep' ? 1200 : 700,
      messages: [
        {
          role: 'user',
          content: `You are JARVIS, an expert research assistant. ${depthInstruction}

${sourceBlock}Research query: "${query}"

Respond with a JSON object in exactly this format (no markdown, raw JSON only):
{
  "title": "concise report title",
  "summary": "2-3 sentence overview",
  "key_facts": ["fact 1", "fact 2", "fact 3"],
  "sources_used": ["source name or url"],
  "confidence": "high" | "medium" | "low"
}

Set confidence to "high" if backed by source data, "medium" if partially, "low" if using only prior knowledge.`,
        },
      ],
    });

    let report;
    try {
      const raw = msg.content[0].text.match(/\{[\s\S]*\}/)?.[0];
      if (!raw) throw new Error('No JSON object found in Claude response');
      report = JSON.parse(raw);
    } catch (parseErr) {
      return res.status(502).json({ error: 'Failed to parse Claude research report', raw: msg.content[0].text });
    }

    // Merge source URLs from actual fetches
    if (sources.length && (!report.sources_used || !report.sources_used.length)) {
      report.sources_used = sources.map((s) => s.url || s.name).filter(Boolean);
    }

    // Save to research_sessions
    db.prepare(
      `INSERT INTO research_sessions (query, result, sources) VALUES (?, ?, ?)`
    ).run(query.trim(), JSON.stringify(report), JSON.stringify(sources));

    // Auto-save research to documents for future Q&A (E8)
    try {
      const docFilename = `research: ${report.title || query.trim()}`.slice(0, 200);
      const docContent = [
        `Query: ${query}`,
        `Summary: ${report.summary || ''}`,
        `Key Facts:\n${(report.key_facts || []).map(f => `- ${f}`).join('\n')}`,
        `Sources: ${(report.sources_used || []).join(', ')}`,
        `Confidence: ${report.confidence || 'unknown'}`,
      ].join('\n\n');
      const docSummary = report.summary || `Research on: ${query}`;

      db.prepare(
        'INSERT INTO documents (filename, content_text, summary, tags) VALUES (?, ?, ?, ?)'
      ).run(docFilename, docContent, docSummary, 'research,auto-saved');
    } catch (e) {
      // Non-critical — don't fail the research response if doc save fails
      console.error('[research] auto-save to docs failed:', e.message);
    }

    res.json({ ...report, sources_fetched: sources, query });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /research/history
router.get('/history', (req, res) => {
  try {
    const sessions = db
      .prepare(
        `SELECT id, query, substr(result, 1, 200) as result_preview, created_at
         FROM research_sessions ORDER BY created_at DESC LIMIT 10`
      )
      .all();
    res.json({ sessions });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /research/:id
router.get('/:id', (req, res) => {
  try {
    const session = db
      .prepare(`SELECT id, query, result, sources, created_at FROM research_sessions WHERE id = ?`)
      .get(req.params.id);
    if (!session) {
      return res.status(404).json({ error: 'Research session not found.' });
    }
    let result = session.result;
    let sources = session.sources;
    try { result = JSON.parse(session.result); } catch (_) {}
    try { sources = JSON.parse(session.sources); } catch (_) {}
    res.json({ id: session.id, query: session.query, result, sources, created_at: session.created_at });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
