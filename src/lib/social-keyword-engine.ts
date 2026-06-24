/**
 * 社媒关键词挖掘与内容裂变引擎
 * 
 * 功能:
 * 1. 从企业知识库提炼高价值关键词
 * 2. 基于核心词裂变出长尾关键词
 * 3. 评估关键词搜索量和商业价值
 * 4. 为企业画像自动注入提供结构化数据
 */

import { getCompanyProfile } from "@/actions/knowledge";
import { aiClient } from "@/lib/ai-client";

// ==================== 类型定义 ====================

export type KeywordCategory =
  | "product"        // 产品相关
  | "technology"     // 技术优势
  | "industry"       // 目标行业
  | "scenario"       // 应用场景
  | "pain_point"     // 客户痛点
  | "differentiator" // 差异化卖点
  | "region";        // 目标区域

export type KeywordMetric = {
  searchVolume: number;      // 月搜索量估算
  competition: "low" | "medium" | "high"; // 竞争程度
  commercialIntent: number;  // 商业意图 (0-1)
  relevance: number;         // 与企业相关性 (0-1)
};

export type CoreKeyword = {
  id: string;
  term: string;              // 关键词文本
  category: KeywordCategory; // 分类
  metrics: KeywordMetric;    // 指标
  sourceAsset?: string;      // 来源资产ID
  confidence: number;        // 置信度 (0-1)
};

export type LongTailKeyword = {
  id: string;
  coreKeywordId: string;     // 关联的核心词
  term: string;              // 长尾词文本
  category: KeywordCategory;
  metrics: KeywordMetric;
  contentAngle?: string;     // 内容角度建议
  searchIntent?: "informational" | "commercial" | "transactional" | "navigational";
};

export type KeywordExpansionResult = {
  coreKeywords: CoreKeyword[];
  longTailKeywords: LongTailKeyword[];
  stats: {
    totalCoreKeywords: number;
    totalLongTailKeywords: number;
    avgSearchVolume: number;
    highValueKeywords: number; // 高价值关键词数量
  };
};

// ==================== 核心函数 ====================

/**
 * 从企业知识库提取核心关键词
 * 
 * 分析维度:
 * - 产品能力 (Product Capabilities)
 * - 技术优势 (Technology Advantages)
 * - 目标行业 (Target Industries)
 * - 应用场景 (Use Cases)
 * - 客户痛点 (Customer Pain Points)
 * - 差异化卖点 (Unique Differentiators)
 */
export async function extractCoreKeywords(
  tenantId: string,
  options: {
    maxKeywords?: number;        // 最大关键词数量
    minSearchVolume?: number;    // 最小搜索量阈值
    categories?: KeywordCategory[]; // 指定类别
  } = {}
): Promise<CoreKeyword[]> {
  const {
    maxKeywords = 30,
    minSearchVolume = 50,
    categories = ["product", "technology", "industry", "scenario", "pain_point", "differentiator"],
  } = options;

  try {
    // 1. 获取企业能力画像
    const profile = await getCompanyProfile();
    
    if (!profile) {
      throw new Error("未找到企业能力画像，请先完成知识库分析");
    }

    // 2. 构建 AI 提示词,提取关键词
    const prompt = buildKeywordExtractionPrompt(profile, {
      maxKeywords,
      minSearchVolume,
      categories,
    });

    // 3. 调用 AI 模型
    const response = await aiClient.chat.completions.create({
      model: process.env.AI_MODEL || "qwen-plus",
      messages: [
        { role: "system", content: KEYWORD_EXTRACTION_SYSTEM_PROMPT },
        { role: "user", content: prompt },
      ],
      temperature: 0.3,
      max_tokens: 2000,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error("AI 返回空结果");
    }

    // 4. 解析 AI 输出
    const keywords = parseKeywordResponse(content);

    // 5. 过滤低质量关键词
    const filteredKeywords = keywords.filter((kw) => {
      return (
        kw.metrics.searchVolume >= minSearchVolume &&
        kw.metrics.relevance >= 0.6 &&
        categories.includes(kw.category)
      );
    });

    // 6. 按综合评分排序
    const sortedKeywords = filteredKeywords.sort((a, b) => {
      const scoreA = calculateKeywordScore(a);
      const scoreB = calculateKeywordScore(b);
      return scoreB - scoreA;
    });

    return sortedKeywords.slice(0, maxKeywords);
  } catch (error) {
    console.error("[extractCoreKeywords] Error:", error);
    throw error;
  }
}

/**
 * 基于核心关键词裂变长尾关键词
 * 
 * 裂变策略:
 * - 问题型长尾词 (How to, What is, Why...)
 * - 比较型长尾词 (vs, comparison, best...)
 * - 地域型长尾词 (城市 + 核心词)
 * - 场景型长尾词 (行业 + 应用 + 核心词)
 * - 购买型长尾词 (buy, price, cost...)
 */
export async function expandLongTailKeywords(
  coreKeywords: CoreKeyword[],
  options: {
    maxPerCore?: number;       // 每个核心词裂变数量
    targetRegion?: string;     // 目标地区
    targetIndustries?: string[]; // 目标行业列表
  } = {}
): Promise<LongTailKeyword[]> {
  const {
    maxPerCore = 10,
    targetRegion = "中国",
    targetIndustries = [],
  } = options;

  const allLongTailKeywords: LongTailKeyword[] = [];

  for (const coreKw of coreKeywords) {
    try {
      // 为每个核心词生成裂变提示词
      const expansionPrompt = buildLongTailExpansionPrompt(coreKw, {
        maxPerCore,
        targetRegion,
        targetIndustries,
      });

      const response = await aiClient.chat.completions.create({
        model: process.env.AI_MODEL || "qwen-plus",
        messages: [
          { role: "system", content: LONG_TAIL_EXPANSION_SYSTEM_PROMPT },
          { role: "user", content: expansionPrompt },
        ],
        temperature: 0.7,
        max_tokens: 3000,
      });

      const content = response.choices[0]?.message?.content;
      if (!content) continue;

      const longTailKeywords = parseLongTailResponse(content, coreKw.id);
      
      // 为长尾词添加内容角度建议
      const enrichedKeywords = longTailKeywords.map((kw) => ({
        ...kw,
        contentAngle: suggestContentAngle(kw, coreKw),
        searchIntent: classifySearchIntent(kw.term),
      }));

      allLongTailKeywords.push(...enrichedKeywords);
    } catch (error) {
      console.error(`[expandLongTailKeywords] Error for "${coreKw.term}":`, error);
      continue;
    }
  }

  // 去重并排序
  const uniqueKeywords = deduplicateKeywords(allLongTailKeywords);
  
  return uniqueKeywords.sort((a, b) => {
    const scoreA = calculateKeywordScore(a);
    const scoreB = calculateKeywordScore(b);
    return scoreB - scoreA;
  });
}

/**
 * 完整关键词挖掘流水线
 * 
 * 流程:
 * 1. 从知识库提取核心关键词
 * 2. 为每个核心词裂变长尾词
 * 3. 评估和排序所有关键词
 * 4. 返回结构化结果
 */
export async function runKeywordExpansionPipeline(
  tenantId: string,
  options: {
    maxCoreKeywords?: number;
    maxLongTailPerCore?: number;
    minSearchVolume?: number;
    targetRegion?: string;
    targetIndustries?: string[];
  } = {}
): Promise<KeywordExpansionResult> {
  const {
    maxCoreKeywords = 30,
    maxLongTailPerCore = 10,
    minSearchVolume = 50,
    targetRegion,
    targetIndustries,
  } = options;

  console.log("[Keyword Pipeline] Step 1: Extracting core keywords...");
  
  // 1. 提取核心关键词
  const coreKeywords = await extractCoreKeywords(tenantId, {
    maxKeywords: maxCoreKeywords,
    minSearchVolume,
  });

  console.log(`[Keyword Pipeline] Extracted ${coreKeywords.length} core keywords`);

  // 2. 裂变长尾关键词
  console.log("[Keyword Pipeline] Step 2: Expanding long-tail keywords...");
  
  const longTailKeywords = await expandLongTailKeywords(coreKeywords, {
    maxPerCore: maxLongTailPerCore,
    targetRegion,
    targetIndustries,
  });

  console.log(`[Keyword Pipeline] Generated ${longTailKeywords.length} long-tail keywords`);

  // 3. 计算统计数据
  const stats = calculateKeywordStats(coreKeywords, longTailKeywords);

  console.log("[Keyword Pipeline] Complete!", stats);

  return {
    coreKeywords,
    longTailKeywords,
    stats,
  };
}

// ==================== 辅助函数 ====================

/**
 * 计算关键词综合评分
 */
function calculateKeywordScore(keyword: CoreKeyword | LongTailKeyword): number {
  const { metrics } = keyword;
  
  // 权重配置
  const weights = {
    searchVolume: 0.3,
    commercialIntent: 0.25,
    relevance: 0.3,
    competition: 0.15,
  };

  // 标准化搜索量 (0-1)
  const normalizedVolume = Math.min(metrics.searchVolume / 10000, 1);

  // 竞争程度转换 (low=1, medium=0.5, high=0.2)
  const competitionScore =
    metrics.competition === "low" ? 1 :
    metrics.competition === "medium" ? 0.5 : 0.2;

  const score =
    normalizedVolume * weights.searchVolume +
    metrics.commercialIntent * weights.commercialIntent +
    metrics.relevance * weights.relevance +
    competitionScore * weights.competition;

  return score;
}

/**
 * 计算关键词统计信息
 */
function calculateKeywordStats(
  coreKeywords: CoreKeyword[],
  longTailKeywords: LongTailKeyword[]
) {
  const allKeywords = [...coreKeywords, ...longTailKeywords];
  const avgSearchVolume =
    allKeywords.reduce((sum, kw) => sum + kw.metrics.searchVolume, 0) /
    allKeywords.length;

  const highValueKeywords = allKeywords.filter((kw) => {
    const score = calculateKeywordScore(kw);
    return score >= 0.7; // 高分值关键词
  }).length;

  return {
    totalCoreKeywords: coreKeywords.length,
    totalLongTailKeywords: longTailKeywords.length,
    avgSearchVolume: Math.round(avgSearchVolume),
    highValueKeywords,
  };
}

/**
 * 关键词去重
 */
function deduplicateKeywords(keywords: LongTailKeyword[]): LongTailKeyword[] {
  const seen = new Set<string>();
  const unique: LongTailKeyword[] = [];

  for (const kw of keywords) {
    const normalized = kw.term.toLowerCase().trim();
    if (!seen.has(normalized)) {
      seen.add(normalized);
      unique.push(kw);
    }
  }

  return unique;
}

/**
 * 建议内容创作角度
 */
function suggestContentAngle(
  longTail: LongTailKeyword,
  core: CoreKeyword
): string {
  const intent = classifySearchIntent(longTail.term);
  
  switch (intent) {
    case "informational":
      return `教育性内容: 解释"${longTail.term}"的概念和价值`;
    case "commercial":
      return `对比性内容: 比较不同解决方案的优劣`;
    case "transactional":
      return `转化性内容: 展示产品如何解决具体问题`;
    case "navigational":
      return `引导性内容: 帮助用户找到所需资源`;
    default:
      return `围绕"${core.term}"创作有价值的内容`;
  }
}

/**
 * 分类搜索意图
 */
function classifySearchIntent(term: string): LongTailKeyword["searchIntent"] {
  const lowerTerm = term.toLowerCase();

  // 信息型
  if (
    lowerTerm.includes("how") ||
    lowerTerm.includes("what") ||
    lowerTerm.includes("why") ||
    lowerTerm.includes("guide") ||
    lowerTerm.includes("tutorial")
  ) {
    return "informational";
  }

  // 商业调查型
  if (
    lowerTerm.includes("best") ||
    lowerTerm.includes("top") ||
    lowerTerm.includes("review") ||
    lowerTerm.includes("comparison") ||
    lowerTerm.includes("vs")
  ) {
    return "commercial";
  }

  // 交易型
  if (
    lowerTerm.includes("buy") ||
    lowerTerm.includes("price") ||
    lowerTerm.includes("cost") ||
    lowerTerm.includes("quote") ||
    lowerTerm.includes("order")
  ) {
    return "transactional";
  }

  // 导航型
  return "navigational";
}

// ==================== AI 提示词 ====================

const KEYWORD_EXTRACTION_SYSTEM_PROMPT = `你是一位专业的SEO和内容营销专家。你的任务是从企业知识库中提炼高价值的关键词。

要求:
1. 关键词必须有较高的搜索量(至少50+月搜索量)
2. 关键词必须与企业业务高度相关
3. 关键词应该有明确的商业意图
4. 避免过于宽泛或竞争过大的通用词
5. 优先选择长尾词和细分领域词

输出格式必须是JSON数组,每个元素包含:
{
  "term": "关键词文本",
  "category": "product|technology|industry|scenario|pain_point|differentiator|region",
  "searchVolume": 数字(月搜索量估算),
  "competition": "low|medium|high",
  "commercialIntent": 0-1之间的数字,
  "relevance": 0-1之间的数字,
  "confidence": 0-1之间的数字
}`;

const LONG_TAIL_EXPANSION_SYSTEM_PROMPT = `你是一位专业的长尾关键词研究专家。基于给定的核心关键词,裂变出相关的长尾关键词。

裂变策略:
1. 问题型: "如何...", "什么是...", "为什么..."
2. 比较型: "... vs ...", "... 哪个更好", "最佳..."
3. 场景型: "[行业] + [核心词]", "[场景] + [核心词]"
4. 地域型: "[城市] + [核心词]"
5. 购买型: "购买...", "... 价格", "... 多少钱"

要求:
1. 每个核心词裂变8-15个长尾词
2. 保持语义相关性和商业价值
3. 覆盖不同的搜索意图
4. 避免重复和过于相似的词

输出格式必须是JSON数组,每个元素包含:
{
  "term": "长尾词文本",
  "category": "product|technology|industry|scenario|pain_point|differentiator|region",
  "searchVolume": 数字(月搜索量估算),
  "competition": "low|medium|high",
  "commercialIntent": 0-1之间的数字,
  "relevance": 0-1之间的数字,
  "confidence": 0-1之间的数字
}`;

// ==================== 提示词构建器 ====================

function buildKeywordExtractionPrompt(
  profile: any,
  options: {
    maxKeywords: number;
    minSearchVolume: number;
    categories: KeywordCategory[];
  }
): string {
  return `请分析以下企业能力画像,提取${options.maxKeywords}个高价值关键词。

企业信息:
- 主营业务: ${profile.businessOverview?.description || "N/A"}
- 核心产品: ${(profile.products || []).map((p: any) => p.name).join(", ") || "N/A"}
- 技术优势: ${(profile.technologies || []).map((t: any) => t.name).join(", ") || "N/A"}
- 目标行业: ${(profile.targetIndustries || []).map((i: any) => i.name).join(", ") || "N/A"}
- 应用场景: ${(profile.useCases || []).map((u: any) => u.title).join(", ") || "N/A"}
- 客户痛点: ${(profile.painPoints || []).map((p: any) => p.description).join(", ") || "N/A"}
- 差异化卖点: ${(profile.differentiators || []).map((d: any) => d.value).join(", ") || "N/A"}

要求:
- 最小搜索量: ${options.minSearchVolume}
- 关键词类别: ${options.categories.join(", ")}
- 输出JSON格式数组`;
}

function buildLongTailExpansionPrompt(
  coreKeyword: CoreKeyword,
  options: {
    maxPerCore: number;
    targetRegion?: string;
    targetIndustries?: string[];
  }
): string {
  const industriesContext = options.targetIndustries?.length
    ? `\n目标行业: ${options.targetIndustries.join(", ")}`
    : "";

  const regionContext = options.targetRegion
    ? `\n目标地区: ${options.targetRegion}`
    : "";

  return `基于核心关键词"${coreKeyword.term}",裂变出${options.maxPerCore}个相关的长尾关键词。

核心词信息:
- 类别: ${coreKeyword.category}
- 搜索量: ${coreKeyword.metrics.searchVolume}
- 竞争程度: ${coreKeyword.metrics.competition}
- 商业意图: ${coreKeyword.metrics.commercialIntent}${industriesContext}${regionContext}

请使用多样化的裂变策略,覆盖问题型、比较型、场景型、地域型和购买型长尾词。

输出JSON格式数组。`;
}

// ==================== 响应解析器 ====================

function parseKeywordResponse(content: string): CoreKeyword[] {
  try {
    // 尝试提取 JSON
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      throw new Error("无法解析JSON数组");
    }

    const data = JSON.parse(jsonMatch[0]);

    return data.map((item: any, index: number) => ({
      id: `kw-core-${index}-${Date.now()}`,
      term: item.term,
      category: item.category as KeywordCategory,
      metrics: {
        searchVolume: Number(item.searchVolume) || 100,
        competition: item.competition || "medium",
        commercialIntent: Number(item.commercialIntent) || 0.5,
        relevance: Number(item.relevance) || 0.7,
      },
      confidence: Number(item.confidence) || 0.8,
    }));
  } catch (error) {
    console.error("[parseKeywordResponse] Error:", error);
    console.error("Raw content:", content);
    return [];
  }
}

function parseLongTailResponse(
  content: string,
  coreKeywordId: string
): LongTailKeyword[] {
  try {
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      throw new Error("无法解析JSON数组");
    }

    const data = JSON.parse(jsonMatch[0]);

    return data.map((item: any, index: number) => ({
      id: `kw-lt-${index}-${Date.now()}`,
      coreKeywordId,
      term: item.term,
      category: item.category as KeywordCategory,
      metrics: {
        searchVolume: Number(item.searchVolume) || 50,
        competition: item.competition || "medium",
        commercialIntent: Number(item.commercialIntent) || 0.5,
        relevance: Number(item.relevance) || 0.6,
      },
      confidence: Number(item.confidence) || 0.7,
    }));
  } catch (error) {
    console.error("[parseLongTailResponse] Error:", error);
    return [];
  }
}
