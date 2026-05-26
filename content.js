/**
 * Content Script — DOM Scraping for Claude.ai
 * 
 * Injected into claude.ai pages. Listens for "scrape" messages from
 * the background worker and extracts conversation turns from the DOM.
 * 
 * ====================================================================
 * SELECTOR MAINTENANCE GUIDE
 * ====================================================================
 * Claude.ai updates their DOM frequently. When scraping breaks:
 * 1. Open claude.ai in Chrome
 * 2. Open DevTools (F12) → Elements tab
 * 3. Find the conversation container and message elements
 * 4. Update the selector arrays below
 * 
 * The script tries selectors in order and uses the first one that works.
 * ====================================================================
 */

// ── Selector Configuration ──────────────────────────────────────────
// Update these when claude.ai changes their DOM structure.
// Each array is tried in order; the first match wins.

const SELECTORS = {
  // The main scrollable container holding all messages
  conversationContainer: [
    '[class*="conversation-content"]',
    '[data-testid="conversation-turn-list"]',
    'main [class*="overflow"]',
    'main .flex.flex-col',
    'main'
  ],

  // Individual message blocks (each turn in the conversation)
  messageBlocks: [
    '[data-testid^="conversation-turn"]',
    '[class*="ConversationTurn"]',
    '[class*="message-row"]',
    '[class*="turn"]'
  ],

  // Markers that identify a message as from the user
  userMarkers: [
    '[data-testid="user-message"]',
    '[class*="human-turn"]',
    '[class*="user-message"]',
    '[data-role="user"]'
  ],

  // Markers that identify a message as from the assistant
  assistantMarkers: [
    '[data-testid="assistant-message"]',
    '[class*="assistant-turn"]',
    '[class*="claude-message"]',
    '[data-role="assistant"]'
  ]
};

// ── Helper Functions ────────────────────────────────────────────────

/**
 * Try each selector in an array; return the first that matches.
 */
function queryFirst(parent, selectors) {
  for (const sel of selectors) {
    try {
      const el = parent.querySelector(sel);
      if (el) return el;
    } catch (e) {
      // Invalid selector, skip
    }
  }
  return null;
}

/**
 * Try each selector; return all matches from the first selector that finds any.
 */
function queryAllFirst(parent, selectors) {
  for (const sel of selectors) {
    try {
      const els = parent.querySelectorAll(sel);
      if (els.length > 0) return Array.from(els);
    } catch (e) {
      // Invalid selector, skip
    }
  }
  return [];
}

/**
 * Determine the role of a message block.
 */
function detectRole(messageEl) {
  // Check for explicit user markers
  for (const sel of SELECTORS.userMarkers) {
    try {
      if (messageEl.querySelector(sel) || messageEl.matches(sel)) return 'user';
    } catch (e) {}
  }

  // Check for explicit assistant markers
  for (const sel of SELECTORS.assistantMarkers) {
    try {
      if (messageEl.querySelector(sel) || messageEl.matches(sel)) return 'assistant';
    } catch (e) {}
  }

  // Heuristic: check for common text patterns
  const text = messageEl.innerText?.slice(0, 200) || '';

  // Claude messages tend to be longer and more structured
  // User messages tend to be shorter
  // This is a weak heuristic, but better than nothing
  
  // Check for aria labels
  const ariaLabel = messageEl.getAttribute('aria-label') || '';
  if (/human|user|you/i.test(ariaLabel)) return 'user';
  if (/assistant|claude|ai/i.test(ariaLabel)) return 'assistant';

  return null; // Unknown
}

/**
 * Extract clean text content from a message element.
 * Preserves code blocks.
 */
function extractText(el) {
  // Clone the element to avoid modifying the page
  const clone = el.cloneNode(true);

  // Remove any UI elements (buttons, toolbars, etc.)
  clone.querySelectorAll('button, [role="toolbar"], [class*="toolbar"]').forEach(e => e.remove());

  // Get text — innerText preserves visual formatting better than textContent
  let text = clone.innerText || clone.textContent || '';

  // Clean up excessive whitespace while preserving code block structure
  text = text.replace(/\t/g, '  ');
  text = text.replace(/\n{4,}/g, '\n\n\n');

  return text.trim();
}

// ── Primary Scraping Strategy ───────────────────────────────────────

/**
 * Strategy 1: Find message blocks with known selectors, detect roles.
 */
function scrapeWithSelectors() {
  const container = queryFirst(document, SELECTORS.conversationContainer);
  if (!container) return null;

  const blocks = queryAllFirst(container, SELECTORS.messageBlocks);
  if (blocks.length === 0) return null;

  const turns = [];
  let lastRole = null;

  for (const block of blocks) {
    let role = detectRole(block);

    // If role detection failed, alternate (user always starts)
    if (!role) {
      role = lastRole === 'user' ? 'assistant' : 'user';
    }

    const text = extractText(block);
    if (text.length > 0) {
      turns.push({ role, text });
      lastRole = role;
    }
  }

  return turns.length > 0 ? turns : null;
}

/**
 * Strategy 2: Structural heuristic — look for alternating content blocks.
 * Falls back to this when specific selectors don't match.
 */
function scrapeStructural() {
  // Find the main content area
  const main = document.querySelector('main') || document.body;
  
  // Look for the deepest scrollable container that has significant content
  const scrollables = main.querySelectorAll('[style*="overflow"], [class*="overflow"], [class*="scroll"]');
  let container = null;
  
  for (const el of scrollables) {
    if (el.scrollHeight > 500 && el.innerText.length > 200) {
      container = el;
    }
  }
  
  if (!container) container = main;
  
  // Try to find direct children that look like message groups
  const children = Array.from(container.children);
  if (children.length < 2) return null;
  
  // Heuristic: message containers are usually direct children of the scroll area
  // and have substantial text content
  const messageLike = children.filter(el => {
    const text = el.innerText || '';
    return text.trim().length > 5;
  });
  
  if (messageLike.length < 2) return null;
  
  const turns = messageLike.map((el, i) => ({
    role: i % 2 === 0 ? 'user' : 'assistant',
    text: extractText(el)
  })).filter(t => t.text.length > 0);
  
  return turns.length > 0 ? turns : null;
}

/**
 * Strategy 3: Last resort — grab all visible text from the page.
 */
function scrapeFallback() {
  const main = document.querySelector('main') || document.body;
  const text = main.innerText || '';
  
  if (text.length < 50) return null;
  
  // Try to split by common patterns
  // Claude.ai often has visual separators between messages
  const parts = text.split(/\n{3,}/);
  
  if (parts.length >= 2) {
    return parts
      .filter(p => p.trim().length > 10)
      .map((p, i) => ({
        role: i % 2 === 0 ? 'user' : 'assistant',
        text: p.trim()
      }));
  }
  
  // Absolute fallback: return as a single block
  return [{ role: 'user', text: 'Full page content:\n' + text.trim() }];
}

// ── Main Scrape Function ────────────────────────────────────────────

function scrapeConversation() {
  // Try strategies in order of reliability
  let turns = scrapeWithSelectors();
  let strategy = 'selectors';

  if (!turns) {
    turns = scrapeStructural();
    strategy = 'structural';
  }

  if (!turns) {
    turns = scrapeFallback();
    strategy = 'fallback';
  }

  if (!turns || turns.length === 0) {
    return { success: false, error: 'Could not find any conversation content on this page.' };
  }

  const totalChars = turns.reduce((sum, t) => sum + t.text.length, 0);

  return {
    success: true,
    turns,
    totalChars,
    turnCount: turns.length,
    strategy,
    url: window.location.href
  };
}

// ── Message Listener ────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'scrape') {
    try {
      const result = scrapeConversation();
      sendResponse(result);
    } catch (err) {
      sendResponse({
        success: false,
        error: `Scraping error: ${err.message}`
      });
    }
  }

  if (message.action === 'ping') {
    // Used by popup to check if content script is loaded
    sendResponse({ alive: true });
  }

  return true; // Keep message channel open for async response
});
