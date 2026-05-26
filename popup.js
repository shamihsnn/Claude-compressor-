/**
 * Popup Script
 * 
 * Handles the extension popup UI:
 * - Detects if we're on claude.ai
 * - Triggers compression pipeline
 * - Displays results
 */

// ── DOM References ──────────────────────────────────────────────────

const $ = (id) => document.getElementById(id);

const els = {
  bannerNotClaude: $('bannerNotClaude'),
  bannerOnClaude: $('bannerOnClaude'),
  bannerNoKey: $('bannerNoKey'),
  btnCompress: $('btnCompress'),
  btnSettings: $('btnSettings'),
  btnCopy: $('btnCopy'),
  progressSection: $('progressSection'),
  stepScrape: $('stepScrape'),
  stepPretrim: $('stepPretrim'),
  stepCompress: $('stepCompress'),
  errorSection: $('errorSection'),
  statsBar: $('statsBar'),
  statOriginal: $('statOriginal'),
  statCompressed: $('statCompressed'),
  statReduction: $('statReduction'),
  resultSection: $('resultSection'),
  resultOutput: $('resultOutput'),
  methodBadge: $('methodBadge'),
  debugToggle: $('debugToggle'),
  debugContent: $('debugContent'),
  linkSetupKey: $('linkSetupKey')
};

let currentResult = null;

// ── Initialize ──────────────────────────────────────────────────────

async function init() {
  // Check if we're on claude.ai
  const tab = await getActiveTab();
  const onClaude = tab?.url?.includes('claude.ai');

  if (onClaude) {
    els.bannerOnClaude.style.display = 'flex';
    els.bannerNotClaude.style.display = 'none';
    els.btnCompress.disabled = false;
  } else {
    els.bannerNotClaude.style.display = 'flex';
    els.bannerOnClaude.style.display = 'none';
    els.btnCompress.disabled = true;
  }

  // Check if API key is set
  const settings = await getSettings();
  if (!settings.apiKey && onClaude) {
    els.bannerNoKey.style.display = 'flex';
  }

  // Listen for progress updates from background
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === 'progress') {
      updateProgress(msg.stage);
    }
  });
}

// ── Helpers ─────────────────────────────────────────────────────────

function getActiveTab() {
  return new Promise(resolve => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      resolve(tabs[0] || null);
    });
  });
}

function getSettings() {
  return new Promise(resolve => {
    chrome.storage.local.get(['apiKey', 'modelId', 'provider', 'qwenApiKey', 'qwenModelId'], (data) => {
      const provider = data.provider || 'openrouter';
      let activeKey, activeModel;

      if (provider === 'qwen') {
        activeKey = data.qwenApiKey || '';
        activeModel = data.qwenModelId || 'qwen-plus';
      } else {
        activeKey = data.apiKey || '';
        activeModel = data.modelId || 'deepseek/deepseek-v4-flash:free';
      }

      resolve({
        apiKey: activeKey,
        modelId: activeModel,
        provider
      });
    });
  });
}

function formatChars(n) {
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
  return n.toString();
}

// ── Progress Updates ────────────────────────────────────────────────

function showProgress() {
  els.progressSection.classList.add('visible');
  els.errorSection.classList.remove('visible');
  els.statsBar.classList.remove('visible');
  els.resultSection.classList.remove('visible');
}

function updateProgress(stage) {

  // Mark everything before current stage as done
  [els.stepScrape, els.stepPretrim, els.stepCompress].forEach(el => {
    el.classList.remove('active', 'done');
  });

  if (stage === 'scraping') {
    els.stepScrape.classList.add('active');
  } else if (stage === 'pretrimming') {
    els.stepScrape.classList.add('done');
    els.stepPretrim.classList.add('active');
  } else if (stage === 'compressing') {
    els.stepScrape.classList.add('done');
    els.stepPretrim.classList.add('done');
    els.stepCompress.classList.add('active');
  }
}

function hideProgress() {
  els.progressSection.classList.remove('visible');
}

// ── Error Display ───────────────────────────────────────────────────

function showError(msg) {
  els.errorSection.textContent = msg;
  els.errorSection.classList.add('visible');
  hideProgress();
}

// ── Results Display ─────────────────────────────────────────────────

function showResults(result) {
  currentResult = result;

  // Stats
  els.statOriginal.textContent = formatChars(result.stats.originalChars);
  els.statCompressed.textContent = formatChars(result.stats.compressedChars);
  els.statReduction.textContent = result.stats.totalReduction + '%';
  els.statsBar.classList.add('visible');

  // Method badge
  if (result.method === 'AI') {
    els.methodBadge.textContent = 'AI';
    els.methodBadge.className = 'method-badge ai';
  } else {
    els.methodBadge.textContent = 'Rule-based';
    els.methodBadge.className = 'method-badge rule';
  }

  // Output
  els.resultOutput.textContent = result.compressed;
  els.resultSection.classList.add('visible');

  // Debug info
  els.debugContent.textContent = JSON.stringify({
    strategy: result.scrapeStrategy,
    turns: result.stats.turnCount,
    pretrimReduction: result.stats.pretrimReduction + '%',
    totalReduction: result.stats.totalReduction + '%',
    method: result.method,
    apiError: result.apiError || null
  }, null, 2);

  // API error warning (AI failed, fell back to rule-based)
  if (result.apiError) {
    const errEl = document.createElement('div');
    errEl.className = 'info-msg warning';
    errEl.textContent = '⚠ AI compression failed: ' + result.apiError;
    els.resultSection.insertBefore(errEl, els.resultSection.firstChild);
  }

  // Long conversation warning
  if (result.stats.warning) {
    const warningEl = document.createElement('div');
    warningEl.className = 'info-msg warning';
    warningEl.textContent = result.stats.warning;
    els.resultSection.insertBefore(warningEl, els.resultSection.firstChild);
  }

  hideProgress();
}

// ── Event Handlers ──────────────────────────────────────────────────

els.btnCompress.addEventListener('click', async () => {
  const tab = await getActiveTab();
  if (!tab) return;

  // Reset UI
  els.btnCompress.disabled = true;
  els.btnCompress.innerHTML = '<span class="spinner"></span> Compressing...';
  els.errorSection.classList.remove('visible');
  els.statsBar.classList.remove('visible');
  els.resultSection.classList.remove('visible');

  showProgress();
  updateProgress('scraping');

  // Send compress request to background
  chrome.runtime.sendMessage(
    { action: 'compress', tabId: tab.id },
    (response) => {
      els.btnCompress.disabled = false;
      els.btnCompress.innerHTML = '⚡ Compress This Chat';

      if (!response) {
        showError('No response from extension. Try reloading the page.');
        return;
      }

      if (response.success) {
        showResults(response);
      } else {
        showError(response.error || 'Compression failed.');
      }
    }
  );
});

els.btnCopy.addEventListener('click', () => {
  if (!currentResult) return;

  navigator.clipboard.writeText(currentResult.compressed).then(() => {
    els.btnCopy.innerHTML = '✓ Copied!';
    els.btnCopy.classList.add('copied');
    setTimeout(() => {
      els.btnCopy.innerHTML = '📋 Copy';
      els.btnCopy.classList.remove('copied');
    }, 2000);
  }).catch(() => {
    // Fallback: select text in output box
    const range = document.createRange();
    range.selectNodeContents(els.resultOutput);
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(range);
  });
});

els.btnSettings.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

els.linkSetupKey.addEventListener('click', (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

els.debugToggle.addEventListener('click', () => {
  const content = els.debugContent;
  const isVisible = content.classList.contains('visible');
  content.classList.toggle('visible');
  els.debugToggle.textContent = isVisible ? '▸ Debug info' : '▾ Debug info';
});

// ── Start ───────────────────────────────────────────────────────────

init();
