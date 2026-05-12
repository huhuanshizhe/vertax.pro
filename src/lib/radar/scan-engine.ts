// ==================== Incremental Scan Engine ====================
// 增量扫描引擎：游标驱动 + 时间预算 + 锁归属校验
// 集成 DiscoveryQueryPlanner + FastICPScorer (Phase 1)

import { prisma } from '@/lib/prisma';
import { 
  getAdapter, 
  ensureAdaptersInitialized,
  type RadarSearchQuery,
  type NormalizedCandidate,
} from './adapters';
import {
  buildTenantIndustryRadarHints,
  selectTenantIndustrySourcePacks,
} from './tenant-industry-source-pack';
import {
  planDiscoveryQueries,
  FallbackLexiconProvider,
} from './discovery-query-planner';
import {
  fastICPScore,
  buildDiscoveryEvidence,
  extractLocalExclusions,
  type ScoringContext,
  DEFAULT_SCORING_CONFIG,
} from './fast-icp-scorer';

// ==================== 类型定义 ====================

export interface ScanOptions {
  maxRunSeconds: number;    // 默认 45
  maxResults?: number;      // 可选上限
  lockToken: string;        // 条款A: 锁归属校验用
}

export interface ScanResult {
  fetched: number;
  created: number;
  duplicates: number;
  errors: string[];
  duration: number;
  cursorAdvanced: boolean;
  exhausted: boolean;
}

interface CursorState {
  nextPage?: number;
  nextPageToken?: string;
  since?: string;          // ISO8601
  queryIndex?: number;
  planVersion?: string;    // Query plan hash for cursor stability
  exhausted?: boolean;
}

// ==================== 增量扫描核心 ====================

export async function runIncrementalScan(
  profileId: string,
  sourceId: string,
  options: ScanOptions
): Promise<ScanResult> {
  ensureAdaptersInitialized();
  const startTime = Date.now();
  const deadline = startTime + options.maxRunSeconds * 1000;

  const stats: ScanResult = {
    fetched: 0,
    created: 0,
    duplicates: 0,
    errors: [],
    duration: 0,
    cursorAdvanced: false,
    exhausted: false,
  };

  try {
    // 1. 加载 Profile + Source
    const profile = await prisma.radarSearchProfile.findUnique({
      where: { id: profileId },
    });
    if (!profile) throw new Error(`Profile not found: ${profileId}`);

    const source = await prisma.radarSource.findUnique({
      where: { id: sourceId },
    });
    if (!source) throw new Error(`Source not found: ${sourceId}`);

    const [tenant, companyProfile] = await Promise.all([
      prisma.tenant.findUnique({
        where: { id: profile.tenantId },
        select: { slug: true, name: true, domain: true },
      }),
      prisma.companyProfile.findUnique({
        where: { tenantId: profile.tenantId },
        select: {
          companyName: true,
          companyIntro: true,
          coreProducts: true,
          targetIndustries: true,
          scenarios: true,
          buyerPersonas: true,
          painPoints: true,
          buyingTriggers: true,
        },
      }),
    ]);

    // 2. 读取或初始化游标
    const cursorRecord = await prisma.radarScanCursor.findUnique({
      where: { profileId_sourceId: { profileId, sourceId } },
    });

    let cursor: CursorState = cursorRecord
      ? (cursorRecord.cursorState as CursorState)
      : { nextPage: 0, queryIndex: 0, exhausted: false };

    // 如果上次已 exhausted，重置游标（time-skew buffer: 回退10分钟）
    if (cursor.exhausted) {
      cursor = {
        nextPage: 0,
        queryIndex: 0,
        since: new Date(Date.now() - 10 * 60 * 1000).toISOString(), // 条款C
        exhausted: false,
      };
    }

    // 3. 获取适配器
    const adapter = getAdapter(source.code, source.adapterConfig as Record<string, unknown>);

    // 4. 构建查询计划（替代原有的 flat keyword iteration）
    const sourcePackHints = buildTenantIndustryRadarHints({
      tenantSlug: tenant?.slug,
      companyName: companyProfile?.companyName || tenant?.name,
      companyIntro: companyProfile?.companyIntro || tenant?.domain,
      coreProducts: companyProfile?.coreProducts,
      targetIndustries: companyProfile?.targetIndustries,
      scenarios: companyProfile?.scenarios,
      buyerPersonas: companyProfile?.buyerPersonas,
      painPoints: companyProfile?.painPoints,
      buyingTriggers: companyProfile?.buyingTriggers,
    });

    // 使用 DiscoveryQueryPlanner 生成多语言查询计划
    const lexiconProvider = new FallbackLexiconProvider();
    const queryPlan = await planDiscoveryQueries({
      tenantId: profile.tenantId,
      tenantSlug: tenant?.slug,
      packHints: sourcePackHints,
      targetCountries: profile.targetCountries,
      currentAdapterCode: source.code,
      customKeywords: (profile.keywords as Record<string, string[]>)?.en,
    }, lexiconProvider);

    // Cursor stability: 如果 planVersion 变化，重置游标
    if (cursor.planVersion && cursor.planVersion !== queryPlan.planVersion) {
      cursor = { nextPage: 0, queryIndex: 0, planVersion: queryPlan.planVersion, exhausted: false };
    }
    cursor.planVersion = queryPlan.planVersion;

    // Fallback: 如果 query planner 无输出，使用旧逻辑
    const plannedQueries = queryPlan.queries;
    if (plannedQueries.length === 0) {
      const fallbackKeywords = [
        ...((profile.keywords as Record<string, string[]>)?.en || []),
      ];
      for (const kw of fallbackKeywords.slice(0, 10)) {
        plannedQueries.push({
          text: kw,
          language: 'en',
          countryCode: profile.targetCountries[0] || '',
          sourceCategory: 'web_serp_english',
          intent: 'discovery',
          priority: 20,
          metadata: { termsUsed: [kw] },
        });
      }
    }

    // 构建 FastICPScorer 上下文
    const packs = selectTenantIndustrySourcePacks({
      tenantSlug: tenant?.slug,
      companyName: companyProfile?.companyName || tenant?.name,
      companyIntro: companyProfile?.companyIntro || tenant?.domain,
      coreProducts: companyProfile?.coreProducts,
      targetIndustries: companyProfile?.targetIndustries,
      scenarios: companyProfile?.scenarios,
      buyerPersonas: companyProfile?.buyerPersonas,
      painPoints: companyProfile?.painPoints,
      buyingTriggers: companyProfile?.buyingTriggers,
    });
    const activePack = packs[0];
    const scoringConfig = activePack?.scoringConfig || DEFAULT_SCORING_CONFIG;
    const scoringContext: ScoringContext = {
      scoringConfig,
      targetCountries: profile.targetCountries,
      targetIndustries: mergeUnique([
        ...profile.industryCodes,
        ...sourcePackHints.targetIndustries,
      ]),
      targetRegions: profile.targetRegions,
      triggerKeywords: sourcePackHints.buyingTriggers,
    };

    const baseQuery: RadarSearchQuery = {
      countries: profile.targetCountries.length > 0 ? profile.targetCountries : undefined,
      regions: profile.targetRegions.length > 0 ? profile.targetRegions : undefined,
      categories: profile.categoryFilters.length > 0 ? profile.categoryFilters : undefined,
      cursor: {
        nextPage: cursor.nextPage,
        nextPageToken: cursor.nextPageToken,
        since: cursor.since,
        queryIndex: cursor.queryIndex,
        planVersion: cursor.planVersion,
      },
      maxResults: options.maxResults,
    };

    // 5. 创建审计用 RadarTask
    const task = await prisma.radarTask.create({
      data: {
        tenantId: profile.tenantId,
        name: `Auto-scan: ${profile.name} × ${source.name}`,
        sourceId,
        queryConfig: baseQuery as object,
        triggeredBy: 'scheduler',
        status: 'RUNNING',
        startedAt: new Date(),
      },
    });

    // 6. 预算循环（使用 PlannedQuery 驱动）
    let iterationCount = 0;
    const initialCursor = { ...cursor };

    while (Date.now() < deadline) {
      // 条款A: 每次迭代前校验锁归属
      if (iterationCount > 0 && iterationCount % 3 === 0) {
        const lockCheck = await prisma.radarSearchProfile.findUnique({
          where: { id: profileId },
          select: { lockToken: true },
        });
        if (lockCheck?.lockToken !== options.lockToken) {
          stats.errors.push('Lock lost - aborting scan');
          break;
        }
      }

      // 从 PlannedQuery 列表中获取当前查询
      const currentQueryIndex = cursor.queryIndex || 0;
      if (currentQueryIndex >= plannedQueries.length) {
        // 所有查询都搜索完了
        cursor.exhausted = true;
        cursor.since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
        cursor.queryIndex = 0;
        stats.exhausted = true;
        break;
      }

      const currentPlannedQuery = plannedQueries[currentQueryIndex];

      // 获取该查询国家的本地排除词
      const queryLexicon = await lexiconProvider.getCountryLexicon(
        currentPlannedQuery.countryCode,
        activePack?.id,
        profile.tenantId
      );
      const localExclusions = extractLocalExclusions(queryLexicon, currentPlannedQuery.language);
      scoringContext.localExclusions = localExclusions;

      // 构建搜索查询（使用 rawQueryText，adapter 直接使用）
      const queryWithCursor: RadarSearchQuery = {
        ...baseQuery,
        rawQueryText: currentPlannedQuery.text,
        plannedQueryMeta: {
          language: currentPlannedQuery.language,
          sourceCategory: currentPlannedQuery.sourceCategory,
          intent: currentPlannedQuery.intent,
          planVersion: queryPlan.planVersion,
        },
        countries: currentPlannedQuery.countryCode ? [currentPlannedQuery.countryCode] : baseQuery.countries,
        cursor: {
          nextPage: cursor.nextPage,
          nextPageToken: cursor.nextPageToken,
          since: cursor.since,
          queryIndex: cursor.queryIndex,
          planVersion: cursor.planVersion,
        },
      };

      const result = await adapter.search(queryWithCursor);
      stats.fetched += result.items.length;

      // 批量处理候选（使用 FastICPScorer 替代简单负面词过滤）
      for (const item of result.items) {
        const scoreResult = fastICPScore(item, scoringContext);

        if (scoreResult.gate === 'HARD_REJECT') continue;

        // 注入结构化证据
        item.matchExplain = buildDiscoveryEvidence(
          scoreResult, currentPlannedQuery, adapter.sourceCode, queryPlan.planVersion
        ) as unknown as typeof item.matchExplain;
        item.matchScore = scoreResult.score / 100;

        try {
          await processCandidate(
            profile.tenantId, sourceId, task.id, profileId, item,
            source.ttlDays, source.storagePolicy, stats,
            {
              tier: scoreResult.tier,
              shouldDeepQualify: scoreResult.shouldDeepQualify,
              reason: scoreResult.reason,
            }
          );
        } catch (error) {
          const errMsg = error instanceof Error ? error.message : 'Unknown error';
          stats.errors.push(`Candidate error: ${errMsg}`);
        }
      }

      // 更新游标
      if (result.nextCursor) {
        cursor = { ...cursor, ...result.nextCursor };
        stats.cursorAdvanced = true;
      }

      // 当前 PlannedQuery 搜索完成
      if (result.isExhausted || !result.hasMore) {
        cursor.queryIndex = (cursor.queryIndex || 0) + 1;
        cursor.nextPage = 0;
        cursor.nextPageToken = undefined;
        stats.cursorAdvanced = true;
      }

      // 速率限制
      await sleep(1000);
      iterationCount++;

      // maxResults 检查
      if (options.maxResults && stats.fetched >= options.maxResults) break;
    }

    // 7. 写回游标（upsert）
    stats.cursorAdvanced = stats.cursorAdvanced || 
      JSON.stringify(cursor) !== JSON.stringify(initialCursor);

    await prisma.radarScanCursor.upsert({
      where: { profileId_sourceId: { profileId, sourceId } },
      create: {
        profileId,
        sourceId,
        cursorState: cursor as object,
        lastScanAt: new Date(),
        scanCount: 1,
        totalFetched: stats.fetched,
        totalNew: stats.created,
        lastError: stats.errors.length > 0 ? stats.errors[0] : null,
      },
      update: {
        cursorState: cursor as object,
        lastScanAt: new Date(),
        scanCount: { increment: 1 },
        totalFetched: { increment: stats.fetched },
        totalNew: { increment: stats.created },
        lastError: stats.errors.length > 0 ? stats.errors[0] : null,
      },
    });

    // 8. 完成审计任务
    stats.duration = Date.now() - startTime;
    await prisma.radarTask.update({
      where: { id: task.id },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
        stats: {
          fetched: stats.fetched,
          created: stats.created,
          duplicates: stats.duplicates,
          errors: stats.errors,
          duration: stats.duration,
          cursorAdvanced: stats.cursorAdvanced,
          exhausted: stats.exhausted,
        } as object,
      },
    });

    return stats;
  } catch (error) {
    stats.duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    stats.errors.push(errorMessage);
    return stats;
  }
}

// ==================== 候选处理（upsert 去重） ====================

interface CandidateScoringMeta {
  tier: import('./fast-icp-scorer').ScoreTier;
  shouldDeepQualify: boolean;
  reason: string;
}

async function processCandidate(
  tenantId: string,
  sourceId: string,
  taskId: string,
  profileId: string,
  item: NormalizedCandidate,
  ttlDays: number,
  storagePolicy: string,
  stats: { created: number; duplicates: number; errors: string[] },
  scoringMeta: CandidateScoringMeta
): Promise<void> {
  const expireAt = ttlDays
    ? new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000)
    : undefined;

  // 条款B: upsert 避免竞态，使用 sourceId_externalId 复合键
  // P1-3: externalId 为空时生成 fallback，防止 unique key 碰撞导致数据覆盖
  if (!item.externalId) {
    const rawKey = (item.displayName + '::' + item.sourceUrl).toLowerCase().replace(/\s+/g, '-');
    const hash = Buffer.from(rawKey).toString('base64url').slice(0, 48);
    item = { ...item, externalId: 'fallback-' + hash };
  }

  // Budget control: needs_review 候选直接进入 REVIEWING，不进入 AI qualify 队列
  const initialStatus = scoringMeta.shouldDeepQualify ? 'NEW' : 'REVIEWING';
  const initialQualifyTier = scoringMeta.tier === 'reject' ? undefined : scoringMeta.tier;

  const result = await prisma.radarCandidate.upsert({
    where: {
      sourceId_externalId: {
        sourceId,
        externalId: item.externalId,
      },
    },
    create: {
      tenantId,
      sourceId,
      taskId,
      profileId,
      candidateType: item.candidateType,
      externalId: item.externalId,
      sourceUrl: item.sourceUrl,
      displayName: item.displayName,
      description: item.description,

      // 公司字段
      website: item.website,
      phone: item.phone,
      email: item.email,
      address: item.address,
      country: item.country,
      city: item.city,
      industry: item.industry,
      companySize: item.companySize,

      // 机会字段
      deadline: item.deadline,
      estimatedValue: item.estimatedValue,
      currency: item.currency,
      buyerName: item.buyerName,
      buyerCountry: item.buyerCountry,
      buyerType: item.buyerType,
      categoryCode: item.categoryCode,
      categoryName: item.categoryName,

      // 匹配信息
      matchExplain: item.matchExplain as object,
      matchScore: item.matchScore,
      publishedAt: item.publishedAt,

      // TTL 策略
      rawData: storagePolicy !== 'ID_ONLY' ? (item.rawData as object) : undefined,
      expireAt,

      // Budget control: shouldDeepQualify 决定初始状态
      status: initialStatus,
      qualifyTier: initialQualifyTier,
      qualifyReason: scoringMeta.shouldDeepQualify
        ? undefined
        : scoringMeta.reason || 'Fast-scored needs_review; awaiting evidence verification',
    },
    update: {
      // 仅更新时间戳，不覆盖已有数据
      updatedAt: new Date(),
    },
  });

  // 通过 createdAt 判断是新建还是已存在
  const isNew = Date.now() - result.createdAt.getTime() < 5000;
  if (isNew) {
    stats.created++;
  } else {
    stats.duplicates++;
  }
}

// ==================== 工具函数 ====================

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function mergeUnique(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const normalized = value.trim();
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(normalized);
  }

  return result;
}
