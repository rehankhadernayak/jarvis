# 09 — Telegram Bot + Mobile (MEDIUM — needs phone)

## What it enables
Full JARVIS control from phone. No need to be at Mac.
Text, voice messages, photos — all processed by JARVIS.

## Capabilities
- Text JARVIS → get response
- Send voice message → transcribed + answered
- Send photo → vision analysis
- "JARVIS, what's my schedule?" → returns formatted calendar
- "JARVIS, remind me about X at 3pm" → creates calendar event
- Push alerts: Gametime updates, SAT reminders, deadlines

## Setup (when phone available)
1. @BotFather → create @rehan_jarvis_bot → get token
2. Store TELEGRAM_BOT_TOKEN in .env
3. npm install telegraf
4. src/integrations/telegram.js — webhook or polling mode
5. Same tool access as web UI

## Message types to handle
- Text → OpenClaw agent → text reply
- Voice → Whisper STT → OpenClaw → Kokoro TTS → voice reply
- Photo → Claude vision → text analysis
- Document/PDF → document intelligence

## Commands
/status — life score + gametime + SAT
/brief — morning briefing
/calendar — today's events
/sat — start a drill
/gametime — advisor
/research [query] — web research
