import { describe, it, expect } from 'vitest';
import { STATIC_FIELD_CATALOGS } from '../src/modules/connectors/fieldCatalogs';

// GA4 reports its own schema through the metadata endpoint. The platforms
// here do not expose one that can be read without extra permissions, so
// their fields are declared. These assert the declarations are complete
// enough to be useful — a catalogue missing spend or a date dimension would
// look present and be useless.

describe('static field catalogues', () => {
  const types = ['GOOGLE_ADS', 'META_ADS', 'LINKEDIN_ADS', 'TIKTOK_ADS', 'ADOBE_ANALYTICS', 'MOCK'];

  it('covers every connector without a schema endpoint', () => {
    for (const type of types) {
      expect(STATIC_FIELD_CATALOGS[type]?.length ?? 0).toBeGreaterThan(0);
    }
  });

  it('gives every field a kind, an API name, a label and a category', () => {
    for (const [type, fields] of Object.entries(STATIC_FIELD_CATALOGS)) {
      for (const field of fields) {
        expect(['DIMENSION', 'METRIC'], `${type} ${field.apiName}`).toContain(field.kind);
        expect(field.apiName).toBeTruthy();
        expect(field.uiName).toBeTruthy();
        expect(field.category).toBeTruthy();
      }
    }
  });

  it('has no duplicate field within a kind', () => {
    for (const [type, fields] of Object.entries(STATIC_FIELD_CATALOGS)) {
      const keys = fields.map((field) => `${field.kind}:${field.apiName}`);
      expect(new Set(keys).size, type).toBe(keys.length);
    }
  });

  it('gives every catalogue both dimensions and metrics', () => {
    for (const [type, fields] of Object.entries(STATIC_FIELD_CATALOGS)) {
      expect(fields.some((field) => field.kind === 'DIMENSION'), type).toBe(true);
      expect(fields.some((field) => field.kind === 'METRIC'), type).toBe(true);
    }
  });

  it('exposes spend and conversions on every ad platform', () => {
    for (const type of ['GOOGLE_ADS', 'META_ADS', 'LINKEDIN_ADS', 'TIKTOK_ADS']) {
      const labels = STATIC_FIELD_CATALOGS[type].map((field) => field.uiName.toLowerCase());
      expect(labels.some((label) => label.includes('spend')), type).toBe(true);
      expect(labels.some((label) => label.includes('conversion')), type).toBe(true);
    }
  });

  it('gives every real platform a date dimension', () => {
    // Nothing is queryable over time without one.
    for (const [type, fields] of Object.entries(STATIC_FIELD_CATALOGS)) {
      if (type === 'MOCK') continue;
      const hasDate = fields.some(
        (field) => field.kind === 'DIMENSION' && /date|day/i.test(`${field.apiName}${field.uiName}`)
      );
      expect(hasDate, type).toBe(true);
    }
  });

  it('reuses categories rather than inventing one per field', () => {
    // Categories exist to group the browser; one each would defeat that.
    for (const [type, fields] of Object.entries(STATIC_FIELD_CATALOGS)) {
      expect(new Set(fields.map((field) => field.category)).size, type).toBeLessThan(fields.length);
    }
  });
});
