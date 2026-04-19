# 06 — Episodic Memory + Decision Logger (MEDIUM)

## The problem
LanceDB is there but it's auto-capturing OpenClaw sessions.
JARVIS doesn't explicitly remember: "on April 3 you said you'd finish the signup flow by Friday."
It doesn't track decisions or follow up on them.

## Episodic Memory
- Every conversation: extract key facts, decisions, commitments, goals
- Store in LanceDB with timestamp + category tags
- On next conversation: auto-recall relevant episodes
- Example: "Last Thursday you were debugging the Gametime payment flow. Did you fix it?"

## Decision Logger
Route: POST /memory/decision
Fields: { decision, options_considered, reasoning, expected_outcome, review_date }

Weekly: JARVIS reviews decisions made 7-30 days ago
- "You decided to prioritize beta users over feature polish. Are you still on track?"
- Tracks if outcome matched expectation

## Commitment Tracker
When JARVIS or Rehan says "I'll do X by Y":
- Extract commitment automatically via Claude
- Store with deadline
- Follow up at deadline: "Did you finish X?"
- If not done: escalate, add to next day priorities

## Implementation
- Add to OpenClaw system prompt: "After each conversation, extract and log any commitments, decisions, or important facts."
- Webhook: after each conversation ends, process the transcript
- Store structured data in `episodes` table
