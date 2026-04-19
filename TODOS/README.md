# JARVIS v2 — Feature Roadmap

The brain is Claude claude-sonnet-4-6. The gap between "routes" and "real AI" is three things:
tools (JARVIS can act), context (JARVIS knows your state), proactivity (JARVIS initiates).

## Status

| # | Feature | Priority | Status |
|---|---------|----------|--------|
| 1 | Tool use — OpenClaw tools calling v2 routes | CRITICAL | **done** |
| 2 | Context injection — real-time state in every conversation | CRITICAL | **done** |
| 3 | Proactive cron loops — JARVIS initiates | CRITICAL | **done** |
| 4 | Self-healing daemon — log watcher + auto-restart | HIGH | **done** |
| 5 | Claude Code self-repair — JARVIS fixes its own bugs | HIGH | **done** |
| 6 | ManageBac scraper — grades/deadlines auto-synced | HIGH | **done** |
| 7 | Mac native notifications — osascript banners | HIGH | **done** |
| 8 | Active app + screen context — knows what you're doing | HIGH | **done** |
| 9 | Mission Control UI — Three.js holographic dashboard | MEDIUM | **done** |
| 10 | Episodic memory — full conversation recall | MEDIUM | **done** |
| 11 | Decision logger — tracks choices + outcomes | MEDIUM | **done** |
| 12 | Web research agent — deep dives on demand | MEDIUM | **done** |
| 13 | GitHub integration — Gametime commit summaries | MEDIUM | **done** |
| 14 | Telegram bot — full mobile control | MEDIUM | **done** |
| 15 | Email autopilot — auto-draft replies | MEDIUM | **done** |
| 16 | iOS health deep integration | MEDIUM | **done** |
| 17 | Good morning / good night rituals | MEDIUM | **done** |
| 18 | Emotional intelligence — stress detection | LOW | **done** |
| 19 | Voice personality — Kokoro voice clone | LOW | dropped (voice removed) |
| 20 | Document intelligence — PDF ingestion | LOW | **done** |
| 21 | Meeting transcription | LOW | **done** |
| 22 | Essay coach | LOW | **done** |
| 23 | Personal finance tracker | LOW | **done** |
| 24 | Investor CRM (Gametime pre-seed) | LOW | removed |
| 25 | Travel planning agent | LOW | **done** |
| 26 | Streaming pipeline — Claude stream + TTS stream in parallel | HIGH | dropped (voice removed) |
| 27 | TTS first-chunk streaming — hear first syllable in ~800ms | HIGH | dropped (voice removed) |
| 28 | Voice STT → haiku → TTS full pipeline under 3s | HIGH | dropped (voice removed) |
| 29 | Watchdog with retry logic + circuit breakers on all external APIs | HIGH | **done** |
| 30 | Prompt caching — pre-warm system prompt, reduce token cost | MEDIUM | **done** |

## Priority explanation

**CRITICAL (do now):** These are the difference between "script" and "AI".
- Without tools, JARVIS can't act.
- Without context, JARVIS can't be situationally aware.
- Without proactivity, JARVIS is just a chatbot.

**HIGH:** These make JARVIS autonomous and reliable.

**MEDIUM:** These make JARVIS genuinely useful vs just cool.

**LOW:** Polish, personality, stretch goals.

See individual files in this folder for specs on each.

## Phase 3 — Genuinely Hard Features

| # | Feature | Status |
|---|---------|--------|
| 31 | Vision screen agent — Claude sees + controls Mac via screenshot loop | **done** |
| 32 | Nightly memory consolidation — extracts facts from conversations at midnight SGT | **done** |
| 33 | Local LLM fallback — Ollama/Gemma3 for simple tasks, auto-routes local vs API | **done** |
| 34 | Predictive briefings — mines hourly patterns, prefetches data before you ask | **done** |
| 35 | Browser extension — Chrome sidebar with SSE chat, page summarize, research shortcut | **done** |
| 36 | Telegram bot v2 — direct Anthropic streaming, no OpenClaw, auto tool exec, background tasks | **done** |
| 37 | Weekly decision review cron — surfaces unresolved decisions Sunday 10am | **done** |
| 38 | Finance budget alerts — daily 9pm check against budget limits | **done** |
| 39 | Research auto-save to docs — every research result queryable via /docs | **done** |
| 40 | Habit tracker — /habits route + bot command + streaks | **done** |
| 41 | Reading list — /reading-list route + bot /read command | **done** |
| 42 | University deadline tracker — /uni route + countdown + bot /uni command | **done** |
| 43 | Gametime CRM — /crm route + pipeline view + bot /crm command | **done** |
| 44 | Meal/nutrition logging — /meals route + bot /meals command | **done** |
| 45 | Pomodoro timer — /pomo bot command with 25min timer + notifications | **done** |
| 46 | Smart model routing — Haiku for simple queries, Sonnet for complex (bot) | **done** |
| 47 | Daily standup cron — 8am SGT, data from all systems | **done** |
| 48 | Weekly accountability report cron — Sunday 11am SGT | **done** |
| 49 | Bot command expansion — /standup /week /habits /uni /crm /read /meals | **done** |
