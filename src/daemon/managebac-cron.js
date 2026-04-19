/**
 * ManageBac Auto-Sync Cron
 * Runs at 7AM and 6PM SGT to keep grades and assignments up to date.
 * Only syncs if login cookies are already saved (i.e. user has authenticated).
 */

'use strict';

const cron = require('node-cron');

async function syncIfConfigured() {
  const { getMemory } = require('../db/init');
  const cookies = getMemory('managebac_cookies');
  if (!cookies) {
    console.log('[managebac] Auto-sync skipped — no saved session (call POST /managebac/login first)');
    return;
  }
  try {
    const scraper = require('../scrapers/managebac');
    await scraper.getDashboard();
    console.log('[managebac] Auto-sync complete');
  } catch (e) {
    console.error('[managebac] Auto-sync failed:', e.message);
  }
}

function startManageBacSync() {
  // 7:00 AM SGT  = 23:00 UTC (previous calendar day)
  cron.schedule('0 23 * * *', syncIfConfigured, { timezone: 'UTC' });

  // 6:00 PM SGT  = 10:00 UTC
  cron.schedule('0 10 * * *', syncIfConfigured, { timezone: 'UTC' });

  console.log('[managebac] Sync cron registered (7am + 6pm SGT)');
}

module.exports = { startManageBacSync };
