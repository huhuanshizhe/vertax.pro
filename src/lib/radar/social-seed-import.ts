/**
 * Social Seed Import
 *
 * Accepts a batch of social page URLs (Facebook/LinkedIn) and creates RadarCandidates
 * linked to the appropriate social SERP source. Useful for manual enrichment of
 * known company social pages found via CRM or trade show lists.
 */

import { prisma } from '@/lib/prisma';

export interface SocialSeedItem {
  displayName: string;
  facebookUrl?: string | null;
  linkedInUrl?: string | null;
  website?: string | null;
  country?: string | null;
  industry?: string | null;
  description?: string | null;
}

export interface SocialSeedInput {
  tenantId: string;
  userId: string;
  items: SocialSeedItem[];
  /** Source code to attribute. Default: 'manual_social_seed' */
  sourceCode?: string;
}

export interface SocialSeedResult {
  total: number;
  created: number;
  duplicates: number;
  errors: string[];
}

/**
 * Import social seed items as RadarCandidates.
 *
 * Each item with a facebookUrl creates a candidate linked to 'social_facebook_serp' source.
 * Each item with a linkedInUrl creates a candidate linked to 'social_linkedin_serp' source.
 * If both URLs exist, two candidates are created (one per channel).
 */
export async function importSocialSeed(input: SocialSeedInput): Promise<SocialSeedResult> {
  const { tenantId, items, sourceCode = 'manual_social_seed' } = input;

  // Resolve source — look up or create the manual_social_seed source
  let source = await prisma.radarSource.findUnique({ where: { code: sourceCode } });
  if (!source) {
    source = await prisma.radarSource.create({
      data: {
        tenantId,
        channelType: 'SOCIAL',
        name: 'Manual Social Seed',
        code: sourceCode,
        description: 'Manually imported social page URLs for radar discovery',
        adapterType: 'MANUAL',
        storagePolicy: 'TTL_CACHE',
        ttlDays: 365,
        isEnabled: true,
      },
    });
  }

  let created = 0;
  let duplicates = 0;
  const errors: string[] = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];

    if (!item.displayName) {
      errors.push(`Row ${i}: missing displayName`);
      continue;
    }

    // Create candidate for Facebook URL
    if (item.facebookUrl) {
      const result = await upsertSocialCandidate({
        tenantId,
        sourceId: source.id,
        displayName: item.displayName,
        socialUrl: item.facebookUrl,
        socialType: 'facebook',
        item,
      });
      if (result === 'created') created++;
      else if (result === 'duplicate') duplicates++;
    }

    // Create candidate for LinkedIn URL
    if (item.linkedInUrl) {
      const result = await upsertSocialCandidate({
        tenantId,
        sourceId: source.id,
        displayName: item.displayName,
        socialUrl: item.linkedInUrl,
        socialType: 'linkedin',
        item,
      });
      if (result === 'created') created++;
      else if (result === 'duplicate') duplicates++;
    }

    // If neither URL provided, still create a basic candidate with website
    if (!item.facebookUrl && !item.linkedInUrl && item.website) {
      const result = await upsertSocialCandidate({
        tenantId,
        sourceId: source.id,
        displayName: item.displayName,
        socialUrl: item.website,
        socialType: 'web',
        item,
      });
      if (result === 'created') created++;
      else if (result === 'duplicate') duplicates++;
    }
  }

  return {
    total: items.length,
    created,
    duplicates,
    errors,
  };
}

async function upsertSocialCandidate(params: {
  tenantId: string;
  sourceId: string;
  displayName: string;
  socialUrl: string;
  socialType: 'facebook' | 'linkedin' | 'web';
  item: SocialSeedItem;
}): Promise<'created' | 'duplicate'> {
  const { tenantId, sourceId, displayName, socialUrl, socialType, item } = params;
  const externalId = `social_seed:${socialType}:${normalizeUrl(socialUrl)}`;

  const existing = await prisma.radarCandidate.findUnique({
    where: { sourceId_externalId: { sourceId, externalId } },
    select: { id: true },
  });

  if (existing) return 'duplicate';

  await prisma.radarCandidate.create({
    data: {
      tenantId,
      sourceId,
      candidateType: 'COMPANY',
      externalId,
      sourceUrl: socialUrl,
      displayName,
      description: item.description || null,
      website: item.website || null,
      country: item.country || null,
      industry: item.industry || null,
      facebookUrl: socialType === 'facebook' ? socialUrl : (item.facebookUrl || null),
      linkedInUrl: socialType === 'linkedin' ? socialUrl : (item.linkedInUrl || null),
      status: 'REVIEWING', // Manual seeds start as REVIEWING for human triage
      matchExplain: { source: 'manual_social_seed', socialType },
    },
  });

  return 'created';
}

/** Normalize a URL for consistent dedup keying */
function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url.startsWith('http') ? url : `https://${url}`);
    // Remove trailing slash, lowercase host
    return `${parsed.host}${parsed.pathname.replace(/\/$/, '')}`.toLowerCase();
  } catch {
    return url.toLowerCase().trim();
  }
}
