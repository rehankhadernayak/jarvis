const express = require('express');
const router = express.Router();
const { getOAuth2Client } = require('../google/auth');
const { db } = require('../db/init');

const SCOPES = [
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/userinfo.email',
];

// GET /auth/google — redirect to Google OAuth consent screen
router.get('/google', (req, res) => {
  const client = getOAuth2Client();
  const url = client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',         // force refresh_token to be returned
    scope: SCOPES,
  });
  res.redirect(url);
});

// GET /auth/google/callback — handle OAuth code, store tokens
router.get('/google/callback', async (req, res) => {
  const { code, error } = req.query;
  if (error) return res.status(400).send(`OAuth error: ${error}`);
  if (!code) return res.status(400).send('No code received');

  try {
    const client = getOAuth2Client();
    const { tokens } = await client.getToken(code);

    if (!tokens.refresh_token) {
      return res.status(400).send('No refresh_token received. Try visiting /auth/google again.');
    }

    // Get user email
    client.setCredentials(tokens);
    const { google } = require('googleapis');
    const oauth2 = google.oauth2({ version: 'v2', auth: client });
    const userInfo = await oauth2.userinfo.get();
    const email = userInfo.data.email;

    // Upsert into google_accounts
    const existing = db.prepare('SELECT id FROM google_accounts WHERE email=?').get(email);
    if (existing) {
      db.prepare('UPDATE google_accounts SET refresh_token=?, access_token=?, token_expiry=? WHERE email=?')
        .run(tokens.refresh_token, tokens.access_token, tokens.expiry_date, email);
    } else {
      db.prepare('INSERT INTO google_accounts (email, refresh_token, access_token, token_expiry, label) VALUES (?,?,?,?,?)')
        .run(email, tokens.refresh_token, tokens.access_token, tokens.expiry_date, 'personal');
    }

    res.send(`
      <html><body style="font-family:monospace;background:#050a14;color:#10b981;padding:40px">
        <h2>✅ Google Auth Success</h2>
        <p>Account: ${email}</p>
        <p>Refresh token stored. Calendar and Gmail are now active.</p>
        <p><a href="/" style="color:#0ea5e9">← Return to JARVIS</a></p>
      </body></html>
    `);
  } catch (e) {
    res.status(500).send(`Auth failed: ${e.message}`);
  }
});

// GET /auth/status — show current auth state
router.get('/status', (req, res) => {
  const accounts = db.prepare('SELECT email, label, token_expiry FROM google_accounts').all();
  res.json({
    accounts,
    reauth_url: 'http://localhost:3001/auth/google',
    note: accounts.length === 0 ? 'No accounts. Visit /auth/google to authorize.' : 'Visit /auth/google to re-authorize if getting invalid_grant errors.'
  });
});

module.exports = router;
