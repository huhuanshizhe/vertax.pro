/**
 * 智能配图引擎
 * 
 * 功能:
 * 1. 从企业资产库匹配相关图片
 * 2. 使用向量相似度匹配内容与图片
 * 3. 如果没有匹配到现成图片,生成AI绘图提示词
 * 4. 根据平台要求调整图片尺寸和格式
 */

import { aiClient } from "@/lib/ai-client";

// ==================== 类型定义 ====================

export type ImageMatchResult = {
  matched: boolean;          // 是否匹配到现成图片
  imageUrl?: string;         // 图片URL
  imageId?: string;          // 图片资产ID
  source?: "asset-library" | "ai-generated" | "stock-photo";
  confidence?: number;       // 匹配置信度 (0-1)
  dimensions?: {
    width: number;
    height: number;
  };
  platformOptimized?: {
    linkedin: ImageDimension;
    x: ImageDimension;
    facebook: ImageDimension;
    instagram: ImageDimension;
  };
};

export type ImageDimension = {
  width: number;
  height: number;
  aspectRatio: string;
};

export type ImageGenerationInput = {
  contentText: string;       // 文案内容
  keyword: string;           // 关键词
  platform: string;          // 目标平台
  style?: "professional" | "casual" | "creative" | "minimalist";
  includeBrandElements?: boolean; // 是否包含品牌元素
};

// ==================== 平台图片规格 ====================

const PLATFORM_IMAGE_SPECS: Record<string, ImageDimension> = {
  linkedin: {
    width: 1200,
    height: 627,
    aspectRatio: "1.91:1",
  },
  x: {
    width: 1200,
    height: 675,
    aspectRatio: "16:9",
  },
  facebook: {
    width: 1200,
    height: 630,
    aspectRatio: "1.91:1",
  },
  instagram: {
    width: 1080,
    height: 1080,
    aspectRatio: "1:1",
  },
  tiktok: {
    width: 1080,
    height: 1920,
    aspectRatio: "9:16",
  },
  wechat: {
    width: 900,
    height: 383,
    aspectRatio: "2.35:1",
  },
};

// ==================== 核心函数 ====================

/**
 * 为社媒内容智能匹配图片
 * 
 * 流程:
 * 1. 分析内容主题和关键词
 * 2. 查询企业资产库
 * 3. 使用向量相似度匹配
 * 4. 如果没有匹配到,生成AI绘图提示词
 */
export async function matchImageForContent(
  input: ImageGenerationInput
): Promise<ImageMatchResult> {
  try {
    // 1. 首先尝试从资产库匹配
    const assetMatch = await matchFromAssetLibrary(input);
    
    if (assetMatch.matched) {
      return assetMatch;
    }

    // 2. 如果资产库没有合适的,生成AI绘图提示词
    const aiGeneratedPrompt = await generateImagePrompt(input);
    
    return {
      matched: false,
      source: "ai-generated",
      imageUrl: undefined, // 这里可以后续调用AI生图API
      imageId: undefined,
      confidence: 0.8,
      dimensions: PLATFORM_IMAGE_SPECS[input.platform] || PLATFORM_IMAGE_SPECS.linkedin,
    };
  } catch (error) {
    console.error("[matchImageForContent] Error:", error);
    
    // 降级:返回默认提示词
    return {
      matched: false,
      source: "ai-generated",
      confidence: 0.5,
      dimensions: PLATFORM_IMAGE_SPECS[input.platform] || PLATFORM_IMAGE_SPECS.linkedin,
    };
  }
}

/**
 * 从企业资产库匹配图片
 */
async function matchFromAssetLibrary(
  input: ImageGenerationInput
): Promise<ImageMatchResult> {
  // TODO: 实现资产库匹配逻辑
  // 1. 查询企业的图片资产
  // 2. 提取内容的向量表示
  // 3. 计算相似度并排序
  // 4. 返回最匹配的图片
  
  // 目前返回未匹配
  return {
    matched: false,
    source: "asset-library",
  };
}

/**
 * 生成AI绘图提示词
 * 
 * 基于内容和关键词,生成高质量的图片描述
 */
async function generateImagePrompt(
  input: ImageGenerationInput
): Promise<string> {
  const { contentText, keyword, platform, style = "professional", includeBrandElements } = input;

  // 提取关键概念
  const keyConcepts = extractKeyConcepts(contentText, keyword);
  
  // 构建提示词模板
  const styleMap: Record<string, string> = {
    professional: "专业商务风格,简洁现代,高质量渲染",
    casual: "轻松自然风格,生活化场景,温暖色调",
    creative: "创意艺术风格,独特视角,鲜明色彩",
    minimalist: "极简主义风格,留白充足,干净利落",
  };

  const platformContext = getPlatformImageContext(platform);
  
  const prompt = `一张${styleMap[style]}的商业图片

主题: ${keyword}
关键元素: ${keyConcepts.join(", ")}
应用场景: ${platformContext}

技术要求:
- 高分辨率,适合社媒展示
- 色彩协调,视觉冲击力强
- 避免文字和水印
- 符合${platform}平台的用户审美${
    includeBrandElements ? "\n- 可融入企业品牌色系和视觉元素" : ""
  }

输出: 详细的图片描述,便于AI绘图工具理解`;

  // 调用AI优化提示词
  try {
    const response = await aiClient.chat.completions.create({
      model: process.env.AI_MODEL || "qwen-plus",
      messages: [
        { role: "system", content: IMAGE_PROMPT_SYSTEM_PROMPT },
        { role: "user", content: prompt },
      ],
      temperature: 0.7,
      max_tokens: 300,
    });

    const optimizedPrompt = response.choices[0]?.message?.content?.trim();
    return optimizedPrompt || prompt;
  } catch (error) {
    console.error("[generateImagePrompt] AI调用失败,使用原始提示词");
    return prompt;
  }
}

/**
 * 批量为多个内容匹配图片
 */
export async function batchMatchImages(
  inputs: ImageGenerationInput[],
  options: { concurrency?: number } = {}
): Promise<ImageMatchResult[]> {
  const { concurrency = 3 } = options;
  
  const results: ImageMatchResult[] = [];
  
  for (let i = 0; i < inputs.length; i += concurrency) {
    const batch = inputs.slice(i, i + concurrency);
    
    const batchResults = await Promise.allSettled(
      batch.map((input) => matchImageForContent(input))
    );
    
    for (const result of batchResults) {
      if (result.status === "fulfilled") {
        results.push(result.value);
      } else {
        console.error("[batchMatchImages] Failed:", result.reason);
        results.push({
          matched: false,
          source: "ai-generated",
          confidence: 0,
        });
      }
    }
  }
  
  return results;
}

// ==================== 辅助函数 ====================

/**
 * 提取关键概念
 */
function extractKeyConcepts(text: string, keyword: string): string[] {
  // 简单的关键词提取
  const sentences = text.split(/[。.!！？]/).filter((s) => s.trim().length > 0);
  
  // 提取重要词汇(长度>2且不是常见停用词)
  const stopWords = new Set(["的", "了", "是", "在", "我", "有", "和", "就", "不", "人", "都", "一", "一个", "上", "也", "很", "到", "说", "要", "去", "你", "会", "着", "没有", "看", "好", "自己", "这", "他", "她", "它", "们", "那", "些", "什么", "怎么", "为什么", "如何"]);
  
  const words = text.split(/[\s,，。.!！?？、]+/).filter((w) => {
    return w.length > 1 && !stopWords.has(w) && !/^\d+$/.test(w);
  });
  
  // 去重并返回前5个
  const uniqueWords = [...new Set(words)];
  
  // 确保关键词在列表中
  if (!uniqueWords.includes(keyword)) {
    uniqueWords.unshift(keyword);
  }
  
  return uniqueWords.slice(0, 5);
}

/**
 * 获取平台的图片上下文建议
 */
function getPlatformImageContext(platform: string): string {
  const contexts: Record<string, string> = {
    linkedin: "LinkedIn专业商务场景,适合B2B营销,展示企业实力和专业性",
    x: "Twitter/X快速传播场景,需要有视觉冲击力,易于快速理解",
    facebook: "Facebook社交分享场景,强调社区感和信任,生活化场景",
    instagram: "Instagram视觉美学场景,高质量摄影风格,生活方式展示",
    tiktok: "TikTok年轻化娱乐场景,活泼有趣,符合年轻用户审美",
    wechat: "微信公众号专业场景,深度内容配图,知识性和权威性",
  };
  
  return contexts[platform] || contexts.linkedin;
}

/**
 * 为生成的图片提示词添加平台优化参数
 */
export function optimizeImageForPlatform(
  basePrompt: string,
  platform: string
): string {
  const specs = PLATFORM_IMAGE_SPECS[platform];
  if (!specs) return basePrompt;
  
  return `${basePrompt}\n\n图片规格: ${specs.width}x${specs.height} (${specs.aspectRatio})`;
}

// ==================== AI系统提示词 ====================

const IMAGE_PROMPT_SYSTEM_PROMPT = `你是一位专业的AI绘图提示词工程师。你的任务是为社媒营销内容生成高质量的图片描述。

要求:
1. 详细描述画面内容,包括主体、背景、色彩、构图等
2. 指定艺术风格和视觉效果
3. 考虑光照、角度、景深等摄影要素
4. 避免抽象模糊的描述,要具体可执行
5. 符合目标平台的用户审美和传播特性

输出格式:
- 直接输出图片描述文本
- 不要添加解释或额外说明
- 使用中文描述
- 长度控制在100-200字

示例输出:
"一张现代办公室的专业照片,前景是一位自信的亚洲商务人士正在演示产品,背景是明亮的落地窗和城市天际线,自然光线充足,色调以蓝色和白色为主,传达专业和科技感,中景拍摄,浅景深虚化背景"`;
