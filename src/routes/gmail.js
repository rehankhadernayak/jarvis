const express = require('express');
const router = express.Router();
const { google } = require('googleapis');
const { getUnreadEmails, sendEmail } = require('../google/gmail');
const { getAuthenticatedClient } = require('../google/auth');
const Anthropic = require('@anthropic-ai/sdk');

router.get('/unread', async (req, res) => {
  try { res.json(await getUnreadEmails()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/triage', async (req, res) => {
  try {
    const emails = await getUnreadEmails(10);
    if (!emails.length) return res.json({ urgent: [], normal: [], total: 0 });
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const prompt = emails.map((e,i) => `${i+1}. From: ${e.from}\nSubject: ${e.subject}\nSnippet: ${e.snippet}`).join('\n\n');
    const msg = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      messages: [{ role: 'user', content: `Triage these emails for urgency. Reply with JSON: {"urgent":[indices],"normal":[indices]}. Indices are 1-based.\n\n${prompt}` }]
    });
    const parsed = JSON.parse(msg.content[0].text.match(/\{[\s\S]*\}/)[0]);
    res.json({ emails, urgent: parsed.urgent || [], normal: parsed.normal || [], total: emails.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/send', async (req, res) => {
  try { await sendEmail(req.body); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /gmail/draft — Create a Gmail draft (not sent)
// Body: { to: string, subject: string, body: string }
router.post('/draft', async (req, res) => {
  try {
    const { to, subject, body } = req.body;
    if (!to || !subject || !body) {
      return res.status(400).json({ error: 'Body must include "to", "subject", and "body" fields.' });
    }

    const auth = await getAuthenticatedClient();
    const gmail = google.gmail({ version: 'v1', auth });

    // Build RFC 2822 message
    const rfc2822 = [
      `To: ${to}`,
      `Subject: ${subject}`,
      'Content-Type: text/plain; charset=UTF-8',
      'MIME-Version: 1.0',
      '',
      body,
    ].join('\r\n');

    const encoded = Buffer.from(rfc2822)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    const draft = await gmail.users.drafts.create({
      userId: 'me',
      resource: { message: { raw: encoded } },
    });

    res.json({ ok: true, draftId: draft.data.id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /gmail/reply-draft — Create a draft reply to an existing message
// Body: { messageId: string, reply: string }
router.post('/reply-draft', async (req, res) => {
  try {
    const { messageId, reply } = req.body;
    if (!messageId || !reply) {
      return res.status(400).json({ error: 'Body must include "messageId" and "reply" fields.' });
    }

    const auth = await getAuthenticatedClient();
    const gmail = google.gmail({ version: 'v1', auth });

    // Fetch original message headers
    const original = await gmail.users.messages.get({
      userId: 'me',
      id: messageId,
      format: 'metadata',
      metadataHeaders: ['From', 'Subject', 'Message-ID', 'References'],
    });

    const headers = original.data.payload.headers;
    const getHeader = (name) => headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || '';

    const fromHeader = getHeader('From');
    const subjectHeader = getHeader('Subject');
    const messageIdHeader = getHeader('Message-ID');
    const referencesHeader = getHeader('References');

    // Reply subject: prepend Re: if not already there
    const replySubject = subjectHeader.startsWith('Re:') ? subjectHeader : `Re: ${subjectHeader}`;

    // Build References chain for threading
    const newReferences = referencesHeader
      ? `${referencesHeader} ${messageIdHeader}`.trim()
      : messageIdHeader;

    const rfc2822Lines = [
      `To: ${fromHeader}`,
      `Subject: ${replySubject}`,
      'Content-Type: text/plain; charset=UTF-8',
      'MIME-Version: 1.0',
    ];
    if (messageIdHeader) rfc2822Lines.push(`In-Reply-To: ${messageIdHeader}`);
    if (newReferences) rfc2822Lines.push(`References: ${newReferences}`);
    rfc2822Lines.push('', reply);

    const rfc2822 = rfc2822Lines.join('\r\n');
    const encoded = Buffer.from(rfc2822)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    const draft = await gmail.users.drafts.create({
      userId: 'me',
      resource: {
        message: {
          raw: encoded,
          threadId: original.data.threadId,
        },
      },
    });

    res.json({ ok: true, draftId: draft.data.id, to: fromHeader, subject: replySubject });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
