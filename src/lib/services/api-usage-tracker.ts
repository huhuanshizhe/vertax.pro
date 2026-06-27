// ==================== External API Usage Tracker ====================
// 外部 API 用量追踪 — 轻量级实现
// 使用 Prisma 已有的 KeyValue 存储（或 fallback 到内存）

import { prisma } from '@/lib/prisma';
import { resolveApiKey } from '@/lib/services/api-key-resolver';

// ==================== API 注册表 ====================

export interface ApiRegistryEntry {
  code: string;
  name: string;
  category: 'search' | 'enrichment' | 'ai' | 'scraping' | 'tender' | 'email';
  provider: string;
  envVar: string;
  /** resolveApiKey 对应的 service 名称（用于查 DB） */
  resolverService?: string;
  /** 每月免费额度（0 = 无免费额度 / 未知） */
  monthlyFreeQuota: number;
  /** 付费额度上限（0 = 无上限 / 未知） */
  monthlyPaidQuota: number;
  /** 预估单价（USD），用于成本估算 */
  estimatedCostPerCall?: number;
  isFree: boolean;
}

export const API_REGISTRY: ApiRegistryEntry[] = [
  // === AI / LLM ===
  {
    code: 'dashscope',
    name: '通义千问 (DashScope)',
    category: 'ai',
    provider: 'Alibaba Cloud',
    envVar: 'TEXT_API_KEY',
    resolverService: 'dashscope',
    monthlyFreeQuota: 0,
    monthlyPaidQuota: 0, // Coding Plan 订阅制
    isFree: false,
  },
  {
    code: 'openrouter',
    name: 'OpenRouter (AI Fallback)',
    category: 'ai',
    provider: 'OpenRouter',
    envVar: 'OPENROUTER_API_KEY',
    resolverService: 'openrouter',
    monthlyFreeQuota: 0,
    monthlyPaidQuota: 0,
    isFree: false,
  },

  // === 搜索引擎 ===
  {
    code: 'exa',
    name: 'Exa (语义搜索)',
    category: 'search',
    provider: 'Exa Labs',
    envVar: 'EXA_API_KEY',
    resolverService: 'exa',
    monthlyFreeQuota: 0,
    monthlyPaidQuota: 0,
    estimatedCostPerCall: 0.002,
    isFree: false,
  },
  {
    code: 'tavily',
    name: 'Tavily (AI 搜索)',
    category: 'search',
    provider: 'Tavily',
    envVar: 'TAVILY_API_KEY',
    resolverService: 'tavily',
    monthlyFreeQuota: 1000,
    monthlyPaidQuota: 0,
    estimatedCostPerCall: 0.003,
    isFree: true,
  },
  {
    code: 'serpapi',
    name: 'SerpAPI (Google 搜索)',
    category: 'search',
    provider: 'SerpAPI',
    envVar: 'SERPAPI_KEY',
    monthlyFreeQuota: 100,
    monthlyPaidQuota: 0,
    estimatedCostPerCall: 0.01,
    isFree: true,
  },
  {
    code: 'brave',
    name: 'Brave Search',
    category: 'search',
    provider: 'Brave',
    envVar: 'BRAVE_SEARCH_API_KEY',
    monthlyFreeQuota: 2000,
    monthlyPaidQuota: 0,
    isFree: true,
  },

  // === 数据富化 ===
  {
    code: 'hunter',
    name: 'Hunter.io (邮箱查找)',
    category: 'email',
    provider: 'Hunter.io',
    envVar: 'HUNTER_API_KEY',
    resolverService: 'hunter',
    monthlyFreeQuota: 25,
    monthlyPaidQuota: 0,
    estimatedCostPerCall: 0.04,
    isFree: true,
  },
  {
    code: 'apollo',
    name: 'Apollo.io (B2B 搜索)',
    category: 'enrichment',
    provider: 'Apollo.io',
    envVar: 'APOLLO_API_KEY',
    resolverService: 'apollo',
    monthlyFreeQuota: 0,
    monthlyPaidQuota: 0,
    isFree: false,
  },
  {
    code: 'google_places',
    name: 'Google Places (地图搜索)',
    category: 'search',
    provider: 'Google Cloud',
    envVar: 'GOOGLE_MAPS_API_KEY',
    resolverService: 'google_places',
    monthlyFreeQuota: 0, // $200 月免费额度
    monthlyPaidQuota: 0,
    estimatedCostPerCall: 0.017,
    isFree: false,
  },

  // === 网页抓取 ===
  {
    code: 'firecrawl',
    name: 'Firecrawl (网页抓取)',
    category: 'scraping',
    provider: 'Firecrawl',
    envVar: 'FIRECRAWL_API_KEY',
    resolverService: 'firecrawl',
    monthlyFreeQuota: 500,
    monthlyPaidQuota: 0,
    estimatedCostPerCall: 0.001,
    isFree: true,
  },
  {
    code: 'jina',
    name: 'Jina Reader (网页提取)',
    category: 'scraping',
    provider: 'Jina AI',
    envVar: '', // 免费，无需 Key
    monthlyFreeQuota: 6000, // 200/天 × 30
    monthlyPaidQuota: 0,
    isFree: true,
  },

  // === 招标数据（免费公共 API） ===
  {
    code: 'ted',
    name: 'TED (欧盟招标)',
    category: 'tender',
    provider: 'EU Publications',
    envVar: '',
    monthlyFreeQuota: 999999,
    monthlyPaidQuota: 999999,
    isFree: true,
  },
  {
    code: 'sam_gov',
    name: 'SAM.gov (美国招标)',
    category: 'tender',
    provider: 'US GSA',
    envVar: 'SAM_GOV_API_KEY',
    monthlyFreeQuota: 999999,
    monthlyPaidQuota: 999999,
    isFree: true,
  },
  {
    code: 'ungm',
    name: 'UNGM (联合国采购)',
    category: 'tender',
    provider: 'United Nations',
    envVar: 'UNGM_CLIENT_ID',
    monthlyFreeQuota: 999999,
    monthlyPaidQuota: 999999,
    isFree: true,
  },
];

// ==================== 用量追踪（内存 + DB 持久化） ====================

interface UsageRecord {
  date: string; // YYYY-MM-DD
  apiCode: string;
  calls: number;
  success: number;
  errors: number;
  lastError?: string;
  lastErrorAt?: string;
  avgLatencyMs: number;
}

// 内存缓存（每次请求初始化时从 DB 加载当天数据）
let memoryCache: Map<string, UsageRecord> | null = null;
let cacheDate = '';

function getTodayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function getCacheKey(apiCode: string, date?: string): string {
  return `${date || getTodayKey()}:${apiCode}`;
}

function ensureCache(): Map<string, UsageRecord> {
  const today = getTodayKey();
  if (!memoryCache || cacheDate !== today) {
    memoryCache = new Map();
    cacheDate = today;
  }
  return memoryCache;
}

/**
 * 记录一次 API 调用
 * 轻量级：只更新内存，由 flushToDb 定期持久化
 */
export function trackApiCall(
  apiCode: string,
  result: { success: boolean; latencyMs: number; error?: string },
): void {
  const cache = ensureCache();
  const key = getCacheKey(apiCode);

  let record = cache.get(key);
  if (!record) {
    record = {
      date: getTodayKey(),
      apiCode,
      calls: 0,
      success: 0,
      errors: 0,
      avgLatencyMs: 0,
    };
    cache.set(key, record);
  }

  record.calls++;
  if (result.success) {
    record.success++;
  } else {
    record.errors++;
    record.lastError = result.error?.slice(0, 200);
    record.lastErrorAt = new Date().toISOString();
  }

  // 滚动平均延迟
  record.avgLatencyMs = Math.round(
    (record.avgLatencyMs * (record.calls - 1) + result.latencyMs) / record.calls
  );
}

/**
 * 包装一个 async 函数，自动追踪调用结果
 */
export async function withApiTracking<T>(
  apiCode: string,
  fn: () => Promise<T>,
): Promise<T> {
  const start = Date.now();
  try {
    const result = await fn();
    trackApiCall(apiCode, { success: true, latencyMs: Date.now() - start });
    return result;
  } catch (error) {
    trackApiCall(apiCode, {
      success: false,
      latencyMs: Date.now() - start,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * 获取今天的用量统计
 */
export function getTodayUsage(): Map<string, UsageRecord> {
  return ensureCache();
}

/**
 * 获取指定 API 的今日用量
 */
export function getApiUsageToday(apiCode: string): UsageRecord | null {
  const cache = ensureCache();
  return cache.get(getCacheKey(apiCode)) || null;
}

// ==================== 健康检查 ====================

export interface ApiHealthStatus {
  code: string;
  name: string;
  category: string;
  provider: string;
  isConfigured: boolean; // API Key 是否已配置
  isFree: boolean;
  monthlyFreeQuota: number;
  todayUsage: {
    calls: number;
    success: number;
    errors: number;
    lastError?: string;
    lastErrorAt?: string;
    avgLatencyMs: number;
  };
  quotaStatus: 'healthy' | 'warning' | 'exhausted' | 'unknown';
  quotaMessage: string;
}

/**
 * 获取所有 API 的健康状态（async — 同时检查 env 和 DB）
 */
export async function getAllApiHealth(): Promise<ApiHealthStatus[]> {
  const todayUsage = getTodayUsage();

  // 并行检查所有 API key 是否已配置（env + DB）
  const configChecks = await Promise.all(
    API_REGISTRY.map(async (entry) => {
      // 免费 API 无需 key
      if (!entry.envVar && !entry.resolverService) return true;

      // 1. 先查 process.env
      if (entry.envVar && process.env[entry.envVar]?.trim()) return true;

      // 2. 再查 resolveApiKey（会检查 DB 的 ApiKeyConfig 表）
      if (entry.resolverService) {
        const resolved = await resolveApiKey(entry.resolverService);
        if (resolved) return true;
      }

      return false;
    })
  );

  return API_REGISTRY.map((entry, idx) => {
    const usage = todayUsage.get(getCacheKey(entry.code));
    const isConfigured = configChecks[idx];

    // 用量 vs 额度检查
    let quotaStatus: 'healthy' | 'warning' | 'exhausted' | 'unknown' = 'unknown';
    let quotaMessage = '';

    if (entry.isFree && entry.monthlyFreeQuota < 999999) {
      // 有明确免费额度的 API
      const monthStart = new Date();
      monthStart.setDate(1);
      const monthKey = monthStart.toISOString().slice(0, 7); // YYYY-MM

      // 简化：用今日用量估算（实际应从 DB 汇总当月数据）
      const todayCalls = usage?.calls || 0;
      const dailyBudget = Math.ceil(entry.monthlyFreeQuota / 30);

      if (todayCalls === 0) {
        quotaStatus = 'healthy';
        quotaMessage = `今日未使用。免费额度: ${entry.monthlyFreeQuota}/月 (约 ${dailyBudget}/天)`;
      } else if (todayCalls >= dailyBudget * 0.9) {
        quotaStatus = 'exhausted';
        quotaMessage = `今日已用 ${todayCalls}/${dailyBudget}，接近免费额度上限！`;
      } else if (todayCalls >= dailyBudget * 0.7) {
        quotaStatus = 'warning';
        quotaMessage = `今日已用 ${todayCalls}/${dailyBudget}，注意控制用量`;
      } else {
        quotaStatus = 'healthy';
        quotaMessage = `今日已用 ${todayCalls}/${dailyBudget}，正常`;
      }
    } else if (entry.isFree) {
      quotaStatus = 'healthy';
      quotaMessage = `免费公共 API，无额度限制`;
    } else {
      // 付费 API
      const todayCalls = usage?.calls || 0;
      if (todayCalls === 0) {
        quotaStatus = 'healthy';
        quotaMessage = `今日未使用。付费 API，请关注账单`;
      } else {
        const estCost = (entry.estimatedCostPerCall || 0) * todayCalls;
        quotaStatus = 'healthy';
        quotaMessage = `今日 ${todayCalls} 次调用，预估费用 ~$${estCost.toFixed(3)}`;
      }
    }

    if (!isConfigured) {
      quotaStatus = 'exhausted';
      quotaMessage = `⚠️ API Key 未配置 (${entry.envVar})`;
    }

    return {
      code: entry.code,
      name: entry.name,
      category: entry.category,
      provider: entry.provider,
      isConfigured,
      isFree: entry.isFree,
      monthlyFreeQuota: entry.monthlyFreeQuota,
      todayUsage: {
        calls: usage?.calls || 0,
        success: usage?.success || 0,
        errors: usage?.errors || 0,
        lastError: usage?.lastError,
        lastErrorAt: usage?.lastErrorAt,
        avgLatencyMs: usage?.avgLatencyMs || 0,
      },
      quotaStatus,
      quotaMessage,
    };
  });
}

// ==================== DB 持久化（异步刷新） ====================

let flushTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * 将内存用量异步刷新到数据库
 * 使用 Prisma 的通用 JSON 存储（CompanyProfile.settings 或独立表）
 * 这里使用一个简单的方案：写入 radarSource 的 syncStats
 */
export async function flushUsageToDb(): Promise<void> {
  const cache = ensureCache();
  if (cache.size === 0) return;

  try {
    // 汇总为 JSON 写入一个系统级 RadarSource 记录
    const usageData: Record<string, UsageRecord> = {};
    for (const [key, record] of cache) {
      usageData[key] = record;
    }

    // 使用系统级 source（code='__api_usage_tracker__'）存储
    await prisma.radarSource.upsert({
      where: { code: '__api_usage_tracker__' },
      update: {
        syncStats: {
          date: getTodayKey(),
          usage: usageData,
          flushedAt: new Date().toISOString(),
        } as unknown as import('@prisma/client').Prisma.InputJsonValue,
      },
      create: {
        tenantId: null,
        channelType: 'CUSTOM' as import('@prisma/client').$Enums.ChannelType,
        name: 'API Usage Tracker (Internal)',
        code: '__api_usage_tracker__',
        description: 'Internal: tracks external API usage',
        adapterType: 'MANUAL' as import('@prisma/client').$Enums.AdapterType,
        isOfficial: false,
        isEnabled: false,
        storagePolicy: 'ID_ONLY' as import('@prisma/client').$Enums.RadarStoragePolicy,
        ttlDays: 365,
        attributionRequired: false,
        syncStats: {
          date: getTodayKey(),
          usage: usageData,
          flushedAt: new Date().toISOString(),
        } as unknown as import('@prisma/client').Prisma.InputJsonValue,
      },
    });
  } catch (error) {
    console.warn('[ApiTracker] DB flush failed:', error);
  }
}

/**
 * 启动定期刷新（在 server 启动时调用一次）
 */
export function startUsageFlusher(intervalMs: number = 60000): void {
  if (flushTimer) return;
  flushTimer = setInterval(() => {
    flushUsageToDb().catch(() => {});
  }, intervalMs);
}

/**
 * 从 DB 加载历史用量数据到内存
 */
export async function loadUsageFromDb(): Promise<void> {
  try {
    const source = await prisma.radarSource.findUnique({
      where: { code: '__api_usage_tracker__' },
    });

    if (!source?.syncStats) return;

    const stats = source.syncStats as { date?: string; usage?: Record<string, UsageRecord> };
    if (stats.date === getTodayKey() && stats.usage) {
      const cache = ensureCache();
      for (const [key, record] of Object.entries(stats.usage)) {
        cache.set(key, record);
      }
    }
  } catch {
    // 首次运行，表可能不存在
  }
}
