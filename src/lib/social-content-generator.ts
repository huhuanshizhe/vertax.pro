/**
 * 增强版社媒内容生成器
 * 
 * 功能:
 * 1. 基于长尾关键词生成社媒内容
 * 2. 自动注入企业画像和知识库上下文
 * 3. 适配不同平台的风格和要求
 * 4. 生成配图建议或调用图片生成API
 */

import { getCompanyProfile } from "@/actions/knowledge";
import { aiClient } from "@/lib/ai-client";
import type { LongTailKeyword } from "./social-keyword-engine";

// ==================== 类型定义 ====================

export type ContentGenerationInput = {
  keyword: LongTailKeyword;
  platform: string;
  tone?: "professional" | "casual" | "humorous" | "informative" | "inspirational";
  language?: string;
  includeCTA?: boolean;        // 是否包含行动号召
  includeHashtags?: boolean;   // 是否包含话题标签
  maxLength?: number;          // 最大长度限制
};

export type GeneratedContent = {
  text: string;                // 生成的文案
  hashtags: string[];          // 话题标签
  cta?: string;                // 行动号召文本
  imagePrompt?: string;        // 配图提示词(用于AI生图)
  imageUrl?: string;           // 配图URL(如果有现成图片库)
  metadata: {
    keywordUsed: string;       // 使用的关键词
    searchIntent: string;      // 搜索意图
    contentAngle: string;      // 内容角度
    estimatedReadTime: number; // 预估阅读时间(秒)
  };
};

export type BatchGenerationResult = {
  contents: GeneratedContent[];
  stats: {
    totalGenerated: number;
    successCount: number;
    failedCount: number;
    avgLength: number;
  };
};

// ==================== 核心函数 ====================

/**
 * 基于单个长尾关键词生成社媒内容
 * 
 * 流程:
 * 1. 获取企业画像作为上下文
 * 2. 构建平台特定的提示词
 * 3. 注入关键词和搜索意图
 * 4. 调用AI生成内容
 * 5. 提取和优化内容元素
 */
export async function generateContentFromKeyword(
  input: ContentGenerationInput
): Promise<GeneratedContent> {
  try {
    // 1. 获取企业能力画像
    const profile = await getCompanyProfile();
    
    if (!profile) {
      throw new Error("未找到企业能力画像，请先完成知识库分析");
    }

    // 2. 构建知识库上下文
    const knowledgeContext = buildKnowledgeContext(profile, input.keyword);

    // 3. 获取平台特定提示词
    const platformPrompt = getPlatformSpecificPrompt(input.platform);

    // 4. 构建完整的生成提示词
    const generationPrompt = buildContentGenerationPrompt({
      keyword: input.keyword,
      platform: input.platform,
      tone: input.tone || "professional",
      language: input.language || "zh-CN",
      knowledgeContext,
      platformPrompt,
      includeCTA: input.includeCTA !== false,
      includeHashtags: input.includeHashtags !== false,
    });

    // 5. 调用AI生成内容
    const response = await aiClient.chat.completions.create({
      model: process.env.AI_MODEL || "qwen-plus",
      messages: [
        { role: "system", content: CONTENT_GENERATION_SYSTEM_PROMPT },
        { role: "user", content: generationPrompt },
      ],
      temperature: 0.8,
      max_tokens: 800,
    });

    const rawContent = response.choices[0]?.message?.content;
    if (!rawContent) {
      throw new Error("AI返回空内容");
    }

    // 6. 解析和结构化输出
    const parsedContent = parseGeneratedContent(rawContent, input);

    // 7. 生成配图提示词
    const imagePrompt = generateImagePrompt(input.keyword, parsedContent.text);

    return {
      ...parsedContent,
      imagePrompt,
      metadata: {
        keywordUsed: input.keyword.term,
        searchIntent: input.keyword.searchIntent || "informational",
        contentAngle: input.keyword.contentAngle || "通用内容",
        estimatedReadTime: Math.ceil(parsedContent.text.length / 200), // 假设200字/分钟
      },
    };
  } catch (error) {
    console.error("[generateContentFromKeyword] Error:", error);
    throw error;
  }
}

/**
 * 批量生成社媒内容
 * 
 * 为多个长尾关键词并行生成内容
 */
export async function batchGenerateContents(
  inputs: ContentGenerationInput[],
  options: {
    concurrency?: number;  // 并发数
    delayBetweenBatches?: number; // 批次间隔(ms)
  } = {}
): Promise<BatchGenerationResult> {
  const {
    concurrency = 5,
    delayBetweenBatches = 1000,
  } = options;

  const results: GeneratedContent[] = [];
  let successCount = 0;
  let failedCount = 0;
  let totalLength = 0;

  // 分批处理
  for (let i = 0; i < inputs.length; i += concurrency) {
    const batch = inputs.slice(i, i + concurrency);
    
    const batchResults = await Promise.allSettled(
      batch.map((input) => generateContentFromKeyword(input))
    );

    for (const result of batchResults) {
      if (result.status === "fulfilled") {
        results.push(result.value);
        successCount++;
        totalLength += result.value.text.length;
      } else {
        console.error("[batchGenerateContents] Failed:", result.reason);
        failedCount++;
      }
    }

    // 批次间延迟,避免API限流
    if (i + concurrency < inputs.length) {
      await new Promise((resolve) => setTimeout(resolve, delayBetweenBatches));
    }
  }

  return {
    contents: results,
    stats: {
      totalGenerated: inputs.length,
      successCount,
      failedCount,
      avgLength: successCount > 0 ? Math.round(totalLength / successCount) : 0,
    },
  };
}

/**
 * 为生成的内容匹配合适的图片
 * 
 * 策略:
 * 1. 从企业资产库匹配相关图片
 * 2. 如果没有现成图片,生成AI绘图提示词
 * 3. 根据平台要求调整图片尺寸
 */
export async function matchImageForContent(
  content: GeneratedContent,
  platform: string
): Promise<{ imageUrl?: string; imagePrompt?: string }> {
  // TODO: 实现图片匹配逻辑
  // 1. 查询企业资产库中的图片
  // 2. 使用向量相似度匹配内容与图片
  // 3. 如果没有匹配到,返回AI生图提示词
  
  // 目前先返回生成的提示词
  return {
    imagePrompt: content.imagePrompt,
  };
}

// ==================== 辅助函数 ====================

/**
 * 构建知识库上下文
 * 
 * 将企业画像转化为AI可理解的上下文信息
 */
function buildKnowledgeContext(
  profile: any,
  keyword: LongTailKeyword
): string {
  const sections: string[] = [];

  // 1. 业务概述
  if (profile.businessOverview?.description) {
    sections.push(`【业务概述】${profile.businessOverview.description}`);
  }

  // 2. 相关产品/服务
  const relevantProducts = findRelevantProducts(profile.products, keyword);
  if (relevantProducts.length > 0) {
    sections.push(
      `【相关产品】${relevantProducts.map((p: any) => `${p.name}: ${p.description || ""}`).join("; ")}`
    );
  }

  // 3. 技术优势
  const relevantTech = findRelevantTechnologies(profile.technologies, keyword);
  if (relevantTech.length > 0) {
    sections.push(
      `【技术优势】${relevantTech.map((t: any) => t.name).join(", ")}`
    );
  }

  // 4. 目标行业
  if (profile.targetIndustries?.length > 0) {
    sections.push(
      `【目标行业】${profile.targetIndustries.map((i: any) => i.name).join(", ")}`
    );
  }

  // 5. 客户案例/痛点
  const relevantPainPoints = findRelevantPainPoints(profile.painPoints, keyword);
  if (relevantPainPoints.length > 0) {
    sections.push(
      `【解决痛点】${relevantPainPoints.map((p: any) => p.description).join("; ")}`
    );
  }

  // 6. 差异化卖点
  if (profile.differentiators?.length > 0) {
    sections.push(
      `【核心优势】${profile.differentiators.map((d: any) => d.value).join("; ")}`
    );
  }

  return sections.join("\n\n");
}

/**
 * 查找相关产品
 */
function findRelevantProducts(products: any[], keyword: LongTailKeyword): any[] {
  if (!products || products.length === 0) return [];

  const keywordLower = keyword.term.toLowerCase();
  
  return products.filter((product) => {
    const nameMatch = product.name?.toLowerCase().includes(keywordLower);
    const descMatch = product.description?.toLowerCase().includes(keywordLower);
    return nameMatch || descMatch;
  }).slice(0, 3); // 最多返回3个相关产品
}

/**
 * 查找相关技术
 */
function findRelevantTechnologies(technologies: any[], keyword: LongTailKeyword): any[] {
  if (!technologies || technologies.length === 0) return [];

  const keywordLower = keyword.term.toLowerCase();
  
  return technologies.filter((tech) => {
    const nameMatch = tech.name?.toLowerCase().includes(keywordLower);
    const descMatch = tech.description?.toLowerCase().includes(keywordLower);
    return nameMatch || descMatch;
  }).slice(0, 2);
}

/**
 * 查找相关痛点
 */
function findRelevantPainPoints(painPoints: any[], keyword: LongTailKeyword): any[] {
  if (!painPoints || painPoints.length === 0) return [];

  const keywordLower = keyword.term.toLowerCase();
  
  return painPoints.filter((pp) => {
    const titleMatch = pp.title?.toLowerCase().includes(keywordLower);
    const descMatch = pp.description?.toLowerCase().includes(keywordLower);
    return titleMatch || descMatch;
  }).slice(0, 2);
}

/**
 * 获取平台特定的提示词
 */
function getPlatformSpecificPrompt(platform: string): string {
  const prompts: Record<string, string> = {
    linkedin: `你是LinkedIn内容营销专家。创作专业、有洞察力的B2B内容。
- 语气: 专业但不生硬
- 结构: 开头吸引眼球,中间提供价值,结尾引导互动
- 长度: 150-300字
- 特色: 使用数据、案例、行业洞察增强说服力`,

    x: `你是Twitter/X内容营销专家。创作简洁、有冲击力的短内容。
- 语气: 直接、有力、有时幽默
- 结构: 一句话一个观点,多用emoji和符号分隔
- 长度: 不超过280字符
- 特色: 制造话题性,鼓励转发`,

    facebook: `你是Facebook内容营销专家。创作亲切、易传播的内容。
- 语气: 友好、亲和、故事化
- 结构: 故事引入 → 价值展示 → 行动号召
- 长度: 100-250字
- 特色: 多用emoji,强调社区感和信任`,

    instagram: `你是Instagram内容营销专家。创作文案配合视觉内容。
- 语气: 灵感性、视觉化、情感驱动
- 结构: 简短有力的文案 + 大量相关hashtag
- 长度: 50-150字
- 特色: 强调美学和生活方式`,

    tiktok: `你是TikTok内容营销专家。创作年轻化、娱乐化的短视频文案。
- 语气: 活泼、有趣、接地气
- 结构: 前3秒抓住注意力,快速传递核心价值
- 长度: 50-100字
- 特色: 使用流行语、挑战、趋势元素`,

    wechat: `你是微信公众号内容营销专家。创作深度、有价值的内容。
- 语气: 专业、权威、有温度
- 结构: 标题党但内容扎实,段落清晰
- 长度: 200-500字(摘要)
- 特色: 结合热点,提供实用价值`,
  };

  return prompts[platform] || prompts.linkedin;
}

/**
 * 构建内容生成提示词
 */
function buildContentGenerationPrompt(params: {
  keyword: LongTailKeyword;
  platform: string;
  tone: string;
  language: string;
  knowledgeContext: string;
  platformPrompt: string;
  includeCTA: boolean;
  includeHashtags: boolean;
}): string {
  const { keyword, platform, tone, language, knowledgeContext, platformPrompt, includeCTA, includeHashtags } = params;

  const ctaInstruction = includeCTA
    ? "\n【行动号召】在文末添加自然的CTA,引导用户点击链接、评论或私信"
    : "";

  const hashtagInstruction = includeHashtags
    ? `\n【话题标签】添加3-5个相关的hashtag,包括:#${keyword.term.replace(/\s+/g, "")} 和其他相关标签`
    : "";

  const toneMap: Record<string, string> = {
    professional: "专业、权威",
    casual: "轻松、友好",
    humorous: "幽默、风趣",
    informative: "教育性、信息丰富",
    inspirational: "激励性、启发性",
  };

  return `请基于以下信息创作社媒内容:

【核心关键词】${keyword.term}
【搜索意图】${keyword.searchIntent || "informational"}
【内容角度】${keyword.contentAngle || "通用内容"}
【目标平台】${platform}
【语气风格】${toneMap[tone] || "专业"}
【语言】${language === "zh-CN" ? "简体中文" : "English"}${ctaInstruction}${hashtagInstruction}

【企业知识库上下文】
${knowledgeContext}

【平台创作指南】
${platformPrompt}

【输出格式】
请以JSON格式输出,包含以下字段:
{
  "text": "主文案内容",
  "hashtags": ["标签1", "标签2", "标签3"],
  "cta": "行动号召文本(可选)",
  "imageSuggestion": "配图建议描述"
}

确保内容:
1. 自然融入关键词"${keyword.term}"
2. 体现企业的专业能力和优势
3. 符合${platform}平台的用户习惯
4. 有明确的价值和吸引力
5. 避免硬销售,注重价值传递`;
}

/**
 * 生成配图提示词
 */
function generateImagePrompt(keyword: LongTailKeyword, contentText: string): string {
  const keywordTerm = keyword.term;
  
  // 提取内容中的关键概念
  const concepts = extractKeyConcepts(contentText);
  
  return `一张专业的商业图片,主题围绕"${keywordTerm}",包含以下元素:${concepts.join(", ")},高质量,现代风格,适合社媒营销使用`;
}

/**
 * 提取关键概念
 */
function extractKeyConcepts(text: string): string[] {
  // 简单的关键词提取(可以优化为更复杂的NLP)
  const words = text.split(/[\s,，。.!！?？]+/);
  const uniqueWords = [...new Set(words)].filter((w) => w.length > 2);
  return uniqueWords.slice(0, 5);
}

/**
 * 解析生成的内容
 */
function parseGeneratedContent(
  rawContent: string,
  input: ContentGenerationInput
): GeneratedContent {
  try {
    // 尝试提取JSON
    const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const data = JSON.parse(jsonMatch[0]);
      return {
        text: data.text || rawContent,
        hashtags: Array.isArray(data.hashtags) ? data.hashtags : [],
        cta: data.cta,
        metadata: {
          keywordUsed: input.keyword.term,
          searchIntent: input.keyword.searchIntent || "informational",
          contentAngle: input.keyword.contentAngle || "通用内容",
          estimatedReadTime: Math.ceil((data.text || rawContent).length / 200),
        },
      };
    }

    // 如果不是JSON格式,直接返回原文
    return {
      text: rawContent,
      hashtags: [],
      metadata: {
        keywordUsed: input.keyword.term,
        searchIntent: input.keyword.searchIntent || "informational",
        contentAngle: input.keyword.contentAngle || "通用内容",
        estimatedReadTime: Math.ceil(rawContent.length / 200),
      },
    };
  } catch (error) {
    console.error("[parseGeneratedContent] Error:", error);
    return {
      text: rawContent,
      hashtags: [],
      metadata: {
        keywordUsed: input.keyword.term,
        searchIntent: input.keyword.searchIntent || "informational",
        contentAngle: input.keyword.contentAngle || "通用内容",
        estimatedReadTime: Math.ceil(rawContent.length / 200),
      },
    };
  }
}

// ==================== AI系统提示词 ====================

const CONTENT_GENERATION_SYSTEM_PROMPT = `你是一位资深的社媒内容营销专家,擅长为不同平台创作高 engagement 的内容。

核心原则:
1. **价值优先**: 每条内容都要为受众提供明确价值
2. **自然融合**: 巧妙融入关键词,不生硬堆砌
3. **品牌一致**: 体现企业专业形象,保持语调一致
4. **平台适配**: 深度理解各平台的算法和用户行为
5. **行动导向**: 设计清晰的CTA,引导用户下一步动作

内容质量标准:
- 原创性: 避免模板化,每个内容都要有独特视角
- 可读性: 段落清晰,适当使用emoji和格式化
- 互动性: 设计能引发评论、分享的话题点
- SEO友好: 自然融入关键词和相关术语

你必须严格遵循用户提供的输出格式,不要添加额外解释。`;
