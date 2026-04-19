#!/usr/bin/env node
/**
 * JARVIS MCP Tool Server
 * Exposes all JARVIS v2 API routes as callable tools via Model Context Protocol (stdio).
 * Registered in OpenClaw so Claude can call JARVIS routes mid-conversation.
 *
 * Protocol: JSON-RPC 2.0 over stdin/stdout (MCP spec)
 */

'use strict';

const BASE = 'http://localhost:3001';

// ── Tool definitions ──────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: 'jarvis_calendar_today',
    description: "Get Rehan's Google Calendar events for today",
    inputSchema: { type: 'object', properties: {}, required: [] },
    handler: () => get('/calendar/today'),
  },
  {
    name: 'jarvis_calendar_upcoming',
    description: 'Get upcoming calendar events for the next N days',
    inputSchema: {
      type: 'object',
      properties: { days: { type: 'number', description: 'Number of days ahead (default 7)' } },
    },
    handler: ({ days = 7 } = {}) => get(`/calendar/upcoming?days=${days}`),
  },
  {
    name: 'jarvis_calendar_create',
    description: 'Create a Google Calendar event',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        start: { type: 'string', description: 'ISO datetime' },
        end: { type: 'string', description: 'ISO datetime' },
        description: { type: 'string' },
      },
      required: ['title', 'start', 'end'],
    },
    handler: (body) => post('/calendar/create', body),
  },
  {
    name: 'jarvis_gmail_unread',
    description: "Get Rehan's unread Gmail messages",
    inputSchema: { type: 'object', properties: {} },
    handler: () => get('/gmail/unread'),
  },
  {
    name: 'jarvis_gmail_triage',
    description: 'Get Claude-triaged inbox — urgent vs normal emails',
    inputSchema: { type: 'object', properties: {} },
    handler: () => get('/gmail/triage'),
  },
  {
    name: 'jarvis_gmail_draft',
    description: 'Create a Gmail draft (not sent)',
    inputSchema: {
      type: 'object',
      properties: {
        to: { type: 'string' },
        subject: { type: 'string' },
        body: { type: 'string' },
      },
      required: ['to', 'subject', 'body'],
    },
    handler: (body) => post('/gmail/draft', body),
  },
  {
    name: 'jarvis_life_score',
    description: "Get Rehan's current weekly life score with component breakdown",
    inputSchema: { type: 'object', properties: {} },
    handler: () => get('/life-score/current'),
  },
  {
    name: 'jarvis_memory_get',
    description: 'Get all JARVIS memory key-value pairs',
    inputSchema: { type: 'object', properties: {} },
    handler: () => get('/memory/'),
  },
  {
    name: 'jarvis_memory_set',
    description: 'Set a JARVIS memory value',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string' },
        value: { type: 'string' },
      },
      required: ['key', 'value'],
    },
    handler: ({ key, value }) => post(`/memory/${key}`, { value }),
  },
  {
    name: 'jarvis_sat_status',
    description: 'Get SAT practice session status — days since last, streak, weak areas',
    inputSchema: { type: 'object', properties: {} },
    handler: () => get('/sat/status'),
  },
  {
    name: 'jarvis_sat_drill',
    description: 'Generate SAT practice questions',
    inputSchema: {
      type: 'object',
      properties: { count: { type: 'number', description: 'Number of questions (default 5)' } },
    },
    handler: ({ count = 5 } = {}) => get(`/sat/drill?count=${count}`),
  },
  {
    name: 'jarvis_sat_log',
    description: 'Log a SAT practice session',
    inputSchema: {
      type: 'object',
      properties: {
        attempted: { type: 'number' },
        score: { type: 'number' },
        weak_areas: { type: 'string' },
        notes: { type: 'string' },
      },
      required: ['attempted', 'score'],
    },
    handler: (body) => post('/sat/log', body),
  },
  {
    name: 'jarvis_gametime_status',
    description: 'Get Gametime startup sprint status — families, pace, days left',
    inputSchema: { type: 'object', properties: {} },
    handler: () => get('/gametime/status'),
  },
  {
    name: 'jarvis_gametime_advice',
    description: 'Get AI-generated Gametime daily outreach advice',
    inputSchema: { type: 'object', properties: {} },
    handler: () => get('/gametime/advice'),
  },
  {
    name: 'jarvis_gametime_update',
    description: 'Update Gametime beta user count',
    inputSchema: {
      type: 'object',
      properties: { users: { type: 'number' } },
      required: ['users'],
    },
    handler: (body) => post('/gametime/update', body),
  },
  {
    name: 'jarvis_vision_screen',
    description: "Capture and analyze Rehan's current screen with Claude Vision",
    inputSchema: {
      type: 'object',
      properties: { prompt: { type: 'string', description: 'Optional specific question about the screen' } },
    },
    handler: (body = {}) => post('/vision/analyze', body),
  },
  {
    name: 'jarvis_context_active',
    description: 'Get the currently active app and window on the Mac',
    inputSchema: { type: 'object', properties: {} },
    handler: () => get('/context/active'),
  },
  {
    name: 'jarvis_briefing_morning',
    description: "Generate Rehan's morning briefing with all live data",
    inputSchema: { type: 'object', properties: {} },
    handler: () => get('/briefing/morning'),
  },
  {
    name: 'jarvis_news_headlines',
    description: 'Get latest news headlines',
    inputSchema: {
      type: 'object',
      properties: { limit: { type: 'number', description: 'Number of headlines (default 5)' } },
    },
    handler: ({ limit = 5 } = {}) => get(`/news/latest?limit=${limit}`),
  },
  {
    name: 'jarvis_research',
    description: 'Deep web research on any topic using DuckDuckGo + Wikipedia + Claude',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        depth: { type: 'string', enum: ['quick', 'deep'] },
      },
      required: ['query'],
    },
    handler: (body) => post('/research/search', body),
  },
  {
    name: 'jarvis_decision_log',
    description: 'Log a decision Rehan made for future tracking',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        decision: { type: 'string' },
        context: { type: 'string' },
        tags: { type: 'string' },
      },
      required: ['title', 'decision'],
    },
    handler: (body) => post('/decisions', body),
  },
  {
    name: 'jarvis_decision_analyze',
    description: 'Analyze decision options and get a recommendation',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        context: { type: 'string' },
        options: { type: 'array', items: { type: 'string' } },
      },
      required: ['title', 'options'],
    },
    handler: (body) => post('/decisions/analyze', body),
  },
  {
    name: 'jarvis_finance_log',
    description: 'Log an expense',
    inputSchema: {
      type: 'object',
      properties: {
        amount: { type: 'number' },
        category: { type: 'string' },
        description: { type: 'string' },
        date: { type: 'string' },
      },
      required: ['amount', 'category'],
    },
    handler: (body) => post('/finance/expense', body),
  },
  {
    name: 'jarvis_finance_summary',
    description: 'Get spending summary',
    inputSchema: {
      type: 'object',
      properties: { period: { type: 'string', enum: ['week', 'month', 'all'] } },
    },
    handler: ({ period = 'month' } = {}) => get(`/finance/summary?period=${period}`),
  },
  {
    name: 'jarvis_essay_analyze',
    description: "Analyze an essay with feedback on thesis, structure, argument, and style",
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string' },
        type: { type: 'string', enum: ['ib', 'sat', 'college', 'general'] },
      },
      required: ['text'],
    },
    handler: (body) => post('/essay/analyze', body),
  },
  {
    name: 'jarvis_travel_plan',
    description: 'Plan a trip with full day-by-day itinerary',
    inputSchema: {
      type: 'object',
      properties: {
        destination: { type: 'string' },
        start_date: { type: 'string' },
        end_date: { type: 'string' },
        budget: { type: 'string' },
        interests: { type: 'array', items: { type: 'string' } },
      },
      required: ['destination', 'start_date', 'end_date'],
    },
    handler: (body) => post('/travel/plan', body),
  },
  {
    name: 'jarvis_health_today',
    description: "Get today's iOS health data (steps, HRV, sleep, etc.)",
    inputSchema: { type: 'object', properties: {} },
    handler: () => get('/shortcuts/health/today'),
  },
  {
    name: 'jarvis_health_insights',
    description: 'Get Claude analysis of the past week of health data',
    inputSchema: { type: 'object', properties: {} },
    handler: () => get('/shortcuts/health/insights'),
  },
  {
    name: 'jarvis_managebac_grades',
    description: "Get Rehan's current grades from ManageBac school portal",
    inputSchema: { type: 'object', properties: {} },
    handler: () => get('/managebac/grades'),
  },
  {
    name: 'jarvis_managebac_deadlines',
    description: 'Get upcoming school assignment deadlines from ManageBac',
    inputSchema: { type: 'object', properties: {} },
    handler: () => get('/managebac/deadlines'),
  },
  {
    name: 'jarvis_system_status',
    description: 'Get JARVIS system health — all routes, circuit breakers, uptime',
    inputSchema: { type: 'object', properties: {} },
    handler: () => get('/status/full'),
  },
  {
    name: 'jarvis_habits_list',
    description: "Get Rehan's habit tracker — streaks, done today, completion rates",
    inputSchema: { type: 'object', properties: {} },
    handler: () => get('/habits'),
  },
  {
    name: 'jarvis_habits_check',
    description: 'Mark a habit as done for today',
    inputSchema: { type: 'object', properties: { id: { type: 'number' } }, required: ['id'] },
    handler: ({ id }) => post(`/habits/${id}/check`, {}),
  },
  {
    name: 'jarvis_habits_add',
    description: 'Add a new habit to track',
    inputSchema: { type: 'object', properties: { name: { type: 'string' }, frequency: { type: 'string' }, target_days: { type: 'number' } }, required: ['name'] },
    handler: (args) => post('/habits', args),
  },
  {
    name: 'jarvis_reading_list',
    description: "Get Rehan's reading list — books, articles, courses",
    inputSchema: { type: 'object', properties: { status: { type: 'string' } } },
    handler: ({ status } = {}) => get(`/reading-list${status ? `?status=${status}` : ''}`),
  },
  {
    name: 'jarvis_reading_add',
    description: 'Add a book or article to the reading list',
    inputSchema: { type: 'object', properties: { title: { type: 'string' }, author: { type: 'string' }, type: { type: 'string' }, url: { type: 'string' } }, required: ['title'] },
    handler: (args) => post('/reading-list', args),
  },
  {
    name: 'jarvis_uni_deadlines',
    description: 'Get university application deadlines with days remaining',
    inputSchema: { type: 'object', properties: {} },
    handler: () => get('/uni/countdown'),
  },
  {
    name: 'jarvis_uni_add',
    description: 'Add a university deadline',
    inputSchema: { type: 'object', properties: { school: { type: 'string' }, program: { type: 'string' }, deadline_date: { type: 'string' }, type: { type: 'string' } }, required: ['school', 'deadline_date'] },
    handler: (args) => post('/uni/deadlines', args),
  },
  {
    name: 'jarvis_crm_pipeline',
    description: 'Get Gametime CRM pipeline — contacts, status breakdown, overdue follow-ups',
    inputSchema: { type: 'object', properties: {} },
    handler: () => get('/crm/pipeline'),
  },
  {
    name: 'jarvis_crm_contacts',
    description: 'List Gametime CRM contacts, optionally filtered by status',
    inputSchema: { type: 'object', properties: { status: { type: 'string' } } },
    handler: ({ status } = {}) => get(`/crm/contacts${status ? `?status=${status}` : ''}`),
  },
  {
    name: 'jarvis_crm_add',
    description: 'Add a new Gametime prospect to CRM',
    inputSchema: { type: 'object', properties: { name: { type: 'string' }, contact_info: { type: 'string' }, source: { type: 'string' }, notes: { type: 'string' } }, required: ['name'] },
    handler: (args) => post('/crm/contacts', args),
  },
  {
    name: 'jarvis_crm_log',
    description: 'Log a follow-up with a Gametime contact',
    inputSchema: { type: 'object', properties: { contact_id: { type: 'number' }, note: { type: 'string' }, outcome: { type: 'string' } }, required: ['contact_id', 'note'] },
    handler: ({ contact_id, ...rest }) => post(`/crm/contacts/${contact_id}/log`, rest),
  },
  {
    name: 'jarvis_meals_today',
    description: "Get today's meal log with calorie and protein totals",
    inputSchema: { type: 'object', properties: {} },
    handler: () => get('/meals/today'),
  },
  {
    name: 'jarvis_meals_log',
    description: 'Log a meal',
    inputSchema: { type: 'object', properties: { meal_type: { type: 'string' }, description: { type: 'string' }, calories: { type: 'number' }, protein_g: { type: 'number' } }, required: ['description'] },
    handler: (args) => post('/meals', args),
  },
];

// ── HTTP helpers ──────────────────────────────────────────────────────────────

async function get(path) {
  const res = await fetch(`${BASE}${path}`, { signal: AbortSignal.timeout(15000) });
  return res.json();
}

async function post(path, body = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  return res.json();
}

// ── MCP stdio protocol ────────────────────────────────────────────────────────

const toolMap = new Map(TOOLS.map((t) => [t.name, t]));

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

function ok(id, result) {
  send({ jsonrpc: '2.0', id, result });
}

function err(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } });
}

async function handle(msg) {
  const { id, method, params } = msg;

  if (method === 'initialize') {
    return ok(id, {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'jarvis-tools', version: '2.0.0' },
    });
  }

  if (method === 'notifications/initialized') return; // no response needed

  if (method === 'tools/list') {
    return ok(id, {
      tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
    });
  }

  if (method === 'tools/call') {
    const { name, arguments: args = {} } = params;
    const tool = toolMap.get(name);
    if (!tool) return err(id, -32601, `Unknown tool: ${name}`);
    try {
      const data = await tool.handler(args);
      return ok(id, {
        content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
      });
    } catch (e) {
      return ok(id, {
        content: [{ type: 'text', text: `Error: ${e.message}` }],
        isError: true,
      });
    }
  }

  if (id !== undefined) err(id, -32601, `Unknown method: ${method}`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

let buf = '';

// Self-terminate after 10 minutes of inactivity — prevents zombie accumulation
// when OpenClaw opens a new MCP process per session without closing old ones.
const IDLE_TIMEOUT_MS = 10 * 60 * 1000;
let idleTimer = setTimeout(() => process.exit(0), IDLE_TIMEOUT_MS);
function resetIdle() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => process.exit(0), IDLE_TIMEOUT_MS);
}

process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  resetIdle();
  buf += chunk;
  const lines = buf.split('\n');
  buf = lines.pop(); // keep incomplete line
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      handle(JSON.parse(trimmed));
    } catch {
      // ignore malformed JSON
    }
  }
});

process.stdin.on('end', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
process.stderr.write(`[jarvis-mcp] JARVIS tool server ready — ${TOOLS.length} tools available\n`);
