# 03 — Self-Healing + Claude Code Self-Repair (HIGH)

## The problem

When JARVIS breaks, Rehan has to notice, diagnose, and fix it.
Real JARVIS handles this himself. "I've identified the fault and rerouted power."

## The fix

### Level 1: Process Watchdog
- `src/daemon/watchdog.js` — runs every 60s
- Checks: server port 3001 alive, OpenClaw gateway port 18789 alive, Ollama port 11434 alive
- On failure: log, attempt restart via LaunchAgent reload, send alert

### Level 2: Error Log Watcher
- fs.watch on `/tmp/jarvis-v2.log`
- On new ERROR lines: capture stack trace + surrounding context
- Classify: known (route error, auth failure) vs unknown (crash)
- Known errors: auto-apply fix templates
- Unknown errors: escalate to Level 3

### Level 3: Claude Code Self-Repair
When an unknown error is detected:
1. Capture: error message, stack trace, file path, line number
2. Read the relevant file
3. Call Claude Code CLI: `claude -p "Fix this bug: [error]\n\nFile: [content]" --output-format json`
4. Parse the suggested fix
5. Apply the edit to the file
6. Restart server
7. Verify fix worked (hit the route that failed)
8. Log outcome to memory

### Level 4: Self-Improvement Scheduler
- Every Sunday: JARVIS reviews its own error logs from the past week
- Identifies patterns (e.g., TTS timeouts, calendar auth failures)
- Generates a fix spec
- Either auto-applies (low risk) or queues for Claude Code review

## Implementation

```js
// src/daemon/watchdog.js
const { execSync } = require('child_process');
const Anthropic = require('@anthropic-ai/sdk');

const SERVICES = [
  { name: 'jarvis-v2', port: 3001, plist: 'ai.jarvis.v2server' },
  { name: 'openclaw', port: 18789, plist: 'ai.openclaw.gateway' },
  { name: 'ollama', port: 11434, plist: 'ai.jarvis.ollama' }
];

async function checkAndHeal(service) {
  const alive = await ping(service.port);
  if (!alive) {
    log(`${service.name} DOWN — attempting restart`);
    execSync(`launchctl unload ~/Library/LaunchAgents/${service.plist}.plist`);
    execSync(`launchctl load ~/Library/LaunchAgents/${service.plist}.plist`);
    // verify after 3s
    await sleep(3000);
    const recovered = await ping(service.port);
    notify('JARVIS', recovered ? `${service.name} recovered` : `${service.name} failed to restart`);
  }
}
```

## Expected behavior

Error in gmail route at 2am → JARVIS wakes up → reads the error → reads gmail.js →
calls Claude Code → gets a fix → applies it → restarts → confirms fixed → back to sleep.
No human needed.
