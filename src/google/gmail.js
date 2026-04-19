const { google } = require('googleapis');
const { getAuthenticatedClient } = require('./auth');

async function getUnreadEmails(maxResults = 10) {
  const auth = await getAuthenticatedClient();
  const gmail = google.gmail({ version: 'v1', auth });
  const res = await gmail.users.messages.list({
    userId: 'me',
    q: 'is:unread',
    maxResults
  });
  const messages = res.data.messages || [];
  const details = await Promise.all(messages.slice(0, 10).map(async (m) => {
    const msg = await gmail.users.messages.get({ userId: 'me', id: m.id, format: 'metadata', metadataHeaders: ['From','Subject','Date'] });
    const headers = msg.data.payload.headers;
    const get = (name) => headers.find(h => h.name === name)?.value || '';
    return { id: m.id, from: get('From'), subject: get('Subject'), date: get('Date'), snippet: msg.data.snippet };
  }));
  return details;
}

async function sendEmail({ to, subject, body }) {
  const auth = await getAuthenticatedClient();
  const gmail = google.gmail({ version: 'v1', auth });
  const message = [`To: ${to}`, `Subject: ${subject}`, '', body].join('\n');
  const encoded = Buffer.from(message).toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  await gmail.users.messages.send({ userId: 'me', resource: { raw: encoded } });
}

module.exports = { getUnreadEmails, sendEmail };
