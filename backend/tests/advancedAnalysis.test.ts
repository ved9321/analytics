import { describe, expect, it } from 'vitest';
import { detectAnomalies, forecast } from '../src/modules/chat/advancedAnalysis';
import { cleanAssistantResponse } from '../src/modules/chat/chatOrchestrator';

describe('advanced analysis', () => {
  it('detects a two-standard-deviation daily outlier', () => {
    const rows = [1, 1, 1, 1, 10].map((sessions, index) => ({ day: `2026-09-0${index + 1}`, sessions }));
    expect(detectAnomalies(rows).rows).toHaveLength(1);
    expect(detectAnomalies(rows).rows[0].day).toBe('2026-09-05');
  });

  it('projects seven future daily values without inventing negative values', () => {
    const rows = [10, 20, 30].map((sessions, index) => ({ day: `2026-09-0${index + 1}`, sessions }));
    const result = forecast(rows);
    expect(result.rows).toHaveLength(7);
    expect(result.rows[0].sessions).toBe(40);
    expect(result.rows.every((row) => Number(row.sessions) >= 0)).toBe(true);
  });

  it('removes exposed reasoning and keeps the final draft', () => {
    const response = "Here's a thinking process:\n1. Inspect data.\n\nRevised draft: The platform breakdown is unavailable.\n\nCheck against rules: done.";
    expect(cleanAssistantResponse(response)).toBe('The platform breakdown is unavailable.');
  });

  it('rejects a reasoning-only response instead of showing the draft', () => {
    const response = "Here's a thinking process:\n1. Analyze the request.\n2. Check DATA.\n3. Draft sentence one.";
    expect(cleanAssistantResponse(response)).toBe('');
  });

  it('removes common reasoning tags', () => {
    expect(cleanAssistantResponse('<think>private reasoning</think>Final answer: 4,673 visits and 198 conversions.')).toBe(
      '4,673 visits and 198 conversions.'
    );
  });

  it('removes reasoning embedded after a valid answer', () => {
    const response = 'Clicks increased over the period.\n\nLet draft: this is internal.\n\nCheck word count: 20.\nCheck guidelines: okay.';
    expect(cleanAssistantResponse(response)).toBe('Clicks increased over the period.');
  });

  it('removes the format-planning block shown by weak models', () => {
    const response = 'The funnel data is available.\n\nspecific format requirements.\n\n- Now user asks for a funnel report.\n- I need to figure out what they want.';
    expect(cleanAssistantResponse(response)).toBe('The funnel data is available.');
  });
});
