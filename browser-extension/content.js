// JARVIS Browser Extension — Content Script
// Injected into all pages at document_idle

(function () {
  'use strict';

  // ── Page context: send on load ─────────────────────────────────────────────
  function sendPageContext(selectedText) {
    chrome.runtime.sendMessage({
      type: 'PAGE_CONTEXT',
      url: location.href,
      title: document.title,
      selectedText: selectedText || ''
    }).catch(() => {}); // ignore if background is unavailable
  }

  // Send initial page context
  sendPageContext();

  // ── Text selection: send on mouseup ───────────────────────────────────────
  document.addEventListener('mouseup', () => {
    const sel = window.getSelection();
    if (!sel) return;
    const text = sel.toString().trim();
    if (text.length > 20 && text.length < 500) {
      sendPageContext(text);
    }
  });

  // ── Keyboard shortcut: Ctrl+Shift+J / Cmd+Shift+J ─────────────────────────
  document.addEventListener('keydown', (e) => {
    const isMac = navigator.platform.toUpperCase().includes('MAC');
    const modifier = isMac ? e.metaKey : e.ctrlKey;
    if (modifier && e.shiftKey && e.key === 'J') {
      e.preventDefault();
      // Try openPopup first; fall back to message
      if (chrome.action && chrome.action.openPopup) {
        chrome.action.openPopup().catch(() => {
          chrome.runtime.sendMessage({ type: 'OPEN_POPUP' }).catch(() => {});
        });
      } else {
        chrome.runtime.sendMessage({ type: 'OPEN_POPUP' }).catch(() => {});
      }
    }
  });

  // ── Inject "J" badge ──────────────────────────────────────────────────────
  if (document.getElementById('__jarvis-badge__')) return; // already injected

  const badge = document.createElement('div');
  badge.id = '__jarvis-badge__';
  badge.textContent = 'J';
  badge.title = 'Open JARVIS';

  Object.assign(badge.style, {
    position: 'fixed',
    bottom: '20px',
    right: '20px',
    width: '32px',
    height: '32px',
    zIndex: '2147483647',
    borderRadius: '50%',
    background: 'radial-gradient(circle at 35% 35%, #1e3a5f, #050a14)',
    border: '1.5px solid #0ea5e9',
    boxShadow: '0 0 8px rgba(14,165,233,0.5), 0 0 2px rgba(14,165,233,0.8)',
    color: '#0ea5e9',
    fontFamily: "'SF Mono', 'Fira Code', monospace",
    fontSize: '13px',
    fontWeight: '700',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    userSelect: 'none',
    transition: 'box-shadow 0.2s ease, transform 0.15s ease'
  });

  badge.addEventListener('mouseenter', () => {
    badge.style.boxShadow = '0 0 16px rgba(14,165,233,0.8), 0 0 4px rgba(14,165,233,1)';
    badge.style.transform = 'scale(1.1)';
  });
  badge.addEventListener('mouseleave', () => {
    badge.style.boxShadow = '0 0 8px rgba(14,165,233,0.5), 0 0 2px rgba(14,165,233,0.8)';
    badge.style.transform = 'scale(1)';
  });

  badge.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'OPEN_POPUP' }).catch(() => {});
  });

  // Wait for body to be available
  if (document.body) {
    document.body.appendChild(badge);
  } else {
    document.addEventListener('DOMContentLoaded', () => document.body.appendChild(badge));
  }
})();
