// ==================== Incremental Scan Engine ====================
// 增量扫描引擎：游标驱动 + 时间预算 + 锁归属校验 + AI 关键词飞轮

import { prisma } from '@/lib/prisma';
import { 
  getAdapter, 
  ensureAdaptersInitialized,
  type RadarSearchQuery,
  type NormalizedCandidate,
} from './adapters';
import {
  buildTenantIndustryRadarHints,
  mergeRadarKeywordHints,
} from './tenant-industry-source-pack';
import { 
  initializeKeywordPool, 
  logSearch,
  type KeywordPoolItem,
  type SearchLogItem,
} from './keyword-generator';
import { selectNextSearchCombo } from './keyword-feedback';

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

  let task: { id: string } | null = null;

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
          techAdvantages: true,
          differentiators: true,
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

    // 4. 初始化/加载 AI 关键词池
    const poolSize = await initializeKeywordPool(profileId);
    if (poolSize === 0) {
      stats.errors.push('No keywords available - please configure seedKeywords or company profile');
      return stats;
    }

    // 重新加载 profile 以获取更新后的 keywordPool
    const updatedProfile = await prisma.radarSearchProfile.findUnique({
      where: { id: profileId },
    });
    if (!updatedProfile) throw new Error(`Profile not found after init: ${profileId}`);

    const keywordPool = (updatedProfile.keywordPool as unknown as KeywordPoolItem[]) || [];
    const searchLog = (updatedProfile.searchLog as unknown as SearchLogItem[]) || [];
    const targetCountries = updatedProfile.targetCountries;

    // 4.1 构建行业包关键词（兼容旧逻辑）
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
    
    // 注入排除词
    const exclusionRules = (updatedProfile.exclusionRules as { negativeKeywords?: string[] }) || {};
    const negativeKeywords = [
      ...(updatedProfile.negativeKeywords as string[] || []),
      ...(exclusionRules.negativeKeywords || []),
      ...sourcePackHints.negativeKeywords,
    ];
    const targetIndustries = mergeUnique([
      ...updatedProfile.industryCodes,
      ...sourcePackHints.targetIndustries,
    ]);

    // 5. 选择下一个要搜索的「关键词 × 国家」组合
    const nextCombo = selectNextSearchCombo(keywordPool, targetCountries, searchLog);
    if (!nextCombo) {
      // 所有组合都搜完了
      stats.exhausted = true;
      console.log(`[scan-engine] All keyword×country combinations exhausted for profile ${profileId}`);
      return stats;
    }

    const { keyword: currentKeyword, country: currentCountry } = nextCombo;
    console.log(`[scan-engine] Searching: "${currentKeyword}" in ${currentCountry}`);

    const baseQuery: RadarSearchQuery = {
      keywords: [currentKeyword],
      countries: [currentCountry],
      regions: updatedProfile.targetRegions.length > 0 ? updatedProfile.targetRegions : undefined,
      categories: updatedProfile.categoryFilters.length > 0 ? updatedProfile.categoryFilters : undefined,
      targetIndustries: targetIndustries.length > 0 ? targetIndustries : undefined,
      cursor: {
        nextPage: cursor.nextPage,
        nextPageToken: cursor.nextPageToken,
        since: cursor.since,
        queryIndex: cursor.queryIndex,
      },
      maxResults: options.maxResults,
    };

    // 6. 创建审计用 RadarTask
    task = await prisma.radarTask.create({
      data: {
        tenantId: updatedProfile.tenantId,
        name: `Auto-scan: ${updatedProfile.name} × ${source.name} [${currentKeyword}×${currentCountry}]`,
        sourceId,
        queryConfig: baseQuery as object,
        triggeredBy: 'scheduler',
        status: 'RUNNING',
        startedAt: new Date(),
      },
    });

    // 7. 预算循环（当前组合的分页搜索）
    let iterationCount = 0;
    const initialCursor = { ...cursor };
    let currentComboExhausted = false;

    while (Date.now() < deadline && !currentComboExhausted) {
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

      // 执行搜索（使用最新 cursor 状态构建查询）
      const queryWithCursor: RadarSearchQuery = {
        ...baseQuery,
        cursor: {
          nextPage: cursor.nextPage,
          nextPageToken: cursor.nextPageToken,
          since: cursor.since,
          queryIndex: cursor.queryIndex,
        },
      };

      // 添加超时保护（单个搜索最多 30 秒）
      const SEARCH_TIMEOUT_MS = 30000;
      const searchPromise = adapter.search(queryWithCursor);
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Search timeout after ${SEARCH_TIMEOUT_MS/1000}s`)), SEARCH_TIMEOUT_MS)
      );

      let result;
      try {
        result = await Promise.race([searchPromise, timeoutPromise]);
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : 'Search failed';
        stats.errors.push(`[${source.code}] ${errMsg}`);
        console.error(`[scan-engine] Search failed for ${source.code}:`, errMsg);
        break; // 搜索失败，退出循环
      }

      stats.fetched += result.items.length;

      // 批量收集并处理候选人（减少 N+1 数据库调用）
      // 策略：不排除任何候选，全部入库。负向关键词仅在 matchExplain 中标注，由用户自行判断
      const batchItems: NormalizedCandidate[] = [];
      for (const item of result.items) {
        // 负向关键词标注（不排除，仅标记）
        if (negativeKeywords.length > 0) {
          const itemText = `${item.displayName} ${item.description || ''}`.toLowerCase();
          const matchedNegative = negativeKeywords.filter(kw => itemText.includes(kw.toLowerCase()));
          if (matchedNegative.length > 0) {
            const existing = (item.matchExplain as Record<string, unknown> | null) || {};
            const existingReasons = (existing.reasons as string[] | undefined) || [];
            item.matchExplain = {
              ...existing,
              reasons: [...existingReasons, `⚠ 命中排除词: ${matchedNegative.join(', ')} — 仅供参考，未自动排除`],
            };
          }
        }
        batchItems.push(item);
      }

      // 批量 upsert（每批最多 20 条，并行执行减少数据库往返）
      const BATCH_SIZE = 20;
      for (let i = 0; i < batchItems.length; i += BATCH_SIZE) {
        const batch = batchItems.slice(i, i + BATCH_SIZE);
        try {
          const results = await Promise.all(
            batch.map(item => processCandidateUpsert(updatedProfile.tenantId, sourceId, task!.id, profileId, item, source.ttlDays, source.storagePolicy))
          );
          for (const r of results) {
            if (r === 'created') stats.created++;
            else stats.duplicates++;
          }
        } catch (error) {
          const errMsg = error instanceof Error ? error.message : 'Unknown error';
          stats.errors.push(`Batch candidate error: ${errMsg}`);
          // 降级为逐条处理，尽量保留数据
          for (const item of batch) {
            try {
              const r = await processCandidateUpsert(updatedProfile.tenantId, sourceId, task!.id, profileId, item, source.ttlDays, source.storagePolicy);
              if (r === 'created') stats.created++;
              else stats.duplicates++;
            } catch (e2) {
              stats.errors.push(`Candidate error: ${e2 instanceof Error ? e2.message : 'Unknown'}`);
            }
          }
        }
      }

      // 更新游标
      if (result.nextCursor) {
        cursor = { ...cursor, ...result.nextCursor };
        stats.cursorAdvanced = true;
      }

      // 当前组合搜索完成（无更多分页）
      if (result.isExhausted || !result.hasMore) {
        currentComboExhausted = true;
        stats.exhausted = true;
        stats.cursorAdvanced = true;
      }

      // 速率限制
      await sleep(1000);
      iterationCount++;

      // maxResults 检查
      if (options.maxResults && stats.fetched >= options.maxResults) break;
    }

    // 8. 记录搜索日志（用于去重和反馈）
    await logSearch(
      profileId,
      currentKeyword,
      currentCountry,
      stats.fetched,
      stats.created,
      0 // qualityCount 会在 qualify 后更新
    );

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

    // 9. 自动触发富化（如果有新创建的候选）
    if (stats.created > 0) {
      try {
        // 查询需要富化的候选（没有邮箱的候选）
        const candidatesToEnrich = await prisma.radarCandidate.findMany({
          where: {
            taskId: task.id,
            status: 'NEW',
            email: null, // 没有邮箱
            website: { not: null }, // 有网站才能富化
          },
          select: { id: true, displayName: true, website: true, country: true, industry: true },
          take: 10, // 最多触发 10 个候选的富化
        });

        if (candidatesToEnrich.length > 0) {
          // 标记为待富化状态
          await prisma.radarCandidate.updateMany({
            where: {
              id: { in: candidatesToEnrich.map(c => c.id) },
            },
            data: {
              status: 'ENRICHING',
            },
          });

          console.log(`[scan-engine] Starting enrichment for ${candidatesToEnrich.length} candidates`);

          // 异步执行富化（不阻塞主流程）
          setImmediate(async () => {
            for (const candidate of candidatesToEnrich) {
              try {
                await enrichCandidateEmail(candidate.id);
              } catch (error) {
                console.error(`[scan-engine] Failed to enrich candidate ${candidate.id}:`, error);
                // 更新状态为失败
                await prisma.radarCandidate.update({
                  where: { id: candidate.id },
                  data: { status: 'NEW' }, // 恢复为 NEW，下次再试
                });
              }
            }
          });
        }

        // 10. 自动导入有邮箱的候选到线索库
        const candidatesToImport = await prisma.radarCandidate.findMany({
          where: {
            taskId: task.id,
            status: { in: ['NEW', 'ENRICHING'] },
            email: { not: null }, // 有邮箱
            importedToId: null, // 还没有导入
          },
          select: { id: true },
          take: 20,
        });

        if (candidatesToImport.length > 0) {
          console.log(`[scan-engine] Auto-importing ${candidatesToImport.length} candidates with emails`);

          // 异步执行导入
          setImmediate(async () => {
            for (const candidate of candidatesToImport) {
              try {
                await autoImportCandidate(candidate.id);
              } catch (error) {
                console.error(`[scan-engine] Failed to auto-import candidate ${candidate.id}:`, error);
              }
            }
          });
        }
      } catch (enrichError) {
        console.warn('[scan-engine] Failed to trigger enrichment/import:', enrichError);
        // 不影响主流程
      }
    }

    return stats;
  } catch (error) {
    stats.duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    stats.errors.push(errorMessage);

    // 更新任务状态为 FAILED
    if (task) {
      try {
        await prisma.radarTask.update({
          where: { id: task.id },
          data: {
            status: 'FAILED',
            completedAt: new Date(),
            errorMessage,
            stats: {
              fetched: stats.fetched,
              created: stats.created,
              duplicates: stats.duplicates,
              errors: stats.errors,
              duration: stats.duration,
            } as object,
          },
        });
      } catch (updateError) {
        console.error('[scan-engine] Failed to update task status:', updateError);
      }
    }

    return stats;
  }
}

// ==================== 候选处理（upsert 去重） ====================

/**
 * 富化候选邮箱
 * 使用 Exa 搜索决策者邮箱
 */
async function enrichCandidateEmail(candidateId: string): Promise<void> {
  const candidate = await prisma.radarCandidate.findUnique({
    where: { id: candidateId },
    select: {
      id: true,
      displayName: true,
      website: true,
      country: true,
      industry: true,
      tenantId: true,
    },
  });

  if (!candidate || !candidate.website) {
    console.log(`[enrichCandidateEmail] Candidate ${candidateId} has no website, skipping`);
    return;
  }

  try {
    // 使用 Exa 搜索决策者邮箱
    const { enrichCandidateWithExa } = await import('./exa-enrich');
    const enrichment = await enrichCandidateWithExa(
      candidate.displayName,
      candidate.country,
      candidate.industry
    );

    // 提取邮箱
    const email = enrichment.email;

    if (email) {
      // 更新候选邮箱
      await prisma.radarCandidate.update({
        where: { id: candidateId },
        data: {
          email,
          status: 'NEW', // 恢复为 NEW
        },
      });

      console.log(`[enrichCandidateEmail] Found email for ${candidate.displayName}: ${email}`);

      // 自动导入到线索库
      await autoImportCandidate(candidateId);
    } else {
      // 没有找到邮箱，恢复状态
      await prisma.radarCandidate.update({
        where: { id: candidateId },
        data: { status: 'NEW' },
      });
      console.log(`[enrichCandidateEmail] No email found for ${candidate.displayName}`);
    }
  } catch (error) {
    console.error(`[enrichCandidateEmail] Failed to enrich ${candidateId}:`, error);
    // 恢复状态，下次再试
    await prisma.radarCandidate.update({
      where: { id: candidateId },
      data: { status: 'NEW' },
    });
    throw error;
  }
}

/**
 * 自动导入候选到线索库
 */
async function autoImportCandidate(candidateId: string): Promise<void> {
  const candidate = await prisma.radarCandidate.findUnique({
    where: { id: candidateId },
    include: { source: true },
  });

  if (!candidate || !candidate.email || candidate.importedToId) {
    return; // 没有邮箱或已导入
  }

  try {
    // 检查是否已存在相同邮箱的线索
    const existingCompany = await prisma.prospectCompany.findFirst({
      where: {
        tenantId: candidate.tenantId,
        OR: [
          { email: candidate.email },
          { website: candidate.website || undefined },
        ],
      },
    });

    let companyId: string;

    if (existingCompany) {
      // 更新现有公司
      companyId = existingCompany.id;
      await prisma.prospectCompany.update({
        where: { id: companyId },
        data: {
          email: candidate.email,
          phone: candidate.phone || existingCompany.phone,
          sourceCandidateId: candidate.id,
        },
      });
    } else {
      // 创建新公司
      const company = await prisma.prospectCompany.create({
        data: {
          tenantId: candidate.tenantId,
          name: candidate.displayName,
          website: candidate.website,
          email: candidate.email,
          phone: candidate.phone,
          country: candidate.country,
          city: candidate.city,
          industry: candidate.industry,
          description: candidate.description,
          tier: candidate.qualifyTier || 'B',
          sourceType: candidate.source.channelType.toLowerCase(),
          sourceCandidateId: candidate.id,
          sourceUrl: candidate.sourceUrl,
          status: 'new',
          enrichmentStatus: 'COMPLETED',
        },
      });
      companyId = company.id;
    }

    // 创建联系人
    if (candidate.email) {
      // 检查是否已存在相同邮箱的联系人
      const existingContact = await prisma.prospectContact.findFirst({
        where: {
          companyId,
          email: candidate.email,
        },
      });

      if (!existingContact) {
        await prisma.prospectContact.create({
          data: {
            tenantId: candidate.tenantId,
            companyId,
            name: candidate.displayName,
            email: candidate.email,
            phone: candidate.phone,
            role: 'Decision Maker',
            seniority: 'Executive',
            status: 'new',
            sourceCandidateId: candidate.id,
          },
        });
      }
    }

    // 更新候选导入状态
    await prisma.radarCandidate.update({
      where: { id: candidateId },
      data: {
        importedToType: 'ProspectCompany',
        importedToId: companyId,
        importedAt: new Date(),
        status: 'IMPORTED',
      },
    });

    console.log(`[autoImportCandidate] Imported ${candidate.displayName} to company ${companyId}`);
  } catch (error) {
    console.error(`[autoImportCandidate] Failed to import ${candidateId}:`, error);
    throw error;
  }
}

/** 单条 upsert，返回 'created' | 'duplicate'（供批量事务使用） */
async function processCandidateUpsert(
  tenantId: string,
  sourceId: string,
  taskId: string,
  profileId: string,
  item: NormalizedCandidate,
  ttlDays: number,
  storagePolicy: string,
): Promise<'created' | 'duplicate'> {
  const expireAt = ttlDays
    ? new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000)
    : undefined;

  // externalId 为空时生成 fallback，防止 unique key 碰撞导致数据覆盖
  if (!item.externalId) {
    const rawKey = (item.displayName + '::' + item.sourceUrl).toLowerCase().replace(/\s+/g, '-');
    const hash = Buffer.from(rawKey).toString('base64url').slice(0, 48);
    item = { ...item, externalId: 'fallback-' + hash };
  }

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
      publishedAt: item.publishedAt,

      // TTL 策略
      rawData: storagePolicy !== 'ID_ONLY' ? (item.rawData as object) : undefined,
      expireAt,

      status: 'NEW',
    },
    update: {
      // 仅更新时间戳，不覆盖已有数据
      updatedAt: new Date(),
    },
  });

  // 通过 createdAt 与 updatedAt 比较判断是新建还是已存在
  return result.createdAt.getTime() === result.updatedAt.getTime() ? 'created' : 'duplicate';
}

/** 兼容旧调用（单条处理，含 stats 更新） */
async function processCandidate(
  tenantId: string,
  sourceId: string,
  taskId: string,
  profileId: string,
  item: NormalizedCandidate,
  ttlDays: number,
  storagePolicy: string,
  stats: { created: number; duplicates: number; errors: string[] }
): Promise<void> {
  try {
    const result = await processCandidateUpsert(tenantId, sourceId, taskId, profileId, item, ttlDays, storagePolicy);
    if (result === 'created') stats.created++;
    else stats.duplicates++;
  } catch (error) {
    stats.errors.push(`Candidate error: ${error instanceof Error ? error.message : 'Unknown'}`);
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
