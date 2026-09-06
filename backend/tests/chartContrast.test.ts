import { describe, it, expect } from 'vitest';
import { SERIES, labelOn, contrastRatio } from '../../frontend/components/charts/types';

// Chart series are fixed brand colours that do not change between themes, so
// a label on top of one cannot follow the theme either — it has to follow the
// fill. White text on the old yellow series was effectively invisible.

const LIGHT_CARD = '#FFFFFF';
const DARK_CARD = '#1D1C1A';

describe('series palette accessibility', () => {
  it('gives every colour a label with at least 4.5:1 contrast', () => {
    for (const fill of SERIES) {
      expect(contrastRatio(fill, labelOn(fill)), fill).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('keeps every colour visible as a line on both theme backgrounds', () => {
    for (const fill of SERIES) {
      expect(contrastRatio(fill, LIGHT_CARD), `${fill} on light`).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(fill, DARK_CARD), `${fill} on dark`).toBeGreaterThanOrEqual(3);
    }
  });

  it('always chooses the higher-contrast label of the two candidates', () => {
    // The first version compared luminance against a guessed threshold and
    // got this wrong: it put white on an orange where dark scored better.
    for (const fill of SERIES) {
      const chosen = labelOn(fill);
      const other = chosen === '#FFFFFF' ? '#12100E' : '#FFFFFF';
      expect(contrastRatio(fill, chosen), fill).toBeGreaterThanOrEqual(contrastRatio(fill, other));
    }
  });

  it('has no duplicate colours', () => {
    expect(new Set(SERIES).size).toBe(SERIES.length);
  });

  it('handles malformed input without throwing', () => {
    for (const value of ['', '#fff', 'not-a-colour', '#12']) {
      expect(() => labelOn(value)).not.toThrow();
    }
  });
});
