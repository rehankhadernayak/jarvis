// JARVIS Browser Extension — Service Worker
// Handles messages from content.js and relays them to localhost:3001

const BASE = 'http://localhost:3001';

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'PAGE_CONTEXT') {
    handlePageContext(msg).then(sendResponse).catch(err => sendResponse({ error: err.message }));
    return true; // keep channel open for async response
  }

  if (msg.type === 'QUICK_RESEARCH') {
    handleQuickResearch(msg).then(sendResponse).catch(err => sendResponse({ error: err.message }));
    return true;
  }

  if (msg.type === 'OPEN_POPUP') {
    // content.js badge click — open popup if API available
    if (chrome.action && chrome.action.openPopup) {
      chrome.action.openPopup().catch(() => {});
    }
    sendResponse({ ok: true });
  }
});

async function handlePageContext({ url, title, selectedText }) {
  try {
    const payload = {
      key: 'active_browser_page',
      value: JSON.stringify({ url, title, selectedText: selectedText || '', ts: Date.now() })
    };
    const res = await fetch(`${BASE}/memory/set`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json().catch(() => ({}));
    return { ok: true, data };
  } catch (err) {
    console.warn('[JARVIS bg] PAGE_CONTEXT failed:', err.message);
    return { ok: false, error: err.message };
  }
}

async function handleQuickResearch({ query }) {
  try {
    const res = await fetch(`${BASE}/research/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, depth: 'quick' })
    });
    const data = await res.json().catch(() => ({}));
    return { ok: true, data };
  } catch (err) {
    console.warn('[JARVIS bg] QUICK_RESEARCH failed:', err.message);
    return { ok: false, error: err.message };
  }
}
