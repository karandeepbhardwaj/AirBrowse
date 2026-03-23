export interface TestStep {
  type: 'navigate' | 'click' | 'type' | 'select' | 'verify' | 'wait' | 'scroll' | 'screenshot';
  target?: string;
  value?: string;
  condition?: string;
  raw: string;
}

/**
 * Parse natural-language test instructions into structured TestStep objects.
 *
 * Handles numbered lists (1. 2. 3.), bullet points (- / *), and plain lines.
 * Each line is classified by action keywords and targets/values are extracted.
 */
export function parseInstructions(text: string): TestStep[] {
  const lines = text
    .split(/\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const steps: TestStep[] = [];
  const stepLinePattern = /^(?:\d+[\.\)]\s*|[-*]\s*)/;

  for (const raw of lines) {
    // Strip leading numbering / bullets for analysis
    const line = raw.replace(stepLinePattern, '').trim();
    if (!line) {
      continue;
    }

    const lower = line.toLowerCase();
    const step = classifyStep(lower, line, raw);
    if (step) {
      steps.push(step);
    }
  }

  return steps;
}

// ---- Internal helpers ----

function classifyStep(lower: string, line: string, raw: string): TestStep | null {
  // Navigate
  if (/^(go\s+to|navigate\s+to|open|visit|browse\s+to)\b/.test(lower)) {
    const url = extractUrl(line) ?? extractQuoted(line) ?? line.replace(/^(?:go\s+to|navigate\s+to|open|visit|browse\s+to)\s*/i, '').trim();
    return { type: 'navigate', target: url, raw };
  }

  // Screenshot
  if (/^(screenshot|capture|take\s+(?:a\s+)?screenshot)/.test(lower)) {
    return { type: 'screenshot', raw };
  }

  // Wait
  if (/^(wait|pause|sleep)/.test(lower)) {
    const ms = extractNumber(line);
    return { type: 'wait', value: ms ? String(ms) : '1000', raw };
  }

  // Scroll
  if (/^scroll/.test(lower)) {
    const selector = extractSelector(line);
    const amount = extractNumber(line);
    return { type: 'scroll', target: selector, value: amount ? String(amount) : undefined, raw };
  }

  // Verify / assert
  if (/^(verify|check|assert|confirm|expect|should|ensure|validate)/.test(lower) || /\bshould\b/.test(lower)) {
    const condition = extractQuoted(line) ?? line.replace(/^(?:verify|check|assert|confirm|expect|should|ensure|validate)\s*(?:that|the|page)?\s*/i, '').trim();
    return { type: 'verify', condition, raw };
  }

  // Select
  if (/^(select|choose|pick)/.test(lower)) {
    const selector = extractSelector(line);
    const value = extractQuoted(line);
    return { type: 'select', target: selector, value: value ?? undefined, raw };
  }

  // Type / fill / enter / input
  if (/^(type|enter|input|fill|write)\b/.test(lower)) {
    return parseTypeStep(line, raw);
  }

  // Click
  if (/^(click|press|tap|hit)\b/.test(lower)) {
    return parseClickStep(line, raw);
  }

  // Catch mid-sentence patterns: "...click...", "...type...", etc.
  if (/\bclick\s+(on\s+)?/i.test(lower)) {
    return parseClickStep(line.replace(/^.*?\bclick\s+(?:on\s+)?/i, 'click '), raw);
  }
  if (/\btype\b/i.test(lower)) {
    return parseTypeStep(line.replace(/^.*?\btype\s+/i, 'type '), raw);
  }
  if (/\bnavigate\s+to\b/i.test(lower)) {
    const url = extractUrl(line) ?? extractQuoted(line);
    return { type: 'navigate', target: url ?? line, raw };
  }
  if (/\b(verify|should|expect|assert)\b/i.test(lower)) {
    const condition = extractQuoted(line) ?? line;
    return { type: 'verify', condition, raw };
  }

  // Could not classify -- skip
  return null;
}

function parseClickStep(line: string, raw: string): TestStep {
  const selector = extractSelector(line);
  if (selector) {
    return { type: 'click', target: selector, raw };
  }

  // Try quoted text as the visible label, infer target as a button/link with that text
  const quoted = extractQuoted(line);
  if (quoted) {
    return { type: 'click', target: 'button', value: quoted, raw };
  }

  // Try "click the <target> button" pattern
  const btnMatch = line.match(/(?:click|press|tap|hit)\s+(?:the\s+|on\s+(?:the\s+)?)?"?(.+?)"?\s*(?:button|link|tab|icon|element|menu|item)?$/i);
  if (btnMatch) {
    const label = btnMatch[1].replace(/\b(button|link|tab|icon|element|menu|item)\b/gi, '').trim();
    return { type: 'click', target: 'button', value: label || undefined, raw };
  }

  return { type: 'click', raw };
}

function parseTypeStep(line: string, raw: string): TestStep {
  const selector = extractSelector(line);
  const quoted = extractQuoted(line);

  // Pattern: type 'value' in/into <selector>
  const intoMatch = line.match(/(?:type|enter|input|fill|write)\s+.+?\s+(?:in|into|to)\s+(.+)$/i);
  let target = selector;
  if (!target && intoMatch) {
    target = intoMatch[1].replace(/["']/g, '').trim();
  }

  return {
    type: 'type',
    target: target ?? undefined,
    value: quoted ?? undefined,
    raw,
  };
}

/**
 * Extract a CSS selector (#id, .class, tag[attr], or complex selectors).
 */
function extractSelector(text: string): string | undefined {
  // #id or .class selectors (possibly chained, e.g. #foo .bar > baz)
  const selectorMatch = text.match(/(#[\w-]+(?:\s*[>+~]\s*[\w.#\[\]=-]+)*|\.[\w-]+(?:\s*[>+~]\s*[\w.#\[\]=-]+)*|\w+\[[\w-]+(?:=[^\]]+)?\])/);
  if (selectorMatch) {
    return selectorMatch[1];
  }
  return undefined;
}

/**
 * Extract a URL from text.
 */
function extractUrl(text: string): string | undefined {
  const urlMatch = text.match(/(https?:\/\/\S+)/i);
  if (urlMatch) {
    return urlMatch[1];
  }
  return undefined;
}

/**
 * Extract content inside single or double quotes.
 */
function extractQuoted(text: string): string | undefined {
  const match = text.match(/['"]([^'"]+)['"]/);
  return match ? match[1] : undefined;
}

/**
 * Extract a number from text (e.g., wait times, scroll amounts).
 */
function extractNumber(text: string): number | undefined {
  const match = text.match(/\b(\d+)\b/);
  return match ? parseInt(match[1], 10) : undefined;
}
