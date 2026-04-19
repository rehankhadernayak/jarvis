# JARVIS Browser Extension

JARVIS sidebar/popup for Chrome and Edge. Communicates with the JARVIS v2 server on `localhost:3001`.

---

## Prerequisites

JARVIS v2 server must be running on port 3001 before using the extension.

---

## Load in Chrome (Developer Mode)

1. Open Chrome and navigate to `chrome://extensions`
2. Enable **Developer mode** (toggle, top-right corner)
3. Click **Load unpacked**
4. Select this folder: `/Users/28rehank/Documents/jarvis-v2/browser-extension/`
5. The JARVIS extension appears in your toolbar

> Note: You need an `icon.png` (32x32) in this folder. See `icon-placeholder.txt` for design specs. Without it Chrome will show a blank icon but the extension will still work.

---

## Load in Edge

Same steps — Edge supports Chrome extensions via `edge://extensions`.

---

## Safari

Safari requires a conversion step via Xcode (`xcrun safari-web-extension-converter`). Not covered here — use Chrome/Edge for development.

---

## How to Use

### Toolbar popup
Click the JARVIS icon in the browser toolbar to open the 400x500 popup.

### Quick actions
| Button | What it does |
|--------|-------------|
| **SUMMARIZE PAGE** | Sends current page title + URL to JARVIS chat for a summary |
| **RESEARCH THIS** | Sends selected text (or page title) as a research query |
| **SAVE TO DOCS** | Saves current page URL + title to JARVIS memory |
| **JARVIS STATUS** | Fetches `/status/full` and shows uptime + memory usage |

### Chat
Type in the input box and press Enter (or click ↑) to send. Responses stream in real-time via SSE — identical to the main JARVIS web UI.

### Page badge
A small "J" orb appears fixed at the bottom-right of every page. Click it to open the popup.

### Keyboard shortcut
- **Mac**: `Cmd+Shift+J`
- **Windows/Linux**: `Ctrl+Shift+J`

---

## How it works

| File | Role |
|------|------|
| `manifest.json` | Manifest V3 config |
| `popup.html` | Main popup UI — chat + quick actions |
| `background.js` | Service worker — relays page context + research to localhost:3001 |
| `content.js` | Injected into every page — sends page context on load/selection, badge UI |

The extension POSTs to:
- `POST /chat` — SSE streaming chat
- `POST /memory/set` — save page context (`active_browser_page`) and docs
- `POST /research/search` — quick research
- `GET /status/full` — status check

All CORS is handled by `app.use(cors())` on the server side.

---

## Updating

After editing any file, go to `chrome://extensions` and click the **refresh** icon on the JARVIS card.
