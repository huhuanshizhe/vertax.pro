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
import { getLanguageInstruction, DEFAULT_LANGUAGE } from "@/lib/languages";

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
    language?: string;           // 目标语言 (如 en, zh-CN, ja 等)
  } = {}
): Promise<CoreKeyword[]> {
  const {
    maxKeywords = 30,
    minSearchVolume = 50,
    categories = ["product", "technology", "industry", "scenario", "pain_point", "differentiator"],
    language = DEFAULT_LANGUAGE,
  } = options;

  try {
    // 1. 获取企业能力画像
    const profile = await getCompanyProfile(tenantId);
    
    if (!profile) {
      throw new Error("未找到企业能力画像，请先完成知识库分析");
    }

    // 2. 构建 AI 提示词,提取关键词
    const prompt = buildKeywordExtractionPrompt(profile, {
      maxKeywords,
      minSearchVolume,
      categories,
      language,
    });

    // 3. 调用 AI 模型
    const response = await aiClient.chat.completions.create({
      model: undefined,
      messages: [
        { role: "system", content: KEYWORD_EXTRACTION_SYSTEM_PROMPT },
        { role: "user", content: prompt },
      ],
      temperature: 0.3,
      max_tokens: 8000,
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
    language?: string;         // 目标语言
  } = {}
): Promise<LongTailKeyword[]> {
  const {
    maxPerCore = 10,
    targetRegion,
    targetIndustries = [],
    language = DEFAULT_LANGUAGE,
  } = options;

  const allLongTailKeywords: LongTailKeyword[] = [];

  for (const coreKw of coreKeywords) {
    try {
      // 为每个核心词生成裂变提示词
      const expansionPrompt = buildLongTailExpansionPrompt(coreKw, {
        maxPerCore,
        targetRegion,
        targetIndustries,
        language,
      });

      const response = await aiClient.chat.completions.create({
        model: undefined,
        messages: [
          { role: "system", content: LONG_TAIL_EXPANSION_SYSTEM_PROMPT },
          { role: "user", content: expansionPrompt },
        ],
        temperature: 0.7,
        max_tokens: 8000,
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
    language?: string;
  } = {}
): Promise<KeywordExpansionResult> {
  const {
    maxCoreKeywords = 30,
    maxLongTailPerCore = 10,
    minSearchVolume = 50,
    targetRegion,
    targetIndustries,
    language = DEFAULT_LANGUAGE,
  } = options;

  console.log("[Keyword Pipeline] Step 1: Extracting core keywords...");
  
  // 1. 提取核心关键词
  const coreKeywords = await extractCoreKeywords(tenantId, {
    maxKeywords: maxCoreKeywords,
    minSearchVolume,
    language,
  });

  console.log(`[Keyword Pipeline] Extracted ${coreKeywords.length} core keywords`);

  // 2. 裂变长尾关键词
  console.log("[Keyword Pipeline] Step 2: Expanding long-tail keywords...");
  
  const longTailKeywords = await expandLongTailKeywords(coreKeywords, {
    maxPerCore: maxLongTailPerCore,
    targetRegion,
    targetIndustries,
    language,
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
  const avgSearchVolume = allKeywords.length > 0
    ? Math.round(allKeywords.reduce((sum, kw) => sum + kw.metrics.searchVolume, 0) / allKeywords.length)
    : 0;

  const highValueKeywords = allKeywords.filter((kw) => {
    const score = calculateKeywordScore(kw);
    return score >= 0.7;
  }).length;

  return {
    totalCoreKeywords: coreKeywords.length,
    totalLongTailKeywords: longTailKeywords.length,
    avgSearchVolume,
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
      return `Educational content: Explaining the concept and value of "${longTail.term}"`;
    case "commercial":
      return `Comparison content: Comparing different solutions for "${longTail.term}"`;
    case "transactional":
      return `Conversion content: Showing how products solve the problem of "${longTail.term}"`;
    case "navigational":
      return `Guide content: Helping users find resources related to "${longTail.term}"`;
    default:
      return `Content centered around "${core.term}"`;
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

const KEYWORD_EXTRACTION_SYSTEM_PROMPT = `You are a professional multilingual SEO and content marketing expert. Your task is to extract high-value keywords from the company knowledge base.

CRITICAL RULES:
1. The input company data may be in Chinese or other languages — IGNORE the input language.
2. ALL keyword output MUST be in the EXACT target language specified by the user.
3. If the target is English, translate all concepts to English keywords.
4. If the target is Japanese, generate keywords in Japanese (日本語).
5. NEVER output Chinese keywords unless the target language is explicitly Chinese.
6. Keywords must have decent search volume (at least 50+ monthly searches)
7. Keywords must be highly relevant to the company's business
8. Keywords should have clear commercial intent
9. Avoid overly broad or highly competitive generic terms
10. Prioritize long-tail and niche keywords

Output format must be a JSON array, each element containing:
{
  "term": "keyword text (MUST be in the target language, NOT Chinese)",
  "category": "product|technology|industry|scenario|pain_point|differentiator|region",
  "searchVolume": number (estimated monthly searches),
  "competition": "low|medium|high",
  "commercialIntent": number between 0-1,
  "relevance": number between 0-1,
  "confidence": number between 0-1
}

REMINDER: Output language = target language specified by user. NOT Chinese (unless target is Chinese).`;

const LONG_TAIL_EXPANSION_SYSTEM_PROMPT = `You are a professional multilingual long-tail keyword research expert. Based on the given core keywords, expand them into related long-tail keywords.

CRITICAL RULES:
1. The input keywords may be in any language — IGNORE the input language.
2. ALL output MUST be in the EXACT target language specified by the user.
3. If target is English, generate English long-tail keywords.
4. If target is Japanese, generate Japanese (日本語) long-tail keywords.
5. NEVER output Chinese unless the target language is explicitly Chinese.

Expansion strategies (apply in the target language):
1. Question-type: "how to...", "what is...", "why..." (translated to target language)
2. Comparison-type: "... vs ...", "which is better...", "best..." (translated to target language)
3. Scenario-type: "[industry] + [core keyword]" (translated to target language)
4. Location-type: "[city/region] + [core keyword]" (translated to target language)
5. Purchase-type: "buy...", "... price", "... cost" (translated to target language)

Requirements:
1. Expand 8-15 long-tail keywords per core keyword
2. Maintain semantic relevance and commercial value
3. Cover different search intents
4. Avoid duplicate or overly similar terms

Output format must be a JSON array, each element containing:
{
  "term": "long-tail keyword text (MUST be in the target language, NOT Chinese)",
  "category": "product|technology|industry|scenario|pain_point|differentiator|region",
  "searchVolume": number (estimated monthly searches),
  "competition": "low|medium|high",
  "commercialIntent": number between 0-1,
  "relevance": number between 0-1,
  "confidence": number between 0-1
}

REMINDER: Output language = target language specified by user. NOT Chinese (unless target is Chinese).`;

// ==================== 提示词构建器 ====================

function buildKeywordExtractionPrompt(
  profile: any,
  options: {
    maxKeywords: number;
    minSearchVolume: number;
    categories: KeywordCategory[];
    language: string;
  }
): string {
  const langInstruction = getLanguageInstruction(options.language);

  return `${langInstruction}

IMPORTANT: The company data below may contain Chinese text. You MUST translate all concepts and generate keywords in the target language specified above. DO NOT output Chinese keywords.

Analyze the following company profile and extract ${options.maxKeywords} high-value keywords.

Company Information:
- Main Business: ${profile.businessOverview?.description || "N/A"}
- Core Products: ${(profile.products || []).map((p: any) => p.name).join(", ") || "N/A"}
- Technology Advantages: ${(profile.technologies || []).map((t: any) => t.name).join(", ") || "N/A"}
- Target Industries: ${(profile.targetIndustries || []).map((i: any) => i.name).join(", ") || "N/A"}
- Use Cases: ${(profile.useCases || []).map((u: any) => u.title).join(", ") || "N/A"}
- Customer Pain Points: ${(profile.painPoints || []).map((p: any) => p.description).join(", ") || "N/A"}
- Differentiators: ${(profile.differentiators || []).map((d: any) => d.value).join(", ") || "N/A"}

Requirements:
- Minimum search volume: ${options.minSearchVolume}
- Keyword categories: ${options.categories.join(", ")}
- Output JSON array format
- REMINDER: All keyword terms MUST be in the target language. Translate from Chinese if needed.`;
}

function buildLongTailExpansionPrompt(
  coreKeyword: CoreKeyword,
  options: {
    maxPerCore: number;
    targetRegion?: string;
    targetIndustries?: string[];
    language: string;
  }
): string {
  const langInstruction = getLanguageInstruction(options.language);

  const industriesContext = options.targetIndustries?.length
    ? `\nTarget Industries: ${options.targetIndustries.join(", ")}`
    : "";

  const regionContext = options.targetRegion
    ? `\nTarget Region: ${options.targetRegion}`
    : "";

  return `${langInstruction}

IMPORTANT: The core keyword below may be in a different language. You MUST generate all long-tail keywords in the target language specified above. Translate if necessary.

Based on the core keyword "${coreKeyword.term}", expand it into ${options.maxPerCore} related long-tail keywords.

Core Keyword Info:
- Category: ${coreKeyword.category}
- Search Volume: ${coreKeyword.metrics.searchVolume}
- Competition: ${coreKeyword.metrics.competition}
- Commercial Intent: ${coreKeyword.metrics.commercialIntent}${industriesContext}${regionContext}

Use diverse expansion strategies, covering question-type, comparison-type, scenario-type, location-type, and purchase-type long-tail keywords — all in the target language.

Output JSON array format.
REMINDER: All keyword terms MUST be in the target language specified above.`;
}

// ==================== 响应解析器 ====================

function parseKeywordResponse(content: string): CoreKeyword[] {
  try {
    // 尝试提取完整 JSON 数组
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      try {
        const data = JSON.parse(jsonMatch[0]);
        return mapToCoreKeywords(data);
      } catch {
        // JSON 可能被截断，尝试容错解析
      }
    }

    // 容错：尝试修复截断的 JSON
    const truncated = tryFixTruncatedJson(content);
    if (truncated) {
      return mapToCoreKeywords(truncated);
    }

    throw new Error("无法解析JSON数组");
  } catch (error) {
    console.error("[parseKeywordResponse] Error:", error);
    console.error("Raw content:", content.slice(0, 500));
    return [];
  }
}

function mapToCoreKeywords(data: any[]): CoreKeyword[] {
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
}

function tryFixTruncatedJson(content: string): any[] | null {
  // 如果 JSON 被截断，缺少结尾的 ]}，尝试补全
  const lastBrace = content.lastIndexOf("{");
  if (lastBrace < 0) return null;

  // 找到最后一个完整的对象：从最后一个 { 向前找最近的 ,
  const beforeLast = content.lastIndexOf(",", lastBrace);
  if (beforeLast < 0) return null;

  const fixed = content.slice(0, beforeLast) + "]";
  try {
    const jsonMatch = fixed.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return null;
    return JSON.parse(jsonMatch[0]);
  } catch {
    return null;
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
