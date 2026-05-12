/**
 * Database-backed Country Language Lexicon Provider
 *
 * Queries CountryLanguageLexicon table with a 5-minute in-memory cache.
 * Falls back to FallbackLexiconProvider when no DB rows exist for a given country+pack.
 */

import { prisma } from '@/lib/prisma';
import type { CountryLanguageLexiconProvider, MergedLexicon, LanguageTerms } from './discovery-query-planner';
import { FallbackLexiconProvider } from './discovery-query-planner';

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface CacheEntry {
  data: MergedLexicon;
  expiresAt: number;
}

export class DbLexiconProvider implements CountryLanguageLexiconProvider {
  private cache = new Map<string, CacheEntry>();
  private fallback = new FallbackLexiconProvider();

  private cacheKey(countryCode: string, packId?: string, tenantId?: string): string {
    return `${countryCode}:${packId || '_'}:${tenantId || '_'}`;
  }

  async getCountryLexicon(
    countryCode: string,
    packId?: string,
    tenantId?: string
  ): Promise<MergedLexicon> {
    const key = this.cacheKey(countryCode, packId, tenantId);
    const now = Date.now();

    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > now) {
      return cached.data;
    }

    // Query DB: platform-level rows (tenantId IS NULL) + tenant-specific overrides
    const rows = await prisma.countryLanguageLexicon.findMany({
      where: {
        countryCode: countryCode.toUpperCase(),
        isActive: true,
        OR: [
          { tenantId: null, packId: packId || null },
          ...(tenantId ? [{ tenantId, packId: packId || null }] : []),
          // Also include rows without a packId (shared terms)
          { tenantId: null, packId: null },
          ...(tenantId ? [{ tenantId, packId: null }] : []),
        ],
      },
      orderBy: [{ tenantId: 'asc' }, { packId: 'asc' }],
    });

    if (rows.length === 0) {
      // No DB data — fall back to hardcoded provider
      const fallbackData = await this.fallback.getCountryLexicon(countryCode, packId, tenantId);
      this.cache.set(key, { data: fallbackData, expiresAt: now + CACHE_TTL_MS });
      return fallbackData;
    }

    // Merge rows into MergedLexicon
    const languageSet = new Set<string>();
    const terms: Record<string, LanguageTerms> = {};
    const exclusionTerms: Record<string, string[]> = {};

    for (const row of rows) {
      const lang = row.language;
      languageSet.add(lang);

      if (!terms[lang]) {
        terms[lang] = {
          manufacturerTerms: [],
          industryTerms: [],
          processTerms: [],
          productTerms: [],
        };
      }

      // Append (tenant-specific rows override/extend platform rows)
      terms[lang].manufacturerTerms.push(...row.manufacturerTerms);
      terms[lang].industryTerms.push(...row.industryTerms);
      terms[lang].processTerms.push(...row.processTerms);
      terms[lang].productTerms.push(...row.productTerms);

      if (row.exclusionTerms.length > 0) {
        if (!exclusionTerms[lang]) exclusionTerms[lang] = [];
        exclusionTerms[lang].push(...row.exclusionTerms);
      }
    }

    // Deduplicate
    for (const lang of Object.keys(terms)) {
      terms[lang].manufacturerTerms = [...new Set(terms[lang].manufacturerTerms)];
      terms[lang].industryTerms = [...new Set(terms[lang].industryTerms)];
      terms[lang].processTerms = [...new Set(terms[lang].processTerms)];
      terms[lang].productTerms = [...new Set(terms[lang].productTerms)];
    }
    for (const lang of Object.keys(exclusionTerms)) {
      exclusionTerms[lang] = [...new Set(exclusionTerms[lang])];
    }

    // Always include 'en' in languages
    languageSet.add('en');

    const merged: MergedLexicon = {
      languages: [...languageSet],
      terms,
      exclusionTerms,
    };

    this.cache.set(key, { data: merged, expiresAt: now + CACHE_TTL_MS });
    return merged;
  }

  async getSupportedCountries(): Promise<string[]> {
    const rows = await prisma.countryLanguageLexicon.findMany({
      where: { isActive: true },
      select: { countryCode: true },
      distinct: ['countryCode'],
    });

    const dbCountries = rows.map((r) => r.countryCode);

    // Merge with fallback supported countries
    const fallbackCountries = await this.fallback.getSupportedCountries();
    return [...new Set([...dbCountries, ...fallbackCountries])];
  }

  /** Invalidate cache for a specific country (used after seeding) */
  invalidate(countryCode?: string): void {
    if (!countryCode) {
      this.cache.clear();
      return;
    }
    for (const key of this.cache.keys()) {
      if (key.startsWith(`${countryCode}:`)) {
        this.cache.delete(key);
      }
    }
  }
}

/** Singleton instance for use across the application */
export const dbLexiconProvider = new DbLexiconProvider();
