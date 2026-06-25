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
import { getLanguageInstruction, DEFAULT_LANGUAGE } from "@/lib/languages";
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
      language: input.language || DEFAULT_LANGUAGE,
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
        contentAngle: input.keyword.contentAngle || "General content",
        estimatedReadTime: Math.ceil(parsedContent.text.length / 200),
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
    linkedin: `You are a LinkedIn content marketing expert. Create professional, insightful B2B content.
- Tone: Professional but not stiff
- Structure: Hook at the start, value in the middle, engagement prompt at the end
- Length: 150-300 words
- Style: Use data, case studies, industry insights to strengthen credibility`,

    x: `You are a Twitter/X content marketing expert. Create concise, impactful short content.
- Tone: Direct, powerful, occasionally humorous
- Structure: One point per sentence, use emoji and symbols as separators
- Length: Max 280 characters
- Style: Create shareable, conversation-starting content`,

    facebook: `You are a Facebook content marketing expert. Create warm, shareable content.
- Tone: Friendly, approachable, storytelling
- Structure: Story hook → Value showcase → Call to action
- Length: 100-250 words
- Style: Use emoji, emphasize community and trust`,

    instagram: `You are an Instagram content marketing expert. Create copy that complements visual content.
- Tone: Inspirational, visual, emotion-driven
- Structure: Short powerful copy + abundant relevant hashtags
- Length: 50-150 words
- Style: Emphasize aesthetics and lifestyle`,

    tiktok: `You are a TikTok content marketing expert. Create youthful, entertaining short-video copy.
- Tone: Lively, fun, relatable
- Structure: Grab attention in first 3 seconds, deliver core value quickly
- Length: 50-100 words
- Style: Use trending language, challenges, trending elements`,

    wechat: `You are a WeChat Official Account content marketing expert. Create in-depth, valuable content.
- Tone: Professional, authoritative, warm
- Structure: Attention-grabbing headline + substantial content, clear paragraphs
- Length: 200-500 words (summary)
- Style: Connect with trending topics, provide practical value`,
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
    ? "\n[CTA] Add a natural call-to-action at the end, guiding users to click links, comment, or DM"
    : "";

  const hashtagInstruction = includeHashtags
    ? `\n[Hashtags] Add 3-5 relevant hashtags, including: #${keyword.term.replace(/\s+/g, "")} and other related tags`
    : "";

  const toneMap: Record<string, string> = {
    professional: "Professional, authoritative",
    casual: "Casual, friendly",
    humorous: "Humorous, witty",
    informative: "Educational, informative",
    inspirational: "Inspirational, motivating",
  };

  return `${getLanguageInstruction(language)}

IMPORTANT: You MUST write ALL content in the target language specified above. Translate all concepts as needed.

Create social media content based on the following information:

[Core Keyword] ${keyword.term}
[Search Intent] ${keyword.searchIntent || "informational"}
[Content Angle] ${keyword.contentAngle || "General content"}
[Target Platform] ${platform}
[Tone] ${toneMap[tone] || "Professional"}${ctaInstruction}${hashtagInstruction}

[Company Knowledge Base]
${knowledgeContext}

[Platform Guidelines]
${platformPrompt}

[Output Format]
Output JSON format with the following fields:
{
  "text": "Main post content",
  "hashtags": ["tag1", "tag2", "tag3"],
  "cta": "Call to action text (optional)",
  "imageSuggestion": "Image suggestion description"
}

Ensure the content:
1. Naturally incorporates the keyword "${keyword.term}"
2. Reflects the company's professional capabilities and advantages
3. Matches ${platform} platform user habits
4. Has clear value and appeal
5. Avoids hard selling, focuses on value delivery

REMINDER: Output in the target language specified at the top.`;
}

/**
 * 生成配图提示词
 */
function generateImagePrompt(keyword: LongTailKeyword, contentText: string): string {
  const keywordTerm = keyword.term;
  
  // Extract key concepts from the content
  const concepts = extractKeyConcepts(contentText);
  
  return `A professional business image themed around "${keywordTerm}", incorporating elements: ${concepts.join(", ")}, high quality, modern style, suitable for social media marketing`;
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
          contentAngle: input.keyword.contentAngle || "General content",
          estimatedReadTime: Math.ceil((data.text || rawContent).length / 200),
        },
      };
    }

    // If not JSON format, return raw text
    return {
      text: rawContent,
      hashtags: [],
      metadata: {
        keywordUsed: input.keyword.term,
        searchIntent: input.keyword.searchIntent || "informational",
        contentAngle: input.keyword.contentAngle || "General content",
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
        contentAngle: input.keyword.contentAngle || "General content",
        estimatedReadTime: Math.ceil(rawContent.length / 200),
      },
    };
  }
}

// ==================== AI系统提示词 ====================

const CONTENT_GENERATION_SYSTEM_PROMPT = `You are a multilingual social media content marketing expert, skilled at creating high-engagement content for different platforms in multiple languages.

CRITICAL LANGUAGE RULE: You MUST generate content in the EXACT target language specified by the user. If the input data contains Chinese text, translate concepts to the target language. NEVER output Chinese unless the target language is explicitly Chinese.

Core Principles:
1. **Value First**: Every piece of content must provide clear value to the audience
2. **Natural Integration**: Skillfully incorporate keywords without forcing them
3. **Brand Consistency**: Reflect the company's professional image, maintain consistent tone
4. **Platform Adaptation**: Deeply understand each platform's algorithm and user behavior
5. **Action-Oriented**: Design clear CTAs that guide users to the next step

Content Quality Standards:
- Originality: Avoid templates, each content piece should have a unique perspective
- Readability: Clear paragraphs, appropriate use of emoji and formatting
- Engagement: Design talking points that spark comments and shares
- SEO Friendly: Naturally incorporate keywords and related terms

You must strictly follow the output format provided by the user. Do not add extra explanations.`;
