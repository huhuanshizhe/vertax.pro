/**
 * AI 关键词生成模块
 * 
 * 飞轮模型核心：根据企业画像 + A/B级候选反馈，动态生成/扩展搜索关键词
 * 
 * 两种模式：
 * - initial: 根据企业画像生成初始关键词
 * - expansion: 根据 A/B 级候选共性扩展新关键词
 */

import { prisma } from '@/lib/prisma';
import { chatCompletion } from '@/lib/ai-client';
import { normalizeTargetRegions } from '@/lib/regions';

// ==================== 类型定义 ====================

export interface GeneratedKeyword {
  keyword: string;
  rationale: string;
  pattern?: string; // 扩展模式：发现的共性模式
}

export interface KeywordPoolItem {
  keyword: string;
  source: 'user_seed' | 'ai_expansion';
  generatedAt: string;
  searchedAt?: string;
  searchCount: number;
  resultCount: number;
  qualityCount: number;
  lastSearchedCountry?: string;
}

export interface SearchLogItem {
  keyword: string;
  country: string;
  searchedAt: string;
  resultCount: number;
  newCount: number;
  qualityCount: number;
}

export interface GenerateKeywordsOptions {
  mode: 'initial' | 'expansion';
  abCandidates?: Array<{
    displayName: string;
    country: string | null;
    industry: string | null;
    description: string | null;
  }>;
  existingKeywords?: string[];
  maxKeywords?: number;
}

// ==================== 企业画像加载 ====================

interface CompanyProfileContext {
  companyName: string;
  companyIntro: string;
  coreProducts: Array<{ name: string; description: string; highlights?: string[] }>;
  targetIndustries: string[];
  targetRegions: string[];
  buyerPersonas: Array<{ role: string; title: string; concerns?: string[] }>;
}

const profileCache = new Map<string, { data: CompanyProfileContext; expiresAt: number }>();

async function loadCompanyProfile(tenantId: string): Promise<CompanyProfileContext | null> {
  const cached = profileCache.get(tenantId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  const profile = await prisma.companyProfile.findUnique({
    where: { tenantId },
  });

  if (!profile) return null;

  const ctx: CompanyProfileContext = {
    companyName: profile.companyName || '',
    companyIntro: profile.companyIntro || '',
    coreProducts: (profile.coreProducts as CompanyProfileContext['coreProducts']) || [],
    targetIndustries: (profile.targetIndustries as string[]) || [],
    targetRegions: normalizeTargetRegions(profile.targetRegions),
    buyerPersonas: (profile.buyerPersonas as CompanyProfileContext['buyerPersonas']) || [],
  };

  profileCache.set(tenantId, { data: ctx, expiresAt: Date.now() + 10 * 60 * 1000 });
  return ctx;
}

// ==================== Prompt 构建 ====================

function buildCompanyContext(profile: CompanyProfileContext): string {
  const sections: string[] = [];

  sections.push(`公司名称：${profile.companyName}`);
  if (profile.companyIntro) {
    sections.push(`公司简介：${profile.companyIntro}`);
  }

  if (profile.coreProducts.length > 0) {
    sections.push('\n【核心产品/服务】');
    for (const p of profile.coreProducts) {
      sections.push(`- ${p.name}: ${p.description}`);
      if (p.highlights?.length) {
        sections.push(`  亮点: ${p.highlights.join(', ')}`);
      }
    }
  }

  if (profile.targetIndustries.length > 0) {
    sections.push(`\n【目标行业】${profile.targetIndustries.join(', ')}`);
  }

  if (profile.targetRegions.length > 0) {
    sections.push('\n【目标市场】');
    sections.push(`- ${profile.targetRegions.join(', ')}`);
  }

  if (profile.buyerPersonas.length > 0) {
    sections.push('\n【典型买家角色】');
    for (const p of profile.buyerPersonas) {
      sections.push(`- ${p.role} (${p.title})`);
    }
  }

  return sections.join('\n');
}

function buildInitialPrompt(profile: CompanyProfileContext, targetCountries: string[]): string {
  return `你是 B2B 获客专家。根据以下企业画像，生成 Google Maps 搜索关键词。

【我方公司】
${buildCompanyContext(profile)}

【目标国家】
${targetCountries.join(', ')}

【要求】
1. 生成 10-15 个搜索关键词（英文）
2. 关键词要能找到我们的潜在客户（经销商、代理商、系统集成商、大型终端用户）
3. 每个关键词格式："{客户类型} {行业/产品} {国家}"
4. 覆盖不同客户类型，不要只搜一种
5. 关键词要具体，不要太宽泛（避免 "company" 这种）

示例格式：
- "agricultural machinery distributor Thailand"
- "farm equipment dealer Vietnam"
- "drone sprayer reseller Indonesia"

返回 JSON 数组：[{"keyword": "...", "rationale": "..."}]`;
}

function buildExpansionPrompt(
  profile: CompanyProfileContext,
  abCandidates: GenerateKeywordsOptions['abCandidates'],
  existingKeywords: string[]
): string {
  const candidateList = abCandidates
    ?.map(c => `- ${c.displayName}, ${c.country || '未知'}, ${c.industry || '未知'}, ${c.description || '无描述'}`)
    .join('\n') || '无';

  return `你是 B2B 获客专家。我们之前搜索找到了一些高质量客户，现在要根据它们的共性扩展新关键词。

【我方公司】
${buildCompanyContext(profile)}

【已找到的高质量客户（A/B级）】
${candidateList}

【已搜过的关键词】
${existingKeywords.slice(0, 20).join(', ')}

【要求】
1. 分析这些高质量客户的共性特征（行业、类型、业务模式）
2. 基于共性，生成 5-10 个新关键词（英文）
3. 新关键词要能发现类似的新客户
4. 避免与已搜过的关键词重复
5. 尝试不同的客户类型和场景

示例：如果发现 A 级客户都是"农机代理商"，可以扩展：
- "agricultural equipment distributor with service center"
- "farm machinery importer exporter"
- "irrigation system dealer Southeast Asia"

返回 JSON 数组：[{"keyword": "...", "pattern": "...", "rationale": "..."}]`;
}

// ==================== 核心函数 ====================

/**
 * 根据企业画像 + A/B级候选反馈，生成/扩展搜索关键词
 */
export async function generateKeywords(
  tenantId: string,
  targetCountries: string[],
  options: GenerateKeywordsOptions
): Promise<GeneratedKeyword[]> {
  const profile = await loadCompanyProfile(tenantId);
  if (!profile) {
    console.warn('[keyword-generator] No company profile found for tenant:', tenantId);
    return [];
  }

  const maxKeywords = options.maxKeywords || (options.mode === 'initial' ? 15 : 10);

  const systemPrompt = '你是 B2B 获客专家，擅长根据企业画像生成精准的 Google Maps 搜索关键词。';
  const userPrompt = options.mode === 'initial'
    ? buildInitialPrompt(profile, targetCountries)
    : buildExpansionPrompt(profile, options.abCandidates, options.existingKeywords || []);

  try {
    const response = await chatCompletion([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ], { 
      model: 'qwen-plus',
      temperature: 0.7,
    });

    // 解析 JSON 响应
    const content = response.content.trim().replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(content);

    if (!Array.isArray(parsed)) {
      console.error('[keyword-generator] AI response is not an array:', parsed);
      return [];
    }

    // 去重并限制数量
    const seen = new Set(options.existingKeywords?.map(k => k.toLowerCase()) || []);
    const results: GeneratedKeyword[] = [];

    for (const item of parsed) {
      if (!item.keyword || typeof item.keyword !== 'string') continue;
      
      const keyword = item.keyword.trim();
      const key = keyword.toLowerCase();
      
      if (seen.has(key)) continue;
      seen.add(key);

      results.push({
        keyword,
        rationale: item.rationale || '',
        pattern: item.pattern,
      });

      if (results.length >= maxKeywords) break;
    }

    console.log(`[keyword-generator] Generated ${results.length} keywords in ${options.mode} mode`);
    return results;
  } catch (error) {
    console.error('[keyword-generator] Failed to generate keywords:', error);
    return [];
  }
}

/**
 * 将生成的关键词追加到关键词池
 */
export async function appendToKeywordPool(
  profileId: string,
  keywords: GeneratedKeyword[],
  source: 'user_seed' | 'ai_expansion'
): Promise<void> {
  const profile = await prisma.radarSearchProfile.findUnique({
    where: { id: profileId },
    select: { keywordPool: true },
  });

  if (!profile) return;

  const existingPool = (profile.keywordPool as unknown as KeywordPoolItem[]) || [];
  const existingKeys = new Set(existingPool.map(k => k.keyword.toLowerCase()));

  const newItems: KeywordPoolItem[] = [];
  const now = new Date().toISOString();

  for (const kw of keywords) {
    if (existingKeys.has(kw.keyword.toLowerCase())) continue;
    
    newItems.push({
      keyword: kw.keyword,
      source,
      generatedAt: now,
      searchCount: 0,
      resultCount: 0,
      qualityCount: 0,
    });
  }

  if (newItems.length > 0) {
    await prisma.radarSearchProfile.update({
      where: { id: profileId },
      data: {
        keywordPool: [...existingPool, ...newItems] as any,
      },
    });
    console.log(`[keyword-generator] Appended ${newItems.length} keywords to pool for profile ${profileId}`);
  }
}

/**
 * 初始化关键词池：将用户填的 seedKeywords 转为 keywordPool
 */
export async function initializeKeywordPool(profileId: string): Promise<number> {
  const profile = await prisma.radarSearchProfile.findUnique({
    where: { id: profileId },
    select: { seedKeywords: true, keywordPool: true, targetCountries: true, tenantId: true },
  });

  if (!profile) return 0;

  // 如果已有 keywordPool，跳过
  const existingPool = (profile.keywordPool as unknown as KeywordPoolItem[]) || [];
  if (existingPool.length > 0) return existingPool.length;

  // 从 seedKeywords 初始化
  const seedKeywords = (profile.seedKeywords as Array<{ keyword: string; language?: string }>) || [];
  const now = new Date().toISOString();

  const poolItems: KeywordPoolItem[] = seedKeywords.map(s => ({
    keyword: s.keyword,
    source: 'user_seed' as const,
    generatedAt: now,
    searchCount: 0,
    resultCount: 0,
    qualityCount: 0,
  }));

  // 如果 seedKeywords 为空，调用 AI 生成初始关键词
  if (poolItems.length === 0) {
    const generated = await generateKeywords(profile.tenantId, profile.targetCountries, {
      mode: 'initial',
      maxKeywords: 15,
    });

    for (const kw of generated) {
      poolItems.push({
        keyword: kw.keyword,
        source: 'ai_expansion',
        generatedAt: now,
        searchCount: 0,
        resultCount: 0,
        qualityCount: 0,
      });
    }
  }

  if (poolItems.length > 0) {
    await prisma.radarSearchProfile.update({
      where: { id: profileId },
      data: { keywordPool: poolItems as any },
    });
  }

  return poolItems.length;
}

/**
 * 记录搜索日志
 */
export async function logSearch(
  profileId: string,
  keyword: string,
  country: string,
  resultCount: number,
  newCount: number,
  qualityCount: number
): Promise<void> {
  const profile = await prisma.radarSearchProfile.findUnique({
    where: { id: profileId },
    select: { searchLog: true, keywordPool: true },
  });

  if (!profile) return;

  const searchLog = (profile.searchLog as unknown as SearchLogItem[]) || [];
  const pool = (profile.keywordPool as unknown as KeywordPoolItem[]) || [];

  // 添加搜索记录
  const logItem: SearchLogItem = {
    keyword,
    country,
    searchedAt: new Date().toISOString(),
    resultCount,
    newCount,
    qualityCount,
  };

  // 更新关键词池中的统计
  const updatedPool = pool.map(item => {
    if (item.keyword.toLowerCase() === keyword.toLowerCase()) {
      return {
        ...item,
        searchedAt: logItem.searchedAt,
        searchCount: item.searchCount + 1,
        resultCount: item.resultCount + resultCount,
        qualityCount: item.qualityCount + qualityCount,
        lastSearchedCountry: country,
      };
    }
    return item;
  });

  await prisma.radarSearchProfile.update({
    where: { id: profileId },
    data: {
      searchLog: [...searchLog, logItem] as any,
      keywordPool: updatedPool as any,
    },
  });
}
