/**
 * Options Page Script
 * 
 * Handles settings persistence via chrome.storage.local.
 * Supports OpenRouter and Qwen Cloud providers.
 */

const $ = (id) => document.getElementById(id);

const els = {
  provider: $('provider'),
  openrouterSection: $('openrouterSection'),
  qwenSection: $('qwenSection'),
  apiKey: $('apiKey'),
  modelId: $('modelId'),
  btnToggleKey: $('btnToggleKey'),
  qwenApiKey: $('qwenApiKey'),
  qwenModelId: $('qwenModelId'),
  btnToggleQwenKey: $('btnToggleQwenKey'),
  btnSave: $('btnSave'),
  btnTest: $('btnTest'),
  saveFeedback: $('saveFeedback'),
  testStatus: $('testStatus'),
  keyDot: $('keyDot'),
  keyStatus: $('keyStatus'),
  qwenKeyDot: $('qwenKeyDot'),
  qwenKeyStatus: $('qwenKeyStatus')
};

let keyVisible = false;
let qwenKeyVisible = false;

// ── Provider toggle ─────────────────────────────────────────────────

function updateProviderUI() {
  const provider = els.provider.value;
  if (provider === 'qwen') {
    els.openrouterSection.style.display = 'none';
    els.qwenSection.style.display = '';
  } else {
    els.openrouterSection.style.display = '';
    els.qwenSection.style.display = 'none';
  }
}

els.provider.addEventListener('change', updateProviderUI);

// ── Load saved settings ─────────────────────────────────────────────

function loadSettings() {
  chrome.storage.local.get(['apiKey', 'modelId', 'provider', 'qwenApiKey', 'qwenModelId'], (data) => {
    if (data.provider) els.provider.value = data.provider;
    if (data.apiKey) els.apiKey.value = data.apiKey;
    if (data.modelId) els.modelId.value = data.modelId;
    if (data.qwenApiKey) els.qwenApiKey.value = data.qwenApiKey;
    if (data.qwenModelId) els.qwenModelId.value = data.qwenModelId;
    updateProviderUI();
    updateKeyStatus();
    updateQwenKeyStatus();
  });
}

// ── Key status indicators ───────────────────────────────────────────

function updateKeyStatus() {
  const key = els.apiKey.value.trim();

  if (!key) {
    els.keyDot.className = 'status-dot gray';
    els.keyStatus.textContent = 'No key entered — will use rule-based fallback';
  } else if (key.startsWith('sk-or-')) {
    els.keyDot.className = 'status-dot green';
    els.keyStatus.textContent = 'Valid OpenRouter format — ready';
  } else {
    els.keyDot.className = 'status-dot amber';
    els.keyStatus.textContent = 'Unusual format — double-check your key';
  }
}

function updateQwenKeyStatus() {
  const key = els.qwenApiKey.value.trim();

  if (!key) {
    els.qwenKeyDot.className = 'status-dot gray';
    els.qwenKeyStatus.textContent = 'No key entered — will use rule-based fallback';
  } else if (key.startsWith('sk-')) {
    els.qwenKeyDot.className = 'status-dot green';
    els.qwenKeyStatus.textContent = 'Valid DashScope format — ready';
  } else {
    els.qwenKeyDot.className = 'status-dot amber';
    els.qwenKeyStatus.textContent = 'Unusual format — double-check your key';
  }
}

// ── Event handlers ──────────────────────────────────────────────────

els.apiKey.addEventListener('input', updateKeyStatus);
els.qwenApiKey.addEventListener('input', updateQwenKeyStatus);

els.btnToggleKey.addEventListener('click', () => {
  keyVisible = !keyVisible;
  els.apiKey.type = keyVisible ? 'text' : 'password';
  els.btnToggleKey.textContent = keyVisible ? '🙈' : '👁';
});

els.btnToggleQwenKey.addEventListener('click', () => {
  qwenKeyVisible = !qwenKeyVisible;
  els.qwenApiKey.type = qwenKeyVisible ? 'text' : 'password';
  els.btnToggleQwenKey.textContent = qwenKeyVisible ? '🙈' : '👁';
});

els.btnSave.addEventListener('click', () => {
  const provider = els.provider.value;
  const apiKey = els.apiKey.value.trim();
  const modelId = els.modelId.value.trim() || 'deepseek/deepseek-v4-flash:free';
  const qwenApiKey = els.qwenApiKey.value.trim();
  const qwenModelId = els.qwenModelId.value.trim() || 'qwen-plus';

  chrome.storage.local.set({ provider, apiKey, modelId, qwenApiKey, qwenModelId }, () => {
    els.saveFeedback.classList.add('visible');
    setTimeout(() => {
      els.saveFeedback.classList.remove('visible');
    }, 2000);
  });
});

els.btnTest.addEventListener('click', async () => {
  els.testStatus.textContent = 'Testing...';
  els.testStatus.style.color = 'var(--text-secondary)';
  els.btnTest.disabled = true;

  // Save first so background has the latest settings
  const provider = els.provider.value;
  const apiKey = els.apiKey.value.trim();
  const modelId = els.modelId.value.trim() || 'deepseek/deepseek-v4-flash:free';
  const qwenApiKey = els.qwenApiKey.value.trim();
  const qwenModelId = els.qwenModelId.value.trim() || 'qwen-plus';
  
  chrome.storage.local.set({ provider, apiKey, modelId, qwenApiKey, qwenModelId }, () => {
    chrome.runtime.sendMessage({ action: 'testConnection' }, (response) => {
      els.btnTest.disabled = false;

      if (response?.success) {
        els.testStatus.textContent = '✓ Connected successfully!';
        els.testStatus.style.color = 'var(--text-success)';
      } else {
        els.testStatus.textContent = '✗ ' + (response?.error || 'Connection failed');
        els.testStatus.style.color = 'var(--text-error)';
      }

      setTimeout(() => {
        els.testStatus.textContent = '';
      }, 5000);
    });
  });
});

// ── Init ────────────────────────────────────────────────────────────

loadSettings();
