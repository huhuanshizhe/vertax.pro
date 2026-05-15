import { describe, expect, it } from 'vitest';
import {
  doesCountryMatchTargets,
  getCountryDisplayName,
  getCountryMatchPriority,
  normalizeCountryCode,
  toTavilyCountryName,
  inferOutreachLanguage,
  getValidOutreachLanguage,
  getOutreachLanguageLabel,
  getSupportedCountryLanguageEntries,
  OUTREACH_LANGUAGE_OPTIONS,
} from '@/lib/radar/country-utils';

describe('radar country utils', () => {
  it('normalizes common aliases to ISO codes', () => {
    expect(normalizeCountryCode('USA')).toBe('US');
    expect(normalizeCountryCode('U.S.A.')).toBe('US');
    expect(normalizeCountryCode('United States')).toBe('US');
    expect(normalizeCountryCode('CHN')).toBe('CN');
    expect(normalizeCountryCode('Deutschland')).toBe('DE');
    expect(normalizeCountryCode('Hong Kong')).toBe('HK');
    expect(normalizeCountryCode('Macau')).toBe('MO');
    expect(normalizeCountryCode('UK')).toBe('GB');
    expect(normalizeCountryCode('South Korea')).toBe('KR');
  });

  it('returns canonical display names', () => {
    expect(getCountryDisplayName('US')).toBe('United States');
    expect(getCountryDisplayName('DE')).toBe('Germany');
    expect(getCountryDisplayName('Deutschland')).toBe('Germany');
    expect(getCountryDisplayName('HKG')).toBe('Hong Kong');
    expect(getCountryDisplayName('MAC')).toBe('Macao');
  });

  it('builds Tavily country names from ISO codes', () => {
    expect(toTavilyCountryName('DE')).toBe('germany');
    expect(toTavilyCountryName('US')).toBe('united states');
    expect(toTavilyCountryName('HKG')).toBe('hong kong');
  });

  it('scores country matches before unknown and mismatched values', () => {
    expect(getCountryMatchPriority('United States', ['US'])).toBe(0);
    expect(getCountryMatchPriority(null, ['US'])).toBe(1);
    expect(getCountryMatchPriority('Germany', ['US'])).toBe(2);
    expect(doesCountryMatchTargets('USA', ['US'])).toBe(true);
    expect(doesCountryMatchTargets('Germany', ['US'])).toBe(false);
  });
});

// ==================== Outreach Language Tests ====================

describe('inferOutreachLanguage', () => {
  it('infers Vietnamese from country name or code', () => {
    expect(inferOutreachLanguage({ country: 'Vietnam' })).toBe('vi');
    expect(inferOutreachLanguage({ country: 'VN' })).toBe('vi');
    expect(inferOutreachLanguage({ country: 'Viet Nam' })).toBe('vi');
  });

  it('infers from website TLD when country is null', () => {
    expect(inferOutreachLanguage({ country: null, website: 'anphatco.vn' })).toBe('vi');
    expect(inferOutreachLanguage({ country: null, website: 'https://example.th' })).toBe('th');
    expect(inferOutreachLanguage({ country: null, website: 'https://www.company.jp/path' })).toBe('ja');
  });

  it('country takes priority over TLD', () => {
    expect(inferOutreachLanguage({ country: 'US', website: 'example.vn' })).toBe('en');
    expect(inferOutreachLanguage({ country: 'Germany', website: 'example.vn' })).toBe('de');
  });

  it('defaults to en for unknown/empty inputs', () => {
    expect(inferOutreachLanguage({})).toBe('en');
    expect(inferOutreachLanguage({ country: null, website: null })).toBe('en');
    expect(inferOutreachLanguage({ country: 'Atlantis' })).toBe('en');
    expect(inferOutreachLanguage({ country: null, website: 'example.com' })).toBe('en');
  });

  it('returns zh-Hans for CN, zh-Hant for TW/HK', () => {
    expect(inferOutreachLanguage({ country: 'CN' })).toBe('zh-Hans');
    expect(inferOutreachLanguage({ country: 'TW' })).toBe('zh-Hant');
    expect(inferOutreachLanguage({ country: 'HK' })).toBe('zh-Hant');
    expect(inferOutreachLanguage({ country: 'Hong Kong' })).toBe('zh-Hant');
  });

  it('maps Southeast Asian countries correctly', () => {
    expect(inferOutreachLanguage({ country: 'Thailand' })).toBe('th');
    expect(inferOutreachLanguage({ country: 'Indonesia' })).toBe('id');
    expect(inferOutreachLanguage({ country: 'Malaysia' })).toBe('ms');
    expect(inferOutreachLanguage({ country: 'Philippines' })).toBe('fil');
  });

  it('maps Arabic-speaking countries', () => {
    expect(inferOutreachLanguage({ country: 'Saudi Arabia' })).toBe('ar');
    expect(inferOutreachLanguage({ country: 'UAE' })).toBe('ar');
    expect(inferOutreachLanguage({ country: 'Egypt' })).toBe('ar');
  });

  it('returns en for English-speaking countries', () => {
    expect(inferOutreachLanguage({ country: 'US' })).toBe('en');
    expect(inferOutreachLanguage({ country: 'United Kingdom' })).toBe('en');
    expect(inferOutreachLanguage({ country: 'Australia' })).toBe('en');
    expect(inferOutreachLanguage({ country: 'Singapore' })).toBe('en');
    expect(inferOutreachLanguage({ country: 'India' })).toBe('en');
  });
});

describe('getValidOutreachLanguage', () => {
  it('returns valid code as-is', () => {
    expect(getValidOutreachLanguage('vi')).toBe('vi');
    expect(getValidOutreachLanguage('en')).toBe('en');
    expect(getValidOutreachLanguage('zh-Hans')).toBe('zh-Hans');
    expect(getValidOutreachLanguage('zh-Hant')).toBe('zh-Hant');
    expect(getValidOutreachLanguage('fil')).toBe('fil');
  });

  it('returns undefined for invalid codes (NOT en fallback)', () => {
    expect(getValidOutreachLanguage('invalid')).toBeUndefined();
    expect(getValidOutreachLanguage('<script>alert(1)</script>')).toBeUndefined();
    expect(getValidOutreachLanguage('')).toBeUndefined();
    expect(getValidOutreachLanguage('tl')).toBeUndefined(); // use 'fil' not 'tl'
  });

  it('returns undefined for non-string inputs', () => {
    expect(getValidOutreachLanguage(undefined)).toBeUndefined();
    expect(getValidOutreachLanguage(null)).toBeUndefined();
    expect(getValidOutreachLanguage(123)).toBeUndefined();
    expect(getValidOutreachLanguage({})).toBeUndefined();
  });
});

describe('getOutreachLanguageLabel', () => {
  it('returns display label for known codes', () => {
    expect(getOutreachLanguageLabel('vi')).toBe('Tieng Viet');
    expect(getOutreachLanguageLabel('en')).toBe('English');
    expect(getOutreachLanguageLabel('ja')).toBe('Japanese');
  });

  it('returns code itself for unknown codes', () => {
    expect(getOutreachLanguageLabel('xx')).toBe('xx');
  });
});

describe('outreach language mapping consistency', () => {
  it('every country mapping value exists in OUTREACH_LANGUAGE_OPTIONS', () => {
    const validCodes = new Set<string>(OUTREACH_LANGUAGE_OPTIONS.map((o) => o.code));
    for (const [country, lang] of getSupportedCountryLanguageEntries()) {
      expect(
        validCodes.has(lang),
        `Country "${country}" maps to "${lang}" which is not in OUTREACH_LANGUAGE_OPTIONS`,
      ).toBe(true);
    }
  });
});
