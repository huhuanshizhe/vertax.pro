'use server';

// ==================== Radar V2 Server Actions ====================
// 閺傛壆澧楅懢宄邦吂闂嗙柉鎻化鑽ょ埠 - 婢舵碍绗柆鎾冲絺閻?+ 閹锋稒鐖ｉ懕姘値

import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { requireDecider } from '@/lib/permissions';
import {
  validateRadarQuery,
  ValidationError,
} from '@/lib/validation';
import type {
  Prisma,
  ChannelType,
  CandidateStatus,
  CandidateType,
  RadarSource,
  RadarTask,
  RadarCandidate,
  ProspectCompany,
  ProspectContact,
  Opportunity,
} from '@prisma/client';
import {
  createRadarTask,
  runRadarTask,
  cancelRadarTask,
  cleanupExpiredCandidates,
} from '@/lib/radar/sync-service';
import {
  ensureAdaptersInitialized,
  listAdapterRegistrations,
  listAdaptersByChannel,
  getAdapterRegistration,
  getAdapter,
} from '@/lib/radar/adapters/registry';
import type { RadarSearchQuery } from '@/lib/radar/adapters/types';
import { enrichProspectCompany } from '@/lib/radar/enrich-pipeline';
import { getCandidateContactEnrichment } from '@/lib/radar/contact-enrichment';
import { buildProspectOutreachStateValue } from '@/lib/radar/prospect-outreach-state';

// ==================== 缁鐎风€电厧鍤?====================

export type RadarSourceData = RadarSource;
export type RadarTaskData = RadarTask;
export type RadarCandidateData = RadarCandidate;
export type ProspectCompanyData = ProspectCompany & { _count?: { contacts: number } };
export type ProspectContactData = ProspectContact;
export type OpportunityData = Opportunity;

export interface CreateProspectContactInput {
  companyId: string;
  name: string;
  email?: string;
  phone?: string;
  role?: string;
  department?: string;
  seniority?: string;
  linkedInUrl?: string;
  notes?: string;
}

export interface SyncResultData {
  success: boolean;
  taskId: string;
  stats: {
    fetched: number;
    created: number;
    duplicates: number;
    errors: string[];
    duration: number;
  };
}

export interface RadarStatsData {
  totalCandidates: number;
  newCandidates: number;
  qualifiedCandidates: number;
  importedCandidates: number;
  opportunities: number;
  companies: number;
  runningTasks: number;
}

export interface ProspectEnrichmentItemResult {
  companyId: string;
  companyName: string;
  success: boolean;
  personCount: number;
  error?: string;
}

export interface ProspectEnrichmentBatchResult {
  success: boolean;
  summary: {
    total: number;
    succeeded: number;
    failed: number;
    contactsFound: number;
  };
  results: ProspectEnrichmentItemResult[];
}

// ==================== 閸樺鍣稿銉ュ徔閸戣姤鏆?====================

/**
 * 鐟欏嫯瀵栭崠鏍秹缁旀瑥鐓欓崥宥囨暏娴滃氦娉曞┃鎰箵闁?
 * 娓氬顩? "https://www.example.com/path" -> "example.com"
 */
function normalizeDomainForDedup(website: string | null | undefined): string | null {
  if (!website) return null;
  try {
    const url = new URL(website.startsWith('http') ? website : `https://${website}`);
    let domain = url.hostname.toLowerCase();
    // 缁夊娅?www. 閸撳秶绱?
    if (domain.startsWith('www.')) {
      domain = domain.slice(4);
    }
    return domain;
  } catch {
    return null;
  }
}

function extractStringReasons(value: unknown): string[] | null {
  if (!value || typeof value !== 'object') return null;

  const reasons = (value as Record<string, unknown>).reasons;
  if (!Array.isArray(reasons)) return null;

  const stringReasons = reasons.filter(
    (reason): reason is string => typeof reason === 'string'
  );

  return stringReasons.length > 0 ? stringReasons : null;
}

// ==================== 閺佺増宓佸┃鎰吀閻?====================

/**
 * 閼惧嘲褰囬幍鈧張澶嬫殶閹诡喗绨?
 */
export async function getRadarSourcesV2(channelType?: ChannelType): Promise<RadarSource[]> {
  const session = await auth();
  if (!session?.user?.tenantId) throw new Error('Unauthorized');
  
  ensureAdaptersInitialized();
  
  const where: Record<string, unknown> = {
    OR: [
      { tenantId: session.user.tenantId },
      { tenantId: null }, // 缁崵绮虹痪褍鍙曢崗杈ㄧ爱
    ],
  };
  
  if (channelType) {
    where.channelType = channelType;
  }
  
  return prisma.radarSource.findMany({
    where,
    orderBy: [
      { isOfficial: 'desc' },
      { channelType: 'asc' },
      { name: 'asc' },
    ],
  });
}

/**
 * 閼惧嘲褰囬崣顖滄暏閻ㄥ嫰鈧倿鍘ら崳銊ュ灙鐞?
 */
export async function getAvailableAdaptersV2(channelType?: string) {
  ensureAdaptersInitialized();
  
  if (channelType) {
    return listAdaptersByChannel(channelType);
  }
  return listAdapterRegistrations();
}

/**
 * 閼惧嘲褰囬柅鍌炲帳閸ｃ劏顕涢幆?
 */
export async function getAdapterInfoV2(code: string) {
  ensureAdaptersInitialized();
  return getAdapterRegistration(code);
}

/**
 * 濡偓閺屻儲鏆熼幑顔界爱閸嬨儱鎮嶉悩鑸碘偓?
 */
export async function checkSourceHealthV2(sourceId: string) {
  const session = await auth();
  if (!session?.user?.tenantId) throw new Error('Unauthorized');
  
  ensureAdaptersInitialized();
  
  const source = await prisma.radarSource.findUnique({
    where: { id: sourceId },
  });
  
  if (!source) throw new Error('Source not found');
  
  const adapter = getAdapter(source.code, source.adapterConfig as Record<string, unknown>);
  const health = await adapter.healthCheck();
  
  // 閺囧瓨鏌婇弫鐗堝祦濠ф劗濮搁幀?
  await prisma.radarSource.update({
    where: { id: sourceId },
    data: {
      syncStats: {
        ...(source.syncStats as object || {}),
        lastHealthCheck: new Date().toISOString(),
        healthy: health.healthy,
        latency: health.latency,
        error: health.error,
      },
    },
  });
  
  return health;
}

/**
 * 閸掓繂顫愰崠鏍兇缂佺喐鏆熼幑顔界爱閿涘牓顩诲▎鈥插▏閻劍妞傜拫鍐暏閿?
 */
export async function initializeSystemSourcesV2() {
  const session = await auth();
  if (!session?.user?.tenantId) throw new Error('Unauthorized');
  
  ensureAdaptersInitialized();
  
  const registrations = listAdapterRegistrations();
  const created: RadarSource[] = [];
  
  for (const reg of registrations) {
    // 濡偓閺屻儲妲搁崥锕€鍑＄€涙ê婀?
    const existing = await prisma.radarSource.findUnique({
      where: { code: reg.code },
    });
    
    if (!existing) {
      const source = await prisma.radarSource.create({
        data: {
          tenantId: null, // 缁崵绮虹痪?
          channelType: reg.channelType as string as import('@prisma/client').$Enums.ChannelType,
          name: reg.name,
          code: reg.code,
          description: reg.description,
          websiteUrl: reg.websiteUrl,
          countries: reg.countries || [],
          regions: reg.regions || [],
          adapterType: reg.adapterType,
          adapterConfig: reg.defaultConfig as Prisma.InputJsonValue,
          isOfficial: reg.isOfficial,
          termsUrl: reg.termsUrl,
          storagePolicy: reg.storagePolicy,
          ttlDays: reg.ttlDays,
          attributionRequired: reg.attributionRequired,
          rateLimit: reg.features.rateLimit as Prisma.InputJsonValue,
          isEnabled: true,
        },
      });
      created.push(source);
    }
  }
  
  return created;
}

const AUTO_DISCOVERY_SOURCE_CODES = ['google_places', 'ai_search', 'apollo_org_search', 'batch_discovery', 'multi_search'] as const;

/**
 * 获取所有可用的自动发现数据源（有 API Key 的）
 */
async function getAvailableAutoDiscoverySources(): Promise<Array<{ source: RadarSource; hasApiKey: boolean }>> {
  ensureAdaptersInitialized();

  const results: Array<{ source: RadarSource; hasApiKey: boolean }> = [];

  for (const code of AUTO_DISCOVERY_SOURCE_CODES) {
    // 跳过 composite alias codes
    if (code === 'batch_discovery' || code === 'multi_search') continue;

    const existing = await prisma.radarSource.findUnique({
      where: { code },
    });

    if (existing) {
      const hasApiKey = checkSourceApiKeyAvailability(code);
      results.push({ source: existing, hasApiKey });
      continue;
    }

    // 尝试注册新源
    const registration = getAdapterRegistration(code);
    if (!registration) continue;

    try {
      const source = await prisma.radarSource.create({
        data: {
          tenantId: null,
          channelType: registration.channelType as string as import('@prisma/client').$Enums.ChannelType,
          name: registration.name,
          code: registration.code,
          description: registration.description,
          websiteUrl: registration.websiteUrl,
          countries: registration.countries || [],
          regions: registration.regions || [],
          adapterType: registration.adapterType,
          adapterConfig: registration.defaultConfig as Prisma.InputJsonValue,
          isOfficial: registration.isOfficial,
          termsUrl: registration.termsUrl,
          storagePolicy: registration.storagePolicy,
          ttlDays: registration.ttlDays,
          attributionRequired: registration.attributionRequired,
          rateLimit: registration.features.rateLimit as Prisma.InputJsonValue,
          isEnabled: true,
        },
      });
      const hasApiKey = checkSourceApiKeyAvailability(code);
      results.push({ source, hasApiKey });
    } catch (err) {
      console.warn(`[radar-v2] Failed to create source ${code}:`, err instanceof Error ? err.message : err);
    }
  }

  return results;
}

/**
 * 检查数据源是否有对应的 API Key
 */
function checkSourceApiKeyAvailability(code: string): boolean {
  switch (code) {
    case 'google_places':
      return !!(process.env.GOOGLE_MAPS_API_KEY);
    case 'ai_search':
      return !!(process.env.SERPAPI_KEY || process.env.SERPAPI_API_KEY || process.env.BRAVE_SEARCH_API_KEY);
    case 'apollo_org_search':
      return !!(process.env.APOLLO_API_KEY);
    default:
      return true; // 无需 API key 的源（如 TED, UNGM）
  }
}

async function getOrCreateAutoDiscoverySource(): Promise<RadarSource> {
  ensureAdaptersInitialized();

  for (const code of AUTO_DISCOVERY_SOURCE_CODES) {
    const existing = await prisma.radarSource.findUnique({
      where: { code },
    });

    if (existing) {
      return existing;
    }

    const registration = getAdapterRegistration(code);
    if (!registration) {
      continue;
    }

    return prisma.radarSource.create({
      data: {
        tenantId: null,
        channelType: registration.channelType as string as import('@prisma/client').$Enums.ChannelType,
        name: registration.name,
        code: registration.code,
        description: registration.description,
        websiteUrl: registration.websiteUrl,
        countries: registration.countries || [],
        regions: registration.regions || [],
        adapterType: registration.adapterType,
        adapterConfig: registration.defaultConfig as Prisma.InputJsonValue,
        isOfficial: registration.isOfficial,
        termsUrl: registration.termsUrl,
        storagePolicy: registration.storagePolicy,
        ttlDays: registration.ttlDays,
        attributionRequired: registration.attributionRequired,
        rateLimit: registration.features.rateLimit as Prisma.InputJsonValue,
        isEnabled: true,
      },
    });
  }

  throw new Error('No automatic discovery engine is available');
}

// ==================== 閸欐垹骞囨禒璇插缁狅紕鎮?====================

/**
 * 閸掓稑缂撻崣鎴犲箛娴犺濮?
 */
export async function createDiscoveryTaskV2(input: {
  sourceId?: string;
  name?: string;
  queryConfig: RadarSearchQuery;
  targetingRef?: {
    segmentId?: string;
    personaId?: string;
    specVersionId?: string;
  };
}): Promise<RadarTask> {
  // 妤犲矁鐦夋潏鎾冲弳
  if (!input.sourceId) {
    input.sourceId = (await getOrCreateAutoDiscoverySource()).id;
  }

  // 妤犲矁鐦夐弻銉嚄闁板秶鐤?
  const validatedQuery = validateRadarQuery(input.queryConfig);
  if (
    !validatedQuery.keywords?.length &&
    !validatedQuery.countries?.length &&
    !validatedQuery.regions?.length &&
    !validatedQuery.categories?.length &&
    !validatedQuery.targetIndustries?.length &&
    !validatedQuery.companyTypes?.length
  ) {
    throw new ValidationError('At least one targeting condition is required');
  }

  const session = await auth();
  if (!session?.user?.tenantId || !session.user.id) throw new Error('Unauthorized');

  if (!input.sourceId) {
    input.sourceId = (await getOrCreateAutoDiscoverySource()).id;
  }

  const sourceId = input.sourceId;

  return createRadarTask({
    tenantId: session.user.tenantId,
    sourceId,
    name: input.name || '按目标客户画像自动采集线索',
    queryConfig: validatedQuery,
    targetingRef: input.targetingRef,
    triggeredBy: session.user.id,
  });
}

/**
 * 鏉╂劘顢戦崣鎴犲箛娴犺濮?
 */
export async function runDiscoveryTaskV2(taskId: string): Promise<SyncResultData> {
  const session = await auth();
  if (!session?.user?.tenantId) throw new Error('Unauthorized');
  
  const task = await prisma.radarTask.findUnique({
    where: { id: taskId },
  });
  
  if (!task || task.tenantId !== session.user.tenantId) {
    throw new Error('Task not found');
  }
  
  return runRadarTask(taskId);
}

/**
 * 逐国迭代搜索：对每个国家依次发起 Google Places 搜索，汇总结果
 */
export async function runDiscoveryByCountries(input: {
  name: string;
  queryConfig: RadarSearchQuery;
  selectedCountries: string[];
  targetingRef?: { specVersionId?: string };
}): Promise<{
  success: boolean;
  countriesSearched: number;
  totalFetched: number;
  totalCreated: number;
  totalDuplicates: number;
  errors: string[];
  perCountry: Array<{
    country: string;
    fetched: number;
    created: number;
    duplicates: number;
    error?: string;
  }>;
}> {
  const session = await auth();
  if (!session?.user?.tenantId) throw new Error('Unauthorized');

  const perCountry: Array<{
    country: string;
    fetched: number;
    created: number;
    duplicates: number;
    error?: string;
  }> = [];
  
  let totalFetched = 0;
  let totalCreated = 0;
  let totalDuplicates = 0;
  const errors: string[] = [];

  for (const country of input.selectedCountries) {
    try {
      const singleCountryQuery: RadarSearchQuery = {
        ...input.queryConfig,
        countries: [country],
      };

      const task = await createDiscoveryTaskV2({
        name: `${input.name} - ${country}`,
        queryConfig: singleCountryQuery,
        targetingRef: input.targetingRef,
      });

      const result = await runRadarTask(task.id);

      perCountry.push({
        country,
        fetched: result.stats.fetched,
        created: result.stats.created,
        duplicates: result.stats.duplicates,
        error: result.stats.errors?.[0],
      });

      totalFetched += result.stats.fetched;
      totalCreated += result.stats.created;
      totalDuplicates += result.stats.duplicates;
      if (result.stats.errors?.length) {
        errors.push(`${country}: ${result.stats.errors[0]}`);
      }

      // 速率限制：国际 API 间隔 1.5s
      await new Promise(r => setTimeout(r, 1500));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      perCountry.push({ country, fetched: 0, created: 0, duplicates: 0, error: msg });
      errors.push(`${country}: ${msg}`);
    }
  }

  return {
    success: errors.length === 0,
    countriesSearched: input.selectedCountries.length,
    totalFetched,
    totalCreated,
    totalDuplicates,
    errors,
    perCountry,
  };
}

/**
 * 閸欐牗绉烽崣鎴犲箛娴犺濮?
 */
export async function cancelDiscoveryTaskV2(taskId: string): Promise<void> {
  const session = await auth();
  if (!session?.user?.tenantId || !session.user.id) throw new Error('Unauthorized');
  
  const task = await prisma.radarTask.findUnique({
    where: { id: taskId },
  });
  
  if (!task || task.tenantId !== session.user.tenantId) {
    throw new Error('Task not found');
  }
  
  return cancelRadarTask(taskId, session.user.id);
}

/**
 * 閼惧嘲褰囨禒璇插閸掓銆?
 */
export async function getDiscoveryTasksV2(options?: {
  sourceId?: string;
  status?: string;
  limit?: number;
}): Promise<Array<RadarTask & { source: RadarSource }>> {
  const session = await auth();
  if (!session?.user?.tenantId) throw new Error('Unauthorized');
  
  const where: Record<string, unknown> = {
    tenantId: session.user.tenantId,
  };
  
  if (options?.sourceId) {
    where.sourceId = options.sourceId;
  }
  if (options?.status) {
    where.status = options.status;
  }
  
  return prisma.radarTask.findMany({
    where,
    include: { source: true },
    orderBy: { createdAt: 'desc' },
    take: options?.limit || 50,
  });
}

/**
 * 閼惧嘲褰囨禒璇插鐠囷附鍎?
 */
export async function getDiscoveryTaskV2(taskId: string) {
  const session = await auth();
  if (!session?.user?.tenantId) throw new Error('Unauthorized');
  
  const task = await prisma.radarTask.findUnique({
    where: { id: taskId },
    include: { source: true },
  });
  
  if (task && task.tenantId !== session.user.tenantId) {
    return null;
  }
  
  return task;
}

// ==================== 閸婃瑩鈧鐫滅粻锛勬倞 ====================

/**
 * 閼惧嘲褰囬崐娆撯偓澶婂灙鐞?
 */
export async function getCandidatesV2(options?: {
  candidateType?: CandidateType;
  status?: CandidateStatus;
  sourceId?: string;
  qualifyTier?: string;
  hasPhone?: boolean;
  hasWebsite?: boolean;
  country?: string;
  search?: string;
  limit?: number;
  offset?: number;
}): Promise<{ candidates: Array<RadarCandidate & { source: RadarSource }>; total: number }> {
  const session = await auth();
  if (!session?.user?.tenantId) throw new Error('Unauthorized');
  
  const where: Record<string, unknown> = {
    tenantId: session.user.tenantId,
  };
  
  if (options?.candidateType) {
    where.candidateType = options.candidateType;
  }
  if (options?.status) {
    where.status = options.status;
  }
  if (options?.sourceId) {
    where.sourceId = options.sourceId;
  }
  if (options?.qualifyTier) {
    const tiers = options.qualifyTier
      .split(',')
      .map((tier) => tier.trim())
      .filter(Boolean);

    where.qualifyTier = tiers.length > 1 ? { in: tiers } : tiers[0];
  }
  if (options?.hasPhone) {
    where.phone = { not: null };
  }
  if (options?.hasWebsite) {
    where.website = { not: null };
  }

  // 组合 AND 条件（country + search 可并存）
  const andConditions: Record<string, unknown>[] = [];

  if (options?.country) {
    // 用所有可能的拼写变体匹配（e.g. 选 "United States" → 匹配 DB 中的 "USA", "US", "United States"）
    const { getCountryMatchValues } = await import('@/lib/radar/country-utils');
    const matchValues = getCountryMatchValues(options.country);
    if (matchValues && matchValues.length > 0) {
      andConditions.push({
        OR: [
          { country: { in: matchValues } },
          { buyerCountry: { in: matchValues } },
        ],
      });
    }
  }
  if (options?.search) {
    andConditions.push({
      OR: [
        { displayName: { contains: options.search, mode: 'insensitive' } },
        { buyerName: { contains: options.search, mode: 'insensitive' } },
        { description: { contains: options.search, mode: 'insensitive' } },
        { website: { contains: options.search, mode: 'insensitive' } },
        { industry: { contains: options.search, mode: 'insensitive' } },
        { country: { contains: options.search, mode: 'insensitive' } },
        { buyerCountry: { contains: options.search, mode: 'insensitive' } },
        { source: { name: { contains: options.search, mode: 'insensitive' } } },
      ],
    });
  }
  if (andConditions.length > 0) {
    where.AND = andConditions;
  }
  
  const [candidates, total] = await Promise.all([
    prisma.radarCandidate.findMany({
      where,
      include: { source: true },
      orderBy: { createdAt: 'desc' },
      take: options?.limit || 50,
      skip: options?.offset || 0,
    }),
    prisma.radarCandidate.count({ where }),
  ]);
  
  return { candidates, total };
}

/**
 * Get distinct countries for the current tenant's candidates (filter dropdown)
 * Only returns values that map to valid ISO country codes
 */
export async function getCandidateCountries(): Promise<string[]> {
  const session = await auth();
  if (!session?.user?.tenantId) throw new Error('Unauthorized');

  const { normalizeCountryCode, getCountryDisplayName } = await import('@/lib/radar/country-utils');

  const rows = await prisma.radarCandidate.findMany({
    where: { tenantId: session.user.tenantId, country: { not: null } },
    select: { country: true },
    distinct: ['country'],
    orderBy: { country: 'asc' },
  });

  // 只保留能映射到合法 ISO 码的国家，按 ISO 码去重
  const seenCodes = new Set<string>();
  const result: string[] = [];

  for (const row of rows) {
    if (!row.country) continue;
    const isoCode = normalizeCountryCode(row.country);
    if (!isoCode || seenCodes.has(isoCode)) continue;
    seenCodes.add(isoCode);
    const displayName = getCountryDisplayName(isoCode);
    if (displayName) result.push(displayName);
  }

  return result.sort();
}

/**
 * getCandidateV2
  const session = await auth();
  if (!session?.user?.tenantId) throw new Error('Unauthorized');
  
  const candidate = await prisma.radarCandidate.findUnique({
    where: { id: candidateId },
    include: { source: true, task: true },
  });
  
  if (candidate && candidate.tenantId !== session.user.tenantId) {
    return null;
  }
  
  return candidate;
}

/**
 * 閸氬牊鐗搁崠鏍р偓娆撯偓澶涚礄閸掑棗鐪伴敍?
 */
export async function qualifyCandidateV2(
  candidateId: string,
  tier: 'A' | 'B' | 'C' | 'excluded',
  reason?: string
): Promise<RadarCandidate> {
  const session = await auth();
  if (!session?.user?.tenantId || !session.user.id) throw new Error('Unauthorized');
  
  const candidate = await prisma.radarCandidate.findUnique({
    where: { id: candidateId },
  });
  
  if (!candidate || candidate.tenantId !== session.user.tenantId) {
    throw new Error('Candidate not found');
  }
  
  const updated = await prisma.radarCandidate.update({
    where: { id: candidateId },
    data: {
      status: tier === 'excluded' ? 'EXCLUDED' : 'QUALIFIED',
      qualifyTier: tier,
      qualifyReason: reason,
      qualifiedAt: new Date(),
      qualifiedBy: session.user.id,
    },
  });
  
  // 鐠佹澘缍?Activity
  await prisma.activity.create({
    data: {
      tenantId: session.user.tenantId,
      userId: session.user.id,
      action: 'radar_candidate_qualified',
      entityType: 'RadarCandidate',
      entityId: candidateId,
      eventCategory: 'radar',
      context: { tier, reason } as object,
    },
  });

  // 閹烘帡娅庨弮璺虹磽濮濄儴袝閸欐埊绱拌箛顐︹偓鐔活唶瑜版洖鍙曢崣绋挎倳 + AI 濡€崇础閹绘劗鍋?
  if (tier === 'excluded') {
    const tenantId = session.user.tenantId;
    void (async () => {
      try {
        const { appendExcludedCompany, learnExclusionPattern } = await import(
          '@/lib/radar/exclusion-learner'
        );
        // 1. 缁斿宓嗛幎濠傚彆閸欑鎮曟潻钘夊閸?excludedCompanies
        if (candidate.profileId) {
          await appendExcludedCompany(candidate.profileId, candidate.displayName);
        }
        // 2. 濮?5 濞嗏剝甯撻梽銈埿曢崣鎴滅濞?AI 濡€崇础閹绘劗鍋ч敍鍫ｅΝ閻?token閿?
        const excludedCount = await prisma.radarCandidate.count({
          where: { tenantId, status: 'EXCLUDED' },
        });
        if (excludedCount % 5 === 0 && candidate.profileId) {
          await learnExclusionPattern(tenantId, candidate.profileId);
        }
      } catch {
        // 闂堟瑩绮径杈Е
      }
    })();
  }

  return updated;
}

/**
 * 閹靛綊鍣洪崥鍫熺壐閸?
 */
export async function qualifyCandidatesBatchV2(
  candidateIds: string[],
  tier: 'A' | 'B' | 'C' | 'excluded',
  reason?: string
): Promise<number> {
  const session = await auth();
  if (!session?.user?.tenantId || !session.user.id) throw new Error('Unauthorized');
  
  const result = await prisma.radarCandidate.updateMany({
    where: {
      id: { in: candidateIds },
      tenantId: session.user.tenantId,
    },
    data: {
      status: tier === 'excluded' ? 'EXCLUDED' : 'QUALIFIED',
      qualifyTier: tier,
      qualifyReason: reason,
      qualifiedAt: new Date(),
      qualifiedBy: session.user.id,
    },
  });
  
  // 鐠佹澘缍?Activity
  await prisma.activity.create({
    data: {
      tenantId: session.user.tenantId,
      userId: session.user.id,
      action: 'radar_candidates_batch_qualified',
      entityType: 'RadarCandidate',
      entityId: candidateIds.join(','),
      eventCategory: 'radar',
      context: { count: result.count, tier, reason } as object,
    },
  });
  
  return result.count;
}

// ==================== 鐎电厧鍙嗙痪璺ㄥ偍鎼?====================

/**
 * 鐎电厧鍙嗛崐娆撯偓澶婂煂 ProspectCompany
 */
export async function importCandidateToCompanyV2(
  candidateId: string
): Promise<ProspectCompany> {
  const session = await auth();
  if (!session?.user?.tenantId || !session.user.id) throw new Error('Unauthorized');

  const candidate = await prisma.radarCandidate.findUnique({
    where: { id: candidateId },
    include: { source: true },
  });

  if (!candidate || candidate.tenantId !== session.user.tenantId) {
    throw new Error('Candidate not found');
  }

  // 濡偓閺屻儲妲搁崥锕€鍑＄€电厧鍙?
  if (candidate.status === 'IMPORTED') {
    throw new Error('Candidate already imported');
  }

  const companyName = candidate.buyerName || candidate.displayName;
  const companyCountry = candidate.buyerCountry || candidate.country;

  // 閸樺鍣稿Λ鈧弻銉窗閸╄桨绨純鎴犵彲閸╃喎鎮?
  let existingCompany: {
    id: string;
    outreachArtifacts: Prisma.JsonValue | null;
    website: string | null;
    phone: string | null;
    email: string | null;
    address: string | null;
  } | null = null;
  if (candidate.website) {
    const domain = normalizeDomainForDedup(candidate.website);
    if (domain) {
      existingCompany = await prisma.prospectCompany.findFirst({
        where: {
          tenantId: session.user.tenantId,
          website: { contains: domain, mode: 'insensitive' },
          deletedAt: null,
        },
        select: {
          id: true,
          outreachArtifacts: true,
          website: true,
          phone: true,
          email: true,
          address: true,
        },
      });
    }
  }

  // 閸樺鍣稿Λ鈧弻銉窗閸╄桨绨崗顒€寰冮崥宥囆?+ 閸ヨ棄顔?
  if (!existingCompany && companyName) {
    existingCompany = await prisma.prospectCompany.findFirst({
      where: {
        tenantId: session.user.tenantId,
        name: { equals: companyName, mode: 'insensitive' },
        country: companyCountry || null,
        deletedAt: null,
      },
      select: {
        id: true,
        outreachArtifacts: true,
        website: true,
        phone: true,
        email: true,
        address: true,
      },
    });
  }

  // 婵″倹鐏夊鎻掔摠閸︻煉绱濇潻鏂挎礀瀹稿弶婀佺拋鏉跨秿楠炶埖鐖ｇ拋鏉库偓娆撯偓澶婂嚒鐎电厧鍙?
  if (existingCompany) {
    const candidateContactSnapshot = getCandidateContactEnrichment(candidate);

    await prisma.prospectCompany.update({
      where: { id: existingCompany.id },
      data: {
        website: existingCompany.website || candidate.website || null,
        phone: existingCompany.phone || candidate.phone || null,
        email: existingCompany.email || candidate.email || null,
        address: existingCompany.address || candidate.address || null,
        outreachArtifacts: candidateContactSnapshot
          ? buildProspectOutreachStateValue(existingCompany.outreachArtifacts, {
              contactSnapshot: candidateContactSnapshot,
            })
          : undefined,
      },
    });

    await prisma.radarCandidate.update({
      where: { id: candidateId },
      data: {
        status: 'IMPORTED',
        importedToType: 'ProspectCompany',
        importedToId: existingCompany.id,
        importedAt: new Date(),
        importedBy: session.user.id,
      },
    });
    return prisma.prospectCompany.findUnique({ where: { id: existingCompany.id } }) as Promise<ProspectCompany>;
  }

  // 閸掓稑缂?ProspectCompany
  const matchReasons =
    extractStringReasons(candidate.aiRelevance) ??
    extractStringReasons(candidate.matchExplain);
  const candidateContactSnapshot = getCandidateContactEnrichment(candidate);

  const company = await prisma.prospectCompany.create({
    data: {
      tenantId: session.user.tenantId,
      name: companyName,
      website: candidate.website,
      phone: candidate.phone,
      email: candidate.email,
      address: candidate.address,
      country: companyCountry,
      city: candidate.city,
      industry: candidate.industry,
      companySize: candidate.companySize,
      description: candidate.description,
      tier: candidate.qualifyTier,
      matchReasons: matchReasons
        ? (matchReasons as Prisma.InputJsonValue)
        : undefined,
      approachAngle: candidate.aiSummary || null,
      sourceType: candidate.source.channelType.toLowerCase(),
      sourceCandidateId: candidateId,
      sourceUrl: candidate.sourceUrl,
      status: 'new',
      outreachArtifacts: candidateContactSnapshot
        ? buildProspectOutreachStateValue(null, {
            contactSnapshot: candidateContactSnapshot,
          })
        : undefined,
    },
  });
  
  // 閼奉亜濮╅幓鎰絿閸愬磭鐡ラ懓鍛颁粓缁姹夐敍鍫濄亼鐠愩儰绗夐梼璇差敚鐎电厧鍙嗛敍?
  try {
    await extractContactsFromCandidate(candidate, company.id, session.user.tenantId, candidateId);
  } catch (err) {
    console.error('[importCandidateToCompanyV2] Contact extraction failed (non-blocking):', err);
  }
  
  // 閺囧瓨鏌婇崐娆撯偓澶屽Ц閹?
  await prisma.radarCandidate.update({
    where: { id: candidateId },
    data: {
      status: 'IMPORTED',
      importedToType: 'ProspectCompany',
      importedToId: company.id,
      importedAt: new Date(),
      importedBy: session.user.id,
    },
  });
  
  // 鐠佹澘缍?Activity
  await prisma.activity.create({
    data: {
      tenantId: session.user.tenantId,
      userId: session.user.id,
      action: 'radar_candidate_imported_company',
      entityType: 'ProspectCompany',
      entityId: company.id,
      eventCategory: 'radar',
      context: { candidateId, companyName: company.name } as object,
    },
  });
  
  return company;
}

/**
 * 鐎电厧鍙嗛崐娆撯偓澶婂煂 Opportunity
 */
export async function importCandidateToOpportunityV2(
  candidateId: string,
  companyId?: string
): Promise<Opportunity> {
  const session = await auth();
  if (!session?.user?.tenantId || !session.user.id) throw new Error('Unauthorized');
  
  const candidate = await prisma.radarCandidate.findUnique({
    where: { id: candidateId },
    include: { source: true },
  });
  
  if (!candidate || candidate.tenantId !== session.user.tenantId) {
    throw new Error('Candidate not found');
  }
  
  if (candidate.candidateType !== 'OPPORTUNITY') {
    throw new Error('Candidate is not an opportunity');
  }
  
  // 閸掓稑缂?Opportunity
  const opportunity = await prisma.opportunity.create({
    data: {
      tenantId: session.user.tenantId,
      companyId,
      sourceType: 'tender',
      sourceCandidateId: candidateId,
      sourceUrl: candidate.sourceUrl,
      title: candidate.displayName,
      description: candidate.description,
      deadline: candidate.deadline,
      estimatedValue: candidate.estimatedValue,
      currency: candidate.currency,
      categoryCode: candidate.categoryCode,
      categoryName: candidate.categoryName,
      stage: 'IDENTIFIED',
    },
  });
  
  // 閺囧瓨鏌婇崐娆撯偓澶屽Ц閹?
  await prisma.radarCandidate.update({
    where: { id: candidateId },
    data: {
      status: 'IMPORTED',
      importedToType: 'Opportunity',
      importedToId: opportunity.id,
      importedAt: new Date(),
      importedBy: session.user.id,
    },
  });
  
  // 鐠佹澘缍?Activity
  await prisma.activity.create({
    data: {
      tenantId: session.user.tenantId,
      userId: session.user.id,
      action: 'radar_candidate_imported_opportunity',
      entityType: 'Opportunity',
      entityId: opportunity.id,
      eventCategory: 'radar',
      context: { candidateId, title: opportunity.title } as object,
    },
  });
  
  return opportunity;
}

/**
 * 閹靛綊鍣虹€电厧鍙?
 */
export async function importCandidatesBatchV2(
  candidateIds: string[],
  targetType: 'company' | 'opportunity'
): Promise<{ imported: number; failed: number }> {
  // 妤犲矁鐦夋潏鎾冲弳
  if (!candidateIds || candidateIds.length === 0) {
    throw new ValidationError('candidateIds is required');
  }
  if (candidateIds.length > 100) {
    throw new ValidationError('Maximum 100 candidates per batch');
  }

  const session = await auth();
  if (!session?.user?.tenantId) throw new Error('Unauthorized');

  let imported = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const id of candidateIds) {
    try {
      if (targetType === 'company') {
        await importCandidateToCompanyV2(id);
      } else {
        await importCandidateToOpportunityV2(id);
      }
      imported++;
    } catch (error) {
      failed++;
      const msg = error instanceof Error ? error.message : 'Unknown error';
      console.error(`[importCandidatesBatchV2] Failed to import ${id}:`, msg);
      errors.push(`${id}: ${msg}`);
    }
  }

  return { imported, failed };
}

// ==================== ProspectCompany 缁狅紕鎮?====================

/**
 * 閼惧嘲褰囩痪璺ㄥ偍閸忣剙寰冮崚妤勩€?
 */
export async function getProspectCompaniesV2(options?: {
  status?: string;
  tier?: string;
  industry?: string;
  search?: string;
  limit?: number;
  offset?: number;
}): Promise<{ companies: ProspectCompanyData[]; total: number }> {
  const session = await auth();
  if (!session?.user?.tenantId) throw new Error('Unauthorized');
  
  const where: Record<string, unknown> = {
    tenantId: session.user.tenantId,
    deletedAt: null,
  };
  
  if (options?.status) {
    where.status = options.status;
  }
  if (options?.tier) {
    where.tier = options.tier;
  }
  if (options?.industry) {
    where.industry = { contains: options.industry, mode: 'insensitive' };
  }
  if (options?.search) {
    where.OR = [
      { name: { contains: options.search, mode: 'insensitive' } },
      { description: { contains: options.search, mode: 'insensitive' } },
    ];
  }
  
  const [companies, total] = await Promise.all([
    prisma.prospectCompany.findMany({
      where,
      include: { _count: { select: { contacts: { where: { deletedAt: null } } } } },
      orderBy: { createdAt: 'desc' },
      take: options?.limit || 50,
      skip: options?.offset || 0,
    }),
    prisma.prospectCompany.count({ where }),
  ]);
  
  return { companies: companies as ProspectCompanyData[], total };
}

// ==================== Opportunity 缁狅紕鎮?====================

/**
 * 閼惧嘲褰囬張杞扮窗閸掓銆?
 */
export async function getOpportunitiesV2(options?: {
  stage?: string;
  companyId?: string;
  hasDeadline?: boolean;
  search?: string;
  limit?: number;
  offset?: number;
}): Promise<{ opportunities: Array<Opportunity & { company: ProspectCompany | null }>; total: number }> {
  const session = await auth();
  if (!session?.user?.tenantId) throw new Error('Unauthorized');
  
  const where: Record<string, unknown> = {
    tenantId: session.user.tenantId,
    deletedAt: null,
  };
  
  if (options?.stage) {
    where.stage = options.stage;
  }
  if (options?.companyId) {
    where.companyId = options.companyId;
  }
  if (options?.hasDeadline) {
    where.deadline = { not: null };
  }
  if (options?.search) {
    where.OR = [
      { title: { contains: options.search, mode: 'insensitive' } },
      { description: { contains: options.search, mode: 'insensitive' } },
    ];
  }
  
  const [opportunities, total] = await Promise.all([
    prisma.opportunity.findMany({
      where,
      include: { company: true },
      orderBy: [
        { deadline: 'asc' },
        { createdAt: 'desc' },
      ],
      take: options?.limit || 50,
      skip: options?.offset || 0,
    }),
    prisma.opportunity.count({ where }),
  ]);
  
  return { opportunities, total };
}

/**
 * 閺囧瓨鏌婇張杞扮窗闂冭埖顔?
 */
export async function updateOpportunityStageV2(
  opportunityId: string,
  stage: string,
  notes?: string
): Promise<Opportunity> {
  const session = await auth();
  if (!session?.user?.tenantId || !session.user.id) throw new Error('Unauthorized');
  
  const opportunity = await prisma.opportunity.findUnique({
    where: { id: opportunityId },
  });
  
  if (!opportunity || opportunity.tenantId !== session.user.tenantId) {
    throw new Error('Opportunity not found');
  }
  
  const updated = await prisma.opportunity.update({
    where: { id: opportunityId },
    data: {
      stage: stage as Opportunity['stage'],
      notes: notes ? `${opportunity.notes || ''}\n\n${new Date().toISOString()}: ${notes}` : opportunity.notes,
      ...(stage === 'WON' ? { wonAt: new Date() } : {}),
      ...(stage === 'LOST' ? { lostAt: new Date() } : {}),
    },
  });
  
  // 鐠佹澘缍?Activity
  await prisma.activity.create({
    data: {
      tenantId: session.user.tenantId,
      userId: session.user.id,
      action: 'opportunity_stage_updated',
      entityType: 'Opportunity',
      entityId: opportunityId,
      eventCategory: 'radar',
      context: { previousStage: opportunity.stage, newStage: stage, notes } as object,
    },
  });
  
  return updated;
}

// ==================== ProspectContact 缁狅紕鎮?====================

/**
 * 娴犲骸鈧瑩鈧甯慨瀣殶閹诡喕鑵戦幒銊︽焽閼辨梻閮存禍楦夸捍缁?
 */
function inferSeniority(title: string | undefined): string | null {
  if (!title) return null;
  const t = title.toLowerCase();
  if (/\b(ceo|cto|cfo|coo|cmo|cio|founder|co-founder|owner|president|chairman)\b/.test(t)) return 'C-level';
  if (/\b(vp|vice president)\b/.test(t)) return 'VP';
  if (/\bdirector\b/.test(t)) return 'Director';
  if (/\bmanager\b/.test(t)) return 'Manager';
  return 'Staff';
}

/**
 * 娴犲骸鈧瑩鈧鏆熼幑顔炬畱 intelligence 娑擃厽褰侀崣鏍粓缁姹夐獮璺哄灡瀵?ProspectContact
 */
async function extractContactsFromCandidate(
  candidate: RadarCandidate,
  companyId: string,
  tenantId: string,
  candidateId: string
): Promise<number> {
  const rawData = candidate.rawData as Record<string, unknown> | null;
  if (!rawData) return 0;

  const intelligence = rawData.intelligence as Record<string, unknown> | undefined;
  const contactsData = intelligence?.contacts as Record<string, unknown> | undefined;
  const decisionMakers = contactsData?.decisionMakers as Array<{
    name?: string;
    title?: string;
    email?: string;
    phone?: string; // v2.0: 添加电话字段
    linkedIn?: string;
    linkedin?: string;
    emailConfidence?: number;
  }> | undefined;

  if (!decisionMakers || decisionMakers.length === 0) return 0;

  let created = 0;
  for (const dm of decisionMakers) {
    if (!dm.name) continue;
    // 閸樺鍣搁敍姘倱閸忣剙寰冮崥灞芥倳鐠哄疇绻?
    const exists = await prisma.prospectContact.findFirst({
      where: { tenantId, companyId, name: dm.name, deletedAt: null },
    });
    if (exists) continue;

    await prisma.prospectContact.create({
      data: {
        tenantId,
        companyId,
        name: dm.name,
        role: dm.title || null,
        email: dm.email || null,
        phone: dm.phone || null, // v2.0: 提取电话字段
        linkedInUrl: dm.linkedIn || dm.linkedin || null,
        seniority: inferSeniority(dm.title),
        sourceCandidateId: candidateId,
        status: 'new',
      },
    });
    created++;
  }
  return created;
}

/**
 * 閼惧嘲褰囬崗顒€寰冮懕鏃傞兇娴滃搫鍨悰?
 */
export async function getProspectContacts(companyId: string): Promise<ProspectContactData[]> {
  const session = await auth();
  if (!session?.user?.tenantId) throw new Error('Unauthorized');

  const company = await prisma.prospectCompany.findUnique({ where: { id: companyId } });
  if (!company || company.tenantId !== session.user.tenantId) {
    throw new Error('Company not found');
  }

  return prisma.prospectContact.findMany({
    where: { tenantId: session.user.tenantId, companyId, deletedAt: null },
    orderBy: [
      { createdAt: 'asc' },
    ],
  });
}

/**
 * 閸掓稑缂撻懕鏃傞兇娴?
 */
export async function createProspectContact(input: CreateProspectContactInput): Promise<ProspectContactData> {
  const session = await auth();
  if (!session?.user?.tenantId || !session.user.id) throw new Error('Unauthorized');

  const company = await prisma.prospectCompany.findUnique({ where: { id: input.companyId } });
  if (!company || company.tenantId !== session.user.tenantId) {
    throw new Error('Company not found');
  }

  const contact = await prisma.prospectContact.create({
    data: {
      tenantId: session.user.tenantId,
      companyId: input.companyId,
      name: input.name,
      email: input.email || null,
      phone: input.phone || null,
      role: input.role || null,
      department: input.department || null,
      seniority: input.seniority || null,
      linkedInUrl: input.linkedInUrl || null,
      notes: input.notes || null,
      status: 'new',
    },
  });

  await prisma.activity.create({
    data: {
      tenantId: session.user.tenantId,
      userId: session.user.id,
      action: 'prospect_contact_created',
      entityType: 'ProspectContact',
      entityId: contact.id,
      eventCategory: 'radar',
      context: { companyId: input.companyId, contactName: input.name } as object,
    },
  });

  return contact;
}

/**
 * 閺囧瓨鏌婇懕鏃傞兇娴?
 */
export async function updateProspectContact(
  contactId: string,
  input: Partial<Omit<CreateProspectContactInput, 'companyId'>>
): Promise<ProspectContactData> {
  const session = await auth();
  if (!session?.user?.tenantId || !session.user.id) throw new Error('Unauthorized');

  const contact = await prisma.prospectContact.findUnique({ where: { id: contactId } });
  if (!contact || contact.tenantId !== session.user.tenantId || contact.deletedAt) {
    throw new Error('Contact not found');
  }

  const updated = await prisma.prospectContact.update({
    where: { id: contactId },
    data: {
      ...(input.name !== undefined && { name: input.name }),
      ...(input.email !== undefined && { email: input.email || null }),
      ...(input.phone !== undefined && { phone: input.phone || null }),
      ...(input.role !== undefined && { role: input.role || null }),
      ...(input.department !== undefined && { department: input.department || null }),
      ...(input.seniority !== undefined && { seniority: input.seniority || null }),
      ...(input.linkedInUrl !== undefined && { linkedInUrl: input.linkedInUrl || null }),
      ...(input.notes !== undefined && { notes: input.notes || null }),
    },
  });

  return updated;
}

/**
 * 閸掔娀娅庨懕鏃傞兇娴滅尨绱欐潪顖氬灩闂勩倧绱?
 */
export async function deleteProspectContact(contactId: string): Promise<void> {
  const session = await auth();
  if (!session?.user?.tenantId || !session.user.id) throw new Error('Unauthorized');

  const contact = await prisma.prospectContact.findUnique({ where: { id: contactId } });
  if (!contact || contact.tenantId !== session.user.tenantId || contact.deletedAt) {
    throw new Error('Contact not found');
  }

  await prisma.prospectContact.update({
    where: { id: contactId },
    data: { deletedAt: new Date() },
  });

  await prisma.activity.create({
    data: {
      tenantId: session.user.tenantId,
      userId: session.user.id,
      action: 'prospect_contact_deleted',
      entityType: 'ProspectContact',
      entityId: contactId,
      eventCategory: 'radar',
      context: { contactName: contact.name, companyId: contact.companyId } as object,
    },
  });
}

// ==================== 閼冲矁鐨熺粻鈧幎?====================

/**
 * 閻㈢喐鍨氱€广垺鍩涢懗宀冪殶缁犫偓閹?
 */
export async function generateProspectDossier(companyId: string): Promise<{
  ok: boolean;
  versionId?: string;
  content?: Record<string, unknown>;
  error?: string;
}> {
  const session = await auth();
  if (!session?.user?.tenantId || !session.user.id) throw new Error('Unauthorized');

  const company = await prisma.prospectCompany.findUnique({ where: { id: companyId } });
  if (!company || company.tenantId !== session.user.tenantId) {
    throw new Error('Company not found');
  }

  // 閺€鍫曟肠閹碘偓閺堝娴夐崗铏殶閹?
  const [contacts, opportunities, sourceCandidate] = await Promise.all([
    prisma.prospectContact.findMany({
      where: { tenantId: session.user.tenantId, companyId, deletedAt: null },
    }),
    prisma.opportunity.findMany({
      where: { tenantId: session.user.tenantId, companyId, deletedAt: null },
    }),
    company.sourceCandidateId
      ? prisma.radarCandidate.findUnique({ where: { id: company.sourceCandidateId } })
      : null,
  ]);

  // 閹绘劕褰?intelligence 閺佺増宓?
  const rawData = sourceCandidate?.rawData as Record<string, unknown> | null;
  const intelligence = rawData?.intelligence as Record<string, unknown> | undefined;

  // 鐠嬪啰鏁?AI 閹垛偓閼?
  const { executeSkill } = await import('@/actions/skills');
  const result = await executeSkill(
    'radar.generateProspectDossier',
    {
      entityType: 'ProspectDossier',
      entityId: companyId,
      mode: 'generate',
      useCompanyProfile: true,
      input: {
        prospectCompany: {
          id: company.id,
          name: company.name,
          website: company.website,
          phone: company.phone,
          email: company.email,
          address: company.address,
          country: company.country,
          city: company.city,
          industry: company.industry,
          companySize: company.companySize,
          description: company.description,
          tier: company.tier,
          status: company.status,
          sourceType: company.sourceType,
          sourceUrl: company.sourceUrl,
        },
        contacts: contacts.map(c => ({
          name: c.name,
          email: c.email,
          phone: c.phone,
          role: c.role,
          department: c.department,
          seniority: c.seniority,
          linkedInUrl: c.linkedInUrl,
        })),
        opportunities: opportunities.map(o => ({
          title: o.title,
          description: o.description,
          stage: o.stage,
          estimatedValue: o.estimatedValue,
          currency: o.currency,
          deadline: o.deadline,
          sourceType: o.sourceType,
        })),
        candidateData: sourceCandidate ? {
          matchScore: sourceCandidate.matchScore,
          matchExplain: sourceCandidate.matchExplain,
          aiRelevance: sourceCandidate.aiRelevance,
          aiSummary: sourceCandidate.aiSummary,
        } : null,
        intelligence: intelligence || null,
      },
    }
  );

  return {
    ok: result.ok,
    versionId: result.versionId,
    content: result.output,
    error: result.ok ? undefined : 'Skill execution failed',
  };
}

/**
 * 閼惧嘲褰囬張鈧弬鎷屽剹鐠嬪啰鐣濋幎?
 */
export async function getLatestProspectDossier(companyId: string): Promise<{
  id: string;
  version: number;
  content: Record<string, unknown>;
  createdAt: Date;
} | null> {
  const session = await auth();
  if (!session?.user?.tenantId) throw new Error('Unauthorized');

  const version = await prisma.artifactVersion.findFirst({
    where: {
      tenantId: session.user.tenantId,
      entityType: 'ProspectDossier',
      entityId: companyId,
    },
    orderBy: { version: 'desc' },
  });

  if (!version) return null;

  return {
    id: version.id,
    version: version.version,
    content: version.content as Record<string, unknown>,
    createdAt: version.createdAt,
  };
}

// ==================== 缂佺喕顓?====================

/**
 * 閼惧嘲褰囬梿鐤彧缂佺喕顓?
 */
export async function getRadarStatsV2(): Promise<RadarStatsData> {
  const session = await auth();
  if (!session?.user?.tenantId) throw new Error('Unauthorized');
  
  const tenantId = session.user.tenantId;
  
  const [
    totalCandidates,
    newCandidates,
    qualifiedCandidates,
    importedCandidates,
    opportunities,
    companies,
    runningTasks,
  ] = await Promise.all([
    prisma.radarCandidate.count({ where: { tenantId } }),
    prisma.radarCandidate.count({ where: { tenantId, status: 'NEW' } }),
    prisma.radarCandidate.count({ where: { tenantId, status: 'QUALIFIED' } }),
    prisma.radarCandidate.count({ where: { tenantId, status: 'IMPORTED' } }),
    prisma.radarCandidate.count({ where: { tenantId, candidateType: 'OPPORTUNITY' } }),
    prisma.prospectCompany.count({ where: { tenantId, deletedAt: null } }),
    prisma.radarTask.count({ where: { tenantId, status: 'RUNNING' } }),
  ]);
  
  return {
    totalCandidates,
    newCandidates,
    qualifiedCandidates,
    importedCandidates,
    opportunities,
    companies,
    runningTasks,
  };
}

// ==================== RadarSearchProfile 缁狅紕鎮?====================

export interface RadarSearchProfileData {
  id: string;
  name: string;
  description: string | null;
  segmentId: string | null;
  personaId: string | null;
  keywords: Record<string, string[]>;
  negativeKeywords: string[] | null;
  targetCountries: string[];
  targetRegions: string[];
  industryCodes: string[];
  categoryFilters: string[];
  enabledChannels: string[];
  sourceIds: string[];
  isActive: boolean;
  scheduleRule: string;
  lastRunAt: Date | null;
  nextRunAt: Date | null;
  lockToken: string | null;
  lockedAt: Date | null;
  lockedBy: string | null;
  maxRunSeconds: number;
  autoQualify: boolean;
  autoEnrich: boolean;
  runStats: {
    totalRuns?: number;
    totalNew?: number;
    lastError?: string;
    avgDurationMs?: number;
  } | null;
  exclusionRules: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
  // 閸忓疇浠?
  segment?: { id: string; name: string } | null;
  persona?: { id: string; name: string } | null;
  _count?: { cursors: number };
}

export interface CreateRadarSearchProfileInput {
  name: string;
  description?: string;
  segmentId?: string;
  personaId?: string;
  keywords?: Record<string, string[]>;
  negativeKeywords?: string[];
  targetCountries?: string[];
  targetRegions?: string[];
  industryCodes?: string[];
  categoryFilters?: string[];
  enabledChannels?: string[];
  sourceIds?: string[];
  scheduleRule?: string;
  maxRunSeconds?: number;
  autoQualify?: boolean;
  autoEnrich?: boolean;
  // 閺傛澘顤冮敍姘辩翱閸戝棗鐣炬担宥呯摟濞?
  targetCustomerType?: string[];      // 閻╊喗鐖ｇ€广垺鍩涚猾璇茬€烽敍姝產nufacturer, distributor, service_provider, retailer
  businessScenario?: string;          // 娑撴艾濮熼崷鐑樻珯閹诲繗鍫敍姘灉閸楁牔绮堟稊鍫礉鐎广垺鍩涢棁鈧憰浣风矆娑?
  exampleCustomers?: string[];        // 缁€杞扮伐閻╊喗鐖ｇ€广垺鍩?
  myProduct?: string;                 // 閹存垹娈戞禍褍鎼?閺堝秴濮?
}

/**
 * 閼惧嘲褰囬幍顐ｅ伎鐠佲€冲灊閸掓銆?
 */
export async function getRadarSearchProfiles(options?: {
  isActive?: boolean;
  limit?: number;
}): Promise<RadarSearchProfileData[]> {
  const session = await auth();
  if (!session?.user?.tenantId) throw new Error('Unauthorized');
  
  const where: Record<string, unknown> = {
    tenantId: session.user.tenantId,
  };
  
  if (options?.isActive !== undefined) {
    where.isActive = options.isActive;
  }
  
  const profiles = await prisma.radarSearchProfile.findMany({
    where,
    orderBy: [
      { isActive: 'desc' },
      { nextRunAt: 'asc' },
      { createdAt: 'desc' },
    ],
    take: options?.limit || 100,
  });
  
  // 閼惧嘲褰囬崗瀹犱粓閻?segment 閸?persona
  const segmentIds = profiles.map(p => p.segmentId).filter(Boolean) as string[];
  const personaIds = profiles.map(p => p.personaId).filter(Boolean) as string[];
  
  const [segments, personas, cursorCounts] = await Promise.all([
    segmentIds.length > 0 
      ? prisma.iCPSegment.findMany({ where: { id: { in: segmentIds } }, select: { id: true, name: true } })
      : [],
    personaIds.length > 0
      ? prisma.persona.findMany({ where: { id: { in: personaIds } }, select: { id: true, name: true } })
      : [],
    prisma.radarScanCursor.groupBy({
      by: ['profileId'],
      where: { profileId: { in: profiles.map(p => p.id) } },
      _count: true,
    }),
  ]);
  
  const segmentMap = new Map(segments.map(s => [s.id, s]));
  const personaMap = new Map(personas.map(p => [p.id, p]));
  const cursorCountMap = new Map(cursorCounts.map(c => [c.profileId, c._count]));
  
  return profiles.map(p => ({
    ...p,
    keywords: (p.keywords || {}) as Record<string, string[]>,
    negativeKeywords: p.negativeKeywords as string[] | null,
    enabledChannels: p.enabledChannels as string[],
    runStats: p.runStats as RadarSearchProfileData['runStats'],
    exclusionRules: p.exclusionRules as Record<string, unknown> | null,
    segment: p.segmentId ? segmentMap.get(p.segmentId) || null : null,
    persona: p.personaId ? personaMap.get(p.personaId) || null : null,
    _count: { cursors: cursorCountMap.get(p.id) || 0 },
  }));
}

/**
 * 閼惧嘲褰囬崡鏇氶嚋閹殿偅寮跨拋鈥冲灊
 */
export async function getRadarSearchProfile(profileId: string): Promise<RadarSearchProfileData | null> {
  const session = await auth();
  if (!session?.user?.tenantId) throw new Error('Unauthorized');
  
  const profile = await prisma.radarSearchProfile.findUnique({
    where: { id: profileId },
  });
  
  if (!profile || profile.tenantId !== session.user.tenantId) {
    return null;
  }
  
  // 閼惧嘲褰囬崗瀹犱粓閺佺増宓?
  const [segment, persona, cursorCount] = await Promise.all([
    profile.segmentId ? prisma.iCPSegment.findUnique({ where: { id: profile.segmentId }, select: { id: true, name: true } }) : null,
    profile.personaId ? prisma.persona.findUnique({ where: { id: profile.personaId }, select: { id: true, name: true } }) : null,
    prisma.radarScanCursor.count({ where: { profileId } }),
  ]);
  
  return {
    ...profile,
    keywords: (profile.keywords || {}) as Record<string, string[]>,
    negativeKeywords: profile.negativeKeywords as string[] | null,
    enabledChannels: profile.enabledChannels as string[],
    runStats: profile.runStats as RadarSearchProfileData['runStats'],
    exclusionRules: profile.exclusionRules as Record<string, unknown> | null,
    segment,
    persona,
    _count: { cursors: cursorCount },
  };
}

/**
 * 閸掓稑缂撻幍顐ｅ伎鐠佲€冲灊
 */
export async function createRadarSearchProfile(input: CreateRadarSearchProfileInput): Promise<RadarSearchProfileData> {
  const session = await auth();
  if (!session?.user?.tenantId) throw new Error('Unauthorized');
  
  // 鐠侊紕鐣婚崚婵嗩潗 nextRunAt
  let nextRunAt: Date | null = null;
  if (input.scheduleRule) {
    try {
      const { CronExpressionParser } = await import('cron-parser');
      const interval = CronExpressionParser.parse(input.scheduleRule);
      nextRunAt = interval.next().toDate();
    } catch (error) {
      console.warn('[createRadarSearchProfile] Invalid cron expression, using default:', error);
      nextRunAt = new Date(Date.now() + 60 * 60 * 1000);
    }
  }
  
  const profile = await prisma.radarSearchProfile.create({
    data: {
      tenantId: session.user.tenantId,
      name: input.name,
      description: input.description,
      segmentId: input.segmentId,
      personaId: input.personaId,
      keywords: (input.keywords || { en: [] }) as Prisma.InputJsonValue,
      negativeKeywords: input.negativeKeywords as Prisma.InputJsonValue,
      targetCountries: input.targetCountries || [],
      targetRegions: input.targetRegions || [],
      industryCodes: input.industryCodes || [],
      categoryFilters: input.categoryFilters || [],
      enabledChannels: (input.enabledChannels || []) as never[],
      sourceIds: input.sourceIds || [],
      scheduleRule: input.scheduleRule || '0 6 * * *',
      maxRunSeconds: input.maxRunSeconds || 45,
      autoQualify: input.autoQualify ?? true,
      autoEnrich: input.autoEnrich ?? true,
      nextRunAt,
      isActive: true,
    },
  });
  
  return {
    ...profile,
    keywords: (profile.keywords || {}) as Record<string, string[]>,
    negativeKeywords: profile.negativeKeywords as string[] | null,
    enabledChannels: profile.enabledChannels as string[],
    runStats: null,
    exclusionRules: null,
    segment: null,
    persona: null,
    _count: { cursors: 0 },
  };
}

/**
 * 閺囧瓨鏌婇幍顐ｅ伎鐠佲€冲灊
 */
export async function updateRadarSearchProfile(
  profileId: string,
  input: Partial<CreateRadarSearchProfileInput> & { isActive?: boolean }
): Promise<void> {
  const session = await auth();
  if (!session?.user?.tenantId) throw new Error('Unauthorized');
  
  // 娣囶喗鏁?scheduleRule 闂団偓鐟曚礁鍠呯粵鏍偓鍛綀闂?
  if (input.scheduleRule !== undefined) {
    const roleCheck = requireDecider(session);
    if (!roleCheck.authorized) {
      throw new Error(roleCheck.error);
    }
  }
  
  const existing = await prisma.radarSearchProfile.findUnique({
    where: { id: profileId },
  });
  
  if (!existing || existing.tenantId !== session.user.tenantId) {
    throw new Error('Profile not found');
  }
  
  const data: Record<string, unknown> = {};
  
  if (input.name !== undefined) data.name = input.name;
  if (input.description !== undefined) data.description = input.description;
  if (input.segmentId !== undefined) data.segmentId = input.segmentId;
  if (input.personaId !== undefined) data.personaId = input.personaId;
  if (input.keywords !== undefined) data.keywords = input.keywords as Prisma.InputJsonValue;
  if (input.negativeKeywords !== undefined) data.negativeKeywords = input.negativeKeywords as Prisma.InputJsonValue;
  if (input.targetCountries !== undefined) data.targetCountries = input.targetCountries;
  if (input.targetRegions !== undefined) data.targetRegions = input.targetRegions;
  if (input.industryCodes !== undefined) data.industryCodes = input.industryCodes;
  if (input.categoryFilters !== undefined) data.categoryFilters = input.categoryFilters;
  if (input.enabledChannels !== undefined) data.enabledChannels = input.enabledChannels as never[];
  if (input.sourceIds !== undefined) data.sourceIds = input.sourceIds;
  if (input.maxRunSeconds !== undefined) data.maxRunSeconds = input.maxRunSeconds;
  if (input.autoQualify !== undefined) data.autoQualify = input.autoQualify;
  if (input.autoEnrich !== undefined) data.autoEnrich = input.autoEnrich;
  if (input.isActive !== undefined) data.isActive = input.isActive;
  
  // 婵″倹鐏夋穱顔芥暭娴?scheduleRule閿涘矂鍣搁弬鎷岊吀缁?nextRunAt
  if (input.scheduleRule !== undefined) {
    data.scheduleRule = input.scheduleRule;
    try {
      const { CronExpressionParser } = await import('cron-parser');
      const interval = CronExpressionParser.parse(input.scheduleRule);
      data.nextRunAt = interval.next().toDate();
    } catch (error) {
      console.warn('[updateRadarSearchProfile] Invalid cron expression, using default:', error);
      data.nextRunAt = new Date(Date.now() + 60 * 60 * 1000);
    }
  }
  
  await prisma.radarSearchProfile.update({
    where: { id: profileId },
    data,
  });
}

/**
 * 閸掑洦宕查幍顐ｅ伎鐠佲€冲灊閸氼垳鏁ら悩鑸碘偓?
 */
export async function toggleRadarSearchProfileActive(profileId: string): Promise<boolean> {
  const session = await auth();
  if (!session?.user?.tenantId) throw new Error('Unauthorized');
  
  const existing = await prisma.radarSearchProfile.findUnique({
    where: { id: profileId },
  });
  
  if (!existing || existing.tenantId !== session.user.tenantId) {
    throw new Error('Profile not found');
  }
  
  const newActive = !existing.isActive;
  
  // 婵″倹鐏夐柌宥嗘煀閸氼垳鏁ら敍宀冾吀缁犳鏌婇惃?nextRunAt
  let nextRunAt = existing.nextRunAt;
  if (newActive && !existing.nextRunAt) {
    try {
      const { CronExpressionParser } = await import('cron-parser');
      const interval = CronExpressionParser.parse(existing.scheduleRule);
      nextRunAt = interval.next().toDate();
    } catch (error) {
      console.warn('[toggleRadarProfile] Invalid cron expression, using default:', error);
      nextRunAt = new Date(Date.now() + 60 * 60 * 1000);
    }
  }
  
  await prisma.radarSearchProfile.update({
    where: { id: profileId },
    data: { 
      isActive: newActive,
      nextRunAt: newActive ? nextRunAt : null,
      // 濞撳懘娅庨柨浣哄Ц閹?
      lockToken: null,
      lockedAt: null,
      lockedBy: null,
    },
  });
  
  return newActive;
}

/**
 * 閸掔娀娅庨幍顐ｅ伎鐠佲€冲灊
 */
export async function deleteRadarSearchProfile(profileId: string): Promise<void> {
  const session = await auth();
  if (!session?.user?.tenantId) throw new Error('Unauthorized');
  const roleCheck = requireDecider(session);
  if (!roleCheck.authorized) {
    throw new Error(roleCheck.error);
  }
  
  const existing = await prisma.radarSearchProfile.findUnique({
    where: { id: profileId },
  });
  
  if (!existing || existing.tenantId !== session.user.tenantId) {
    throw new Error('Profile not found');
  }
  
  // 閸忓牆鍨归梽銈呭彠閼辨梻娈戝〒鍛婄垼
  await prisma.radarScanCursor.deleteMany({
    where: { profileId },
  });
  
  await prisma.radarSearchProfile.delete({
    where: { id: profileId },
  });
}

/**
 * 閼惧嘲褰囬幍顐ｅ伎鐠佲€冲灊閻ㄥ嫭鐖堕弽鍥╁Ц閹?
 */
export async function getRadarSearchProfileCursors(profileId: string) {
  const session = await auth();
  if (!session?.user?.tenantId) throw new Error('Unauthorized');
  
  const profile = await prisma.radarSearchProfile.findUnique({
    where: { id: profileId },
  });
  
  if (!profile || profile.tenantId !== session.user.tenantId) {
    throw new Error('Profile not found');
  }
  
  const cursors = await prisma.radarScanCursor.findMany({
    where: { profileId },
    orderBy: { lastScanAt: 'desc' },
  });
  
  // 閼惧嘲褰?source 閸氬秶袨
  const sourceIds = cursors.map(c => c.sourceId);
  const sources = await prisma.radarSource.findMany({
    where: { id: { in: sourceIds } },
    select: { id: true, name: true, code: true },
  });
  const sourceMap = new Map(sources.map(s => [s.id, s]));
  
  return cursors.map(c => ({
    ...c,
    cursorState: c.cursorState as Record<string, unknown>,
    source: sourceMap.get(c.sourceId) || null,
  }));
}

/**
 * 閹靛濮╃憴锕€褰傞幍顐ｅ伎
 */
export async function triggerRadarSearchProfileScan(profileId: string): Promise<{ success: boolean; message: string }> {
  const session = await auth();
  if (!session?.user?.tenantId) throw new Error('Unauthorized');
  
  const profile = await prisma.radarSearchProfile.findUnique({
    where: { id: profileId },
  });
  
  if (!profile || profile.tenantId !== session.user.tenantId) {
    throw new Error('Profile not found');
  }
  
  // 濡偓閺屻儲妲搁崥锕€鍑＄悮顐︽敚鐎?
  if (profile.lockToken && profile.lockedAt) {
    const lockAge = Date.now() - profile.lockedAt.getTime();
    if (lockAge < 5 * 60 * 1000) {
      return { success: false, message: '任务已在运行中，请稍后再试' };
    }
  }
  
  // 鐠佸墽鐤?nextRunAt 娑撹櫣骞囬崷顭掔礉鐠佲晞鐨熸惔锕€娅掔粩瀣祮閹锋儳褰?
  await prisma.radarSearchProfile.update({
    where: { id: profileId },
    data: { 
      nextRunAt: new Date(),
      isActive: true,
    },
  });
  
  return { success: true, message: '扫描任务已加入队列' };
}

// ==================== 濞撳懐鎮?====================

// ==================== 辅助任务 ====================

/**
 * 清理过期的候选人数据
 */
export async function cleanupExpiredV2(): Promise<number> {
  const session = await auth();
  if (!session?.user?.tenantId) throw new Error('Unauthorized');
  return cleanupExpiredCandidates();
}


/**
 * 手动触发线索丰富化
 */
export async function enrichProspectCompanyAction(companyId: string) {
  const session = await auth();
  if (!session?.user?.tenantId) throw new Error('Unauthorized');
  const company = await prisma.prospectCompany.findUnique({
    where: { id: companyId, tenantId: session.user.tenantId }
  });
  if (!company) throw new Error('Company not found');
  return await enrichProspectCompany(company.id);
}

/**
 * Batch enrich prospect companies and return per-company results for UI progress/summary.
 */
export async function enrichProspectCompaniesBatchAction(
  companyIds: string[]
): Promise<ProspectEnrichmentBatchResult> {
  const session = await auth();
  if (!session?.user?.tenantId) {
    throw new Error('Unauthorized');
  }

  const tenantId = session.user.tenantId;
  const uniqueIds = Array.from(new Set(companyIds.filter(Boolean)));
  if (uniqueIds.length === 0) {
    return {
      success: true,
      summary: {
        total: 0,
        succeeded: 0,
        failed: 0,
        contactsFound: 0,
      },
      results: [],
    };
  }

  const companies = await prisma.prospectCompany.findMany({
    where: {
      tenantId,
      id: { in: uniqueIds },
      deletedAt: null,
    },
    select: {
      id: true,
      name: true,
    },
  });

  const companyMap = new Map(companies.map((company) => [company.id, company]));
  const results: ProspectEnrichmentItemResult[] = [];

  for (const companyId of uniqueIds) {
    const company = companyMap.get(companyId);
    if (!company) {
      results.push({
        companyId,
        companyName: 'Unknown company',
        success: false,
        personCount: 0,
        error: 'Company not found',
      });
      continue;
    }

    try {
      const result = await enrichProspectCompany(company.id);
      results.push({
        companyId: company.id,
        companyName: company.name,
        success: result.success,
        personCount: result.success ? result.personCount ?? 0 : 0,
        error: result.success ? undefined : result.error,
      });
    } catch (error) {
      results.push({
        companyId: company.id,
        companyName: company.name,
        success: false,
        personCount: 0,
        error: error instanceof Error ? error.message : 'Enrichment failed',
      });
    }
  }

  const succeeded = results.filter((item) => item.success).length;
  const failed = results.length - succeeded;
  const contactsFound = results.reduce((sum, item) => sum + item.personCount, 0);

  return {
    success: failed === 0,
    summary: {
      total: results.length,
      succeeded,
      failed,
      contactsFound,
    },
    results,
  };
}

// ==================== 单国多源并发搜索 ====================

/**
 * 单组合多源并发搜索：一个关键词 × 一个国家，
 * 同时使用 Google Places + AI 搜索 + Apollo 等多种数据源并行发现
 *
 * 策略：
 *   - 获取所有有 API Key 的自动发现源
 *   - 每个源创建一个独立 Task 并发执行
 *   - 结果按公司名+域名去重合并
 *   - 一个源失败不影响其他源
 */
export async function runSingleCountrySearch(input: {
  name: string;
  queryConfig: RadarSearchQuery;
  keyword: string;
  country: string;
  targetingRef?: { specVersionId?: string };
}): Promise<{
  keyword: string;
  country: string;
  fetched: number;
  created: number;
  duplicates: number;
  candidateIds: string[];
  sources: Array<{ code: string; name: string; taskId: string; fetched: number; created: number; duplicates: number; error?: string }>;
  error?: string;
}> {
  const session = await auth();
  if (!session?.user?.tenantId) throw new Error('Unauthorized');

  const singleComboQuery: RadarSearchQuery = {
    ...input.queryConfig,
    keywords: [input.keyword],
    countries: [input.country],
  };

  try {
    // 获取所有可用数据源
    const availableSources = await getAvailableAutoDiscoverySources();
    const sourcesWithKey = availableSources.filter(s => s.hasApiKey);

    if (sourcesWithKey.length === 0) {
      // 回退到单一默认源
      const task = await createDiscoveryTaskV2({
        name: `${input.name}: ${input.keyword} × ${input.country}`,
        queryConfig: singleComboQuery,
        targetingRef: input.targetingRef,
      });
      const result = await runRadarTask(task.id);
      return {
        keyword: input.keyword,
        country: input.country,
        fetched: result.stats.fetched,
        created: result.stats.created,
        duplicates: result.stats.duplicates,
        candidateIds: [],
        sources: [{ code: 'default', name: 'Default Source', taskId: task.id, ...result.stats }],
      };
    }

    console.log(
      `[radar-v2] Multi-source discovery for "${input.keyword}" × ${input.country}: ` +
      `${sourcesWithKey.length} sources (${sourcesWithKey.map(s => s.source.code).join(', ')})`
    );

    // 并发执行所有数据源
    const sourceResults = await Promise.allSettled(
      sourcesWithKey.map(async ({ source }) => {
        const task = await createDiscoveryTaskV2({
          sourceId: source.id,
          name: `${input.name}: ${input.keyword} × ${input.country} [${source.code}]`,
          queryConfig: singleComboQuery,
          targetingRef: input.targetingRef,
        });

        console.log(`[radar-v2] Running source ${source.code} (task ${task.id})...`);
        const result = await runRadarTask(task.id);
        console.log(
          `[radar-v2] Source ${source.code} done: ${result.stats.fetched} fetched, ` +
          `${result.stats.created} new, ${result.stats.duplicates} dup`
        );

        return {
          code: source.code,
          name: source.name,
          taskId: task.id,
          fetched: result.stats.fetched,
          created: result.stats.created,
          duplicates: result.stats.duplicates,
          error: result.stats.errors?.[0],
        };
      })
    );

    // 汇总结果
    const sources: Array<{
      code: string;
      name: string;
      taskId: string;
      fetched: number;
      created: number;
      duplicates: number;
      error?: string;
    }> = [];

    let totalFetched = 0;
    let totalCreated = 0;
    let totalDuplicates = 0;
    const allErrors: string[] = [];
    const taskIds: string[] = [];

    for (const r of sourceResults) {
      if (r.status === 'fulfilled') {
        sources.push(r.value);
        totalFetched += r.value.fetched;
        totalCreated += r.value.created;
        totalDuplicates += r.value.duplicates;
        taskIds.push(r.value.taskId);
        if (r.value.error) allErrors.push(`[${r.value.code}] ${r.value.error}`);
      } else {
        sources.push({
          code: 'unknown',
          name: 'Failed Source',
          taskId: '',
          fetched: 0,
          created: 0,
          duplicates: 0,
          error: r.reason instanceof Error ? r.reason.message : String(r.reason),
        });
        allErrors.push(r.reason instanceof Error ? r.reason.message : String(r.reason));
      }
    }

    // 查询本次搜索创建的所有候选 ID
    const newCandidates = taskIds.length > 0
      ? await prisma.radarCandidate.findMany({
          where: {
            tenantId: session.user.tenantId,
            taskId: { in: taskIds },
            status: { not: 'IMPORTED' },
          },
          select: { id: true },
          take: 200,
        })
      : [];
    const candidateIds = newCandidates.map(c => c.id);

    return {
      keyword: input.keyword,
      country: input.country,
      fetched: totalFetched,
      created: totalCreated,
      duplicates: totalDuplicates,
      candidateIds,
      sources,
      error: allErrors.length > 0 ? allErrors.join('; ') : undefined,
    };
  } catch (err) {
    return {
      keyword: input.keyword,
      country: input.country,
      fetched: 0,
      created: 0,
      duplicates: 0,
      candidateIds: [],
      sources: [],
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}

// ==================== 自动补全 + 自动入库 ====================

const AUTO_ENRICH_CONCURRENCY = 3;
const AUTO_IMPORT_EMAIL_MIN_CONFIDENCE = 70;

/**
 * 搜索完成后自动执行的管线：
 *   1. 对候选企业执行联系人补全（Firecrawl + OSINT + 邮箱验证 + LinkedIn）
 *   2. 有邮箱数据的企业自动移入线索库（ProspectCompany）
 *
 * 设计原则：
 *   - 并发处理（3个一批）避免 Vercel 超时
 *   - 每个候选独立容错，一个失败不影响其他
 *   - 已在 runRadarTask 中补全过的候选自动跳过
 */
export async function autoEnrichAndImportCandidates(
  candidateIds: string[]
): Promise<{
  enriched: number;
  imported: number;
  failed: number;
  errors: string[];
}> {
  const session = await auth();
  if (!session?.user?.tenantId || !session.user.id) throw new Error('Unauthorized');

  const stats = { enriched: 0, imported: 0, failed: 0, errors: [] as string[] };

  if (!candidateIds.length) return stats;

  console.log(`[autoEnrich] Starting auto-enrich + import for ${candidateIds.length} candidates`);

  for (let i = 0; i < candidateIds.length; i += AUTO_ENRICH_CONCURRENCY) {
    const batch = candidateIds.slice(i, i + AUTO_ENRICH_CONCURRENCY);

    const results = await Promise.allSettled(
      batch.map(async (candidateId) => {
        // 检查是否已被补全过
        const candidate = await prisma.radarCandidate.findUnique({
          where: { id: candidateId },
          select: { id: true, status: true, email: true, enrichedAt: true, tenantId: true },
        });

        if (!candidate || candidate.tenantId !== session.user.tenantId) {
          return { enriched: false, imported: false, reason: 'not found or wrong tenant' };
        }

        // 跳过已导入或已补全的
        if (candidate.status === 'IMPORTED') {
          return { enriched: false, imported: false, reason: 'already imported' };
        }

        // Step 1: 联系人补全
        let enriched = false;
        if (!candidate.enrichedAt) {
          try {
            const { enrichCandidateIntelligence } = await import(
              '@/lib/radar/intelligence-enricher'
            );
            const enrichResult = await enrichCandidateIntelligence(candidateId, {
              includeFunding: false,
              includeNews: false,
              includeContacts: true,
              includeCompetitors: false,
            });

            if (enrichResult.success) {
              enriched = true;
            } else if (enrichResult.errors.length > 0) {
              console.warn(`[autoEnrich] Enrich ${candidateId} partial:`, enrichResult.errors.join('; '));
              enriched = true; // 部分成功也算成功
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`[autoEnrich] Enrich ${candidateId} failed:`, msg);
            return { enriched: false, imported: false, reason: msg };
          }
        } else {
          enriched = true; // 之前已补全
        }

        // Step 2: 有邮箱 → 自动入库
        let imported = false;
        if (enriched) {
          const updated = await prisma.radarCandidate.findUnique({
            where: { id: candidateId },
            select: { email: true, phone: true, status: true },
          });

          const hasEmail = updated?.email && updated.email.includes('@');
          if (hasEmail && updated?.status !== 'IMPORTED') {
            try {
              await importCandidateToCompanyV2Internal(candidateId, session.user.id, session.user.tenantId);
              imported = true;
              console.log(`[autoEnrich] Auto-imported ${candidateId} to leads (email: ${updated?.email})`);
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              if (!msg.includes('already imported')) {
                console.error(`[autoEnrich] Import ${candidateId} failed:`, msg);
              }
            }
          }
        }

        return { enriched, imported };
      })
    );

    for (const r of results) {
      if (r.status === 'fulfilled') {
        if (r.value.enriched) stats.enriched++;
        if (r.value.imported) stats.imported++;
        if (!r.value.enriched && !r.value.imported) stats.failed++;
      } else {
        stats.failed++;
        stats.errors.push(r.reason instanceof Error ? r.reason.message : String(r.reason));
      }
    }
  }

  console.log(
    `[autoEnrich] Done: ${stats.enriched} enriched, ${stats.imported} imported, ${stats.failed} failed`
  );

  return stats;
}

/**
 * 内部导入函数（无需再次 auth，由 autoEnrichAndImportCandidates 调用）
 */
async function importCandidateToCompanyV2Internal(
  candidateId: string,
  userId: string,
  tenantId: string
): Promise<void> {
  const candidate = await prisma.radarCandidate.findUnique({
    where: { id: candidateId },
    include: { source: true },
  });

  if (!candidate || candidate.status === 'IMPORTED') return;

  const companyName = candidate.buyerName || candidate.displayName;
  const companyCountry = candidate.buyerCountry || candidate.country;
  const { normalizeDomainForDedup } = await import('@/lib/radar/prospect-import');
  const { getCandidateContactEnrichment } = await import('@/lib/radar/contact-enrichment');
  const { buildProspectOutreachStateValue } = await import('@/lib/radar/prospect-outreach-state');

  // 去重检查
  let existingCompany: { id: string } | null = null;
  if (candidate.website) {
    const domain = normalizeDomainForDedup(candidate.website);
    if (domain) {
      existingCompany = await prisma.prospectCompany.findFirst({
        where: { tenantId, website: { contains: domain, mode: 'insensitive' }, deletedAt: null },
        select: { id: true },
      });
    }
  }

  if (existingCompany) {
    // 已存在则只标记导入
    await prisma.radarCandidate.update({
      where: { id: candidateId },
      data: {
        status: 'IMPORTED',
        importedToType: 'ProspectCompany',
        importedToId: existingCompany.id,
        importedAt: new Date(),
        importedBy: userId,
      },
    });
    return;
  }

  const matchReasons = (candidate.matchExplain as Record<string, unknown>)?.reasons || [];
  const candidateContactSnapshot = getCandidateContactEnrichment(candidate);

  const company = await prisma.prospectCompany.create({
    data: {
      tenantId,
      name: companyName,
      website: candidate.website,
      phone: candidate.phone,
      email: candidate.email,
      address: candidate.address,
      country: companyCountry,
      city: candidate.city,
      industry: candidate.industry,
      companySize: candidate.companySize,
      description: candidate.description,
      tier: candidate.qualifyTier,
      matchReasons: Array.isArray(matchReasons) ? (matchReasons as unknown as Prisma.InputJsonValue) : undefined,
      sourceType: candidate.source.channelType.toLowerCase(),
      sourceCandidateId: candidateId,
      sourceUrl: candidate.sourceUrl,
      status: 'new',
      outreachArtifacts: candidateContactSnapshot
        ? buildProspectOutreachStateValue(null, { contactSnapshot: candidateContactSnapshot })
        : undefined,
    },
  });

  await prisma.radarCandidate.update({
    where: { id: candidateId },
    data: {
      status: 'IMPORTED',
      importedToType: 'ProspectCompany',
      importedToId: company.id,
      importedAt: new Date(),
      importedBy: userId,
    },
  });

  await prisma.activity.create({
    data: {
      tenantId,
      userId,
      action: 'radar_candidate_auto_imported',
      entityType: 'ProspectCompany',
      entityId: company.id,
      eventCategory: 'radar',
      context: { candidateId, companyName: company.name, autoEnrich: true } as object,
    },
  });
}

// ==================== 搜索组合进度矩阵 ====================

export interface SearchComboCell {
  keyword: string;
  country: string;
  status: 'pending' | 'completed';
  lastSearchedAt: string | null;
  resultCount: number;
  newCount: number;
  searchCount: number;  // 被搜索过的轮次（每个单国家任务计 1 轮）
}

export interface SearchComboMatrix {
  keywords: string[];
  countries: Array<{ code: string; label: string }>;
  cells: SearchComboCell[];
  summary: { total: number; completed: number; pending: number };
}

/**
 * 获取搜索组合进度矩阵
 * 通过分析已完成的 RadarTask 记录，确定哪些 (关键词 × 国家) 组合已经被搜索过
 */
export async function getSearchComboMatrix(
  keywords: string[],
  countries: string[]
): Promise<SearchComboMatrix> {
  const session = await auth();
  if (!session?.user?.tenantId) throw new Error('Unauthorized');
  const tenantId = session.user.tenantId;
  const countryLabels: Record<string, string> = {
    VN: '越南', TH: '泰国', ID: '印尼', MY: '马来西亚', PH: '菲律宾',
    SG: '新加坡', IN: '印度', MX: '墨西哥', TR: '土耳其', SA: '沙特',
    AE: '阿联酋', US: '美国', CA: '加拿大', BR: '巴西', CO: '哥伦比亚',
    CL: '智利', PE: '秘鲁', AU: '澳大利亚', GB: '英国', DE: '德国',
    FR: '法国', ES: '西班牙', IT: '意大利', PL: '波兰', CZ: '捷克',
    JP: '日本', KR: '韩国', ZA: '南非', EG: '埃及', NG: '尼日利亚',
    KE: '肯尼亚', PK: '巴基斯坦', BD: '孟加拉', MM: '缅甸', KH: '柬埔寨',
    LA: '老挝',
  };

  const countryInfos = countries.map(c => ({
    code: c,
    label: countryLabels[c] || c,
  }));

  // 查询最近 30 天内完成的 RadarTask
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const completedTasks = await prisma.radarTask.findMany({
    where: {
      tenantId,
      status: 'COMPLETED',
      completedAt: { gte: thirtyDaysAgo },
    },
    select: {
      queryConfig: true,
      stats: true,
      completedAt: true,
    },
    orderBy: { completedAt: 'desc' },
    take: 200,
  });

  // 从任务的 queryConfig 中提取已搜过的 (keyword, country) 组合
  const searched = new Map<string, { lastSearchedAt: string; resultCount: number; newCount: number; searchCount: number }>();

  for (const task of completedTasks) {
    const config = task.queryConfig as RadarSearchQuery | null;
    if (!config) continue;

    const taskKeywords = config.keywords || [];
    const taskCountries = config.countries || [];
    const stats = task.stats as { fetched?: number; created?: number } | null;
    const completedAt = task.completedAt?.toISOString() || '';

    // 只计入单国家任务（由 runDiscoveryByCountries 创建）
    const effectiveCountries = taskCountries.length === 1
      ? taskCountries
      : [];

    for (const kw of taskKeywords) {
      for (const c of effectiveCountries) {
        const key = `${kw.toLowerCase()}|${c}`;
        const existing = searched.get(key);
        const newRecord = {
          lastSearchedAt: completedAt,
          resultCount: (existing?.resultCount || 0) + (stats?.fetched || 0),
          newCount: (existing?.newCount || 0) + (stats?.created || 0),
          searchCount: (existing?.searchCount || 0) + 1, // 每个匹配的 task 计一轮
        };
        if (!existing || completedAt > existing.lastSearchedAt) {
          searched.set(key, newRecord);
        }
      }
    }
  }

  // 构建完整矩阵
  const cells: SearchComboCell[] = [];
  let completed = 0;

  for (const keyword of keywords) {
    for (const country of countries) {
      const key = `${keyword.toLowerCase()}|${country}`;
      const record = searched.get(key);
      const isCompleted = !!record;
      if (isCompleted) completed++;

      cells.push({
        keyword,
        country,
        status: isCompleted ? 'completed' : 'pending',
        lastSearchedAt: record?.lastSearchedAt || null,
        resultCount: record?.resultCount || 0,
        newCount: record?.newCount || 0,
        searchCount: record?.searchCount || 0,
      });
    }
  }

  const total = cells.length;

  return {
    keywords,
    countries: countryInfos,
    cells,
    summary: { total, completed, pending: total - completed },
  };
}

/**
 * 清理卡住的 RUNNING 任务（超过 10 分钟仍为 RUNNING 状态）
 */
export async function cleanupStuckTasks(): Promise<{ fixed: number }> {
  const session = await auth();
  if (!session?.user?.tenantId) throw new Error('Unauthorized');

  const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);

  const result = await prisma.radarTask.updateMany({
    where: {
      tenantId: session.user.tenantId,
      status: 'RUNNING',
      startedAt: { lt: tenMinutesAgo },
    },
    data: {
      status: 'FAILED',
      completedAt: new Date(),
      errorMessage: 'Auto-cleaned: task stuck in RUNNING for >10 minutes',
    },
  });

  return { fixed: result.count };
}
