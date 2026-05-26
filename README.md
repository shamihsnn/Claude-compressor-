# ⚡ Context Compressor

> One-click conversation compression for Claude.ai — compress long chats into dense context resumes you can paste into a new conversation.

A Chrome extension that scrapes your current Claude.ai conversation, compresses it intelligently using a two-stage pipeline, and gives you a copyable **Context Resume** to paste into a fresh chat.

## How It Works

```
Raw conversation → Local Pre-Trim → AI Compression → Context Resume
     (DOM)          (instant)        (OpenRouter)      (copyable)
```

**Stage 1 — Local Pre-Trim** (free, instant):
- Strips AI filler phrases ("Sure, I can help!", "Let me think...", etc.)
- Collapses whitespace and removes noise
- Preserves ALL code blocks verbatim

**Stage 2 — AI Compression** (OpenRouter API):
- Sends pre-trimmed text to an AI model for intelligent compression
- Produces a structured Context Resume with decisions, code, errors, and next steps
- Falls back to rule-based compression if no API key is set

## Installation

1. **Download** — Clone or download this repository
2. **Open Chrome Extensions** — Go to `chrome://extensions/`
3. **Enable Developer Mode** — Toggle in the top right
4. **Load Unpacked** — Click "Load unpacked" and select the `context-compressor-ext` folder
5. **Pin the extension** — Click the puzzle icon in Chrome's toolbar and pin Context Compressor

## Setup

1. **Get a free API key** at [openrouter.ai](https://openrouter.ai) → Sign up → Keys
2. **Open extension settings** — Click the ⚙ icon in the popup, or right-click the extension icon → Options
3. **Paste your API key** and click Save
4. **(Optional)** Click "Test Connection" to verify it works

> **No API key?** The extension still works — it uses a rule-based compression fallback. The AI mode produces much better results though.

## Usage

1. Open a conversation on [claude.ai](https://claude.ai)
2. Click the Context Compressor extension icon
3. Click **⚡ Compress This Chat**
4. Wait for compression (usually 5-15 seconds)
5. Click **📋 Copy**
6. Open a new Claude chat and paste as your first message

Claude will read the context resume and continue exactly where you left off.

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| API Key | *(none)* | Your OpenRouter API key (`sk-or-v1-...`) |
| Model ID | `deepseek/deepseek-v4-flash:free` | Any model from [openrouter.ai/models](https://openrouter.ai/models) |

### Recommended Free Models

- `deepseek/deepseek-v4-flash:free` — Fast, good quality (default)
- `google/gemini-2.5-flash:free` — Large context window

## When DOM Scraping Breaks

Claude.ai updates their frontend regularly, which can break the conversation scraping. When this happens:

1. Open Claude.ai
2. Open DevTools (`F12`) → Elements tab
3. Find the conversation container and message elements
4. Open `content.js` and update the `SELECTORS` object at the top of the file:

```js
const SELECTORS = {
  conversationContainer: [
    // Add new selectors here ↓
    '[your-new-selector]',
    // ... existing selectors
  ],
  // same for messageBlocks, userMarkers, assistantMarkers
};
```

5. Save and reload the extension at `chrome://extensions/`

## File Structure

```
context-compressor-ext/
├── manifest.json           # Extension configuration
├── content.js              # DOM scraping (runs on claude.ai)
├── background.js           # Service worker (API calls, pipeline)
├── popup.html/js/css       # Extension popup UI
├── options.html/js/css     # Settings page
├── lib/
│   ├── pretrim.js          # Stage 1: local pre-trim
│   └── compressor.js       # Stage 2: AI compression + fallback
├── icons/                  # Extension icons
└── README.md
```

## Privacy

- **No data collection** — everything runs locally in your browser
- **No tracking** — zero analytics, no telemetry
- **API calls only to OpenRouter** — your conversation text is sent to the AI model you choose for compression, nothing else
- **API key stored locally** — saved in Chrome's `chrome.storage.local`, never transmitted anywhere except OpenRouter

## License

MIT
