
const PROVIDERS = {
  openrouter: {
    url: 'https://openrouter.ai/api/v1/chat/completions',
    testUrl: 'https://openrouter.ai/api/v1/models',
    headers: (apiKey) => ({
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://github.com/context-compressor',
      'X-Title': 'Context Compressor Extension'
    })
  },
  qwen: {
    url: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions',
    testUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/models',
    headers: (apiKey) => ({
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    })
  }
};

const SYSTEM_PROMPT = `You are a context compression engine. You will receive a long AI conversation. Compress it into a dense, structured "Context Resume" that another AI can read to resume the conversation with ZERO context loss on anything that matters.

PRIORITY HIERARCHY (cut lowest priority first when space is tight):
P0 — NEVER CUT: Code blocks (verbatim), final working solutions, active unresolved errors, file paths, variable names, config values, URLs
P1 — KEEP FULLY: Every decision and WHY it was made, tools/libraries chosen, architecture patterns, constraints discovered
P2 — KEEP AS BULLETS: Errors → what fixed them, dead ends tried, approaches rejected and why
P3 — SUMMARIZE BRIEFLY: Background discussion, concept explanations the AI already knows, exploratory back-and-forth
P4 — DROP ENTIRELY: Pleasantries, filler, "let me help you with that", repetition, meta-commentary, markdown decoration

RULES:
- NEVER summarize, abbreviate, or paraphrase code — reproduce it exactly
- Preserve the REASONING behind decisions, not just the decisions themselves
- The last ~20% of the conversation is the most important — give it MORE detail
- For debug chains, capture the full sequence: symptom → hypothesis → test → result → fix
- Note the user's preferences and working style when apparent
- If a file was edited multiple times, include ONLY the final version
- If multiple topics were discussed, group them — do not interleave
- Preserve ALL URLs, links, documentation references, and external resources mentioned in the conversation — reproduce them exactly as they appeared
- Skip empty sections entirely
- Do NOT add commentary about the compression process itself
- Aim for roughly 15-25% of the original conversation length

OUTPUT FORMAT:
=== CONTEXT RESUME ===
PROJECT: [project name if identifiable]
TOPIC: [what this conversation is about, 5-15 words]
TURNS: [approximate number]
ACTIVE TASK: [what was being worked on when the conversation ended]

--- DECISIONS & REASONING ---
[bullet list: what was decided + why, chronological order]

--- CURRENT STATE ---
[what is working, what is broken, what files exist, what's been built so far]

--- CODE ---
[all final code blocks verbatim, labeled with filename or purpose]

--- ERRORS & DEBUG HISTORY ---
[symptom → cause → fix, as bullet chains]

--- KEY DETAILS ---
[file paths, variable names, config values, versions, package names, environment details]

--- LINKS & REFERENCES ---
[all URLs, documentation links, external resources, articles, and references mentioned in the conversation — listed with brief context of why they were shared]

--- REJECTED APPROACHES ---
[what was tried and abandoned, and why — so we don't retry it]

--- NEXT STEPS ---
[what was explicitly discussed as the next thing to do]
[any open questions or unresolved issues]

=== END CONTEXT RESUME ===
You are now resuming this conversation. Read the full context resume above, internalize all decisions and state, and continue working on the ACTIVE TASK. Do not introduce yourself or ask "how can I help" — pick up where we left off.`;

/**
 * Compress conversation text using AI.
 * @param {string} text - Pre-trimmed conversation text
 * @param {string} apiKey - API key for the selected provider
 * @param {string} model - Model ID
 * @param {number} turnCount - Number of conversation turns
 * @param {string} provider - 'openrouter' or 'qwen'
 * @returns {Promise<string>} Compressed context resume
 */
export async function aiCompress(text, apiKey, model, turnCount, provider = 'openrouter') {
  const providerConfig = PROVIDERS[provider] || PROVIDERS.openrouter;

  const userMessage = `${turnCount} turns, ${text.length.toLocaleString()} chars.\n\n${text}`;

  const resp = await fetch(providerConfig.url, {
    method: 'POST',
    headers: providerConfig.headers(apiKey),
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMessage }
      ],
      max_tokens: 6000,
      temperature: 0.2
    })
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    const status = resp.status;
    const errMsg = err?.error?.message || 'Unknown error';
    const errCode = err?.error?.code || '';
    const errType = err?.error?.type || '';

    let detail = `HTTP ${status}`;
    if (errCode) detail += ` [${errCode}]`;
    if (errType) detail += ` (${errType})`;
    detail += `: ${errMsg}`;

    if (status === 401) {
      detail += ' — API key invalid or expired. Check Settings.';
    } else if (status === 402) {
      detail += ' — No credits remaining.';
    } else if (status === 429) {
      detail += ' — Rate limited. Wait and retry, or switch model.';
    } else if (status === 503 || errMsg.includes('provider')) {
      detail += ' — Provider temporarily down. Try later or switch model.';
    }

    throw new Error(detail);
  }

  const data = await resp.json();
  const content = data.choices?.[0]?.message?.content;

  if (!content) {
    const embeddedError = data?.error?.message || data?.choices?.[0]?.finish_reason;
    throw new Error(
      `No response from model.${embeddedError ? ' Reason: ' + embeddedError : ''} Model: ${model}`
    );
  }

  return content;
}

/**
 * Test API connection for a given provider.
 * @param {string} apiKey
 * @param {string} provider - 'openrouter' or 'qwen'
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function testConnection(apiKey, provider = 'openrouter') {
  if (!apiKey) return { success: false, error: 'No API key configured.' };

  const providerConfig = PROVIDERS[provider] || PROVIDERS.openrouter;

  try {
    const resp = await fetch(providerConfig.testUrl, {
      headers: providerConfig.headers(apiKey)
    });

    if (resp.ok) {
      return { success: true };
    } else {
      const err = await resp.json().catch(() => ({}));
      return {
        success: false,
        error: err?.error?.message || `HTTP ${resp.status}`
      };
    }
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Rule-based compression fallback.
 * Used when no API key is set or AI compression fails.
 */
export function ruleCompress(text, turnCount) {
  const codeBlocks = [];
  const codeRe = /```[\s\S]*?```/g;
  let match;
  while ((match = codeRe.exec(text)) !== null) {
    const block = match[0].trim();
    codeBlocks.push(block.length < 600 ? block : block.slice(0, 500) + '\n...[truncated]```');
  }

  const lines = text.split('\n');

  const decisions = lines.filter(l => {
    const t = l.trim();
    if (t.length < 15 || t.length > 300) return false;
    return /\b(decided|conclusion|therefore|solution|we'll use|best approach|recommended|the fix|turned out|finally|in the end|agreed|chosen|going with|settled on)\b/i.test(t);
  }).map(l => '• ' + l.trim().replace(/^[-•*]\s*/, '')).slice(0, 20);

  const errors = lines.filter(l => {
    const t = l.trim();
    if (t.length < 12 || t.length > 300) return false;
    return /\b(error|failed|exception|bug|broken|crash|fix(ed)?|resolved|workaround|issue|problem|TypeError|SyntaxError|ReferenceError|undefined is not)\b/i.test(t);
  }).map(l => '▸ ' + l.trim()).slice(0, 15);

  const keyDetails = lines.filter(l => {
    const t = l.trim();
    if (t.length < 10 || t.length > 250) return false;
    return (
      /[\/\\][\w.-]+\.\w{1,5}\b/.test(t) ||
      /\bhttps?:\/\//.test(t) ||
      /\b(version|v\d|port \d|localhost)\b/i.test(t) ||
      /\b(npm|pip|yarn|cargo|apt|brew)\s+(install|add|remove)\b/i.test(t)
    );
  }).map(l => '▸ ' + l.trim()).slice(0, 15);

  const lists = lines.filter(l => {
    const t = l.trim();
    return (/^(\d+\.|[-*•])\s/.test(t) && t.length > 15) || /^Step \d/i.test(t);
  }).slice(0, 25);

  const freq = {};
  text.split(/\s+/)
    .filter(w => w.length > 4 && /^[A-Za-z]/.test(w))
    .forEach(w => {
      const k = w.toLowerCase().replace(/[.,;:!?()]/g, '');
      freq[k] = (freq[k] || 0) + 1;
    });

  const stopWords = new Set([
    'about', 'after', 'again', 'also', 'assistant', 'based', 'because', 'before',
    'being', 'between', 'could', 'different', 'doesn', 'doing', 'during', 'each',
    'example', 'first', 'going', 'gonna', 'have', 'having', 'here', 'https',
    'instead', 'into', 'just', 'know', 'like', 'looks', 'make', 'maybe', 'might',
    'more', 'much', 'need', 'only', 'other', 'over', 'really', 'right', 'same',
    'should', 'since', 'some', 'still', 'sure', 'their', 'them', 'then', 'there',
    'these', 'they', 'thing', 'think', 'this', 'those', 'through', 'turn', 'user',
    'using', 'very', 'want', 'well', 'were', 'what', 'when', 'where', 'which',
    'while', 'will', 'with', 'would', 'your'
  ]);

  const topic = Object.entries(freq)
    .filter(([w]) => !stopWords.has(w))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([w]) => w)
    .join(', ') || 'general conversation';

  let out = `=== CONTEXT RESUME (rule-based) ===\n`;
  out += `TOPIC: ${topic}\n`;
  out += `TURNS: ${turnCount}\n`;
  out += `DATE: ${new Date().toISOString().split('T')[0]}\n\n`;

  if (decisions.length > 0) {
    out += `--- DECISIONS & STATE ---\n${decisions.join('\n')}\n\n`;
  }
  if (codeBlocks.length > 0) {
    out += `--- CODE ---\n${codeBlocks.join('\n\n')}\n\n`;
  }
  if (errors.length > 0) {
    out += `--- ERRORS & FIXES ---\n${errors.join('\n')}\n\n`;
  }
  if (keyDetails.length > 0) {
    out += `--- KEY DETAILS ---\n${keyDetails.join('\n')}\n\n`;
  }
  if (lists.length > 0) {
    out += `--- STEPS & LISTS ---\n${lists.join('\n')}\n\n`;
  }

  out += `=== END CONTEXT RESUME ===\n`;
  out += `Read this resume fully and continue from where we left off.\n`;

  return out;
}
