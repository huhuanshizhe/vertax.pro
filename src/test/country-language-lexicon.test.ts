import { describe, expect, it, vi, beforeEach } from 'vitest';

import { DbLexiconProvider } from '@/lib/radar/country-language-lexicon';

// Mock prisma
vi.mock('@/lib/prisma', () => ({
  prisma: {
    countryLanguageLexicon: {
      findMany: vi.fn(),
    },
  },
}));

import { prisma } from '@/lib/prisma';

const mockFindMany = vi.mocked(prisma.countryLanguageLexicon.findMany);

describe('DbLexiconProvider', () => {
  let provider: DbLexiconProvider;

  beforeEach(() => {
    provider = new DbLexiconProvider();
    vi.clearAllMocks();
  });

  it('falls back to FallbackLexiconProvider when no DB rows exist', async () => {
    mockFindMany.mockResolvedValue([]);

    const lexicon = await provider.getCountryLexicon('VN', 'painting_automation');

    expect(lexicon.languages).toContain('vi');
    expect(lexicon.languages).toContain('en');
    expect(lexicon.terms['vi']).toBeDefined();
    expect(lexicon.terms['vi'].processTerms.length).toBeGreaterThan(0);
    expect(lexicon.terms['vi'].processTerms).toContain('sơn phun');
  });

  it('returns merged DB rows when data exists', async () => {
    mockFindMany.mockResolvedValue([
      {
        id: 'row-1',
        tenantId: null,
        countryCode: 'VN',
        language: 'vi',
        packId: 'painting_automation',
        manufacturerTerms: ['nhà sản xuất', 'công ty'],
        industryTerms: ['linh kiện ô tô'],
        processTerms: ['sơn phun', 'xưởng sơn'],
        productTerms: ['vỏ nhựa'],
        exclusionTerms: ['sửa chữa ô tô'],
        source: 'manual',
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ] as never);

    const lexicon = await provider.getCountryLexicon('VN', 'painting_automation');

    expect(lexicon.languages).toContain('vi');
    expect(lexicon.languages).toContain('en');
    expect(lexicon.terms['vi'].processTerms).toContain('sơn phun');
    expect(lexicon.terms['vi'].processTerms).toContain('xưởng sơn');
    expect(lexicon.exclusionTerms['vi']).toContain('sửa chữa ô tô');
  });

  it('merges platform + tenant rows and deduplicates', async () => {
    mockFindMany.mockResolvedValue([
      {
        id: 'row-1',
        tenantId: null,
        countryCode: 'VN',
        language: 'vi',
        packId: 'painting_automation',
        manufacturerTerms: ['nhà sản xuất'],
        industryTerms: ['linh kiện ô tô'],
        processTerms: ['sơn phun'],
        productTerms: [],
        exclusionTerms: ['sửa chữa ô tô'],
        source: 'manual',
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 'row-2',
        tenantId: 'tenant-1',
        countryCode: 'VN',
        language: 'vi',
        packId: 'painting_automation',
        manufacturerTerms: ['nhà sản xuất', 'xí nghiệp'], // overlaps + adds new
        industryTerms: [],
        processTerms: ['phun sơn tự động'],
        productTerms: [],
        exclusionTerms: [],
        source: 'manual',
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ] as never);

    const lexicon = await provider.getCountryLexicon('VN', 'painting_automation', 'tenant-1');

    // Should deduplicate 'nhà sản xuất'
    expect(lexicon.terms['vi'].manufacturerTerms).toEqual(['nhà sản xuất', 'xí nghiệp']);
    // Should merge process terms
    expect(lexicon.terms['vi'].processTerms).toContain('sơn phun');
    expect(lexicon.terms['vi'].processTerms).toContain('phun sơn tự động');
  });

  it('caches results for 5 minutes', async () => {
    mockFindMany.mockResolvedValue([]);

    // First call hits DB (falls back)
    await provider.getCountryLexicon('VN', 'painting_automation');
    expect(mockFindMany).toHaveBeenCalledTimes(1);

    // Second call should use cache
    await provider.getCountryLexicon('VN', 'painting_automation');
    expect(mockFindMany).toHaveBeenCalledTimes(1); // Still 1
  });

  it('invalidate() clears cache for specific country', async () => {
    mockFindMany.mockResolvedValue([]);

    await provider.getCountryLexicon('VN', 'painting_automation');
    expect(mockFindMany).toHaveBeenCalledTimes(1);

    provider.invalidate('VN');

    await provider.getCountryLexicon('VN', 'painting_automation');
    expect(mockFindMany).toHaveBeenCalledTimes(2);
  });
});
