# 07 — Web Research Agent (MEDIUM)

## What it does
Deep research on any topic. Not just a web search — a synthesized report.
Like Perplexity but integrated into JARVIS with your context.

## How it works
1. User: "JARVIS, research best strategies to get 20 sports app beta users in Singapore"
2. JARVIS spawns a research agent:
   - 5-10 DuckDuckGo searches with varied queries
   - Fetches and reads top 3 results per query
   - Synthesizes with Claude claude-sonnet-4-6
   - Cross-references with Rehan's specific context (Gametime, Singapore, 16yo founder)
3. Returns: structured report with sources, key takeaways, specific action items for Rehan

## Route
POST /research/query
Body: { query, depth: 'quick'|'deep', context?: string }

## Modes
- Quick (30s): 3 searches, summary answer
- Deep (2-3min): 10 searches, full report with sections + citations

## Integration with JARVIS chat
When JARVIS detects a research-worthy question mid-conversation:
- Automatically triggers research
- "Let me look that up properly..." → runs research → returns synthesized answer
- Cites sources inline

## Use cases for Rehan
- "What are Singapore sports associations I should partner with for Gametime?"
- "What ML papers came out this week on transformers?"
- "What's the best way to study for SAT transition words?"
- "What are competitors to Gametime?"
