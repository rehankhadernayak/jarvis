require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const { google } = require('googleapis');
const { db } = require('../db/init');

function getOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

async function getAuthenticatedClient(label = 'personal') {
  const account = db.prepare('SELECT * FROM google_accounts WHERE label=? LIMIT 1').get(label);
  if (!account) throw new Error('No Google account found for label: ' + label);
  const client = getOAuth2Client();
  client.setCredentials({ refresh_token: account.refresh_token });
  // Refresh access token
  const { credentials } = await client.refreshAccessToken();
  client.setCredentials(credentials);
  // Update stored token
  db.prepare('UPDATE google_accounts SET access_token=?, token_expiry=? WHERE label=?')
    .run(credentials.access_token, credentials.expiry_date, label);
  return client;
}

module.exports = { getOAuth2Client, getAuthenticatedClient };
