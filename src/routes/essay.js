const express = require('express');
const router = express.Router();
const Anthropic = require('@anthropic-ai/sdk');

const SONNET = 'claude-sonnet-4-6';

const ESSAY_PROMPTS = {
  ib: [
    'To what extent does language shape thought? Discuss with reference to at least two areas of knowledge.',
    'Is certainty ever justified in the pursuit of knowledge? Explore using examples from mathematics and the natural sciences.',
    '"The knower\'s perspective is essential in the pursuit of knowledge." Discuss this claim with reference to two areas of knowledge.',
    'How does the methodology used in one area of knowledge help us judge the claims made in another? Discuss with examples.',
    'Can we have beliefs or knowledge that are independent of our culture? Examine this question with reference to two areas of knowledge.',
  ],
  sat: [
    'Write an essay in which you explain how the author builds an argument to persuade their audience that urban green spaces are essential to mental health.',
    'Analyze how a speaker uses rhetorical strategies to argue that standardized testing fails to measure true academic potential.',
    'Explain how the author uses evidence, reasoning, and stylistic elements to argue that social media has reshaped human connection.',
    'Write an essay explaining how the author argues that the traditional school day should be restructured to match adolescent sleep cycles.',
    'Analyze the rhetorical choices an author makes to argue that public libraries remain vital institutions in the digital age.',
  ],
  college: [
    'Describe a challenge you have faced and what you learned from it. (CommonApp Prompt 2)',
    'Reflect on something that someone has done for you that has made you happy or thankful in a surprising way. (CommonApp Prompt 5)',
    'Describe a topic, idea, or concept you find so engaging that it makes you lose all track of time. Why does it captivate you? (CommonApp Prompt 4)',
    'Share an essay on any topic of your choice — it can be one you have already written, one that responds to a different prompt, or one of your own design.',
    'Some students have a background, identity, interest, or talent that is so meaningful they believe their application would be incomplete without it. Share your story.',
  ],
  general: [
    'Discuss a time when you had to make a difficult decision with incomplete information. What was the outcome?',
    'What is the most important problem facing your generation, and what can be done about it?',
    'Describe a moment when you changed your mind about something significant. What caused the shift?',
    'What does leadership mean to you, and describe a moment when you demonstrated it.',
    'If you could redesign one aspect of modern education, what would it be and why?',
  ],
};

// POST /essay/analyze
router.post('/analyze', async (req, res) => {
  try {
    const { text, type = 'general' } = req.body;
    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      return res.status(400).json({ error: 'text is required' });
    }

    const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const systemPrompt = `You are an expert essay coach specializing in ${type.toUpperCase()} essays.
Analyze the provided essay rigorously and return a JSON object with exactly these fields:
{
  "score": <integer 0-10>,
  "thesis": "<assessment of the thesis clarity and strength>",
  "structure": "<assessment of the essay's organization and flow>",
  "argument": "<assessment of argumentation, evidence, and reasoning>",
  "style": "<assessment of writing style, voice, and tone>",
  "improvements": ["<specific actionable improvement 1>", "<specific actionable improvement 2>", "<specific actionable improvement 3>"]
}
Return ONLY valid JSON, no markdown, no extra text.`;

    const message = await client.messages.create({
      model: SONNET,
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: 'user', content: `Essay type: ${type}\n\nEssay text:\n${text}` }],
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
      score: parsed.score,
      thesis: parsed.thesis,
      structure: parsed.structure,
      argument: parsed.argument,
      style: parsed.style,
      improvements: parsed.improvements,
      wordCount,
    });
  } catch (err) {
    console.error('[essay/analyze]', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// POST /essay/improve
router.post('/improve', async (req, res) => {
  try {
    const { text, focus = 'concision' } = req.body;
    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      return res.status(400).json({ error: 'text is required' });
    }

    const originalWordCount = text.trim().split(/\s+/).filter(Boolean).length;
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const focusInstructions = {
      thesis: 'Sharpen the thesis statement — make it specific, arguable, and placed clearly at the end of the introduction.',
      conclusion: 'Rewrite the conclusion to synthesize arguments without simply repeating them, and end with a resonant final thought.',
      transitions: 'Improve paragraph transitions so each one logically connects to the next. Add transitional phrases and topic sentences where missing.',
      concision: 'Eliminate wordiness, redundancy, and weak filler phrases. Every word should earn its place.',
    };

    const instruction = focusInstructions[focus] || focusInstructions.concision;

    const systemPrompt = `You are an expert writing editor. Your task: ${instruction}
Return ONLY a valid JSON object with exactly these fields:
{
  "improved_text": "<the full improved essay>",
  "changes_made": ["<specific change description 1>", "<specific change description 2>", "<specific change description 3>"]
}
Return ONLY valid JSON, no markdown, no extra text.`;

    const message = await client.messages.create({
      model: SONNET,
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: 'user', content: `Focus: ${focus}\n\nOriginal essay:\n${text}` }],
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

    const newWordCount = (parsed.improved_text || '').trim().split(/\s+/).filter(Boolean).length;

    return res.json({
      original_word_count: originalWordCount,
      new_word_count: newWordCount,
      improved_text: parsed.improved_text,
      changes_made: parsed.changes_made,
    });
  } catch (err) {
    console.error('[essay/improve]', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// GET /essay/prompts?type=ib|sat|college|general
router.get('/prompts', (req, res) => {
  try {
    const { type = 'general' } = req.query;
    const prompts = ESSAY_PROMPTS[type];
    if (!prompts) {
      return res.status(400).json({ error: `Invalid type. Use: ${Object.keys(ESSAY_PROMPTS).join(', ')}` });
    }
    return res.json({ type, prompts });
  } catch (err) {
    console.error('[essay/prompts]', err.message);
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
