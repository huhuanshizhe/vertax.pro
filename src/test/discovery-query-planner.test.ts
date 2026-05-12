import { describe, expect, it } from 'vitest';

import {
  FallbackLexiconProvider,
  normalizeUnicode,
  planDiscoveryQueries,
  type QueryPlanInput,
} from '@/lib/radar/discovery-query-planner';
import { buildTenantIndustryRadarHints } from '@/lib/radar/tenant-industry-source-pack';

describe('DiscoveryQueryPlanner', () => {
  const tdpaintHints = buildTenantIndustryRadarHints({
    tenantSlug: 'tdpaint',
    companyName: 'TD Painting Systems',
    companyIntro: 'Robotic painting systems, paint booth automation, liquid paint finishing.',
    targetIndustries: ['automotive component robotic painting line'],
  });

  const machRioHints = buildTenantIndustryRadarHints({
    tenantSlug: 'machrio',
    companyName: 'Machrio',
    companyIntro: 'MRO industrial supplies, fasteners, PPE, material handling.',
  });

  it('generates English and local-language queries for TDPaint SEA countries', async () => {
    const input: QueryPlanInput = {
      tenantId: 'tenant-1',
      tenantSlug: 'tdpaint',
      packHints: tdpaintHints,
      targetCountries: ['VN'],
      currentAdapterCode: 'brave_search',
    };

    const result = await planDiscoveryQueries(input);

    expect(result.totalQueries).toBeGreaterThan(0);
    expect(result.byCountry.VN).toBeGreaterThan(0);
    expect(result.byLanguage.en).toBeGreaterThan(0);
    expect(Object.keys(result.byLanguage).some((lang) => lang !== 'en')).toBe(true);
  });

  it('adds verification queries for hiring, expansion, compliance, video, and directories', async () => {
    const input: QueryPlanInput = {
      tenantId: 'tenant-1',
      tenantSlug: 'tdpaint',
      packHints: tdpaintHints,
      targetCountries: ['VN'],
      currentAdapterCode: 'brave_search',
    };

    const result = await planDiscoveryQueries(input);
    const categories = new Set(result.queries.map((query) => query.sourceCategory));

    expect(categories.has('hiring_signal')).toBe(true);
    expect(categories.has('expansion_news')).toBe(true);
    expect(categories.has('environmental_permit')).toBe(true);
    expect(categories.has('factory_video')).toBe(true);
    expect(categories.has('industrial_directory')).toBe(true);
    expect(result.queries.some((query) => query.text.includes('painting supervisor'))).toBe(true);
    expect(result.queries.some((query) => query.intent === 'verification')).toBe(true);
  });

  it('does not add TDPaint verification queries to MachRio', async () => {
    const input: QueryPlanInput = {
      tenantId: 'tenant-2',
      tenantSlug: 'machrio',
      packHints: machRioHints,
      targetCountries: ['VN'],
      currentAdapterCode: 'brave_search',
    };

    const result = await planDiscoveryQueries(input);
    const allQueryTexts = result.queries.map((query) => query.text.toLowerCase()).join(' ');

    expect(allQueryTexts).not.toContain('spray painting');
    expect(allQueryTexts).not.toContain('paint booth');
    expect(result.queries.some((query) => query.sourceCategory === 'hiring_signal')).toBe(false);
  });

  it('constrains source categories to adapter capabilities', async () => {
    const input: QueryPlanInput = {
      tenantId: 'tenant-1',
      tenantSlug: 'tdpaint',
      packHints: tdpaintHints,
      targetCountries: ['VN'],
      currentAdapterCode: 'exa_search',
    };

    const result = await planDiscoveryQueries(input);
    const categories = new Set(result.queries.map((query) => query.sourceCategory));

    expect(categories.has('exa_semantic')).toBe(true);
    expect(categories.has('web_serp_english')).toBe(false);
    expect(categories.has('hiring_signal')).toBe(false);
  });

  it('keeps planVersion stable for the same inputs', async () => {
    const input: QueryPlanInput = {
      tenantId: 'tenant-1',
      tenantSlug: 'tdpaint',
      packHints: tdpaintHints,
      targetCountries: ['VN', 'TH'],
      currentAdapterCode: 'brave_search',
    };

    const result1 = await planDiscoveryQueries(input);
    const result2 = await planDiscoveryQueries(input);

    expect(result1.planVersion).toBe(result2.planVersion);
    expect(result1.planVersion.length).toBe(12);
  });

  it('provides fallback lexicon data for supported countries', async () => {
    const provider = new FallbackLexiconProvider();
    const lexicon = await provider.getCountryLexicon('VN', 'painting_automation');

    expect(lexicon.languages).toContain('en');
    expect(lexicon.languages.length).toBeGreaterThan(1);
    expect(Object.keys(lexicon.terms).length).toBeGreaterThan(0);
  });

  it('normalizes compatibility characters', () => {
    expect(normalizeUnicode('ﬁnish')).toBe('finish');
  });
});
