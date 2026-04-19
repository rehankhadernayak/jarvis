/**
 * JARVIS Proactive Daemon
 * This is the heartbeat. JARVIS speaks without being asked.
 * Runs cron jobs that gather real data, reason with Claude, speak + notify.
 */

const cron = require('node-cron');
const { execSync } = require('child_process');
const Anthropic = require('@anthropic-ai/sdk');
const path = require('path');
const { telegramNotify } = require('../telegram/bot');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Helpers ──────────────────────────────────────────────────────────────────

// callRoute with automatic retry + timeout
async function callRoute(routePath, retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(`http://localhost:3001${routePath}`, { signal: controller.signal });
      clearTimeout(timeout);
      return await res.json();
    } catch (e) {
      if (attempt === retries) return null;
      await new Promise(r => setTimeout(r, 500 * Math.pow(2, attempt)));
    }
  }
  return null;
}

function macNotify(title, message) {
  try {
    execSync(`osascript -e 'display notification "${message.replace(/'/g, '')}" with title "${title.replace(/'/g, '')}" sound name "Glass"'`);
  } catch {}
}

// Notify via both Mac banner and Telegram
function notify(title, message) {
  macNotify(title, message);
  telegramNotify(title, message).catch(() => {});
}


// Cached system prompt — pre-warms on first call, reused across all proactive jobs
const JARVIS_SYSTEM = `You are JARVIS, Rehan's personal AI operating system. Rehan is a 17-year-old entrepreneur and student in Singapore. He runs Gametime (a sports scheduling startup targeting 20 beta families), studies for the SAT (target 1550+), and is learning ML. He attends Overseas Family School. Be direct, British-toned, no fluff. Lead with what matters. Never pad responses.`;

async function askClaude(prompt, maxTokens = 150) {
  const msg = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: maxTokens,
    system: [{ type: 'text', text: JARVIS_SYSTEM, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: prompt }]
  });
  return msg.content[0].text.trim();
}

function sgtHour() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Singapore' })).getHours();
}

function sgtDate() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Singapore' }); // YYYY-MM-DD
}

// ── Jobs ─────────────────────────────────────────────────────────────────────

// 7:00 AM SGT — Good Morning
async function morningRitual() {
  try {
    const [score, cal, gametime, satStatus, memory, news] = await Promise.all([
      callRoute('/life-score/current'),
      callRoute('/calendar/today'),
      callRoute('/gametime/status'),
      callRoute('/sat/status'),
      callRoute('/memory/'),
      callRoute('/news/headlines')
    ]);

    const memKV = {};
    (Array.isArray(memory) ? memory : []).forEach(m => { memKV[m.key] = m.value; });

    const calEvents = Array.isArray(cal) ? cal : (cal?.events || []);
    const todayEvents = calEvents.slice(0, 3).map(e =>
      `${e.summary || e.title}${e.start?.dateTime ? ' @ ' + new Date(e.start.dateTime).toLocaleTimeString('en-SG', {hour:'2-digit',minute:'2-digit'}) : ''}`
    );

    const headline = Array.isArray(news) && news[0] ? news[0].title : null;

    const context = [
      `Life score: ${score?.score ?? '?'}/${score?.max ?? 82} (grade ${score?.grade ?? '?'})`,
      `Today's calendar: ${todayEvents.length ? todayEvents.join(' | ') : 'no events'}`,
      `Gametime: ${gametime?.users ?? '?'}/20 families · ${gametime?.daysLeft ?? '?'} days left · pace: ${gametime?.paceStatus ?? '?'}`,
      `SAT: ${satStatus?.daysSinceLast ?? '?'} days since last session${satStatus?.stale ? ' ⚠️ STALE' : ''}`,
      `ML: Day ${memKV['ml_current_day'] ?? '?'}`,
      headline ? `Top headline: ${headline}` : '',
    ].filter(Boolean).join('\n');

    const briefing = await askClaude(
      `It is 7 AM in Singapore. Give Rehan his morning briefing.\n` +
      `Data:\n${context}\n\n` +
      `5 lines max. Start with the single most important thing. British tone. No greetings, no sign-off.`,
      250
    );

    notify('JARVIS — Morning Brief', briefing.split('\n')[0]);
    // Also log the full briefing as a second notification
    const line2 = briefing.split('\n').slice(1, 3).join(' ');
    if (line2.trim()) setTimeout(() => notify('JARVIS', line2), 3000);
    console.log('[proactive] Morning ritual:', briefing.substring(0, 100));
  } catch (e) {
    console.error('[proactive] Morning ritual failed:', e.message);
  }
}

// 8:00 PM SGT — Evening accountability check
async function eveningCheck() {
  try {
    const [satStatus, gametime, memory, moodTrends] = await Promise.all([
      callRoute('/sat/status'),
      callRoute('/gametime/status'),
      callRoute('/memory/'),
      callRoute('/emotional/trends'),
    ]);

    const memKV = {};
    (Array.isArray(memory) ? memory : []).forEach(m => { memKV[m.key] = m.value; });

    const issues = [];
    if (satStatus?.sessionsThisWeek === 0) issues.push(`SAT: no session this week. Last was ${satStatus?.daysSinceLast ?? '?'} days ago.`);
    if (gametime?.paceStatus === 'critical' || gametime?.paceStatus === 'behind') {
      issues.push(`Gametime: ${gametime.users}/20 families. Behind by ${Math.round(gametime.expectedPace - gametime.users)} from pace.`);
    }
    const mlDay = parseInt(memKV['ml_current_day']) || 1;
    issues.push(`ML: currently on day ${mlDay}.`);

    // Emotional state context
    const avgStress = moodTrends?.avgStress ?? null;
    const avgMood = moodTrends?.avgMood ?? null;
    const emotionalCtx = avgStress != null
      ? `Mood avg last 14 days: ${avgMood}/10, stress avg: ${avgStress}/10.`
      : '';

    if (issues.length > 0) {
      const msg = await askClaude(
        `You are JARVIS. It's 8 PM. Rehan needs a direct evening accountability check.\n` +
        `Issues:\n${issues.join('\n')}\n` +
        (emotionalCtx ? `Emotional context: ${emotionalCtx}\n` : '') +
        `\nGive 2-3 sentences. Direct, no fluff. Tell him what to do tonight. If stress is high (>7), acknowledge it briefly. British tone.`,
        180
      );
      notify('JARVIS — Evening Check', msg.split('.')[0]);
    }

    // Supportive notification if both SAT stale AND Gametime behind
    const satStale = satStatus?.daysSinceLast > 7;
    const gametimeBehind = gametime?.paceStatus === 'critical' || gametime?.paceStatus === 'behind';
    if (satStale && gametimeBehind) {
      try {
        const stressMsg = await askClaude(
          `Rehan is behind on both SAT (${satStatus?.daysSinceLast} days since last session) and Gametime (${gametime?.users}/20 families, ${gametime?.paceStatus} pace). He may be stressed. Give 1 genuinely supportive sentence — acknowledge the pressure, remind him one step is enough tonight. Not sappy. British tone.`,
          100
        );
        setTimeout(() => notify('JARVIS — You\'ve got this', stressMsg), 5000);
      } catch {}
    }
  } catch (e) {
    console.error('[proactive] Evening check failed:', e.message);
  }
}

// 11:00 PM SGT — Wind down
async function windDown() {
  try {
    const [cal, score] = await Promise.all([
      callRoute('/calendar/upcoming?days=1'),
      callRoute('/life-score/current')
    ]);
    const events = Array.isArray(cal) ? cal : (cal?.events || []);
    const tomorrowDate = new Date(Date.now() + 86400000).toISOString().split('T')[0];
    const tomorrow = events.filter(e => {
      const d = e.start?.dateTime || e.start?.date;
      return d && d.startsWith(tomorrowDate);
    });

    const tomorrowStr = tomorrow.length
      ? tomorrow.slice(0,3).map(e => e.summary || e.title).join(', ')
      : 'nothing scheduled';

    const msg = await askClaude(
      `It's 11 PM. Rehan's life score today: ${score?.score ?? '?'}/${score?.max ?? 82}.\n` +
      `Tomorrow: ${tomorrowStr}.\n` +
      `2 sentences: wind-down + what to prioritise tomorrow. Direct.`,
      120
    );
    notify('JARVIS — Wind Down', msg.split('.')[0] + '.');
  } catch (e) {
    console.error('[proactive] Wind down failed:', e.message);
  }
}

// Every 30min — Calendar event pre-briefer
const alreadyAlerted = new Set();
async function eventPreBriefing() {
  try {
    const cal = await callRoute('/calendar/today');
    const events = Array.isArray(cal) ? cal : (cal?.events || []);
    const now = Date.now();

    for (const event of events) {
      if (!event.start?.dateTime) continue;
      const start = new Date(event.start.dateTime).getTime();
      const minsUntil = Math.round((start - now) / 60000);
      const key = `${event.id || event.summary}-${sgtDate()}`;

      if (minsUntil > 0 && minsUntil <= 30 && !alreadyAlerted.has(key)) {
        alreadyAlerted.add(key);
        const msg = `${event.summary || 'Event'} in ${minsUntil} minutes.`;
        notify('JARVIS — Upcoming', msg);
      }
    }
  } catch (e) {
    console.error('[proactive] Event pre-briefer failed:', e.message);
  }
}

// Midnight SGT — Memory consolidation
async function consolidateMemory() {
  try {
    const recent = await callRoute('/memory-recall/recent?limit=50');
    const conversations = Array.isArray(recent) ? recent : (recent?.conversations || recent?.messages || []);
    if (conversations.length < 5) return;

    const formatted = conversations.map(c => `${(c.role || 'unknown').toUpperCase()}: ${c.content || ''}`).join('\n');

    const raw = await askClaude(
      `You are analyzing Rehan's recent conversations. Extract a JSON object with exactly these keys:\n` +
      `{\n` +
      `  "facts": ["string — concrete fact learned"],\n` +
      `  "tasks_mentioned": ["string — tasks or goals Rehan mentioned"],\n` +
      `  "decisions": ["string — decisions made"],\n` +
      `  "mood": "positive|neutral|negative",\n` +
      `  "key_topics": ["string"]\n` +
      `}\n\n` +
      `Conversations:\n${formatted}\n\n` +
      `Return ONLY valid JSON. No prose, no markdown, no explanation.`,
      400
    );

    let extracted;
    try {
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      extracted = JSON.parse(jsonMatch ? jsonMatch[0] : raw);
    } catch {
      return;
    }

    await fetch('http://localhost:3001/memory/set', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: `consolidated_${Date.now()}`, value: JSON.stringify(extracted) })
    });

    await fetch('http://localhost:3001/memory/set', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: `memory_consolidation_${sgtDate()}`, value: JSON.stringify(extracted) })
    });

    notify('JARVIS — Memory', `Consolidated ${extracted.facts?.length || 0} facts from today's conversations.`);
    console.log('[proactive] Memory consolidation complete:', extracted.facts?.length, 'facts');
  } catch (e) {
    console.error('[proactive] Memory consolidation failed:', e.message);
  }
}

// Every 5 minutes — Active app context refresh
async function contextRefresh() {
  try { await callRoute('/context/active'); } catch {}
}

// Every 30min — Service health check
async function healthCheck() {
  const services = [
    { name: 'JARVIS v2', port: 3001, path: '/status' },
    { name: 'OpenClaw', port: 18789, path: '/' },
    { name: 'Ollama', port: 11434, path: '/api/tags' },
  ];

  for (const svc of services) {
    try {
      const res = await fetch(`http://localhost:${svc.port}${svc.path}`, { signal: AbortSignal.timeout(3000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (e) {
      console.error(`[proactive] ${svc.name} DOWN:`, e.message);
      notify('JARVIS — Service Down', `${svc.name} is not responding`);
      // Attempt restart via launchctl for known services
      if (svc.port === 3001) {
        try { execSync('launchctl kickstart -k gui/$(id -u)/ai.jarvis.v2server 2>/dev/null || true'); } catch {}
      } else if (svc.port === 11434) {
        try { execSync('launchctl kickstart -k gui/$(id -u)/ai.jarvis.ollama 2>/dev/null || true'); } catch {}
      }
    }
  }
}

// Every hour — self-repair: check last 10 min of logs for ERRORs, auto-fix
async function autoSelfRepair() {
  try {
    const LOG_PATH = '/tmp/jarvis-v2-server.log';
    const { readFileSync, existsSync } = require('fs');
    if (!existsSync(LOG_PATH)) return;
    const lines = readFileSync(LOG_PATH, 'utf8').split('\n');
    const tenMinAgo = Date.now() - 10 * 60 * 1000;
    const recentErrors = lines.filter(l => l.includes('ERROR') || l.includes('Error:') || l.includes('ENOENT') || l.includes('ECONNREFUSED'));
    if (recentErrors.length === 0) return;

    console.log(`[proactive] self-repair: ${recentErrors.length} error lines found, triggering analyze+fix`);
    const analyzeRes = await fetch('http://localhost:3001/self-repair/analyze', { method: 'POST' });
    const analysis = await analyzeRes.json();
    if (analysis.errors?.length > 0 && analysis.hasFixes) {
      await fetch('http://localhost:3001/self-repair/fix', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ errors: analysis.errors })
      });
      notify('JARVIS — Self-Repair', `Auto-fixing ${analysis.errors.length} error(s) detected in server logs`);
    }
  } catch (e) {
    console.error('[proactive] self-repair failed:', e.message);
  }
}

// Sunday 10:00 AM SGT — Weekly decision review
async function weeklyDecisionReview() {
  try {
    const stats = await callRoute('/decisions/stats');
    if (!stats) {
      console.log('[proactive] weeklyDecisionReview: /decisions/stats returned null, skipping');
      return;
    }

    const pending = stats.pending_outcomes ?? stats.pendingOutcomes ?? 0;
    if (pending === 0) {
      console.log('[proactive] weeklyDecisionReview: no pending outcomes');
      return;
    }

    const msg = await askClaude(
      `Rehan has ${pending} decision(s) logged where the outcome is still NULL — they were never followed up on.\n` +
      `Raw stats: ${JSON.stringify(stats)}\n\n` +
      `Write a 2-3 sentence reminder telling him which decisions need outcomes reviewed. Be specific if the data includes titles. Direct, British tone.`,
      180
    );

    notify('JARVIS — Decision Review', msg);
    console.log('[proactive] weeklyDecisionReview:', msg.substring(0, 100));
  } catch (e) {
    console.error('[proactive] weeklyDecisionReview failed:', e.message);
  }
}

// 9:00 PM SGT — Daily budget check
async function budgetCheck() {
  try {
    const memory = await callRoute('/memory/');
    if (!memory) return;

    const memList = Array.isArray(memory) ? memory : [];
    const budgetKeys = memList.filter(m => m.key && m.key.startsWith('finance_budget_'));
    if (budgetKeys.length === 0) return; // No budgets set yet — silent return

    const summary = await callRoute('/finance/summary?period=month');
    if (!summary) return;

    const byCat = Array.isArray(summary.by_category) ? summary.by_category : [];
    const spending = {};
    for (const row of byCat) spending[row.category] = row.total;
    const warnings = [];

    for (const entry of budgetKeys) {
      const category = entry.key.replace('finance_budget_', '');
      const limit = parseFloat(entry.value);
      if (isNaN(limit) || limit <= 0) continue;

      const spent = parseFloat(spending[category]) || 0;
      const pct = (spent / limit) * 100;

      if (pct >= 100) {
        warnings.push(`${category}: $${spent.toFixed(0)}/$${limit.toFixed(0)} — OVER BUDGET`);
      } else if (pct >= 80) {
        warnings.push(`${category}: $${spent.toFixed(0)}/$${limit.toFixed(0)} (${Math.round(pct)}%)`);
      }
    }

    if (warnings.length > 0) {
      notify('JARVIS — Budget Alert', warnings.join(' | '));
      console.log('[proactive] Budget check: warnings for', warnings.length, 'categories');
    } else {
      console.log('[proactive] Budget check: all categories within limits');
    }
  } catch (e) {
    console.error('[proactive] Budget check failed:', e.message);
  }
}

// 8:00 AM SGT — Daily standup generator
async function dailyStandup() {
  try {
    const [gametime, sat, habits, cal, score] = await Promise.all([
      callRoute('/gametime/status'),
      callRoute('/sat/status'),
      callRoute('/habits'),
      callRoute('/calendar/today'),
      callRoute('/life-score/current'),
    ]);

    const events = Array.isArray(cal) ? cal : (cal?.events || []);
    const calStr = events.length ? events.slice(0, 3).map(e => e.summary || e.title).join(', ') : 'clear';
    const habitList = Array.isArray(habits) ? habits : [];
    const habitStr = habitList.length ? `${habitList.filter(h => h.done_today).length}/${habitList.length} done` : 'none set';

    const standup = await askClaude(
      `Generate a crisp daily standup for Rehan. Data:\n` +
      `Life score: ${score?.score ?? '?'}/${score?.max ?? 82}\n` +
      `Gametime: ${gametime?.users ?? '?'}/20 families, pace: ${gametime?.paceStatus ?? '?'}, ${gametime?.daysLeft ?? '?'} days left\n` +
      `SAT: ${sat?.daysSinceLast ?? '?'} days since last session\n` +
      `Habits: ${habitStr}\n` +
      `Calendar today: ${calStr}\n\n` +
      `4 lines max. Format: 1 priority line, 1 warning if anything is off, 1 calendar note, 1 action item. No greetings.`,
      200
    );

    notify('JARVIS — Standup', standup.split('\n')[0]);
    console.log('[proactive] Daily standup:', standup.substring(0, 100));
  } catch (e) {
    console.error('[proactive] Daily standup failed:', e.message);
  }
}

// Sunday 11:00 AM SGT — Weekly accountability report
async function weeklyReport() {
  try {
    const [score, sat, gametime, spend, mood] = await Promise.all([
      callRoute('/life-score/current'),
      callRoute('/sat/status'),
      callRoute('/gametime/status'),
      callRoute('/finance/summary?period=week'),
      callRoute('/emotional/trends'),
    ]);

    const context = [
      `Life score: ${score?.score ?? '?'}/${score?.max ?? 82} (${score?.grade ?? '?'})`,
      `SAT: ${sat?.sessionsThisWeek ?? 0} sessions this week, ${sat?.daysSinceLast ?? '?'} days since last`,
      `Gametime: ${gametime?.users ?? '?'}/20 families, pace ${gametime?.paceStatus ?? '?'}, ${gametime?.daysLeft ?? '?'} days to deadline`,
      `Spending this week: $${spend?.total ?? 0}`,
      `Mood avg: ${mood?.avgMood ?? '?'}/10, Stress avg: ${mood?.avgStress ?? '?'}/10`,
    ].join('\n');

    const report = await askClaude(
      `Rehan's weekly accountability check. Sunday review.\nData:\n${context}\n\n` +
      `3 lines: 1) What he achieved this week (honest score), 2) What slipped (be direct), 3) Single most important thing for next week. British tone. No padding.`,
      250
    );

    notify('JARVIS — Weekly Report', report);
    console.log('[proactive] Weekly report:', report.substring(0, 100));
  } catch (e) {
    console.error('[proactive] Weekly report failed:', e.message);
  }
}

// ── Schedule ─────────────────────────────────────────────────────────────────
// All times in SGT (UTC+8) — cron runs in system local time, converted

function startProactiveDaemon() {
  // 7:00 AM SGT = 23:00 UTC previous day
  cron.schedule('0 23 * * *', morningRitual, { timezone: 'UTC' });

  // 8:00 PM SGT = 12:00 UTC
  cron.schedule('0 12 * * *', eveningCheck, { timezone: 'UTC' });

  // 11:00 PM SGT = 15:00 UTC
  cron.schedule('0 15 * * *', windDown, { timezone: 'UTC' });

  // Every 5 minutes — active app context refresh
  cron.schedule('*/5 * * * *', contextRefresh);

  // Every 30 minutes — event pre-briefer + health check
  cron.schedule('*/30 * * * *', () => {
    eventPreBriefing();
    healthCheck();
  });

  // Every hour — auto self-repair check
  cron.schedule('0 * * * *', autoSelfRepair);

  // Midnight SGT = 16:00 UTC
  cron.schedule('0 16 * * *', consolidateMemory, { timezone: 'UTC' });

  // Sunday 10:00 AM SGT = 02:00 UTC Sunday
  cron.schedule('0 2 * * 0', weeklyDecisionReview, { timezone: 'UTC' });

  // 9:00 PM SGT = 13:00 UTC — Daily budget check
  cron.schedule('0 13 * * *', budgetCheck, { timezone: 'UTC' });

  // 8:00 AM SGT = 00:00 UTC — Daily standup
  cron.schedule('0 0 * * *', dailyStandup, { timezone: 'UTC' });

  // Sunday 11:00 AM SGT = 03:00 UTC — Weekly accountability report
  cron.schedule('0 3 * * 0', weeklyReport, { timezone: 'UTC' });

  console.log('[proactive] Daemon started — standup 8am, morning 7am, evening 8pm, budget 9pm, wind-down 11pm, context every 5min, checks every 30min, midnight consolidation, Sunday 10am decision review, Sunday 11am weekly report');
}

module.exports = { startProactiveDaemon, morningRitual, eveningCheck, healthCheck, weeklyDecisionReview, budgetCheck, dailyStandup, weeklyReport };
