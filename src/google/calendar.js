const { google } = require('googleapis');
const { getAuthenticatedClient } = require('./auth');
const { db } = require('../db/init');

async function getTodayEvents() {
  const auth = await getAuthenticatedClient();
  const cal = google.calendar({ version: 'v3', auth });
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfDay = new Date(startOfDay.getTime() + 86400000);
  const res = await cal.events.list({
    calendarId: 'primary',
    timeMin: startOfDay.toISOString(),
    timeMax: endOfDay.toISOString(),
    singleEvents: true,
    orderBy: 'startTime',
    maxResults: 20
  });
  return res.data.items || [];
}

async function getUpcomingEvents(days = 7) {
  const auth = await getAuthenticatedClient();
  const cal = google.calendar({ version: 'v3', auth });
  const now = new Date();
  const future = new Date(now.getTime() + days * 86400000);
  const res = await cal.events.list({
    calendarId: 'primary',
    timeMin: now.toISOString(),
    timeMax: future.toISOString(),
    singleEvents: true,
    orderBy: 'startTime',
    maxResults: 30
  });
  return res.data.items || [];
}

async function createEvent({ title, start, end, description = '', allDay = false }) {
  const auth = await getAuthenticatedClient();
  const cal = google.calendar({ version: 'v3', auth });
  const event = {
    summary: title,
    description,
    start: allDay ? { date: start } : { dateTime: start, timeZone: 'Asia/Singapore' },
    end: allDay ? { date: end } : { dateTime: end, timeZone: 'Asia/Singapore' }
  };
  const res = await cal.events.insert({ calendarId: 'primary', resource: event });
  return res.data;
}

async function blockTime({ title, startDate, endDate, blockType = 'focus', description = '' }) {
  // Creates a calendar block event
  const allDay = !startDate.includes('T');
  const event = await createEvent({ title: `🚫 ${title}`, start: startDate, end: endDate, description, allDay });
  // Store in DB
  db.prepare('INSERT INTO time_blocks (title, start_time, end_time, block_type, calendar_event_id) VALUES (?,?,?,?,?)')
    .run(title, startDate, endDate, blockType, event.id);
  return event;
}

module.exports = { getTodayEvents, getUpcomingEvents, createEvent, blockTime };
