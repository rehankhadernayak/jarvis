# JARVIS v2 — Active Tasks

Last updated: 2026-04-08

---

## Skill Extensions (Next Capabilities to Build)

| # | Feature | Effort | Blocked By | Notes |
|---|---------|--------|------------|-------|
| E1 | GitHub token → add to `.env` to unlock commit history | 5 min | Nothing | Just add `GITHUB_TOKEN=ghp_...` |
| E2 | ManageBac first login → activate school sync | 10 min | Rehan's credentials | `POST /managebac/login {email, password}` |
| E3 | iOS Shortcut → activate health data pipeline | 30 min | iPhone setup | See comment at top of `src/routes/shortcuts.js` |
| E4 | Telegram bot → mobile control | TBD | Phone number | Add `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` to `.env` |
| E5 | Emotional intelligence → add to proactive evening check | 2 hrs | Nothing | **done** — already wired in `eveningCheck()` |
| E6 | Decisions → review outcomes of past decisions weekly | 2 hrs | Nothing | **done** — Sunday 10am SGT cron in proactive.js |
| E7 | Finance → monthly budget limit alerts | 1 hr | Nothing | **done** — daily 9pm SGT budget check, set limits via `finance_budget_{category}` memory keys |
| E8 | Research → save to docs for future Q&A | 1 hr | Nothing | **done** — auto-saves to documents table on every research search |

---

## Integration Health Checks

Run these weekly to verify all integrations are alive:

### Google (Calendar + Gmail)
```bash
curl -s http://localhost:3001/auth/status
curl -s http://localhost:3001/calendar/today | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); console.log('events:', Array.isArray(d) ? d.length : d.events?.length)"
curl -s http://localhost:3001/gmail/unread | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); console.log('unread:', Array.isArray(d) ? d.length : d.error)"
```
**If broken:** Visit `http://localhost:3001/auth/google` to re-authorize.

### Anthropic API
```bash
curl -s -X POST http://localhost:3001/sat/drill?count=1 | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); console.log('claude:', d.questions ? 'ok' : d.error)"
```
**If broken:** Check `ANTHROPIC_API_KEY` in `.env`. Key may have expired or hit rate limit.

### OpenClaw Gateway
```bash
curl -s http://localhost:18789/ && echo "openclaw ok"
launchctl print "gui/$(id -u)/ai.openclaw.gateway" | grep state
```
**If broken:** `launchctl kickstart -k "gui/$(id -u)/ai.openclaw.gateway"`

### Ollama (LanceDB vectors)
```bash
curl -s http://localhost:11434/api/tags | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); console.log('models:', d.models?.map(m=>m.name).join(', '))"
```
**If broken:** `launchctl kickstart -k "gui/$(id -u)/ai.jarvis.ollama"`

### MCP Tool Server
```bash
printf '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}\n' \
  | node src/mcp/jarvis-tools.js 2>/dev/null \
  | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); console.log('mcp tools:', d.result.tools.length)"
```
**Expected:** 31 tools

### Full System (all 24 routes)
```bash
curl -s http://localhost:3001/status/full | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); console.log('routes:', d.routes.length, '| uptime:', d.uptime_s+'s', '| memory:', d.memory_mb+'MB')"
```

---

## Pending Setup Actions (Rehan to complete)

- [ ] Add `GITHUB_TOKEN` to `.env` — prevents GitHub rate limiting
- [ ] Run `POST /managebac/login` with school credentials — activates grade sync
- [ ] Set up iPhone Shortcut for health data (see `src/routes/shortcuts.js` comment)
- [ ] Obtain phone number for Telegram bot

---

## Known Limitations

| Limitation | Impact | Workaround |
|------------|--------|------------|
| GitHub API rate limit (60 req/hr without token) | `/github/activity` fails on public repos | Add `GITHUB_TOKEN` to `.env` |
| ManageBac selectors may need tuning | Grades/assignments may be empty after first sync | Check console logs, adjust `SELECTORS` in `src/scrapers/managebac.js` |
| Meeting transcription requires audio file upload | No live recording | Record meeting externally, then `POST /transcribe/upload` |
| Context refresh only every 5 min | Active app can be stale | `GET /context/active` on demand |
