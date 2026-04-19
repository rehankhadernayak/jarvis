# Autonomy Rules — Proactive Daemon Management

> Rules for managing the JARVIS proactive cron system, background jobs, and silent error handling.
> Applies to: `src/daemon/proactive.js`, `src/daemon/managebac-cron.js`, any future daemon files.

---

## 1. Cron Job Protocol

### Time Zone Rule
All cron jobs use **UTC** with explicit `{ timezone: 'UTC' }`. SGT offsets:
```
SGT 7:00 AM  = UTC 23:00 (previous day)  → '0 23 * * *'
SGT 8:00 PM  = UTC 12:00                 → '0 12 * * *'
SGT 11:00 PM = UTC 15:00                 → '0 15 * * *'
Every 5 min  = '*/5 * * * *'
Every 30 min = '*/30 * * * *'
```

**Never** use `{ timezone: 'Asia/Singapore' }` — use UTC offsets instead. The `timezone` option in node-cron changes when "midnight" is, not what UTC time fires.

### Dry-Run Test Before Scheduling
Before adding a new cron job to `startProactiveDaemon()`, test the function in isolation:
```js
// In a separate test script, not in the daemon:
const { morningRitual } = require('./src/daemon/proactive');
morningRitual().then(console.log).catch(console.error);
```
The function must return cleanly before it goes into the scheduler.

### Cron Job Structure (Mandatory)
Every cron job function must follow this exact pattern:
```js
async function jobName() {
  try {
    // 1. Gather data with callRoute() — handles retries internally
    // 2. Build context string
    // 3. Call askClaude() for AI synthesis (uses prompt cache)
    // 4. macNotify() — never speak/TTS
    // 5. console.log('[proactive] jobName: ...')
  } catch (e) {
    console.error('[proactive] jobName failed:', e.message);
    // Never re-throw. Never crash the daemon.
  }
}
```

---

## 2. Silent Error Handling

The proactive daemon **must never crash**. It runs 24/7. A single unhandled exception kills all cron jobs.

### Rules
1. Every async function in the daemon gets a top-level `try/catch`
2. `callRoute()` returns `null` on failure — always null-check the result before using it
3. Claude API failures are caught and logged — never propagate
4. Mac notification failures are swallowed (osascript is best-effort)
5. No `process.exit()` calls anywhere in daemon files

### callRoute Pattern
```js
// CORRECT — null-safe
const score = await callRoute('/life-score/current');
const scoreText = score?.score ? `${score.score}/${score.max}` : 'unavailable';

// WRONG — will throw if route is down
const { score, max } = await callRoute('/life-score/current');
```

### Notification Failures
```js
// macNotify is already wrapped in try/catch internally.
// If osascript is not available (e.g., no screen session), it silently fails.
// This is correct behavior — never add error handling around macNotify calls.
macNotify('JARVIS', message); // fine as-is
```

---

## 3. Adding New Cron Jobs

Steps to add a new scheduled job:

1. **Write the function** with the mandatory pattern above
2. **Dry-run test** it standalone (see §1)
3. **Add to `startProactiveDaemon()`** with correct UTC time
4. **Update the daemon log message** at the bottom of `startProactiveDaemon()`
5. **Restart server** and verify the log shows the new job registered
6. **Update JARVIS-SPEC.md** daemon table with the new schedule

### Current Schedule (do not duplicate these times)
| UTC Cron | SGT | Job |
|----------|-----|-----|
| `0 23 * * *` | 7:00 AM | morningRitual |
| `0 12 * * *` | 8:00 PM | eveningCheck |
| `0 15 * * *` | 11:00 PM | windDown |
| `*/5 * * * *` | Every 5 min | contextRefresh |
| `*/30 * * * *` | Every 30 min | eventPreBriefing + healthCheck |

---

## 4. healthCheck Rules

The `healthCheck()` function monitors three services: JARVIS v2 (3001), OpenClaw (18789), Ollama (11434).

**Auto-restart behavior:**
- Port 3001 down → `launchctl kickstart -k gui/$(id -u)/ai.jarvis.v2server`
- Port 11434 down → `launchctl kickstart -k gui/$(id -u)/ai.jarvis.ollama`
- Port 18789 down → notify only (OpenClaw has its own restart logic)

**Never** use `execSync` for restart commands — use `execSync` wrapped in try/catch:
```js
try { execSync('launchctl kickstart -k gui/$(id -u)/ai.jarvis.v2server 2>/dev/null || true'); } catch {}
```

---

## 5. Prompt Caching in Daemon

All `askClaude()` calls in the daemon use the cached system prompt:
```js
system: [{ type: 'text', text: JARVIS_SYSTEM, cache_control: { type: 'ephemeral' } }]
```

**Rule:** Never add a `system` field to individual job prompts — it bypasses the cache.
Pass context as the user message only. The system prompt is already set at the module level.

**`JARVIS_SYSTEM` must not exceed 1024 tokens** — ephemeral caching limit.
Current length: ~150 tokens. Headroom: ample.

---

## 6. ManageBac Cron Rules

`src/daemon/managebac-cron.js` is separate from the main proactive daemon intentionally.

- Fires at 7am + 6pm SGT only
- **No-ops silently** if `managebac_cookies` is not in DB (user hasn't logged in yet)
- Playwright launches a fresh Chromium instance each sync — this is intentional (no stale state)
- Sync takes up to 60 seconds — do not add a timeout shorter than 65s
- If sync fails, log it; do not notify Rehan unless it fails 3+ consecutive times
