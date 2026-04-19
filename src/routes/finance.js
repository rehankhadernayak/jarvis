const express = require('express');
const router = express.Router();
const { db } = require('../db/init');
const Anthropic = require('@anthropic-ai/sdk');

const HAIKU = 'claude-haiku-4-5-20251001';

// POST /finance/expense — Log an expense
router.post('/expense', (req, res) => {
  try {
    const { amount, category, description = null, date = null } = req.body;

    if (amount === undefined || amount === null) {
      return res.status(400).json({ error: 'amount is required' });
    }
    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      return res.status(400).json({ error: 'amount must be a positive number' });
    }
    if (!category || typeof category !== 'string' || category.trim().length === 0) {
      return res.status(400).json({ error: 'category is required' });
    }

    const expenseDate = date || new Date().toISOString().split('T')[0];

    const result = db.prepare(
      `INSERT INTO expenses (amount, category, description, date) VALUES (?, ?, ?, ?)`
    ).run(parsedAmount, category.trim(), description || null, expenseDate);

    const saved = db.prepare('SELECT * FROM expenses WHERE id = ?').get(result.lastInsertRowid);
    return res.status(201).json(saved);
  } catch (err) {
    console.error('[finance/expense POST]', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// GET /finance/summary?period=week|month|all
router.get('/summary', (req, res) => {
  try {
    const { period = 'month' } = req.query;

    let dateFilter = '';
    if (period === 'week') {
      dateFilter = `AND date >= date('now', '-7 days')`;
    } else if (period === 'month') {
      dateFilter = `AND date >= date('now', '-30 days')`;
    }
    // 'all' has no date filter

    const totalRow = db.prepare(
      `SELECT COALESCE(SUM(amount), 0) as total FROM expenses WHERE 1=1 ${dateFilter}`
    ).get();

    const byCategory = db.prepare(
      `SELECT category, ROUND(SUM(amount), 2) as total, COUNT(*) as count
       FROM expenses
       WHERE 1=1 ${dateFilter}
       GROUP BY category
       ORDER BY total DESC`
    ).all();

    const recent = db.prepare(
      `SELECT * FROM expenses WHERE 1=1 ${dateFilter} ORDER BY created_at DESC LIMIT 10`
    ).all();

    return res.json({
      period,
      total: parseFloat(totalRow.total.toFixed(2)),
      by_category: byCategory,
      recent,
    });
  } catch (err) {
    console.error('[finance/summary]', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// GET /finance/insights — Claude-powered spending analysis
router.get('/insights', async (req, res) => {
  try {
    const rows = db.prepare(
      `SELECT category, ROUND(SUM(amount), 2) as total, COUNT(*) as count
       FROM expenses
       WHERE date >= date('now', '-30 days')
       GROUP BY category
       ORDER BY total DESC`
    ).all();

    const totalRow = db.prepare(
      `SELECT COALESCE(SUM(amount), 0) as total FROM expenses WHERE date >= date('now', '-30 days')`
    ).get();

    const totalSpent = parseFloat(totalRow.total.toFixed(2));
    const topCategory = rows.length > 0 ? rows[0].category : 'none';

    if (rows.length === 0) {
      return res.json({
        total_spent: 0,
        top_category: 'none',
        insight: 'No expenses recorded in the last 30 days.',
        suggestion: 'Start logging your expenses to get personalized insights.',
      });
    }

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const systemPrompt = `You are a personal finance advisor. Analyze the user's spending data from the last 30 days.
Return ONLY a valid JSON object with exactly these fields:
{
  "insight": "<one clear, specific observation about their spending pattern>",
  "suggestion": "<one concrete, actionable suggestion to improve their finances>"
}
Be direct, specific, and use the actual numbers from the data. Return ONLY valid JSON, no markdown.`;

    const spendingBreakdown = rows
      .map((r) => `${r.category}: $${r.total} (${r.count} transaction${r.count !== 1 ? 's' : ''})`)
      .join('\n');

    const userPrompt = `My spending for the last 30 days:
Total: $${totalSpent}

Breakdown by category:
${spendingBreakdown}

Give me one insight and one suggestion.`;

    const message = await client.messages.create({
      model: HAIKU,
      max_tokens: 512,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const rawText = message.content[0].text.trim();
    let parsed;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return res.status(500).json({ error: 'Failed to parse Claude response' });
      parsed = JSON.parse(jsonMatch[0]);
    }

    return res.json({
      total_spent: totalSpent,
      top_category: topCategory,
      insight: parsed.insight,
      suggestion: parsed.suggestion,
    });
  } catch (err) {
    console.error('[finance/insights]', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// DELETE /finance/expense/:id
router.delete('/expense/:id', (req, res) => {
  try {
    const { id } = req.params;

    const existing = db.prepare('SELECT id FROM expenses WHERE id = ?').get(id);
    if (!existing) {
      return res.status(404).json({ error: 'Expense not found' });
    }

    db.prepare('DELETE FROM expenses WHERE id = ?').run(id);
    return res.json({ ok: true, deleted_id: parseInt(id, 10) });
  } catch (err) {
    console.error('[finance/expense DELETE]', err.message);
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
