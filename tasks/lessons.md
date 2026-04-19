# JARVIS v2 — Lessons Learned

> Bugs found, fixed, and the rule that prevents them recurring.
> Every entry here represents real pain. Don't repeat it.

---

## Architecture

### L001 — strftime double-quote trap (SQLite)
**Date:** 2026-04-07
**Bug:** `setMemory()` threw `no such column: "%s"` — SQLite treated `"%s"` as a column identifier.
**Root cause:** `strftime("%s","now")` uses double quotes for the format string. SQLite ANSI mode treats double-quoted strings as identifiers, not literals.
**Fix:** Changed to `strftime('%s','now')` (single quotes).
**Rule:** Always use single quotes for SQLite string literals. Double quotes = identifiers.

### L002 — Multiple JARVIS processes serving stale code
**Date:** 2026-04-07
**Bug:** Route changes weren't taking effect even after LaunchAgent reload.
**Root cause:** Old `server.js` processes kept running. LaunchAgent spawns a new one without killing the old one if the PID file isn't managed correctly.
**Fix:** Before reload: `pkill -9 -f "jarvis-v2/server.js" && lsof -ti :3001 | xargs kill -9`
**Rule:** Always kill old processes before restart. Verify with `lsof -ti :3001`.

### L003 — TTS mlx_audio output path wrong
**Date:** 2026-04-06
**Bug:** TTS route returned 500 "No audio file generated" despite mlx_audio succeeding.
**Root cause:** `mlx_audio` saves to `{--output_path}/audio/audio_000.wav` (adds a subdirectory), not `{--output_path}/audio_000.wav` as expected.
**Fix:** Changed outPath to `path.join(outDir, 'audio', 'audio_000.wav')` + added recursive WAV scan fallback.
**Rule:** For mlx_audio CLI: output is always in a subdirectory named after the base. Always scan recursively.

---

## Google OAuth

### L004 — redirect_uri_mismatch
**Date:** 2026-04-06
**Bug:** Google OAuth returned `Error 400: redirect_uri_mismatch`.
**Root cause:** Google Cloud Console had `localhost:3000` registered but server was on port 3001.
**Fix:** Added Node.js HTTP shim on port 3000 that redirects callbacks to port 3001. Set `GOOGLE_REDIRECT_URI=http://localhost:3000/auth/google/callback` in `.env`.
**Rule:** Google Cloud Console redirect URI must exactly match. Solution: OAuth shim on port 3000, real server on 3001.

### L005 — invalid_grant on Calendar/Gmail
**Date:** 2026-04-06
**Bug:** All Google API calls failed with `invalid_grant`.
**Root cause:** Refresh token expired (tokens go stale after ~6 months of inactivity or revocation).
**Fix:** Re-authorize at `http://localhost:3001/auth/google`.
**Rule:** If Google APIs fail with `invalid_grant`, always re-auth first before debugging code.

---

## Proactive Daemon

### L006 — Wake word 2-minute delay
**Date:** 2026-04-06
**Bug:** Whisper model took ~2 minutes to respond to wake word.
**Root cause:** `WhisperModel` was lazy-loaded on first call, triggering a model download.
**Fix:** Moved model loading to module top level with warm-up pass on startup. (Wake word since removed.)
**Rule:** Pre-load all ML models at startup. Never lazy-load on first request in production.

### L007 — node-cron missed executions on server restart
**Date:** 2026-04-07
**Observation:** Log shows "missed execution" warnings for past UTC times when server restarts during SGT morning.
**Root cause:** node-cron fires at the scheduled UTC time. If the server starts after that time, the job is "missed" — this is expected behavior, not a bug.
**Rule:** Missed execution warnings are normal after restart. Not an error. Do not add retry logic for missed cron jobs.

---

## MCP / Tool Use

### L008 — MCP server exits before async tool call completes
**Date:** 2026-04-07
**Bug:** When piping two JSON-RPC messages via printf, only the first response came back.
**Root cause:** `process.stdin.on('end', () => process.exit(0))` fired before the async HTTP call inside `tools/call` completed.
**Fix:** Tested with Python subprocess (keeps stdin open). The MCP server itself is correct — OpenClaw holds stdin open during real conversations.
**Rule:** When testing MCP stdio, use a subprocess that holds stdin open (not `printf |`). The `printf |` pattern closes stdin immediately after sending.

---

## Skill Extensions Log

### S001 — Added 15 trivial/easy/medium features in one session
**Date:** 2026-04-07
**Features:** Essay coach, travel planning, decision logger, finance tracker, GitHub integration, document intelligence, email autopilot, web research, circuit breakers, self-healing, context injection, episodic memory, meeting transcription.
**Key insight:** Parallel agents (3 at once) writing independent route files, while main context handles infrastructure, cuts time by ~70%. Route files are fully independent — no shared state.

### S002 — MCP gives Claude 31 structured tools
**Date:** 2026-04-07
**Impact:** Claude can now call any JARVIS route mid-conversation as a `tool_use` block, not just via bash/curl. This is the difference between "can access data if asked" and "autonomously acts on data."
**Key insight:** MCP stdio is just JSON-RPC 2.0 over stdin/stdout. No SDK needed — ~150 lines of Node.js.

### S003 — Prompt caching on proactive daemon
**Date:** 2026-04-07
**Impact:** All Haiku calls in the daemon now reuse the cached system prompt. Estimated 80% token reduction on the `system` field across all cron job invocations.
**Key insight:** `cache_control: { type: 'ephemeral' }` on the system message. The cache is per-model, per-API-key, per-message-content. Same content = cache hit.
