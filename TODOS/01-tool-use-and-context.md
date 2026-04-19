# 01 — Tool Use + Context Injection (CRITICAL)

## The problem

Right now Claude gets a message and returns text. That's it.
It cannot check your calendar. It cannot search the web. It cannot send an email.
It doesn't know your life score, your next meeting, or what you're working on.

## The fix

### Part A: Tool Use
Register v2 API routes as OpenClaw tools. Claude then decides mid-conversation
to call them — exactly like how Claude uses tools in Claude.ai.

Tools to register:
- `get_calendar_today` → GET /calendar/today
- `get_upcoming_events` → GET /calendar/upcoming
- `create_calendar_event` → POST /calendar/create
- `block_time` → POST /calendar/block
- `get_gmail_unread` → GET /gmail/unread
- `triage_email` → GET /gmail/triage
- `get_life_score` → GET /life-score/current
- `get_memory` → GET /memory/:key
- `set_memory` → POST /memory/:key
- `search_web` → already in OpenClaw (DuckDuckGo plugin)
- `get_gametime_status` → GET /gametime/status
- `get_sat_status` → GET /sat/status
- `analyze_screen` → POST /vision/analyze
- `get_news` → GET /news/latest
- `run_sat_drill` → GET /sat/drill

### Part B: Context Injection
Every conversation automatically prepends real-time context to the system prompt:

```
[Current time: SGT 09:14 | Monday Apr 7 2026]
[Life Score: 24/82 | Grade D]
[Next event: Math class @ 10:00]
[Unread emails: 3 (1 urgent)]
[Gametime: 3/20 families | 33d left | CRITICAL pace]
[SAT: 17 days since last session — STALE]
[ML: Day 1 current]
[Active app: VSCode]
[Last context: working on Gametime booking flow]
```

Claude sees this on every message. JARVIS is now situationally aware.

## Implementation

1. Create `~/.openclaw/workspace/TOOLS.md` — documents available tools for OpenClaw
2. Create a context-injection hook that fires before each conversation turn
3. Register routes as OpenClaw tools via `openclaw.json` tools config
4. Test: ask "what's on my calendar today?" — JARVIS should call the tool and answer

## Expected result

User: "JARVIS, do I have time for a SAT drill before my next class?"
JARVIS: [calls get_calendar_today, get_sat_status, does the math]
JARVIS: "Yes — Math is at 10:00, it's 08:47 now. You have 73 minutes.
         Your last SAT session was 17 days ago. Do it. I'll start you with 5 questions."
