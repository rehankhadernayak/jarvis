# 08 — Active Context Awareness (HIGH)

## The problem
JARVIS doesn't know what Rehan is doing right now.
If he's in Xcode working on Gametime, JARVIS should be in Gametime mode.
If he's on YouTube at 11pm, JARVIS should call him out.

## Active App Monitor
Every 60s: `lsappinfo list` → extract frontmost app + window title
Store in memory: `current_app`, `current_window_title`, `app_last_changed`

Behavior changes by context:
- VSCode/Xcode/Cursor → developer mode, ready to help with code
- Safari/Chrome → reading mode, can summarize current page if asked
- YouTube at 11pm → "It's 11:07. That's enough YouTube."
- Notes/Pages → writing mode, essay coach available

## Screen Context (every 5min)
Screenshot → Claude vision → extract:
- What task is in progress?
- Any errors or warnings visible?
- Is Rehan on-task based on current priorities?

Store as `screen_context` in memory.
Inject into every conversation: "[Currently working on: Gametime booking screen in Xcode]"

## Focus Mode Detection
Detect deep work: same app for > 20min without switching
- Hold non-urgent notifications
- Don't interrupt unless deadline-critical
- Log focus session: app, duration, outcome

## Anti-distraction
Pattern detection:
- Rapid app switching = distracted
- Social media during study hours = flag
- "Rehan, you've switched apps 8 times in 10 minutes. Are you stuck on something?"
