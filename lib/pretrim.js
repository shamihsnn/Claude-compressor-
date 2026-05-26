/**
 * Stage 1: Local Pre-Trim
 * 
 * Cleans conversation turns by removing filler, collapsing whitespace,
 * and preserving all code blocks and technical content.
 * Runs locally — no API calls, instant.
 */

// Common AI filler phrases to strip (case-insensitive)
const FILLER_PATTERNS = [
  // Greetings & pleasantries
  /^(hi|hello|hey|greetings)[!.,]?\s*/i,
  /^(thanks|thank you|thx)[!.,]?\s*(so much|a lot|very much)?[!.,]?\s*/i,
  /^(please|pls)\s+/i,
  
  // AI opening filler
  /^(sure|absolutely|of course|certainly|definitely|great|perfect)[!.,]?\s*(i can|i'd be|let me|i'll)\s*/i,
  /^(sure|absolutely|of course|certainly|definitely)[!.,]?\s*/i,
  /^great (question|point)[!.,]?\s*/i,
  /^that'?s a (great|good|excellent|interesting) (question|point)[!.,]?\s*/i,
  /^let me (think|consider|look) (about|at|into) (this|that)[.!]?\s*/i,
  /^i'?d be happy to help[!.,]?\s*(with that)?[!.,]?\s*/i,
  /^i understand[.,]?\s*/i,
  /^(good|excellent|interesting) (question|point|observation)[!.,]?\s*/i,
  
  // AI closing filler
  /\s*(i )?hope (this|that) helps[!.,]?\s*$/i,
  /\s*let me know if you (have|need|want) (any )?(more |further )?(questions|help|assistance|clarification)[!.,]?\s*$/i,
  /\s*feel free to (ask|reach out|let me know)[^.]*[!.,]?\s*$/i,
  /\s*is there anything else[^?]*\?\s*$/i,
  /\s*happy to (help|assist|clarify)[^.]*[!.,]?\s*$/i,
  /\s*don'?t hesitate to (ask|reach out)[^.]*[!.,]?\s*$/i,
];

// Phrases that indicate an entire line is filler (remove whole line)
const FILLER_LINE_PATTERNS = [
  /^sure,?\s*i can help with that[!.]?$/i,
  /^absolutely[!.]?$/i,
  /^of course[!.]?$/i,
  /^certainly[!.]?$/i,
  /^great[!.]?$/i,
  /^perfect[!.]?$/i,
  /^got it[!.]?$/i,
  /^understood[!.]?$/i,
  /^no problem[!.]?$/i,
  /^you'?re welcome[!.]?$/i,
  /^here you go[!:.]?$/i,
  /^here'?s what i (came up with|found|think)[!:.]?$/i,
  /^let me (explain|break this down|walk you through)[!:.]?$/i,
  /^i hope this helps[!.]?$/i,
  /^happy to help[!.]?$/i,
  /^glad i could help[!.]?$/i,
];

/**
 * Extract and protect code blocks from text.
 * Returns { cleaned, blocks } where cleaned has placeholders and blocks is the array.
 */
function extractCodeBlocks(text) {
  const blocks = [];
  const cleaned = text.replace(/```[\s\S]*?```/g, (match) => {
    const idx = blocks.length;
    blocks.push(match);
    return `\n__CODE_BLOCK_${idx}__\n`;
  });
  return { cleaned, blocks };
}

/**
 * Restore code blocks from placeholders.
 */
function restoreCodeBlocks(text, blocks) {
  return text.replace(/__CODE_BLOCK_(\d+)__/g, (_, idx) => {
    return blocks[parseInt(idx)] || '';
  });
}

/**
 * Remove filler from a single line of text.
 */
function trimFillerFromLine(line) {
  let trimmed = line;
  
  // Check if the entire line is filler
  const stripped = trimmed.trim();
  for (const pat of FILLER_LINE_PATTERNS) {
    if (pat.test(stripped)) return '';
  }
  
  // Remove filler from start/end of line
  for (const pat of FILLER_PATTERNS) {
    trimmed = trimmed.replace(pat, '');
  }
  
  return trimmed;
}

/**
 * Collapse multiple blank lines into a single blank line.
 */
function collapseWhitespace(text) {
  return text
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+$/gm, '')  // trailing whitespace per line
    .trim();
}

/**
 * Detect if assistant is repeating the user's question back.
 * e.g., "You asked about X. Here's the answer..."
 * Returns the text with the repetition removed.
 */
function removeEchoedQuestions(text) {
  // Common patterns: "You asked ...", "You mentioned ...", "You want to ..."
  return text.replace(
    /^(you (asked|mentioned|said|want(ed)? to|were asking|brought up)[^.]*\.\s*)/im,
    ''
  );
}

/**
 * Pre-trim a single turn's text content.
 */
function pretrimTurnText(text, role) {
  // Extract code blocks to protect them
  const { cleaned, blocks } = extractCodeBlocks(text);
  
  // Process line by line
  let lines = cleaned.split('\n');
  
  if (role === 'assistant') {
    lines = lines.map(l => trimFillerFromLine(l));
  }
  
  let result = lines.filter(l => l.trim() !== '' || l === '').join('\n');
  
  if (role === 'assistant') {
    result = removeEchoedQuestions(result);
  }
  
  // Restore code blocks
  result = restoreCodeBlocks(result, blocks);
  
  // Collapse whitespace
  result = collapseWhitespace(result);
  
  return result;
}

/**
 * Main pre-trim function.
 * Takes an array of turns: [{ role: "user"|"assistant", text: "..." }, ...]
 * Returns { formatted: string, stats: { originalChars, trimmedChars } }
 */
export function pretrim(turns) {
  const originalChars = turns.reduce((sum, t) => sum + t.text.length, 0);
  
  const trimmedTurns = turns.map((turn, i) => {
    const trimmedText = pretrimTurnText(turn.text, turn.role);
    return {
      ...turn,
      text: trimmedText,
      turnNumber: i + 1
    };
  }).filter(t => t.text.length > 0); // Remove completely empty turns
  
  // Format as structured text
  const formatted = trimmedTurns.map(t => {
    const roleLabel = t.role === 'user' ? 'USER' : 'ASSISTANT';
    return `[TURN ${t.turnNumber} - ${roleLabel}]\n${t.text}`;
  }).join('\n\n');
  
  const trimmedChars = formatted.length;
  
  return {
    formatted,
    turnCount: trimmedTurns.length,
    stats: {
      originalChars,
      trimmedChars,
      reduction: originalChars > 0 
        ? Math.round((1 - trimmedChars / originalChars) * 100) 
        : 0
    }
  };
}

/**
 * Aggressive pre-trim for very long conversations.
 * Keeps last N turns in full, summarizes older turns to key lines only.
 */
export function pretrimAggressive(turns, keepLastN = 15) {
  if (turns.length <= keepLastN) {
    return pretrim(turns);
  }
  
  const olderTurns = turns.slice(0, -keepLastN);
  const recentTurns = turns.slice(-keepLastN);
  
  // For older turns: keep only lines with code, decisions, errors, or key info
  const olderSummary = olderTurns.map((turn, i) => {
    const { cleaned, blocks } = extractCodeBlocks(turn.text);
    const importantLines = cleaned.split('\n').filter(line => {
      const t = line.trim();
      if (t.length < 10) return false;
      // Keep lines with: decisions, errors, file paths, technical terms
      return (
        /```|__CODE_BLOCK_/.test(t) ||
        /\b(decided|conclusion|solution|fix|error|failed|bug|resolved)\b/i.test(t) ||
        /\b(function|class|import|export|const|let|var|def |return)\b/.test(t) ||
        /[\/\\][\w.-]+\.\w+/.test(t) || // file paths
        /^[-*•]\s/.test(t) || // bullet points
        /^\d+\.\s/.test(t)  // numbered lists
      );
    });
    
    if (importantLines.length === 0 && blocks.length === 0) return null;
    
    let text = importantLines.join('\n');
    text = restoreCodeBlocks(text, blocks);
    
    const roleLabel = turn.role === 'user' ? 'USER' : 'ASSISTANT';
    return `[TURN ${i + 1} - ${roleLabel} (summarized)]\n${text}`;
  }).filter(Boolean);
  
  // For recent turns: full pre-trim
  const recentResult = pretrim(recentTurns);
  
  const originalChars = turns.reduce((sum, t) => sum + t.text.length, 0);
  const olderText = olderSummary.join('\n\n');
  const formatted = olderText 
    ? `--- OLDER CONTEXT (summarized) ---\n${olderText}\n\n--- RECENT CONVERSATION ---\n${recentResult.formatted}`
    : recentResult.formatted;
  
  return {
    formatted,
    turnCount: turns.length,
    stats: {
      originalChars,
      trimmedChars: formatted.length,
      reduction: originalChars > 0 
        ? Math.round((1 - formatted.length / originalChars) * 100) 
        : 0
    }
  };
}
