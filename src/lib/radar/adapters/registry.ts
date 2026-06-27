// ==================== Radar Adapter Registry ====================
// 适配器注册表和工厂（精简版：8 个核心适配器）

import type { 
  RadarAdapter, 
  AdapterConfig, 
  AdapterFactory, 
  AdapterRegistration,
  SourceReliability
} from './types';
import { UNGMAdapter } from './ungm';
import { TEDAdapter } from './ted';
import { AISearchAdapter } from './ai-search';
import { GooglePlacesAdapter } from './google-places';
import { GenericFeedAdapter } from './generic-feed';
import { SAMGovAdapter } from './sam-gov';
import { HunterAdapter } from './hunter';
import { ApolloOrganizationSearchAdapter } from './apollo-search';

// ==================== 数据源可靠性定义 ====================

const SOURCE_RELIABILITY: Record<string, SourceReliability> = {
  // === 官方招标 API ===
  ungm: {
    dataType: 'OFFICIAL_API',
    qualityLevel: 'HIGH',
    requiresAuth: true,
    authMethod: 'OAuth2 Client Credentials',
    updateFrequency: 'DAILY',
    coverageNote: '覆盖所有联合国机构采购公告',
    limitations: ['需要注册开发者账号获取认证信息'],
    docUrl: 'https://developer.ungm.org/',
  },
  ted: {
    dataType: 'OFFICIAL_API',
    qualityLevel: 'HIGH',
    requiresAuth: false,
    updateFrequency: 'DAILY',
    coverageNote: '覆盖欧盟27国政府采购公告',
    limitations: ['搜索API无需认证，但提交公告需要认证'],
    docUrl: 'https://docs.ted.europa.eu/api/latest/index.html',
  },
  sam_gov: {
    dataType: 'OFFICIAL_API',
    qualityLevel: 'HIGH',
    requiresAuth: true,
    authMethod: 'API Key',
    updateFrequency: 'DAILY',
    coverageNote: '覆盖美国联邦政府采购公告',
    limitations: ['需要API Key，免费但有请求限制'],
    docUrl: 'https://open.gsa.gov/api/sam-gov-api/',
  },
  google_places: {
    dataType: 'OFFICIAL_API',
    qualityLevel: 'HIGH',
    requiresAuth: true,
    authMethod: 'API Key',
    updateFrequency: 'REAL_TIME',
    coverageNote: '全球企业信息',
    limitations: ['需要Google Cloud API Key，有费用'],
    docUrl: 'https://developers.google.com/maps/documentation/places',
  },
  
  // === 公开数据 ===
  generic_feed: {
    dataType: 'PUBLIC_DATA',
    qualityLevel: 'MEDIUM',
    requiresAuth: false,
    updateFrequency: 'UNKNOWN',
    coverageNote: '取决于配置的RSS/JSON源',
    limitations: ['数据质量取决于源网站'],
  },
  
  // === AI 搜索（需要人工验证）===
  ai_search: {
    dataType: 'AI_INFERRED',
    qualityLevel: 'UNSTABLE',
    requiresAuth: true,
    authMethod: '搜索引擎API Key',
    updateFrequency: 'REAL_TIME',
    coverageNote: '全球范围，但结果需要验证',
    limitations: ['AI可能产生幻觉', '搜索结果可能不相关', '需要人工验证'],
  },
  
  // === 联系人丰富化 API ===
  hunter: {
    dataType: 'OFFICIAL_API',
    qualityLevel: 'HIGH',
    requiresAuth: true,
    authMethod: 'API Key',
    updateFrequency: 'REAL_TIME',
    coverageNote: '全球企业邮箱查找和验证',
    limitations: ['免费额度: 25次/月', '仅限邮箱相关数据'],
    docUrl: 'https://hunter.io/api-documentation',
  },
  
  // === Apollo B2B 数据库 ===
  apollo_org_search: {
    dataType: 'OFFICIAL_API',
    qualityLevel: 'HIGH',
    requiresAuth: true,
    authMethod: 'API Key',
    updateFrequency: 'REAL_TIME',
    coverageNote: '全球3000万+公司画像，结构化行业/规模/营收数据',
    limitations: ['按信用点计费', '每页最多100条', '最多500页'],
    docUrl: 'https://docs.apollo.io/reference/organization-search',
  },
};

// ==================== 适配器注册表 ====================

const adapterFactories = new Map<string, AdapterFactory>();
const adapterRegistrations = new Map<string, AdapterRegistration>();

// ==================== 注册函数 ====================

export function registerAdapter(
  registration: AdapterRegistration,
  factory: AdapterFactory
): void {
  adapterFactories.set(registration.code, factory);
  adapterRegistrations.set(registration.code, registration);
}

// ==================== 获取适配器（单例缓存） ====================

const adapterInstances = new Map<string, RadarAdapter>();

export function getAdapter(code: string, config?: AdapterConfig): RadarAdapter {
  const factory = adapterFactories.get(code);
  if (!factory) {
    throw new Error(`Adapter not found: ${code}`);
  }

  const registration = adapterRegistrations.get(code);
  const mergedConfig = {
    ...registration?.defaultConfig,
    ...config,
  };

  // 使用 code + 序列化 config 作为缓存键，同一配置复用实例
  // 这样 UNGM 等有 token 缓存的适配器不会因重复创建实例而失效
  const cacheKey = `${code}:${JSON.stringify(mergedConfig, Object.keys(mergedConfig).sort())}`;
  let instance = adapterInstances.get(cacheKey);
  if (!instance) {
    instance = factory(mergedConfig);
    adapterInstances.set(cacheKey, instance);
  }

  return instance;
}

/** 清除适配器实例缓存（主要用于测试） */
export function clearAdapterCache(): void {
  adapterInstances.clear();
}

// ==================== 获取注册信息 ====================

export function getAdapterRegistration(code: string): AdapterRegistration | undefined {
  return adapterRegistrations.get(code);
}

export function listAdapterRegistrations(): AdapterRegistration[] {
  return Array.from(adapterRegistrations.values());
}

export function listAdaptersByChannel(channelType: string): AdapterRegistration[] {
  return listAdapterRegistrations().filter(r => r.channelType === channelType);
}

// ==================== 检查适配器是否存在 ====================

export function hasAdapter(code: string): boolean {
  return adapterFactories.has(code);
}

// ==================== 初始化内置适配器 ====================

let initialized = false;

export function ensureAdaptersInitialized(): void {
  if (initialized) return;
  
  // 注册 UNGM 适配器（联合国采购）
  registerAdapter(
    {
      code: 'ungm',
      name: 'UNGM - 联合国采购',
      channelType: 'TENDER',
      adapterType: 'API',
      description: '联合国全球市场平台，覆盖联合国机构的采购公告',
      features: {
        supportsKeywordSearch: true,
        supportsCategoryFilter: true,
        supportsDateFilter: true,
        supportsRegionFilter: false,
        supportsPagination: true,
        supportsDetails: true,
        maxResultsPerQuery: 100,
        rateLimit: { requests: 10, windowMs: 60000 },
      },
      defaultConfig: {
        apiEndpoint: 'https://www.ungm.org',
        timeout: 30000,
      },
      storagePolicy: 'TTL_CACHE',
      ttlDays: 90,
      attributionRequired: true,
      isOfficial: true,
      websiteUrl: 'https://www.ungm.org',
      termsUrl: 'https://www.ungm.org/Public/Pages/TermsOfUse',
      reliability: SOURCE_RELIABILITY.ungm,
    },
    (config) => new UNGMAdapter(config)
  );
  
  // 注册 TED 适配器（欧盟招标）
  registerAdapter(
    {
      code: 'ted',
      name: 'TED - 欧盟招标',
      channelType: 'TENDER',
      adapterType: 'API',
      description: '欧盟官方招标电子日报，覆盖欧盟27国政府采购',
      features: {
        supportsKeywordSearch: true,
        supportsCategoryFilter: true,
        supportsDateFilter: true,
        supportsRegionFilter: true,
        supportsPagination: true,
        supportsDetails: true,
        maxResultsPerQuery: 100,
        rateLimit: { requests: 30, windowMs: 60000 },
      },
      defaultConfig: {
        apiEndpoint: 'https://api.ted.europa.eu',
        timeout: 30000,
      },
      storagePolicy: 'TTL_CACHE',
      ttlDays: 90,
      attributionRequired: true,
      isOfficial: true,
      countries: ['AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE'],
      regions: ['EU'],
      websiteUrl: 'https://ted.europa.eu',
      termsUrl: 'https://ted.europa.eu/en/legal-notice',
      reliability: SOURCE_RELIABILITY.ted,
    },
    (config) => new TEDAdapter(config)
  );
  
  // 注册 AI 搜索适配器（统一封装 Exa/Tavily/Brave/SerpAPI）
  registerAdapter(
    {
      code: 'ai_search',
      name: 'AI 智能搜索',
      channelType: 'TENDER',
      adapterType: 'AI_SEARCH',
      description: '使用 AI + 搜索引擎发现全球招标公告，覆盖官方 API 未覆盖的地区',
      features: {
        supportsKeywordSearch: true,
        supportsCategoryFilter: false,
        supportsDateFilter: false,
        supportsRegionFilter: true,
        supportsPagination: false,
        supportsDetails: false,
        maxResultsPerQuery: 20,
        rateLimit: { requests: 5, windowMs: 60000 },
      },
      defaultConfig: {
        timeout: 60000,
      },
      storagePolicy: 'TTL_CACHE',
      ttlDays: 30,
      attributionRequired: true,
      isOfficial: false,
      websiteUrl: undefined,
      reliability: SOURCE_RELIABILITY.ai_search,
    },
    (config) => new AISearchAdapter(config)
  );
  
  // 注册 Google Places 适配器（企业发现）
  registerAdapter(
    {
      code: 'google_places',
      name: 'Google Maps - 企业发现',
      channelType: 'MAPS',
      adapterType: 'API',
      description: '通过 Google Maps Places API 发现目标区域的潜在客户公司',
      features: {
        supportsKeywordSearch: true,
        supportsCategoryFilter: true,
        supportsDateFilter: false,
        supportsRegionFilter: true,
        supportsPagination: true,
        supportsDetails: true,
        maxResultsPerQuery: 60,
        rateLimit: { requests: 100, windowMs: 60000 },
      },
      defaultConfig: {
        timeout: 30000,
      },
      storagePolicy: 'TTL_CACHE',
      ttlDays: 90,
      attributionRequired: true,
      isOfficial: true,
      websiteUrl: 'https://developers.google.com/maps/documentation/places',
      reliability: SOURCE_RELIABILITY.google_places,
    },
    (config) => new GooglePlacesAdapter(config)
  );
  
  // 注册 Generic Feed 适配器（RSS/JSON）
  registerAdapter(
    {
      code: 'generic_feed',
      name: 'Generic Feed - RSS/JSON',
      channelType: 'TENDER',
      adapterType: 'RSS',
      description: 'RSS/JSON 通用 Feed 适配器，支持自定义字段映射',
      features: {
        supportsKeywordSearch: false,
        supportsCategoryFilter: false,
        supportsDateFilter: false,
        supportsRegionFilter: false,
        supportsPagination: false,
        supportsDetails: false,
        maxResultsPerQuery: 100,
        rateLimit: { requests: 10, windowMs: 60000 },
      },
      defaultConfig: {
        timeout: 30000,
      },
      storagePolicy: 'TTL_CACHE',
      ttlDays: 60,
      attributionRequired: true,
      isOfficial: false,
      websiteUrl: undefined,
      reliability: SOURCE_RELIABILITY.generic_feed,
    },
    (config) => new GenericFeedAdapter(config)
  );

  // 注册 SAM.gov 适配器（美国政府采购）
  registerAdapter(
    {
      code: 'sam_gov',
      name: 'SAM.gov - 美国政府采购',
      channelType: 'TENDER',
      adapterType: 'API',
      description: '美国联邦政府采购招标平台，覆盖美国政府采购公告',
      features: {
        supportsKeywordSearch: true,
        supportsCategoryFilter: true,
        supportsDateFilter: true,
        supportsRegionFilter: true,
        supportsPagination: true,
        supportsDetails: true,
        maxResultsPerQuery: 100,
        rateLimit: { requests: 30, windowMs: 60000 },
      },
      defaultConfig: {
        timeout: 30000,
      },
      storagePolicy: 'TTL_CACHE',
      ttlDays: 90,
      attributionRequired: true,
      isOfficial: true,
      countries: ['US'],
      websiteUrl: 'https://sam.gov',
      reliability: SOURCE_RELIABILITY.sam_gov,
    },
    (config) => new SAMGovAdapter(config)
  );

  // 注册 Hunter.io 适配器（邮箱查找验证）
  registerAdapter(
    {
      code: 'hunter',
      name: 'Hunter.io - 邮箱查找验证',
      channelType: 'DIRECTORY',
      adapterType: 'API',
      description: '根据域名查找公司邮箱格式，验证邮箱有效性',
      features: {
        supportsKeywordSearch: false,
        supportsCategoryFilter: false,
        supportsDateFilter: false,
        supportsRegionFilter: false,
        supportsPagination: true,
        supportsDetails: true,
        maxResultsPerQuery: 100,
        rateLimit: { requests: 25, windowMs: 60000 },
      },
      defaultConfig: {
        timeout: 30000,
      },
      storagePolicy: 'TTL_CACHE',
      ttlDays: 90,
      attributionRequired: true,
      isOfficial: true,
      websiteUrl: 'https://hunter.io',
      termsUrl: 'https://hunter.io/terms',
      reliability: SOURCE_RELIABILITY.hunter,
    },
    (config) => new HunterAdapter(config)
  );

  // 注册 Apollo Organization Search 适配器（B2B数据库）
  registerAdapter(
    {
      code: 'apollo_org_search',
      name: 'Apollo 公司搜索 - B2B数据库',
      channelType: 'DIRECTORY',
      adapterType: 'API',
      description: '通过Apollo结构化B2B数据库搜索目标公司，按行业/地区/规模精确过滤，数据质量远高于网页搜索',
      features: {
        supportsKeywordSearch: true,
        supportsCategoryFilter: true,
        supportsDateFilter: false,
        supportsRegionFilter: true,
        supportsPagination: true,
        supportsDetails: false,
        maxResultsPerQuery: 100,
        rateLimit: { requests: 5, windowMs: 60000 },
      },
      defaultConfig: {
        timeout: 30000,
      },
      storagePolicy: 'TTL_CACHE',
      ttlDays: 30,
      attributionRequired: false,
      isOfficial: true,
      websiteUrl: 'https://www.apollo.io',
      reliability: SOURCE_RELIABILITY.apollo_org_search,
    },
    (config) => new ApolloOrganizationSearchAdapter(config)
  );

  initialized = true;
}

// ==================== 适配器代码常量 ====================

export const ADAPTER_CODES = {
  UNGM: 'ungm',
  TED: 'ted',
  AI_SEARCH: 'ai_search',
  GOOGLE_PLACES: 'google_places',
  GENERIC_FEED: 'generic_feed',
  SAM_GOV: 'sam_gov',
  HUNTER: 'hunter',
  APOLLO_ORG_SEARCH: 'apollo_org_search',
  // 后续扩展
  CSV_IMPORT: 'csv_import',
} as const;

export type AdapterCode = typeof ADAPTER_CODES[keyof typeof ADAPTER_CODES];
