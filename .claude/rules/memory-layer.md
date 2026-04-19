# Memory Layer Rules — Dual-Storage Protocol

> Every significant interaction must persist to both layers.
> SQLite = facts (structured, queryable). LanceDB = semantics (fuzzy recall, context).
> One without the other is incomplete memory.

---

## 1. The Dual-Layer Model

```
Every significant interaction
         │
         ├──▶ SQLite (better-sqlite3)
         │    "What happened, exactly"
         │    Structured rows, SQL-queryable, permanent facts
         │
         └──▶ LanceDB (via OpenClaw memory plugin + Ollama)
              "What this was about, semantically"
              768-dim vectors, fuzzy search, contextual recall
```

**SQLite is the source of truth for facts.**
**LanceDB is the source of truth for meaning.**

---

## 2. When to Write to SQLite

Write to SQLite for any of these:
- User-stated fact ("I scored 1400 on my SAT practice test")
- Action taken ("logged expense: $12.50 food")
- Decision made (via `/decisions` route)
- Health data received (via `/shortcuts/health`)
- Conversation turn (auto-logged in `/chat` handler)
- Scheduled event or deadline
- Gametime user count update
- SAT/ML session completion

**Use `setMemory(key, value)`** for scalar facts:
```js
const { setMemory } = require('../db/init');
setMemory('gametime_beta_users', '7');
setMemory('sat_last_session', JSON.stringify({ date, score, weakAreas }));
```

**Use direct DB insert** for structured records:
```js
const { db } = require('../db/init');
db.prepare('INSERT INTO sat_sessions (date, attempted, score) VALUES (?,?,?)').run(date, attempted, score);
```

### Critical SQLite Rules
- Always use parameterized queries (`?` placeholders) — never string interpolation
- `strftime('%s','now')` for Unix timestamps — single quotes, not double quotes
- Use `INSERT OR REPLACE` for upserts on tables with UNIQUE constraints
- Use `ON CONFLICT(date) DO UPDATE SET ... = COALESCE(excluded.col, col)` for partial updates (e.g. health_data)

---

## 3. When to Write to LanceDB

LanceDB is managed by the OpenClaw `memory-lancedb` plugin with `autoCapture: true`.

**This means:** Every conversation turn through OpenClaw is automatically vectorized and stored.

**Manual LanceDB writes** are NOT needed for conversation memory — OpenClaw handles it.

However, you should **ensure important context flows through OpenClaw** (not just direct API calls):
- Long briefings → pass through chat if Rehan needs to recall them later
- Decisions → log via `/decisions` route AND mention in chat so OpenClaw captures it
- Research results → the `/research` route saves to `research_sessions` in SQLite; the conversation context should summarize key findings

**LanceDB read** happens via `POST /memory-recall/search` (Claude haiku finds relevant past conversations).

---

## 4. Context Injection Pipeline

The live context window fed to every OpenClaw conversation:

```
Every 5 minutes:
1. callRoute('/context/active')     → active app → memory.active_app_context
2. buildContextSnapshot()           → reads memory keys + last 5 conversations
3. Writes ~/.openclaw/workspace/CONTEXT.md
4. OpenClaw reads CONTEXT.md as part of system workspace on next conversation
```

**CONTEXT.md must always contain:**
- Current SGT date + time
- `ml_current_day`, `gametime_beta_users`, `sat_last_session` from memory
- Last 5 conversation turns (role + content snippet)
- Active app name (if refreshed in last 5 min)

**Never write stale data to CONTEXT.md.** If a route is down, omit that section rather than showing old data.

---

## 5. Memory Key Naming Convention

All `setMemory` keys follow snake_case with domain prefix:

| Prefix | Domain | Examples |
|--------|--------|---------|
| `sat_` | SAT tracking | `sat_last_session`, `sat_weak_areas` |
| `ml_` | ML learning | `ml_current_day`, `ml_last_topic` |
| `gametime_` | Startup | `gametime_beta_users`, `gametime_next_milestone` |
| `ios_health_` | Health | `ios_health_latest`, `ios_health_2026-04-07` |
| `managebac_` | School | `managebac_grades`, `managebac_assignments` |
| `cached_` | Cache | `cached_briefing`, `cached_news` |
| `active_` | Live context | `active_app_context`, `screen_context` |

**Never use freeform keys** — always check this list first. Add new prefixes here when introducing new domains.

---

## 6. Episodic Memory (conversations table)

Every `/chat` turn is auto-logged in `server.js`:
```js
db.prepare('INSERT INTO conversations (role, content) VALUES (?,?)').run('user', message);
db.prepare('INSERT INTO conversations (role, content) VALUES (?,?)').run('assistant', buffer.trim());
```

The `memory-recall` module provides:
- `GET /memory-recall/recent?limit=N` — last N turns
- `POST /memory-recall/search` — Claude haiku semantic search over last 100 turns
- `GET /memory-recall/stats` — total message counts

**CONTEXT.md refresh** reads the last 5 turns from this table automatically.

### Retention Policy
- No automatic deletion — all conversations persist
- Manual deletion: `POST /memory-recall/forget` with `{ before_date: "YYYY-MM-DD" }`
- Recommended: prune conversations older than 6 months once the table exceeds 10,000 rows

---

## 7. What NOT to Store

| Don't store | Reason |
|-------------|--------|
| Raw API responses as-is | Too large, query `setMemory` with processed values |
| Passwords or raw tokens | Use DB `google_accounts` table for OAuth; never in `memory` table |
| Temporary computation | Local variables only — if it doesn't need to survive a restart, don't store it |
| Duplicate keys | Always check `getMemory(key)` before deciding to overwrite |
| Large blobs >50KB | Use the `documents` table with `content_text` for large text |

---

## 8. Memory Health Checks

Run these queries to verify memory layer health:

```bash
# SQLite: check memory table
node -e "const {getAllMemory}=require('./src/db/init'); console.table(getAllMemory())"

# SQLite: check conversation count
node -e "const {db}=require('./src/db/init'); console.log(db.prepare('SELECT COUNT(*) as c FROM conversations').get())"

# Context injection: verify CONTEXT.md is fresh
head -5 ~/.openclaw/workspace/CONTEXT.md

# MCP: verify tools server responds
printf '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}\n' \
  | node src/mcp/jarvis-tools.js 2>/dev/null | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); console.log('tools:', d.result.tools.length)"
```
