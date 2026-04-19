# JARVIS v2 — Project Specification (Ground Truth)

> This document is the canonical reference for all architectural decisions, principles, and constraints.
> When in doubt, this file wins. Do not contradict it without updating it first.

---

## 1. Identity

**JARVIS v2** is a personal AI operating system for Rehan Khadernayak, 17, Singapore.
- Brain: `claude-sonnet-4-6` via Anthropic API
- Gateway: OpenClaw 2026.4.2 (port 18789, LaunchAgent `ai.openclaw.gateway`)
- Server: Express 5 (port 3001, LaunchAgent `ai.jarvis.v2server`)
- Platform: Apple Silicon Mac, macOS 15, Singapore timezone (SGT, UTC+8)
- Persona: Dry, direct, British-toned. Addresses Rehan as "Sir" when appropriate. No fluff.

---

## 2. Architecture

```
┌─────────────────────────────────────────────────────────┐
│                      JARVIS v2                          │
│                                                         │
│  ┌──────────┐    ┌──────────────┐    ┌───────────────┐ │
│  │  Web UI  │───▶│ Express 5    │───▶│  OpenClaw     │ │
│  │ :3001    │    │ 24 routes    │    │  Gateway      │ │
│  └──────────┘    └──────┬───────┘    │  :18789       │ │
│                         │            └──────┬────────┘ │
│  ┌──────────────────────┼─────────────────┐ │          │
│  │        Data Layer    │                 │ │          │
│  │  ┌─────────────┐  ┌──▼──────────┐      │ │          │
│  │  │  LanceDB    │  │  SQLite     │      │ │          │
│  │  │  (vectors)  │  │  (facts)    │      │ │          │
│  │  │  via Ollama │  │  12 tables  │      │ │          │
│  │  └─────────────┘  └─────────────┘      │ │          │
│  └─────────────────────────────────────────┘ │          │
│                                               │          │
│  ┌────────────────────────────────────────────▼────────┐ │
│  │  Claude claude-sonnet-4-6 (Brain)                   │ │
│  │  + MCP Tool Server (31 tools) + Prompt Caching      │ │
│  └─────────────────────────────────────────────────────┘ │
│                                                         │
│  ┌─────────────────────────────────────────────────────┐ │
│  │  Proactive Daemon (node-cron)                       │ │
│  │  7am brief · 8pm check · 11pm wind-down             │ │
│  │  30min health/events · 5min context refresh         │ │
│  └─────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

### Key Services
| Service | Port | LaunchAgent | Purpose |
|---------|------|-------------|---------|
| JARVIS v2 Server | 3001 | `ai.jarvis.v2server` | All routes + UI |
| OpenClaw Gateway | 18789 | `ai.openclaw.gateway` | Claude agent sessions |
| Ollama | 11434 | `ai.jarvis.ollama` | nomic-embed-text for LanceDB |
| OAuth Shim | 3000 | (inline) | Google redirect forward |

---

## 3. Route Inventory (24 active)

### Core
- `/auth` — Google OAuth2 (calendar + gmail)
- `/calendar` — Google Calendar CRUD + time blocks
- `/gmail` — Unread, triage, send, draft, reply-draft
- `/memory` — Key-value memory store
- `/memory-recall` — Episodic conversation log + semantic search
- `/life-score` — Weekly life score calculation

### Domain
- `/sat` — SAT session tracking, drills, history
- `/gametime` — Startup sprint tracking (20-family goal)
- `/briefing` — Morning briefing generation
- `/news` — RSS headlines (BBC + HN)
- `/shortcuts` — iOS health data webhook

### Features
- `/essay` — Essay analysis, improvement, prompts
- `/travel` — Trip planning, packing lists, destination ideas
- `/decisions` — Decision logger + AI analysis
- `/finance` — Expense tracking + insights
- `/github` — Commit activity + summaries
- `/docs` — PDF/TXT upload, Q&A against documents
- `/research` — DuckDuckGo + Wikipedia + Claude synthesis
- `/transcribe` — Audio → faster-whisper → Claude summary
- `/vision` — Screen capture + Claude Vision analysis
- `/context` — Active app + window + browser URL
- `/managebac` — School portal scraper (Playwright)
- `/habits` — Habit tracker with streaks and daily check-ins
- `/reading-list` — Books/articles/courses reading list
- `/uni` — University application deadlines and countdown
- `/crm` — Gametime family CRM (pipeline, follow-ups, logs)
- `/meals` — Meal and nutrition logging

### Infrastructure
- `/status` — Health check
- `/status/full` — Routes + circuit breakers + uptime

---

## 4. Data Layer

### SQLite (`~/.jarvis-v2/jarvis.db`) — Structured Facts
| Table | Purpose |
|-------|---------|
| `memory` | Key-value store (all persistent state) |
| `google_accounts` | OAuth tokens |
| `conversations` | Episodic chat history |
| `sat_sessions` | SAT practice logs |
| `ml_sessions` | ML learning logs |
| `tasks` | Task list |
| `health_data` | iOS health metrics (17 fields) |
| `expenses` | Finance tracking |
| `time_blocks` | Calendar blocks |
| `decisions` | Decision log |
| `documents` | Uploaded doc metadata + text |
| `github_events` | Commit history |
| `research_sessions` | Research query history |
| `transcriptions` | Audio transcription history |
| `mood_logs` | Emotional state log |
| `repair_logs` | Self-repair attempt history |

### LanceDB (`~/.openclaw/memory/lancedb`) — Semantic Vectors
- Embedding model: `nomic-embed-text` via Ollama (port 11434)
- Dimensions: 768
- Auto-capture + auto-recall enabled in OpenClaw
- Used for: semantic memory search, conversation recall

---

## 5. MCP Tool Server

- Location: `src/mcp/jarvis-tools.js`
- Protocol: JSON-RPC 2.0 over stdio (MCP spec 2024-11-05)
- Registered in OpenClaw as `jarvis-tools`
- 31 tools covering all major routes
- Claude calls JARVIS routes as native tool_use blocks during conversation

---

## 6. Proactive Daemon

Location: `src/daemon/proactive.js`

| Job | Schedule (UTC) | SGT |
|-----|----------------|-----|
| Daily standup | `0 0 * * *` | 8:00 AM |
| Morning ritual | `0 23 * * *` | 7:00 AM |
| Evening check | `0 12 * * *` | 8:00 PM |
| Budget check | `0 13 * * *` | 9:00 PM |
| Wind-down | `0 15 * * *` | 11:00 PM |
| Context refresh | `*/5 * * * *` | Every 5 min |
| Event pre-brief + health | `*/30 * * * *` | Every 30 min |
| Decision review | `0 2 * * 0` | Sunday 10:00 AM |
| Weekly report | `0 3 * * 0` | Sunday 11:00 AM |
| Memory consolidation | `0 16 * * *` | Midnight |
| Self-repair | `0 * * * *` | Every hour |

ManageBac sync: `src/daemon/managebac-cron.js` — 7am + 6pm SGT

All notifications via `osascript` (Mac banners with Glass sound).
Prompt caching: system prompt pre-warmed via `cache_control: ephemeral`.
Retry logic: `callRoute()` retries up to 2x with exponential backoff.

---

## 7. Core Principles

1. **Real data, never fake it** — Every response uses live API data. Never hallucinate state.
2. **No voice** — Voice was removed. JARVIS is text-only (chat + Mac notifications).
3. **LaunchAgent stability is sacred** — Never kill daemons carelessly. Restart via `launchctl kickstart -k`.
4. **Dual-layer memory** — Facts to SQLite, semantics to LanceDB. Both always.
5. **Circuit breakers** — All external calls wrapped in `withRetry`. Fail fast, notify, recover.
6. **Silent errors in proactive daemon** — Daemon jobs never throw. Errors are logged, not fatal.
7. **Prompt caching** — System prompt cached with `ephemeral` on every Haiku call in the daemon.
8. **Context injection** — `~/.openclaw/workspace/CONTEXT.md` refreshes every 5 minutes with live state.

---

## 8. Technology Stack

```
Runtime:       Node.js 24.13.1 (nvm)
Framework:     Express 5
AI:            @anthropic-ai/sdk (claude-sonnet-4-6, claude-haiku-4-5-20251001)
Agent:         OpenClaw 2026.4.2
DB:            better-sqlite3 (sync), LanceDB (async via Ollama)
Cron:          node-cron 4
HTTP:          native fetch() (Node 24)
OAuth:         googleapis 171
Scraping:      playwright (Chromium headless)
PDF:           pdf-parse
Audio:         faster-whisper (Python, ~/.jarvis-voice)
Upload:        multer (memory storage)
Notifications: osascript (macOS)
Circuit:       src/utils/circuit-breaker.js (custom)
```

---

## 9. Domain Context

### Rehan's Goals (inform all AI responses)
- **SAT**: Target 1550+. Track sessions. Flag if >7 days since last practice.
- **Gametime**: Sports scheduling startup. Sprint goal: 20 beta families by May 2026. Currently 3/20.
- **ML**: Daily learning. Currently Day 1. Track progress.
- **School**: Overseas Family School, Singapore. IB curriculum. ManageBac for grades.
- **University targets**: Top US/UK universities.

### Tone
- British. Direct. No filler words.
- Accountability over comfort — if Rehan is behind, say so clearly.
- Lead with what matters most. Numbers before prose.

---

## 10. End State

JARVIS is not a chatbot. It is an operating system layer that:
- **Knows** Rehan's state at all times (context injection, screen awareness, health data)
- **Acts** without being asked (proactive daemon, ManageBac sync, evening accountability)
- **Calls** its own APIs mid-conversation as structured tools (MCP)
- **Remembers** everything (SQLite facts + LanceDB vectors + episodic log)
- **Improves** from failures (circuit breakers, self-repair, repair_logs)

The gap between "script" and "AI" is: tools + context + proactivity. All three are now live.
