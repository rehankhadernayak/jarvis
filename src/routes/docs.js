const express = require('express');
const router = express.Router();
const multer = require('multer');
const pdfParse = require('pdf-parse');
const { db } = require('../db/init');
const Anthropic = require('@anthropic-ai/sdk');

const SONNET = 'claude-sonnet-4-6';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (_req, file, cb) => {
    const allowed = ['application/pdf', 'text/plain'];
    if (allowed.includes(file.mimetype) || file.originalname.endsWith('.txt') || file.originalname.endsWith('.pdf')) {
      cb(null, true);
    } else {
      cb(new Error('Only PDF and TXT files are supported'));
    }
  },
});

// POST /docs/upload
router.post('/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded. Use multipart field name "file".' });
    }

    const { originalname, buffer, mimetype } = req.file;
    let contentText = '';

    if (mimetype === 'application/pdf' || originalname.toLowerCase().endsWith('.pdf')) {
      const data = await pdfParse(buffer);
      contentText = data.text;
    } else {
      contentText = buffer.toString('utf8');
    }

    if (!contentText.trim()) {
      return res.status(422).json({ error: 'Could not extract any text from the file.' });
    }

    const truncated = contentText.slice(0, 50000);
    const wordCount = truncated.trim().split(/\s+/).length;

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const msg = await client.messages.create({
      model: SONNET,
      max_tokens: 300,
      messages: [
        {
          role: 'user',
          content: `Summarize the following document in exactly 3 sentences. Be concise and capture the most important information.\n\nDocument: ${originalname}\n\n${truncated.slice(0, 8000)}`,
        },
      ],
    });

    const summary = msg.content[0].text.trim();

    const stmt = db.prepare(
      `INSERT INTO documents (filename, content_text, summary, tags) VALUES (?, ?, ?, ?)`
    );
    const result = stmt.run(originalname, truncated, summary, null);

    const doc = db
      .prepare(`SELECT id, filename, summary, tags, created_at FROM documents WHERE id = ?`)
      .get(result.lastInsertRowid);

    res.status(201).json({ id: doc.id, filename: doc.filename, summary: doc.summary, word_count: wordCount, created_at: doc.created_at });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /docs
router.get('/', (req, res) => {
  try {
    const docs = db
      .prepare(`SELECT id, filename, summary, tags, created_at FROM documents ORDER BY created_at DESC`)
      .all();
    res.json({ documents: docs, count: docs.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /docs/:id/query
router.post('/:id/query', async (req, res) => {
  try {
    const { question } = req.body;
    if (!question || typeof question !== 'string' || !question.trim()) {
      return res.status(400).json({ error: 'Body must include a non-empty "question" string.' });
    }

    const doc = db
      .prepare(`SELECT id, filename, content_text FROM documents WHERE id = ?`)
      .get(req.params.id);

    if (!doc) {
      return res.status(404).json({ error: 'Document not found.' });
    }

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const msg = await client.messages.create({
      model: SONNET,
      max_tokens: 800,
      messages: [
        {
          role: 'user',
          content: `You are answering a question about a document. Use only the document text provided. If the answer is not in the document, say so clearly.\n\nDocument: ${doc.filename}\n\nDocument Text:\n${doc.content_text.slice(0, 40000)}\n\nQuestion: ${question}`,
        },
      ],
    });

    const answer = msg.content[0].text.trim();
    res.json({ answer, document: doc.filename });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /docs/:id
router.delete('/:id', (req, res) => {
  try {
    const doc = db.prepare(`SELECT id, filename FROM documents WHERE id = ?`).get(req.params.id);
    if (!doc) {
      return res.status(404).json({ error: 'Document not found.' });
    }
    db.prepare(`DELETE FROM documents WHERE id = ?`).run(req.params.id);
    res.json({ ok: true, deleted: { id: doc.id, filename: doc.filename } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
