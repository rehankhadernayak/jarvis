const express = require('express');
const router = express.Router();
const Anthropic = require('@anthropic-ai/sdk');

const SONNET = 'claude-sonnet-4-6';

// POST /travel/plan
router.post('/plan', async (req, res) => {
  try {
    const { destination, start_date, end_date, budget = 'moderate', interests = [] } = req.body;
    if (!destination || !start_date || !end_date) {
      return res.status(400).json({ error: 'destination, start_date, and end_date are required' });
    }

    const start = new Date(start_date);
    const end = new Date(end_date);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD.' });
    }
    const durationDays = Math.max(1, Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1);

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const systemPrompt = `You are an expert travel planner. Generate a detailed travel itinerary.
Return ONLY a valid JSON object with exactly this structure:
{
  "itinerary": [
    {
      "day": <number>,
      "date": "<YYYY-MM-DD>",
      "morning": "<detailed morning activity description>",
      "afternoon": "<detailed afternoon activity description>",
      "evening": "<detailed evening activity description>",
      "tips": "<practical local tips for the day>"
    }
  ],
  "packing_list": ["<item1>", "<item2>"],
  "estimated_budget": "<breakdown of estimated costs>",
  "best_time_to_visit": "<best season/months and why>"
}
Return ONLY valid JSON, no markdown, no extra text.`;

    const interestStr = interests.length > 0 ? `Interests: ${interests.join(', ')}` : '';
    const userPrompt = `Destination: ${destination}
Start date: ${start_date}
End date: ${end_date}
Duration: ${durationDays} days
Budget level: ${budget}
${interestStr}

Create a day-by-day itinerary for all ${durationDays} days.`;

    const message = await client.messages.create({
      model: SONNET,
      max_tokens: 4096,
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
      destination,
      duration_days: durationDays,
      itinerary: parsed.itinerary,
      packing_list: parsed.packing_list,
      estimated_budget: parsed.estimated_budget,
      best_time_to_visit: parsed.best_time_to_visit,
    });
  } catch (err) {
    console.error('[travel/plan]', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// POST /travel/packing
router.post('/packing', async (req, res) => {
  try {
    const { destination, duration_days, activities = [] } = req.body;
    if (!destination || !duration_days) {
      return res.status(400).json({ error: 'destination and duration_days are required' });
    }

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const systemPrompt = `You are a travel packing expert. Generate a comprehensive categorized packing list.
Return ONLY a valid JSON object with exactly this structure:
{
  "categories": [
    {
      "name": "<category name>",
      "items": ["<item1>", "<item2>"]
    }
  ]
}
Include categories like: Documents & Money, Clothing, Toiletries, Electronics, Health & Safety, Activities-specific gear.
Return ONLY valid JSON, no markdown, no extra text.`;

    const activityStr = activities.length > 0 ? `Activities planned: ${activities.join(', ')}` : '';
    const userPrompt = `Destination: ${destination}
Trip duration: ${duration_days} days
${activityStr}

Generate a complete packing list organized by category.`;

    const message = await client.messages.create({
      model: SONNET,
      max_tokens: 2048,
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

    return res.json({ categories: parsed.categories });
  } catch (err) {
    console.error('[travel/packing]', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// GET /travel/ideas?interests=beach,food,history
router.get('/ideas', async (req, res) => {
  try {
    const { interests = '' } = req.query;
    const interestList = interests
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const systemPrompt = `You are a travel inspiration expert. Suggest exactly 5 travel destinations.
Return ONLY a valid JSON array with exactly 5 objects in this structure:
[
  {
    "name": "<city or region name>",
    "country": "<country name>",
    "why": "<specific reason this matches the interests>",
    "best_for": "<type of traveler or experience this suits>",
    "typical_cost": "<rough budget estimate per day in USD>"
  }
]
Return ONLY valid JSON, no markdown, no extra text.`;

    const userPrompt = interestList.length > 0
      ? `Suggest 5 travel destinations that match these interests: ${interestList.join(', ')}`
      : 'Suggest 5 diverse and interesting travel destinations for an adventurous traveler.';

    const message = await client.messages.create({
      model: SONNET,
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const rawText = message.content[0].text.trim();
    let parsed;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      const jsonMatch = rawText.match(/\[[\s\S]*\]/);
      if (!jsonMatch) return res.status(500).json({ error: 'Failed to parse Claude response' });
      parsed = JSON.parse(jsonMatch[0]);
    }

    return res.json(parsed);
  } catch (err) {
    console.error('[travel/ideas]', err.message);
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
