import { describe, it, expect } from 'vitest';
import { extractAnswer, looksTruncated } from '../src/modules/chat/answerExtractor';

// These cases are taken from real leaked output. The previous approach was a
// blocklist of phrases, which by construction only catches wordings someone
// enumerated; these assert the structural behaviour that replaced it.

describe('extractAnswer — chain-of-thought leakage', () => {
  it('removes the "thinking process" preamble and keeps the answer', () => {
    const result = extractAnswer(
      "Here's a thinking process: 1. Analyze User Input. 2. Check data.\n\nFinal answer: Spend rose 12% to $4,673."
    );
    expect(result.answer).toBe('Spend rose 12% to $4,673.');
  });

  it('removes arithmetic-verification monologue', () => {
    const result = extractAnswer(
      "Let's verify the math: 2033 + 2640 = 4673. 77 + 121 = 198.\nFinal: Total spend was $4,673 across 198 conversions."
    );
    expect(result.answer).toBe('Total spend was $4,673 across 198 conversions.');
  });

  it('rejects rather than shows a monologue with no recoverable answer', () => {
    // Showing nothing model-written beats showing deliberation; the caller
    // substitutes a deterministic summary.
    const result = extractAnswer("Here's a thinking process: the user is asking about campaigns. Let me think through it.");
    expect(result.answer).toBeNull();
    expect(result.method).toBe('rejected');
  });

  it('prefers an explicit <answer> block over everything else', () => {
    const result = extractAnswer('<think>rambling</think><answer>Spend was $4,673.</answer>');
    expect(result.answer).toBe('Spend was $4,673.');
    expect(result.method).toBe('answer_tag');
  });

  it('discards untagged reasoning that precedes an answer block', () => {
    const result = extractAnswer('Okay so the user wants campaigns. Let me check.\n<answer>Brand_Search is most efficient.</answer>');
    expect(result.answer).toBe('Brand_Search is most efficient.');
  });

  it('strips an unclosed reasoning tag, which is what truncation looks like', () => {
    expect(extractAnswer('<think>I should first check whether the data covers').answer).toBeNull();
  });

  it('handles every reasoning tag variant, including overlapping prefixes', () => {
    // <thinking> must not be half-consumed by the shorter 'think' pattern.
    for (const tag of ['think', 'thought', 'thinking', 'reasoning', 'scratchpad', 'analysis', 'reflection']) {
      expect(extractAnswer(`<${tag}>noise</${tag}>Clean answer here.`).answer).toBe('Clean answer here.');
    }
  });

  it('handles tags carrying attributes', () => {
    expect(extractAnswer('<think type="internal">x</think>Answer.').answer).toBe('Answer.');
  });

  it('leaves a genuinely clean answer untouched', () => {
    const text = 'Spend rose 12.4% to $48,210, driven mainly by Brand_Search.';
    const result = extractAnswer(text);
    expect(result.answer).toBe(text);
    expect(result.method).toBe('clean');
  });

  it('does not mangle an answer that merely contains the word "think"', () => {
    expect(extractAnswer('I think spend rose 12%.').answer).toBe('I think spend rose 12%.');
  });

  it('treats a populated provider reasoning channel as already separated', () => {
    const result = extractAnswer('Spend rose 12%.', 'internal chain of thought');
    expect(result.answer).toBe('Spend rose 12%.');
    expect(result.strippedReasoning).toBe(true);
  });
});

describe('looksTruncated', () => {
  it('catches the reported mid-sentence cut-off', () => {
    expect(looksTruncated("Let's verify the math: 2033 + 2640 = 4673. 77 + 121 =")).toBe(true);
  });

  it('catches dangling conjunctions and commas', () => {
    expect(looksTruncated('Spend rose sharply and')).toBe(true);
    expect(looksTruncated('Spend rose in August,')).toBe(true);
  });

  it('accepts properly terminated sentences', () => {
    expect(looksTruncated('Spend rose 12%.')).toBe(false);
    expect(looksTruncated('Was it worth it?')).toBe(false);
    expect(looksTruncated('Efficiency improved (notably).')).toBe(false);
  });

  it('treats empty output as truncated', () => {
    expect(looksTruncated('   ')).toBe(true);
  });
});
