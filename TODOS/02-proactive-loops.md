# 02 — Proactive Cron Loops (CRITICAL)

## The problem

JARVIS only speaks when spoken to. Real JARVIS from MCU doesn't wait.
He tells Tony things Tony needs to know before Tony asks.

## The fix

A set of background cron jobs that:
1. Gather context
2. Decide if action/alert is warranted
3. Speak via TTS and/or send Mac notification
4. Message via Telegram when available

## Loops to implement

### 7:00 AM SGT — Good Morning
- Pull: weather (wttr.in API), calendar today, life score, pending tasks, Gametime status, SAT staleness
- Generate briefing via Claude
- Speak via Kokoro TTS
- Mac notification with summary

### 8:00 PM SGT — Evening Check
- SAT: if no session today, firm nudge
- ML: if no session today, firm nudge
- Gametime: if behind pace, specific action item
- Tomorrow: any events before 9am? Alert now.

### 11:00 PM SGT — Wind Down
- "It's 11. Time to wind down."
- Preview tomorrow
- Sleep score prediction

### Every 30min — Event Pre-Briefer
- Check next calendar event
- If < 30min away and not yet alerted: announce + brief
- "In 28 minutes: Math Extended. Chapter 7 test today based on last ManageBac check."

### Every 6h — ManageBac Scan
- Scrape grades + assignments
- Alert on new grade posted
- Alert on assignment due < 48h

### Every 30min — Health Check
- Hit all server routes, confirm 200
- If any fail: attempt auto-restart, then alert
- Log to health_log table

### Every 24h — Gametime Advisor
- Calculate current pace
- If critical: voice alert with 3 specific actions
- Log to memory

### Every Sunday 6 PM — Weekly Review
- What did you do this week (SAT sessions, ML days, tasks completed)
- What's ahead next week
- Gametime sprint progress
- Speak + send full text to Telegram

## Implementation

Use node-cron in a separate `src/daemon/cron.js` file.
Mount it in server.js: `require('./src/daemon/cron')`.
Each job is a function that: gathers data → calls Claude → speaks + notifies.

The cron daemon is the heartbeat. This is what makes JARVIS feel alive.
