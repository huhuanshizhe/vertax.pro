import { describe, expect, it, vi, beforeEach } from 'vitest';

import { importSocialSeed, type SocialSeedItem } from '@/lib/radar/social-seed-import';

// Mock prisma
vi.mock('@/lib/prisma', () => ({
  prisma: {
    radarSource: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    radarCandidate: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
  },
}));

import { prisma } from '@/lib/prisma';

const mockSourceFindUnique = vi.mocked(prisma.radarSource.findUnique);
const mockSourceCreate = vi.mocked(prisma.radarSource.create);
const mockCandidateFindUnique = vi.mocked(prisma.radarCandidate.findUnique);
const mockCandidateCreate = vi.mocked(prisma.radarCandidate.create);

describe('importSocialSeed', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSourceFindUnique.mockResolvedValue({
      id: 'source-1',
      code: 'manual_social_seed',
    } as never);
  });

  it('creates candidates for Facebook and LinkedIn URLs', async () => {
    mockCandidateFindUnique.mockResolvedValue(null);
    mockCandidateCreate.mockResolvedValue({ id: 'c-1' } as never);

    const items: SocialSeedItem[] = [
      {
        displayName: 'Acme Corp',
        facebookUrl: 'https://facebook.com/acmecorp',
        linkedInUrl: 'https://linkedin.com/company/acme-corp',
        country: 'VN',
      },
    ];

    const result = await importSocialSeed({
      tenantId: 'tenant-1',
      userId: 'user-1',
      items,
    });

    expect(result.total).toBe(1);
    expect(result.created).toBe(2); // One for FB, one for LI
    expect(result.duplicates).toBe(0);
    expect(result.errors).toHaveLength(0);
    expect(mockCandidateCreate).toHaveBeenCalledTimes(2);
  });

  it('deduplicates existing candidates', async () => {
    // First call: exists; second call: not exists
    mockCandidateFindUnique
      .mockResolvedValueOnce({ id: 'existing-1' } as never)
      .mockResolvedValueOnce(null);
    mockCandidateCreate.mockResolvedValue({ id: 'c-2' } as never);

    const items: SocialSeedItem[] = [
      {
        displayName: 'Dupe Corp',
        facebookUrl: 'https://facebook.com/dupecorp',
        linkedInUrl: 'https://linkedin.com/company/dupe-corp',
      },
    ];

    const result = await importSocialSeed({
      tenantId: 'tenant-1',
      userId: 'user-1',
      items,
    });

    expect(result.created).toBe(1);
    expect(result.duplicates).toBe(1);
  });

  it('reports error for items missing displayName', async () => {
    const items: SocialSeedItem[] = [
      { displayName: '', facebookUrl: 'https://facebook.com/noname' },
    ];

    const result = await importSocialSeed({
      tenantId: 'tenant-1',
      userId: 'user-1',
      items,
    });

    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain('missing displayName');
    expect(result.created).toBe(0);
  });

  it('creates source when not found', async () => {
    mockSourceFindUnique.mockResolvedValue(null);
    mockSourceCreate.mockResolvedValue({
      id: 'new-source',
      code: 'manual_social_seed',
    } as never);
    mockCandidateFindUnique.mockResolvedValue(null);
    mockCandidateCreate.mockResolvedValue({ id: 'c-3' } as never);

    const items: SocialSeedItem[] = [
      { displayName: 'New Corp', facebookUrl: 'https://facebook.com/newcorp' },
    ];

    await importSocialSeed({
      tenantId: 'tenant-1',
      userId: 'user-1',
      items,
    });

    expect(mockSourceCreate).toHaveBeenCalledTimes(1);
    expect(mockSourceCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          code: 'manual_social_seed',
          channelType: 'SOCIAL',
          adapterType: 'MANUAL',
        }),
      })
    );
  });

  it('falls back to website when no social URLs provided', async () => {
    mockCandidateFindUnique.mockResolvedValue(null);
    mockCandidateCreate.mockResolvedValue({ id: 'c-4' } as never);

    const items: SocialSeedItem[] = [
      { displayName: 'Web Only Corp', website: 'https://webonly.com' },
    ];

    const result = await importSocialSeed({
      tenantId: 'tenant-1',
      userId: 'user-1',
      items,
    });

    expect(result.created).toBe(1);
    expect(mockCandidateCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          sourceUrl: 'https://webonly.com',
        }),
      })
    );
  });
});
