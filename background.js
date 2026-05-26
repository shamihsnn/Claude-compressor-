/**
 * Background Service Worker
 * 
 * Orchestrates the compression pipeline:
 * 1. Receives "compress" request from popup
 * 2. Sends "scrape" to content script on active tab
 * 3. Runs pre-trim (Stage 1)
 * 4. Runs AI compression (Stage 2) or rule-based fallback
 * 5. Returns result to popup
 */

import { pretrim, pretrimAggressive } from './lib/pretrim.js';
import { aiCompress, ruleCompress, testConnection } from './lib/compressor.js';

// Char thresholds for compression strategy
const THRESHOLD_AGGRESSIVE = 60000;  // Use aggressive pretrim above this
const THRESHOLD_WARNING = 120000;    // Warn user above this

/**
 * Get settings from chrome.storage.local
 */
async function getSettings() {
  return new Promise(resolve => {
    chrome.storage.local.get(['apiKey', 'modelId', 'provider', 'qwenApiKey', 'qwenModelId'], (data) => {
      resolve({
        provider: data.provider || 'openrouter',
        apiKey: data.apiKey || '',
        modelId: data.modelId || 'deepseek/deepseek-v4-flash:free',
        qwenApiKey: data.qwenApiKey || '',
        qwenModelId: data.qwenModelId || 'qwen-plus'
      });
    });
  });
}

/**
 * Get the active API key and model based on selected provider.
 */
function getActiveConfig(settings) {
  if (settings.provider === 'qwen') {
    return {
      apiKey: settings.qwenApiKey,
      model: settings.qwenModelId,
      provider: 'qwen'
    };
  }
  return {
    apiKey: settings.apiKey,
    model: settings.modelId,
    provider: 'openrouter'
  };
}

/**
 * Send a message to the content script on the active tab.
 */
async function sendToContentScript(tabId, message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(response);
      }
    });
  });
}

/**
 * Main compression pipeline.
 */
async function runPipeline(tabId, progressCallback) {
  // Step 1: Scrape
  progressCallback('scraping');
  
  let scrapeResult;
  try {
    scrapeResult = await sendToContentScript(tabId, { action: 'scrape' });
  } catch (err) {
    throw new Error(
      'Could not connect to the page. Make sure you\'re on claude.ai and try refreshing the page.'
    );
  }

  if (!scrapeResult.success) {
    throw new Error(scrapeResult.error || 'Failed to scrape conversation.');
  }

  const { turns, totalChars, turnCount, strategy } = scrapeResult;

  // Step 2: Pre-trim
  progressCallback('pretrimming');

  let pretrimResult;
  if (totalChars > THRESHOLD_AGGRESSIVE) {
    pretrimResult = pretrimAggressive(turns);
  } else {
    pretrimResult = pretrim(turns);
  }

  const { formatted, stats: pretrimStats } = pretrimResult;

  // Step 3: AI Compress or Rule-based fallback
  const settings = await getSettings();
  const config = getActiveConfig(settings);
  let compressedText;
  let method;
  let apiError = null;

  if (config.apiKey) {
    progressCallback('compressing');
    try {
      compressedText = await aiCompress(
        formatted,
        config.apiKey,
        config.model,
        turnCount,
        config.provider
      );
      method = 'AI';
    } catch (err) {
      // AI failed — fall back to rule-based
      apiError = err.message;
      compressedText = ruleCompress(formatted, turnCount);
      method = 'rule-based';
      compressedText += `\n\n[Note: AI compression failed — ${err.message}. Used rule-based fallback.]`;
    }
  } else {
    progressCallback('compressing');
    compressedText = ruleCompress(formatted, turnCount);
    method = 'rule-based';
  }

  return {
    success: true,
    compressed: compressedText,
    method,
    apiError,
    scrapeStrategy: strategy,
    stats: {
      originalChars: totalChars,
      afterPretrim: pretrimResult.stats.trimmedChars,
      compressedChars: compressedText.length,
      pretrimReduction: pretrimStats.reduction,
      totalReduction: totalChars > 0
        ? Math.round((1 - compressedText.length / totalChars) * 100)
        : 0,
      turnCount,
      warning: totalChars > THRESHOLD_WARNING
        ? 'Very long conversation — compression quality may vary on free API tiers.'
        : null
    }
  };
}

// ── Message Handler ─────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'compress') {
    const { tabId } = message;

    (async () => {
      try {
        const progressCallback = (stage) => {
          chrome.runtime.sendMessage({ action: 'progress', stage }).catch(() => {});
        };

        const result = await runPipeline(tabId, progressCallback);
        sendResponse(result);
      } catch (err) {
        sendResponse({
          success: false,
          error: err.message
        });
      }
    })();

    return true;
  }

  if (message.action === 'getSettings') {
    getSettings().then(sendResponse);
    return true;
  }

  if (message.action === 'saveSettings') {
    chrome.storage.local.set({
      provider: message.provider,
      apiKey: message.apiKey,
      modelId: message.modelId,
      qwenApiKey: message.qwenApiKey,
      qwenModelId: message.qwenModelId
    }, () => {
      sendResponse({ success: true });
    });
    return true;
  }

  if (message.action === 'testConnection') {
    (async () => {
      try {
        const settings = await getSettings();
        const config = getActiveConfig(settings);

        if (!config.apiKey) {
          sendResponse({ success: false, error: 'No API key configured for ' + config.provider + '.' });
          return;
        }

        const result = await testConnection(config.apiKey, config.provider);
        sendResponse(result);
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }
});
