'use strict';

/**
 * JARVIS Telegram Bot v2
 * Direct Anthropic API with streaming — no OpenClaw middleman.
 * Progressive message editing, auto tool execution, background tasks.
 */

const Anthropic = require('@anthropic-ai/sdk');
const path = require('path');
const { db } = require('../db/init');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID   = process.env.TELEGRAM_CHAT_ID;
const API       = `https://api.telegram.org/bot${BOT_TOKEN}`;
const BASE      = 'http://localhost:3001';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── JARVIS System Prompt ─────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are JARVIS, Rehan's personal AI operating system. Rehan is a 17-year-old entrepreneur and student in Singapore (SGT, UTC+8).

Key context:
- Gametime: sports scheduling startup, 3/20 beta families, sprint ends May 2026 — critical pace
- SAT: target 1550+, flag if >7 days since last session
- ML: daily learning track, currently Day 1
- School: Overseas Family School, IB curriculum, ManageBac for grades

Personality: British. Direct. No filler. Lead with what matters. Numbers before prose. Address him as "Sir" when appropriate.

You have full access to JARVIS tools — calendar, email, memory, SAT, finance, research, etc. Use them proactively to answer questions with real data. Never say "I don't have access." You do.

Current date: ${new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Singapore' })}
Current time: ${new Date().toLocaleTimeString('en-SG', { timeZone: 'Asia/Singapore', hour: '2-digit', minute: '2-digit' })}`;

// ── Tool Definitions (Anthropic format) ──────────────────────────────────────

const TOOLS = [
  {
    name: 'jarvis_calendar_today',
    description: "Get Rehan's Google Calendar events for today",
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'jarvis_calendar_upcoming',
    description: 'Get upcoming calendar events for the next N days',
    input_schema: { type: 'object', properties: { days: { type: 'number', description: 'Number of days ahead (default 7)' } } },
  },
  {
    name: 'jarvis_calendar_create',
    description: 'Create a Google Calendar event',
    input_schema: { type: 'object', properties: { title: { type: 'string' }, start: { type: 'string', description: 'ISO datetime' }, end: { type: 'string', description: 'ISO datetime' }, description: { type: 'string' } }, required: ['title', 'start', 'end'] },
  },
  {
    name: 'jarvis_gmail_unread',
    description: "Get Rehan's unread Gmail messages",
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'jarvis_gmail_triage',
    description: 'Get Claude-triaged inbox — urgent vs normal emails',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'jarvis_gmail_draft',
    description: 'Create a Gmail draft (not sent)',
    input_schema: { type: 'object', properties: { to: { type: 'string' }, subject: { type: 'string' }, body: { type: 'string' } }, required: ['to', 'subject', 'body'] },
  },
  {
    name: 'jarvis_gmail_send',
    description: 'Send an email directly',
    input_schema: { type: 'object', properties: { to: { type: 'string' }, subject: { type: 'string' }, body: { type: 'string' } }, required: ['to', 'subject', 'body'] },
  },
  {
    name: 'jarvis_gmail_reply_draft',
    description: 'Create a reply draft to an existing email thread',
    input_schema: { type: 'object', properties: { threadId: { type: 'string' }, body: { type: 'string' } }, required: ['threadId', 'body'] },
  },
  {
    name: 'jarvis_life_score',
    description: "Get Rehan's current weekly life score with component breakdown",
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'jarvis_memory_get',
    description: 'Get all JARVIS memory key-value pairs',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'jarvis_memory_set',
    description: 'Set a JARVIS memory value',
    input_schema: { type: 'object', properties: { key: { type: 'string' }, value: { type: 'string' } }, required: ['key', 'value'] },
  },
  {
    name: 'jarvis_sat_status',
    description: 'Get SAT practice session status — days since last, streak, weak areas',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'jarvis_sat_drill',
    description: 'Generate SAT practice questions',
    input_schema: { type: 'object', properties: { count: { type: 'number', description: 'Number of questions (default 5)' } } },
  },
  {
    name: 'jarvis_sat_log',
    description: 'Log a SAT practice session',
    input_schema: { type: 'object', properties: { attempted: { type: 'number' }, score: { type: 'number' }, weak_areas: { type: 'string' }, notes: { type: 'string' } }, required: ['attempted', 'score'] },
  },
  {
    name: 'jarvis_gametime_status',
    description: 'Get Gametime startup sprint status — families, pace, days left',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'jarvis_gametime_advice',
    description: 'Get AI-generated Gametime daily outreach advice',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'jarvis_gametime_update',
    description: 'Update Gametime beta user count',
    input_schema: { type: 'object', properties: { users: { type: 'number' } }, required: ['users'] },
  },
  {
    name: 'jarvis_news_headlines',
    description: 'Get latest news headlines',
    input_schema: { type: 'object', properties: { limit: { type: 'number', description: 'Number of headlines (default 5)' } } },
  },
  {
    name: 'jarvis_research',
    description: 'Deep web research on any topic using DuckDuckGo + Wikipedia + Claude synthesis',
    input_schema: { type: 'object', properties: { query: { type: 'string' }, depth: { type: 'string', enum: ['quick', 'deep'] } }, required: ['query'] },
  },
  {
    name: 'jarvis_decision_log',
    description: 'Log a decision Rehan made for future tracking',
    input_schema: { type: 'object', properties: { title: { type: 'string' }, decision: { type: 'string' }, context: { type: 'string' }, tags: { type: 'string' } }, required: ['title', 'decision'] },
  },
  {
    name: 'jarvis_decision_analyze',
    description: 'Analyze decision options and get a recommendation',
    input_schema: { type: 'object', properties: { title: { type: 'string' }, context: { type: 'string' }, options: { type: 'array', items: { type: 'string' } } }, required: ['title', 'options'] },
  },
  {
    name: 'jarvis_finance_log',
    description: 'Log an expense',
    input_schema: { type: 'object', properties: { amount: { type: 'number' }, category: { type: 'string' }, description: { type: 'string' }, date: { type: 'string' } }, required: ['amount', 'category'] },
  },
  {
    name: 'jarvis_finance_summary',
    description: 'Get spending summary',
    input_schema: { type: 'object', properties: { period: { type: 'string', enum: ['week', 'month', 'all'] } } },
  },
  {
    name: 'jarvis_essay_analyze',
    description: "Analyze an essay with feedback on thesis, structure, argument, and style",
    input_schema: { type: 'object', properties: { text: { type: 'string' }, type: { type: 'string', enum: ['ib', 'sat', 'college', 'general'] } }, required: ['text'] },
  },
  {
    name: 'jarvis_travel_plan',
    description: 'Plan a trip with full day-by-day itinerary',
    input_schema: { type: 'object', properties: { destination: { type: 'string' }, start_date: { type: 'string' }, end_date: { type: 'string' }, budget: { type: 'string' }, interests: { type: 'array', items: { type: 'string' } } }, required: ['destination', 'start_date', 'end_date'] },
  },
  {
    name: 'jarvis_health_today',
    description: "Get today's iOS health data (steps, HRV, sleep, etc.)",
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'jarvis_health_insights',
    description: 'Get Claude analysis of the past week of health data',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'jarvis_managebac_grades',
    description: "Get Rehan's current grades from ManageBac school portal",
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'jarvis_managebac_deadlines',
    description: 'Get upcoming school assignment deadlines from ManageBac',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'jarvis_emotional_analyze',
    description: 'Analyze emotional state from text',
    input_schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
  },
  {
    name: 'jarvis_emotional_journal',
    description: 'Write a journal entry and get emotional analysis',
    input_schema: { type: 'object', properties: { entry: { type: 'string' } }, required: ['entry'] },
  },
  {
    name: 'jarvis_system_status',
    description: 'Get JARVIS system health — all routes, circuit breakers, uptime',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'jarvis_briefing_morning',
    description: "Generate Rehan's morning briefing with all live data",
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'jarvis_context_active',
    description: 'Get the currently active app and window on the Mac',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'jarvis_habits_list',
    description: "Get Rehan's habit tracker — streaks, completions, what's done today",
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'jarvis_habits_check',
    description: 'Mark a habit as done for today',
    input_schema: { type: 'object', properties: { id: { type: 'number', description: 'Habit ID' } }, required: ['id'] },
  },
  {
    name: 'jarvis_habits_add',
    description: 'Add a new habit to track',
    input_schema: { type: 'object', properties: { name: { type: 'string' }, frequency: { type: 'string', enum: ['daily', 'weekly'] }, target_days: { type: 'number' } }, required: ['name'] },
  },
  {
    name: 'jarvis_reading_list',
    description: "Get Rehan's reading list — books, articles, courses",
    input_schema: { type: 'object', properties: { status: { type: 'string', enum: ['unread', 'reading', 'done'] } } },
  },
  {
    name: 'jarvis_reading_add',
    description: 'Add a book or article to the reading list',
    input_schema: { type: 'object', properties: { title: { type: 'string' }, author: { type: 'string' }, type: { type: 'string', enum: ['book', 'article', 'paper', 'course'] }, url: { type: 'string' } }, required: ['title'] },
  },
  {
    name: 'jarvis_uni_deadlines',
    description: 'Get university application deadlines with days remaining',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'jarvis_uni_add',
    description: 'Add a university deadline',
    input_schema: { type: 'object', properties: { school: { type: 'string' }, program: { type: 'string' }, deadline_date: { type: 'string', description: 'YYYY-MM-DD' }, type: { type: 'string', enum: ['application', 'scholarship', 'sat', 'interview', 'financial_aid'] }, notes: { type: 'string' } }, required: ['school', 'deadline_date'] },
  },
  {
    name: 'jarvis_crm_pipeline',
    description: 'Get Gametime CRM pipeline — contact status, conversion rate, follow-ups due',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'jarvis_crm_add',
    description: 'Add a new Gametime prospect/contact to the CRM',
    input_schema: { type: 'object', properties: { name: { type: 'string' }, contact_info: { type: 'string' }, family_size: { type: 'number' }, source: { type: 'string', enum: ['referral', 'cold', 'event', 'social'] }, notes: { type: 'string' } }, required: ['name'] },
  },
  {
    name: 'jarvis_crm_log',
    description: 'Log a follow-up with a Gametime contact',
    input_schema: { type: 'object', properties: { contact_id: { type: 'number' }, note: { type: 'string' }, outcome: { type: 'string', enum: ['interested', 'no_response', 'declined', 'scheduled_call', 'converted'] } }, required: ['contact_id', 'note'] },
  },
  {
    name: 'jarvis_meals_today',
    description: "Get today's meal log with calorie totals",
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'jarvis_meals_log',
    description: 'Log a meal',
    input_schema: { type: 'object', properties: { meal_type: { type: 'string', enum: ['breakfast', 'lunch', 'dinner', 'snack', 'meal'] }, description: { type: 'string' }, calories: { type: 'number' }, protein_g: { type: 'number' } }, required: ['description'] },
  },
];

// ── Tool Execution (calls JARVIS routes directly) ────────────────────────────

async function routeGet(path) {
  const res = await fetch(`${BASE}${path}`, { signal: AbortSignal.timeout(15000) });
  return res.json();
}

async function routePost(path, body = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  return res.json();
}

const TOOL_HANDLERS = {
  jarvis_calendar_today:      ()          => routeGet('/calendar/today'),
  jarvis_calendar_upcoming:   (a)         => routeGet(`/calendar/upcoming?days=${a?.days || 7}`),
  jarvis_calendar_create:     (a)         => routePost('/calendar/create', a),
  jarvis_gmail_unread:        ()          => routeGet('/gmail/unread'),
  jarvis_gmail_triage:        ()          => routeGet('/gmail/triage'),
  jarvis_gmail_draft:         (a)         => routePost('/gmail/draft', a),
  jarvis_gmail_send:          (a)         => routePost('/gmail/send', a),
  jarvis_gmail_reply_draft:   (a)         => routePost('/gmail/reply-draft', a),
  jarvis_life_score:          ()          => routeGet('/life-score/current'),
  jarvis_memory_get:          ()          => routeGet('/memory/'),
  jarvis_memory_set:          (a)         => routePost(`/memory/${a.key}`, { value: a.value }),
  jarvis_sat_status:          ()          => routeGet('/sat/status'),
  jarvis_sat_drill:           (a)         => routeGet(`/sat/drill?count=${a?.count || 5}`),
  jarvis_sat_log:             (a)         => routePost('/sat/log', a),
  jarvis_gametime_status:     ()          => routeGet('/gametime/status'),
  jarvis_gametime_advice:     ()          => routeGet('/gametime/advice'),
  jarvis_gametime_update:     (a)         => routePost('/gametime/update', a),
  jarvis_news_headlines:      (a)         => routeGet(`/news/latest?limit=${a?.limit || 5}`),
  jarvis_research:            (a)         => routePost('/research/search', a),
  jarvis_decision_log:        (a)         => routePost('/decisions', a),
  jarvis_decision_analyze:    (a)         => routePost('/decisions/analyze', a),
  jarvis_finance_log:         (a)         => routePost('/finance/expense', a),
  jarvis_finance_summary:     (a)         => routeGet(`/finance/summary?period=${a?.period || 'month'}`),
  jarvis_essay_analyze:       (a)         => routePost('/essay/analyze', a),
  jarvis_travel_plan:         (a)         => routePost('/travel/plan', a),
  jarvis_health_today:        ()          => routeGet('/shortcuts/health/today'),
  jarvis_health_insights:     ()          => routeGet('/shortcuts/health/insights'),
  jarvis_managebac_grades:    ()          => routeGet('/managebac/grades'),
  jarvis_managebac_deadlines: ()          => routeGet('/managebac/deadlines'),
  jarvis_emotional_analyze:   (a)         => routePost('/emotional/analyze', a),
  jarvis_emotional_journal:   (a)         => routePost('/emotional/journal', a),
  jarvis_system_status:       ()          => routeGet('/status/full'),
  jarvis_briefing_morning:    ()          => routeGet('/briefing/morning'),
  jarvis_context_active:      ()          => routeGet('/context/active'),
  jarvis_habits_list:         ()          => routeGet('/habits'),
  jarvis_habits_check:        (a)         => routePost(`/habits/${a.id}/check`, {}),
  jarvis_habits_add:          (a)         => routePost('/habits', a),
  jarvis_reading_list:        (a)         => routeGet(`/reading-list${a?.status ? `?status=${a.status}` : ''}`),
  jarvis_reading_add:         (a)         => routePost('/reading-list', a),
  jarvis_uni_deadlines:       ()          => routeGet('/uni/countdown'),
  jarvis_uni_add:             (a)         => routePost('/uni/deadlines', a),
  jarvis_crm_pipeline:        ()          => routeGet('/crm/pipeline'),
  jarvis_crm_add:             (a)         => routePost('/crm/contacts', a),
  jarvis_crm_log:             (a)         => routePost(`/crm/contacts/${a.contact_id}/log`, { note: a.note, outcome: a.outcome }),
  jarvis_meals_today:         ()          => routeGet('/meals/today'),
  jarvis_meals_log:           (a)         => routePost('/meals', a),
};

async function executeTool(name, input) {
  const handler = TOOL_HANDLERS[name];
  if (!handler) return { error: `Unknown tool: ${name}` };
  try {
    return await handler(input);
  } catch (e) {
    return { error: e.message };
  }
}

// ── Telegram API ─────────────────────────────────────────────────────────────

async function tgPost(method, body) {
  try {
    const res = await fetch(`${API}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });
    return await res.json();
  } catch (e) {
    console.error(`[telegram] ${method} failed:`, e.message);
    return null;
  }
}

function splitMessage(text, limit = 4096) {
  if (text.length <= limit) return [text];
  const chunks = [];
  let remaining = text;
  while (remaining.length > 0) {
    let cut = limit;
    if (remaining.length > limit) {
      const nl = remaining.lastIndexOf('\n', limit);
      if (nl > limit * 0.5) cut = nl + 1;
    }
    chunks.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut);
  }
  return chunks;
}

async function sendMessage(chatId, text, options = {}) {
  const chunks = splitMessage(text);
  let lastResult = null;
  for (const chunk of chunks) {
    lastResult = await tgPost('sendMessage', {
      chat_id: chatId,
      text: chunk,
      parse_mode: 'Markdown',
      ...options,
    });
    // Fallback: if Markdown fails, resend as plain text
    if (!lastResult?.ok) {
      lastResult = await tgPost('sendMessage', {
        chat_id: chatId,
        text: chunk,
        ...options,
      });
    }
  }
  return lastResult;
}

async function editMessage(chatId, messageId, text) {
  const result = await tgPost('editMessageText', {
    chat_id: chatId,
    message_id: messageId,
    text: text.substring(0, 4096),
    parse_mode: 'Markdown',
  });
  // Fallback to plain text if Markdown parsing fails
  if (!result?.ok) {
    return tgPost('editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text: text.substring(0, 4096),
    });
  }
  return result;
}

async function sendChatAction(chatId, action = 'typing') {
  return tgPost('sendChatAction', { chat_id: chatId, action });
}

// ── Public: notification helper for proactive daemon ─────────────────────────

async function telegramNotify(title, message) {
  if (!BOT_TOKEN || !CHAT_ID) return;
  const text = title ? `*${title}*\n${message}` : message;
  return sendMessage(CHAT_ID, text);
}

// ── Smart Model Routing ───────────────────────────────────────────────────────
// Use Haiku for simple lookups, Sonnet for reasoning/writing/complex tasks.

const HAIKU_MODEL  = 'claude-haiku-4-5-20251001';
const SONNET_MODEL = 'claude-sonnet-4-6';

const SIMPLE_PATTERNS = [
  /^what('s| is) (my|the) (sat|gametime|score|health|status|cal|calendar|mood|budget|balance)/i,
  /^(show|get|list|check) (my )?(habits?|reading|meals?|calendar|emails?|tasks?|deadlines?)/i,
  /^how (many|much|long)/i,
  /^(yes|no|ok|thanks?|got it|sure|noted|done)/i,
];

function selectModel(text) {
  if (!text || text.length < 8) return HAIKU_MODEL;
  if (text.length > 200) return SONNET_MODEL;
  for (const pattern of SIMPLE_PATTERNS) {
    if (pattern.test(text.trim())) return HAIKU_MODEL;
  }
  // Complex keywords → Sonnet
  const complexKeywords = ['analyze', 'plan', 'write', 'draft', 'explain', 'research', 'strategy', 'advice', 'review', 'why', 'how should', 'what should', 'help me'];
  if (complexKeywords.some(k => text.toLowerCase().includes(k))) return SONNET_MODEL;
  return text.length < 80 ? HAIKU_MODEL : SONNET_MODEL;
}

// ── Streaming Claude Conversation with Tool Loop ─────────────────────────────

// Conversation history per chat (in-memory, last 20 turns)
const chatHistories = new Map();
const MAX_HISTORY = 20;

function getHistory(chatId) {
  if (!chatHistories.has(chatId)) chatHistories.set(chatId, []);
  return chatHistories.get(chatId);
}

function addToHistory(chatId, role, content) {
  const h = getHistory(chatId);
  h.push({ role, content });
  // Keep last MAX_HISTORY messages
  while (h.length > MAX_HISTORY) h.shift();
}

/**
 * Main conversation handler — streams Claude response, auto-executes tools,
 * progressively edits Telegram message.
 */
async function streamConversation(chatId, userMessage) {
  addToHistory(chatId, 'user', userMessage);

  // Smart model routing
  const model = selectModel(userMessage);

  // Send initial "thinking" message
  const thinkingRes = await sendMessage(chatId, '_Thinking..._');
  const msgId = thinkingRes?.result?.message_id;
  if (!msgId) {
    await sendMessage(chatId, 'Failed to send thinking message.');
    return;
  }

  let fullText = '';
  let lastEditTime = 0;
  const EDIT_INTERVAL = 800; // ms between edits (avoid Telegram rate limits)
  let editTimer = null;

  function scheduleEdit() {
    if (editTimer) return;
    const now = Date.now();
    const wait = Math.max(0, EDIT_INTERVAL - (now - lastEditTime));
    editTimer = setTimeout(async () => {
      editTimer = null;
      if (fullText.trim()) {
        await editMessage(chatId, msgId, fullText);
        lastEditTime = Date.now();
      }
    }, wait);
  }

  const messages = [...getHistory(chatId)];
  let toolRound = 0;
  const MAX_TOOL_ROUNDS = 8;

  try {
    while (toolRound <= MAX_TOOL_ROUNDS) {
      toolRound++;

      // Stream the response
      const stream = client.messages.stream({
        model,
        max_tokens: model === HAIKU_MODEL ? 1024 : 2048,
        system: SYSTEM_PROMPT,
        tools: TOOLS,
        messages,
      });

      let currentToolUses = [];
      let hasToolUse = false;

      for await (const event of stream) {
        if (event.type === 'content_block_delta') {
          if (event.delta.type === 'text_delta') {
            fullText += event.delta.text;
            scheduleEdit();
          }
        }
        if (event.type === 'content_block_start' && event.content_block?.type === 'tool_use') {
          hasToolUse = true;
        }
      }

      // Get the final message
      const finalMessage = await stream.finalMessage();

      // Collect tool uses from the response
      const toolBlocks = finalMessage.content.filter(b => b.type === 'tool_use');
      const textBlocks = finalMessage.content.filter(b => b.type === 'text').map(b => b.text).join('');

      if (toolBlocks.length === 0) {
        // No tools — we're done
        if (!fullText.trim() && textBlocks) fullText = textBlocks;
        break;
      }

      // Execute tools and show status
      const toolStatus = toolBlocks.map(t => `_→ ${t.name.replace('jarvis_', '')}..._`).join('\n');
      await editMessage(chatId, msgId, (fullText || '') + '\n' + toolStatus);
      await sendChatAction(chatId, 'typing');

      // Execute all tool calls in parallel
      const toolResults = await Promise.all(
        toolBlocks.map(async (tool) => {
          const result = await executeTool(tool.name, tool.input);
          return {
            type: 'tool_result',
            tool_use_id: tool.id,
            content: JSON.stringify(result).substring(0, 20000),
          };
        })
      );

      // Add assistant message + tool results to conversation
      messages.push({ role: 'assistant', content: finalMessage.content });
      messages.push({ role: 'user', content: toolResults });

      // Clear the tool status from display
      if (fullText.trim()) {
        await editMessage(chatId, msgId, fullText + '\n_Processing..._');
      }
    }

    // Final edit with complete text
    if (editTimer) { clearTimeout(editTimer); editTimer = null; }

    if (fullText.trim()) {
      await editMessage(chatId, msgId, fullText);
    } else {
      await editMessage(chatId, msgId, 'No response generated.');
    }

    // Save assistant response to history
    addToHistory(chatId, 'assistant', fullText || 'No response.');

    // Log to episodic memory
    try {
      db.prepare('INSERT INTO conversations (role, content) VALUES (?,?)').run('user', userMessage);
      if (fullText.trim()) db.prepare('INSERT INTO conversations (role, content) VALUES (?,?)').run('assistant', fullText.trim());
    } catch {}

  } catch (e) {
    console.error('[telegram] streamConversation error:', e.message);
    if (editTimer) { clearTimeout(editTimer); editTimer = null; }
    const errorText = fullText
      ? fullText + `\n\n_Error: ${e.message}_`
      : `Error: ${e.message}`;
    await editMessage(chatId, msgId, errorText);
  }
}

// ── Slash Command Handlers (fast, no Claude needed) ──────────────────────────

async function handleCommand(cmd, chatId) {
  const commands = {
    '/start': () => sendMessage(chatId, `*JARVIS v2 Online.*\nStreaming mode active. Send anything.\n\n/brief — Morning briefing\n/status — System status\n/sat — SAT status\n/gametime — Startup sprint\n/cal — Today's calendar\n/score — Life score\n/health — Health stats\n/standup — Daily standup\n/week — Weekly report\n/habits — Habit tracker\n/uni — University deadlines\n/crm — Gametime CRM\n/read — Reading list\n/meals — Today's nutrition\n/research <query> — Web research\n/task <desc> — Background task\n/help — All commands`),

    '/help': () => sendMessage(chatId, `*Commands:*\n/brief — Morning briefing\n/status — System status\n/sat — SAT drill status\n/gametime — Sprint tracker\n/cal — Today's calendar\n/score — Life score\n/health — Health stats\n/news — Headlines\n/standup — Daily standup\n/week — Weekly report\n/habits — Habit tracker\n/uni — Uni deadlines\n/crm — Gametime CRM\n/read — Reading list\n/meals — Nutrition log\n/email — Inbox triage\n/spend — Monthly spending\n/mood — Emotional trends\n/research <query> — Deep research\n/task <desc> — Background task\n\nOr just message naturally — JARVIS streams back instantly.`),

    '/brief': async () => {
      await sendChatAction(chatId, 'typing');
      const r = await routeGet('/briefing/morning').catch(() => null);
      return sendMessage(chatId, r?.briefing || 'Briefing unavailable — server may be down.');
    },

    '/status': async () => {
      const r = await routeGet('/status/full').catch(() => null);
      if (!r) return sendMessage(chatId, 'Server unreachable.');
      return sendMessage(chatId, `*JARVIS v2 Status*\nUptime: ${Math.floor(r.uptime_s / 60)}m\nMemory: ${r.memory_mb}MB\nRoutes: ${r.routes?.length || '?'} active\nBreakers: ${r.circuit_breakers?.length || 0} tripped`);
    },

    '/sat': async () => {
      await sendChatAction(chatId, 'typing');
      const r = await routeGet('/sat/status').catch(() => null);
      if (!r) return sendMessage(chatId, 'SAT data unavailable.');
      const stale = r.stale ? ' ⚠️ STALE' : '';
      return sendMessage(chatId, `*SAT Status*\nDays since last session: ${r.daysSinceLast ?? '?'}${stale}\nSessions this week: ${r.sessionsThisWeek ?? 0}\nWeak areas: ${r.weakAreas || 'none logged'}`);
    },

    '/gametime': async () => {
      await sendChatAction(chatId, 'typing');
      const [s, a] = await Promise.all([
        routeGet('/gametime/status').catch(() => null),
        routeGet('/gametime/advice').catch(() => null),
      ]);
      if (!s) return sendMessage(chatId, 'Gametime data unavailable.');
      return sendMessage(chatId, `*Gametime Sprint*\n${s.users}/20 families · ${s.daysLeft}d left\nPace: ${s.paceStatus?.toUpperCase()}\nExpected: ${Math.round(s.expectedPace)}\n\n${a?.advice || ''}`);
    },

    '/cal': async () => {
      await sendChatAction(chatId, 'typing');
      const r = await routeGet('/calendar/today').catch(() => null);
      const events = Array.isArray(r) ? r : (r?.events || []);
      if (!events.length) return sendMessage(chatId, 'No events today.');
      const lines = events.map(e => {
        const time = e.start?.dateTime ? new Date(e.start.dateTime).toLocaleTimeString('en-SG', { hour: '2-digit', minute: '2-digit' }) : 'All day';
        return `• ${time} — ${e.summary || e.title || 'Event'}`;
      });
      return sendMessage(chatId, `*Today's Calendar*\n${lines.join('\n')}`);
    },

    '/score': async () => {
      await sendChatAction(chatId, 'typing');
      const r = await routeGet('/life-score/current').catch(() => null);
      if (!r) return sendMessage(chatId, 'Score unavailable.');
      return sendMessage(chatId, `*Life Score: ${r.score}/${r.max} — Grade ${r.grade}*`);
    },

    '/health': async () => {
      await sendChatAction(chatId, 'typing');
      const r = await routeGet('/shortcuts/health/today').catch(() => null);
      if (!r || r.error) return sendMessage(chatId, 'No health data today.');
      const lines = Object.entries(r).filter(([k, v]) => v != null && !['id', 'date', 'created_at'].includes(k)).map(([k, v]) => `• ${k}: ${v}`);
      return sendMessage(chatId, `*Health Today*\n${lines.join('\n') || 'No data yet.'}`);
    },

    '/news': async () => {
      await sendChatAction(chatId, 'typing');
      const r = await routeGet('/news/latest?limit=5').catch(() => null);
      const items = Array.isArray(r) ? r : [];
      if (!items.length) return sendMessage(chatId, 'No news available.');
      const lines = items.slice(0, 5).map((n, i) => `${i + 1}. ${n.title}`);
      return sendMessage(chatId, `*Headlines*\n${lines.join('\n')}`);
    },

    '/email': async () => {
      await sendChatAction(chatId, 'typing');
      const r = await routeGet('/gmail/unread').catch(() => null);
      const emails = Array.isArray(r) ? r : [];
      if (!emails.length) return sendMessage(chatId, 'Inbox clear.');
      const lines = emails.slice(0, 5).map(e => `• *${e.from?.split('<')[0]?.trim() || 'Unknown'}*: ${e.subject || 'No subject'}`);
      return sendMessage(chatId, `*Unread (${emails.length})*\n${lines.join('\n')}${emails.length > 5 ? `\n...and ${emails.length - 5} more` : ''}`);
    },

    '/spend': async () => {
      await sendChatAction(chatId, 'typing');
      const r = await routeGet('/finance/summary?period=month').catch(() => null);
      if (!r) return sendMessage(chatId, 'Finance data unavailable.');
      const cats = (r.by_category || []).map(c => `• ${c.category}: $${c.total}`).join('\n');
      return sendMessage(chatId, `*Monthly Spending: $${r.total}*\n${cats || 'No expenses logged.'}`);
    },

    '/mood': async () => {
      await sendChatAction(chatId, 'typing');
      const r = await routeGet('/emotional/trends').catch(() => null);
      if (!r) return sendMessage(chatId, 'Mood data unavailable.');
      return sendMessage(chatId, `*Mood Trends (14d)*\nAvg mood: ${r.avgMood ?? 'N/A'}/10\nAvg stress: ${r.avgStress ?? 'N/A'}/10\nEntries: ${r.logs?.length ?? 0}\n\n${r.insight || ''}`);
    },

    '/habits': async () => {
      await sendChatAction(chatId, 'typing');
      const r = await routeGet('/habits').catch(() => null);
      if (!r || r.error) return sendMessage(chatId, 'No habits tracked yet. Say "add habit: [name]" to start.');
      const habits = Array.isArray(r) ? r : [];
      if (!habits.length) return sendMessage(chatId, 'No habits yet. Add one by saying "track habit: daily meditation"');
      const lines = habits.map(h => `${h.done_today ? '✓' : '○'} *${h.name}* — streak: ${h.streak}d`);
      return sendMessage(chatId, `*Habits*\n${lines.join('\n')}`);
    },

    '/uni': async () => {
      await sendChatAction(chatId, 'typing');
      const r = await routeGet('/uni/countdown').catch(() => null);
      if (!r || r.error) return sendMessage(chatId, 'No university deadlines tracked.');
      const { total, upcoming_30_days, deadlines_sorted } = r;
      if (!total) return sendMessage(chatId, 'No deadlines yet. Add one: "uni deadline: [school] [date]"');
      const lines = (deadlines_sorted || []).slice(0, 5).map(d => {
        const urgency = d.days_left < 0 ? '🔴 OVERDUE' : d.days_left <= 14 ? '🟡 URGENT' : '🟢';
        return `${urgency} *${d.school}* — ${d.days_left >= 0 ? `${d.days_left}d left` : `${Math.abs(d.days_left)}d ago`}`;
      });
      return sendMessage(chatId, `*University Deadlines*\n${lines.join('\n')}\n\n${upcoming_30_days} due in next 30 days.`);
    },

    '/crm': async () => {
      await sendChatAction(chatId, 'typing');
      const r = await routeGet('/crm/pipeline').catch(() => null);
      if (!r || r.error) return sendMessage(chatId, 'CRM unavailable.');
      const s = r.by_status || {};
      const overdue = r.overdue_followups?.length || 0;
      return sendMessage(chatId, `*Gametime CRM*\nTotal: ${r.total} contacts\n\n• Prospects: ${s.prospect || 0}\n• Contacted: ${s.contacted || 0}\n• Interested: ${s.interested || 0}\n• Beta users: ${s.beta_user || 0}\n• Declined: ${s.declined || 0}\n\nConversion: ${r.conversion_rate ? Math.round(r.conversion_rate * 100) + '%' : 'N/A'}\nOverdue follow-ups: ${overdue}`);
    },

    '/read': async () => {
      await sendChatAction(chatId, 'typing');
      const r = await routeGet('/reading-list?status=reading').catch(() => null);
      const reading = Array.isArray(r) ? r : [];
      const unread = await routeGet('/reading-list?status=unread').catch(() => []);
      const unreadList = Array.isArray(unread) ? unread : [];
      const lines = [
        reading.length ? `*Currently reading:*\n${reading.slice(0,3).map(b => `• ${b.title}`).join('\n')}` : '',
        unreadList.length ? `\n*Up next:*\n${unreadList.slice(0,3).map(b => `• ${b.title}`).join('\n')}` : '',
      ].filter(Boolean);
      return sendMessage(chatId, lines.join('') || 'Reading list empty. Add a book: "add to reading list: [title]"');
    },

    '/meals': async () => {
      await sendChatAction(chatId, 'typing');
      const r = await routeGet('/meals/today').catch(() => null);
      if (!r || r.error) return sendMessage(chatId, 'No meals logged today.');
      const meals = r.meals || [];
      if (!meals.length) return sendMessage(chatId, 'No meals logged today.');
      const lines = meals.map(m => `• *${m.meal_type}*: ${m.description}${m.calories ? ` (${m.calories} kcal)` : ''}`);
      return sendMessage(chatId, `*Today's Meals*\n${lines.join('\n')}\n\nTotal: ${r.total_calories || 0} kcal | Protein: ${r.total_protein_g || 0}g`);
    },

    '/standup': async () => {
      await sendChatAction(chatId, 'typing');
      const [gametime, sat, habits, cal] = await Promise.all([
        routeGet('/gametime/status').catch(() => null),
        routeGet('/sat/status').catch(() => null),
        routeGet('/habits').catch(() => null),
        routeGet('/calendar/today').catch(() => null),
      ]);
      const events = Array.isArray(cal) ? cal : (cal?.events || []);
      const habitList = Array.isArray(habits) ? habits : [];
      const doneTodayCount = habitList.filter(h => h.done_today).length;
      const lines = [
        `*Daily Standup — ${new Date().toLocaleDateString('en-SG', { timeZone: 'Asia/Singapore', weekday: 'long', month: 'short', day: 'numeric' })}*`,
        '',
        `*Gametime:* ${gametime?.users ?? '?'}/20 · Pace: ${gametime?.paceStatus ?? '?'}`,
        `*SAT:* ${sat?.daysSinceLast ?? '?'}d since last session${sat?.stale ? ' ⚠️' : ''}`,
        `*Habits:* ${doneTodayCount}/${habitList.length} done`,
        `*Calendar:* ${events.length ? events.slice(0,3).map(e => e.summary || e.title).join(', ') : 'clear'}`,
      ];
      return sendMessage(chatId, lines.join('\n'));
    },

    '/pomodoro': () => sendMessage(chatId, `*Pomodoro*\nUsage:\n• /pomo start [task] — 25min focus session\n• /pomo status — time remaining\n• /pomo stop — cancel\n\nOr just say "start a pomodoro for [task]" and I'll handle it.`),

    '/week': async () => {
      await sendChatAction(chatId, 'typing');
      const [score, sat, gametime, spend] = await Promise.all([
        routeGet('/life-score/current').catch(() => null),
        routeGet('/sat/status').catch(() => null),
        routeGet('/gametime/status').catch(() => null),
        routeGet('/finance/summary?period=week').catch(() => null),
      ]);
      const lines = [
        `*Weekly Report*`,
        '',
        `Life score: ${score?.score ?? '?'}/${score?.max ?? 82} (${score?.grade ?? '?'})`,
        `SAT: ${sat?.sessionsThisWeek ?? 0} sessions this week${sat?.stale ? ' ⚠️ stale' : ''}`,
        `Gametime: ${gametime?.users ?? '?'}/20 families · ${gametime?.paceStatus ?? '?'} pace`,
        `Spend this week: $${spend?.total ?? 0}`,
      ];
      return sendMessage(chatId, lines.join('\n'));
    },
  };

  return commands[cmd]?.() ?? null;
}

// ── Background Task System ───────────────────────────────────────────────────

async function createBackgroundTask(chatId, description) {
  try {
    // Use Claude to break down the task
    const breakdown = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 500,
      messages: [{
        role: 'user',
        content: `Break this task into 2-5 concrete steps. Return ONLY a JSON array of strings, no markdown.\n\nTask: "${description}"`,
      }],
    });

    let steps;
    try {
      const raw = breakdown.content[0].text.match(/\[[\s\S]*\]/)?.[0];
      steps = JSON.parse(raw || '[]');
    } catch { steps = [description]; }

    const result = db.prepare(
      'INSERT INTO telegram_tasks (chat_id, description, steps, status) VALUES (?,?,?,?)'
    ).run(chatId, description, JSON.stringify(steps), 'running');

    const taskId = result.lastInsertRowid;

    await sendMessage(chatId, `*Task #${taskId} created*\n${description}\n\n*Steps:*\n${steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}\n\n_Working in background. I'll notify you when done._`);

    // Execute in background
    processBackgroundTask(taskId, chatId, description, steps).catch(e => {
      console.error(`[telegram] Background task ${taskId} failed:`, e.message);
    });

    return true;
  } catch (e) {
    await sendMessage(chatId, `Failed to create task: ${e.message}`);
    return false;
  }
}

async function processBackgroundTask(taskId, chatId, description, steps) {
  const results = [];

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    try {
      // Update progress
      db.prepare('UPDATE telegram_tasks SET progress = ?, updated_at = datetime(\'now\') WHERE id = ?')
        .run(`Step ${i + 1}/${steps.length}: ${step}`, taskId);

      // Execute step via Claude with tools
      const msg = await client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 1500,
        system: SYSTEM_PROMPT,
        tools: TOOLS,
        messages: [{
          role: 'user',
          content: `Execute this step for a background task. Use tools as needed. Be concise.\n\nOverall task: "${description}"\nCurrent step: "${step}"`,
        }],
      });

      // Handle tool calls
      let stepMessages = [{ role: 'assistant', content: msg.content }];
      let currentMsg = msg;

      while (currentMsg.stop_reason === 'tool_use') {
        const toolBlocks = currentMsg.content.filter(b => b.type === 'tool_use');
        const toolResults = await Promise.all(
          toolBlocks.map(async (tool) => ({
            type: 'tool_result',
            tool_use_id: tool.id,
            content: JSON.stringify(await executeTool(tool.name, tool.input)).substring(0, 15000),
          }))
        );

        stepMessages.push({ role: 'user', content: toolResults });
        currentMsg = await client.messages.create({
          model: 'claude-sonnet-4-6',
          max_tokens: 1500,
          system: SYSTEM_PROMPT,
          tools: TOOLS,
          messages: [
            { role: 'user', content: `Execute this step: "${step}" for task: "${description}"` },
            ...stepMessages,
          ],
        });
        stepMessages.push({ role: 'assistant', content: currentMsg.content });
      }

      const stepResult = currentMsg.content.filter(b => b.type === 'text').map(b => b.text).join('');
      results.push(`*Step ${i + 1}:* ${stepResult || 'Done.'}`);

    } catch (e) {
      results.push(`*Step ${i + 1}:* Error — ${e.message}`);
    }
  }

  // Final result
  const finalResult = results.join('\n\n');
  db.prepare('UPDATE telegram_tasks SET status = ?, result = ?, updated_at = datetime(\'now\') WHERE id = ?')
    .run('completed', finalResult, taskId);

  await sendMessage(chatId, `*Task #${taskId} Complete*\n_${description}_\n\n${finalResult}`);
}

// ── Message Router ───────────────────────────────────────────────────────────

async function handleMessage(msg) {
  const chatId = String(msg.chat.id);
  const text   = msg.text?.trim();
  const userId = String(msg.from?.id);

  // Security: only respond to Rehan
  if (userId !== String(CHAT_ID)) {
    return sendMessage(chatId, 'Unauthorised.');
  }

  if (!text) return;

  // /research <query>
  if (text.startsWith('/research ')) {
    const query = text.slice(10).trim();
    if (!query) return sendMessage(chatId, 'Usage: /research <topic>');
    return streamConversation(chatId, `Do deep web research on: ${query}. Use the jarvis_research tool with depth "deep".`);
  }

  // /task <description> — background task
  if (text.startsWith('/task ')) {
    const desc = text.slice(6).trim();
    if (!desc) return sendMessage(chatId, 'Usage: /task <description of what to do>');
    return createBackgroundTask(chatId, desc);
  }

  // /tasks — list background tasks
  if (text === '/tasks') {
    const tasks = db.prepare('SELECT id, description, status, progress FROM telegram_tasks ORDER BY created_at DESC LIMIT 5').all();
    if (!tasks.length) return sendMessage(chatId, 'No background tasks.');
    const lines = tasks.map(t => `#${t.id} [${t.status}] ${t.description.slice(0, 50)}${t.progress ? `\n   → ${t.progress}` : ''}`);
    return sendMessage(chatId, `*Background Tasks*\n${lines.join('\n')}`);
  }

  // /pomo start [task] — pomodoro timer
  if (text.startsWith('/pomo start') || text.startsWith('/pomo start ')) {
    const task = text.slice(11).trim() || 'Focus session';
    const durationMin = 25;
    try {
      db.prepare('INSERT INTO pomodoro_sessions (task, duration_min, started_at) VALUES (?,?,datetime("now"))').run(task, durationMin);
      await sendMessage(chatId, `*Pomodoro started*\n${task}\n25 minutes. Phone down. Go.`);
      // Notify when done
      setTimeout(async () => {
        try {
          db.prepare('UPDATE pomodoro_sessions SET completed = 1, ended_at = datetime("now") WHERE ended_at IS NULL ORDER BY id DESC LIMIT 1').run();
        } catch {}
        await telegramNotify('JARVIS — Pomodoro', `Done. Take a 5-minute break. Task: ${task}`);
      }, durationMin * 60 * 1000);
    } catch (e) {
      await sendMessage(chatId, `Pomodoro error: ${e.message}`);
    }
    return;
  }

  // /pomo status
  if (text === '/pomo status' || text === '/pomo') {
    const session = db.prepare('SELECT * FROM pomodoro_sessions WHERE completed = 0 AND ended_at IS NULL ORDER BY id DESC LIMIT 1').get();
    if (!session) return sendMessage(chatId, 'No active pomodoro. Start one: /pomo start [task]');
    const elapsed = Math.floor((Date.now() - new Date(session.started_at + 'Z').getTime()) / 60000);
    const remaining = Math.max(0, session.duration_min - elapsed);
    return sendMessage(chatId, `*Pomodoro Active*\nTask: ${session.task}\n${remaining}m remaining`);
  }

  // /pomo stop
  if (text === '/pomo stop') {
    db.prepare('UPDATE pomodoro_sessions SET completed = 0, ended_at = datetime("now") WHERE ended_at IS NULL').run();
    return sendMessage(chatId, 'Pomodoro cancelled.');
  }

  // Slash commands (fast, direct route calls)
  if (text.startsWith('/')) {
    const cmd = text.split(' ')[0].toLowerCase();
    const handled = await handleCommand(cmd, chatId);
    if (handled) return;
    // Unknown command → fall through to Claude
  }

  // Free-form → stream Claude conversation with tools
  await sendChatAction(chatId, 'typing');
  return streamConversation(chatId, text);
}

// ── Long-Polling Loop ────────────────────────────────────────────────────────

let offset = 0;
let running = false;

async function poll() {
  if (!BOT_TOKEN || !CHAT_ID) {
    console.log('[telegram] TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not set — bot disabled');
    return;
  }

  running = true;
  console.log('[telegram] Bot v2 started — direct Anthropic streaming, no OpenClaw');

  // Startup notification
  await telegramNotify('JARVIS Online', 'Streaming mode active. Send /start to begin.');

  while (running) {
    try {
      const res = await fetch(`${API}/getUpdates?offset=${offset}&timeout=25&allowed_updates=["message"]`, {
        signal: AbortSignal.timeout(35000),
      });
      const data = await res.json();

      if (data.ok && data.result?.length > 0) {
        for (const update of data.result) {
          offset = update.update_id + 1;
          if (update.message) {
            // Handle messages without blocking the poll loop
            handleMessage(update.message).catch(e =>
              console.error('[telegram] handleMessage error:', e.message)
            );
          }
        }
      }
    } catch (e) {
      if (!e.message?.includes('abort') && !e.message?.includes('timeout')) {
        console.error('[telegram] Poll error:', e.message);
      }
      await new Promise(r => setTimeout(r, 2000));
    }
  }
}

function stopBot() { running = false; }

module.exports = { poll, stopBot, telegramNotify };
