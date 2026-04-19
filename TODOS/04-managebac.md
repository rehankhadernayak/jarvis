# 04 — ManageBac Scraper (HIGH)

## What it does
- Logs into ManageBac automatically
- Scrapes: current grades per subject, upcoming assignments + due dates, recent feedback
- Stores in DB: `grades` table, syncs assignments to Google Calendar
- Alerts: new grade posted, assignment due < 48h, subject falling below target

## Implementation
Puppeteer-based, port from JARVIS v1.
Credentials stored in .env: MANAGEBAC_EMAIL, MANAGEBAC_PASSWORD.

Routes:
- GET /managebac/grades — current grade summary
- GET /managebac/assignments — upcoming assignments
- POST /managebac/sync — force re-scrape

Cron: scrape every 6h automatically.

## Priority subjects
- Science (1B) — needs improvement
- Mandarin (1A) — needs improvement
- Math Extended (4A) — strong, low priority

## Alert thresholds
- Grade drops: alert immediately
- Grade improves: celebrate (JARVIS says "Science moved to B+")
- Assignment < 48h: urgent notification
- Assignment < 6h: CRITICAL notification + speak
