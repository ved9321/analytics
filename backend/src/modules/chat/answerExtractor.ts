// Structural separation of reasoning from answer.
//
// The previous approach was a blocklist of phrases ("here's a thinking
// process", "let me think through"). That fails by construction: it only
// catches wordings someone thought to enumerate, so any model that phrases
// its monologue differently sails straight through to the user.
//
// This module treats the problem structurally instead, in four layers, most
// reliable first:
//
//   1. The provider's own reasoning channel. Reasoning models on OpenRouter
//      return `reasoning` separately from `content`; when a model honours
//      that, content is already clean.
//   2. An explicit <answer> block, which the prompt demands. If present,
//      everything outside it is discarded regardless of what it says.
//   3. Known reasoning tags (<think>, <thought>, <reasoning>, <scratchpad>),
//      including an UNCLOSED opening tag — which is what a truncated
//      reasoning dump looks like.
//   4. The phrase heuristics, kept only as a last resort for models that do
//      none of the above.
//
// The critical property: if a response cannot be shown to contain a clean
// answer, this returns null and the caller falls back to a deterministic
// summary. Showing nothing model-written is strictly better than showing a
// monologue.

const REASONING_TAGS = ['think', 'thought', 'thinking', 'reasoning', 'scratchpad', 'analysis', 'reflection'];

/** Phrases that only ever appear in a model talking to itself. */
const MONOLOGUE_MARKERS = [
  /here['’]s a thinking process/i,
  /^\s*thinking process\s*:/im,
  /let me think through/i,
  /let['’]s verify the math/i,
  /^\s*let['’]?s? draft\s*:/im,
  /^\s*draft\s*\d*\s*:/im,
  /^\s*(?:check|checking) (?:word count|guidelines|against rules|the rules)\s*:/im,
  /^\s*self-check\s*:/im,
  /^\s*(?:step|rule)\s*\d+\s*:\s*(?:analyz|verif|check|confirm)/im,
  /the user (?:is asking|wants|asked)/i,
  /^\s*specific format requirements/im,
  /^\s*now user asks/im,
];

/** Markers a model uses to announce the real answer after deliberating. */
const ANSWER_MARKERS = /(?:^|\n)\s*(?:revised draft|final answer|final response|final|answer)\s*:\s*/gi;

export interface ExtractionResult {
  /** Clean answer, or null when nothing trustworthy could be recovered. */
  answer: string | null;
  /** Which layer produced the result — surfaced in the trace for debugging. */
  method: 'reasoning_channel' | 'answer_tag' | 'tag_strip' | 'marker_split' | 'clean' | 'rejected';
  /** True when reasoning text was found and removed. */
  strippedReasoning: boolean;
}

function stripReasoningTags(text: string): { text: string; stripped: boolean } {
  let out = text;
  let stripped = false;

  // One alternation with a backreference, rather than a loop per tag name.
  // Looping matched `<think` inside `<thinking>` and consumed up to the
  // `</think` inside `</thinking>`, leaving a mangled `ing>` fragment. The
  // \b plus \1 make each tag match only its own closing tag.
  const alternation = REASONING_TAGS.join('|');

  const paired = new RegExp(`<(${alternation})\\b[^>]*>[\\s\\S]*?<\\/\\1\\s*>`, 'gi');
  if (paired.test(out)) {
    out = out.replace(paired, '');
    stripped = true;
  }

  // An opening tag with no close means the model was still reasoning when
  // it ran out of tokens. Everything from there on is monologue.
  const unclosed = new RegExp(`<(?:${alternation})\\b[^>]*>[\\s\\S]*$`, 'i');
  if (unclosed.test(out)) {
    out = out.replace(unclosed, '');
    stripped = true;
  }

  return { text: out.trim(), stripped };
}

/**
 * Recovers the answer from a raw model response.
 *
 * `reasoningField` is the provider's separate reasoning channel, when the
 * model populated it.
 */
export function extractAnswer(rawContent: string, reasoningField?: string): ExtractionResult {
  const raw = (rawContent ?? '').trim();
  if (!raw) return { answer: null, method: 'rejected', strippedReasoning: Boolean(reasoningField) };

  // --- Layer 2: explicit answer block (checked before the reasoning
  // channel, because a model may use both and the tag is more specific).
  const answerTag = raw.match(/<answer>([\s\S]*?)<\/answer>/i);
  if (answerTag) {
    const inner = answerTag[1].trim();
    return inner
      ? { answer: inner, method: 'answer_tag', strippedReasoning: true }
      : { answer: null, method: 'rejected', strippedReasoning: true };
  }

  // An opened-but-unclosed <answer> means truncation mid-answer. The partial
  // text is still the answer, and the caller decides whether to keep it.
  const openAnswer = raw.match(/<answer>([\s\S]*)$/i);
  if (openAnswer) {
    const inner = openAnswer[1].trim();
    return inner
      ? { answer: inner, method: 'answer_tag', strippedReasoning: true }
      : { answer: null, method: 'rejected', strippedReasoning: true };
  }

  // --- Layer 3: strip known reasoning tags.
  const { text: untagged, stripped } = stripReasoningTags(raw);
  if (stripped) {
    return untagged
      ? { answer: untagged, method: 'tag_strip', strippedReasoning: true }
      : { answer: null, method: 'rejected', strippedReasoning: true };
  }

  // --- Layer 1: provider reasoning channel, content already separate.
  if (reasoningField && raw) {
    if (!MONOLOGUE_MARKERS.some((marker) => marker.test(raw))) {
      return { answer: raw, method: 'reasoning_channel', strippedReasoning: true };
    }
  }

  // --- Layer 4: phrase heuristics.
  const hasMonologue = MONOLOGUE_MARKERS.some((marker) => marker.test(raw));
  if (!hasMonologue) {
    return { answer: raw, method: 'clean', strippedReasoning: Boolean(reasoningField) };
  }

  // Monologue detected. If the model announced a final answer, take
  // everything after the LAST such marker.
  ANSWER_MARKERS.lastIndex = 0;
  let lastIndex = -1;
  let match: RegExpExecArray | null;
  while ((match = ANSWER_MARKERS.exec(raw))) lastIndex = match.index + match[0].length;

  if (lastIndex >= 0) {
    const tail = raw
      .slice(lastIndex)
      .replace(/\n\s*(?:check against rules|self-check|quality check)[\s\S]*$/i, '')
      .trim();
    // A tail that still looks like deliberation isn't an answer.
    if (tail && !MONOLOGUE_MARKERS.some((marker) => marker.test(tail))) {
      return { answer: tail, method: 'marker_split', strippedReasoning: true };
    }
  }

  // Monologue with no recoverable answer. Reject rather than show it.
  return { answer: null, method: 'rejected', strippedReasoning: true };
}

/**
 * True when text ends mid-thought. Used to avoid publishing a sentence that
 * stops in the middle — which is what made a truncated reply run visually
 * into the chart beneath it.
 */
export function looksTruncated(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return true;

  // Ends on sentence-final punctuation, a closing bracket, or a digit+% —
  // all legitimate endings.
  if (/[.!?)\]"'’”]$/.test(trimmed)) return false;
  if (/\d%$/.test(trimmed)) return false;

  // Dangling operator, comma, colon or conjunction is a clear cut-off.
  if (/[,:;+\-=/*]$/.test(trimmed)) return true;
  if (/\b(?:and|or|but|the|a|an|of|to|in|for|with|is|was|were|by)$/i.test(trimmed)) return true;

  // Otherwise: a final line with no terminal punctuation is suspicious once
  // it is long enough to have been a real sentence.
  const lastLine = trimmed.split('\n').pop() ?? '';
  return lastLine.length > 40;
}
