import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { chatCompletion } from "@/lib/ai-client";
import { prisma } from "@/lib/prisma";
import { DEFAULT_LANGUAGE } from "@/lib/languages";

const PLATFORM_STYLES: Record<string, string> = {
  linkedin: "专业深度分析，适合 B2B 决策者阅读，1500-3000 字符，引用数据和行业洞察",
  facebook: "通俗易懂的行业分享，适合企业主页粉丝，800-1500 字符，带互动引导",
  x: "短小精悍的观点或洞察，280 字符以内，带话题标签，适合引发讨论",
  instagram: "图文配套文案，50-150 字，带 emoji 和大量 hashtag，视觉叙事风格",
  tiktok: "视频脚本格式，前 3 秒抓注意力，口语化，50-100 字 + 镜头说明",
  pinterest: "教程式/清单式内容，适合收藏保存，带步骤说明或要点列表，200-500 字",
};

type PipelineData = {
  productUrl?: string;
  productName?: string;
  parsedContent?: string;
  analysis?: {
    keywords: string[];
    userNeeds: string[];
    scenarios: string[];
    painPoints: string[];
  };
  topics?: string[];
  contents?: Record<string, { text: string; hashtags: string[]; cta?: string }[]>;
};

export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.tenantId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { step, ...params } = body;

    switch (step) {
      case "parse":
        return handleParse(session.user.tenantId, params);
      case "analyze":
        return handleAnalyze(session.user.tenantId, params);
      case "topics":
        return handleTopics(session.user.tenantId, params);
      case "rewrite":
        return handleRewrite(session.user.tenantId, params);
      default:
        return NextResponse.json({ error: "Invalid step: parse | analyze | topics | rewrite" }, { status: 400 });
    }
  } catch (error) {
    console.error("[product-pipeline] Error:", error);
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Internal error" }, { status: 500 });
  }
}

/** GET: 加载已保存的流水线数据 */
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.tenantId) return NextResponse.json({ success: true, data: null });
    const saved = await prisma.socialKeywordSet.findUnique({ where: { tenantId: session.user.tenantId } });
    return NextResponse.json({ success: true, data: (saved?.config as Record<string, unknown> | null)?.pipeline || null });
  } catch {
    return NextResponse.json({ success: true, data: null });
  }
}

// ==================== Step Handlers ====================

/** Step 1: 解析产品链接 */
async function handleParse(tenantId: string, params: any) {
  const { productUrl } = params;
  if (!productUrl) return NextResponse.json({ error: "productUrl required" }, { status: 400 });

  console.log("[Step 1] Parsing product URL:", productUrl);

  let parsedContent = "";
  let productName = "";

  try {
    // 尝试爬取页面内容
    const res = await fetch(productUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; VertaX/1.0)" },
      signal: AbortSignal.timeout(15000),
    });
    const html = await res.text();

    // 简单提取标题和文本
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    productName = titleMatch?.[1]?.trim() || new URL(productUrl).hostname;

    // 提取可见文本（去标签）
    parsedContent = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 8000);
  } catch {
    // 爬取失败则用 URL 本身
    productName = new URL(productUrl).hostname;
    parsedContent = `Product URL: ${productUrl}`;
  }

  console.log(`[Step 1] Parsed: ${productName}, ${parsedContent.length} chars`);

  const data: PipelineData = { productUrl, productName, parsedContent };
  await savePipeline(tenantId, data);

  return NextResponse.json({ success: true, data: { productUrl, productName, parsedContent } });
}

/** Step 2: AI 分析 → 四模块 */
async function handleAnalyze(tenantId: string, params: any) {
  const { productName, parsedContent, language = DEFAULT_LANGUAGE } = params;
  if (!parsedContent) return NextResponse.json({ error: "No parsed content" }, { status: 400 });

  console.log("[Step 2] AI analyzing product...");

  const langHint = language === "zh-CN" ? "请用中文输出" : "Please output in English";

  const response = await chatCompletion([
    { role: "system", content: `你是产品营销专家。分析产品并提取四个维度的信息。${langHint}。` },
    {
      role: "user",
      content: `产品: ${productName || "未知"}

页面内容:
${parsedContent.slice(0, 5000)}

请输出 JSON:
{
  "keywords": ["产品核心关键词1", "关键词2", ...10个],
  "userNeeds": ["用户需求1", "需求2", ...8个],
  "scenarios": ["应用场景1", "场景2", ...8个],
  "painPoints": ["行业痛点1", "痛点2", ...8个]
}`,
    },
  ], { maxTokens: 3000, temperature: 0.3 });

  let analysis;
  try {
    const json = response.content.match(/\{[\s\S]*\}/)?.[0] || "{}";
    analysis = JSON.parse(json);
  } catch {
    analysis = { keywords: [], userNeeds: [], scenarios: [], painPoints: [] };
  }

  const data: PipelineData = { productName, parsedContent, analysis };
  await savePipeline(tenantId, data);

  return NextResponse.json({ success: true, data: { analysis } });
}

/** Step 3: 生成 100+ 主题 */
async function handleTopics(tenantId: string, params: any) {
  const { productName, analysis, language = DEFAULT_LANGUAGE } = params;
  if (!analysis) return NextResponse.json({ error: "No analysis data" }, { status: 400 });

  console.log("[Step 3] Generating 100+ topics...");

  const langHint = language === "zh-CN" ? "请用中文输出" : "Please output in English";

  const response = await chatCompletion([
    { role: "system", content: `你是社媒内容策略师。${langHint}` },
    {
      role: "user",
      content: `产品: ${productName}

关键词: ${(analysis.keywords || []).join(", ")}
用户需求: ${(analysis.userNeeds || []).join(", ")}
应用场景: ${(analysis.scenarios || []).join(", ")}
行业痛点: ${(analysis.painPoints || []).join(", ")}

请基于以上信息生成 100+ 个社媒内容主题。每个主题是一句话标题，覆盖不同角度（教程、案例、观点、对比、趋势、FAQ等）。
输出 JSON 数组: ["主题1", "主题2", ...]`,
    },
  ], { maxTokens: 8000, temperature: 0.7 });

  let topics: string[] = [];
  try {
    const json = response.content.match(/\[[\s\S]*\]/)?.[0] || "[]";
    topics = JSON.parse(json);
  } catch {
    topics = (analysis.keywords || []).flatMap((k: string) => [
      `如何选择适合的${k}方案`, `${k}的5大应用趋势`, `${k}选购指南`, `${k} vs 传统方案对比`
    ]);
  }

  const data: PipelineData = { productName, analysis, topics };
  await savePipeline(tenantId, data);

  return NextResponse.json({ success: true, data: { topics, totalTopics: topics.length } });
}

/** Step 4: 六平台改写 */
async function handleRewrite(tenantId: string, params: any) {
  const { productName, topics, platforms = Object.keys(PLATFORM_STYLES), language = DEFAULT_LANGUAGE } = params;
  if (!topics?.length) return NextResponse.json({ error: "No topics" }, { status: 400 });

  const selectedTopics = topics.slice(0, 20);
  console.log(`[Step 4] Rewriting ${selectedTopics.length} topics for ${platforms.length} platforms...`);

  const langHint = language === "zh-CN" ? "请用中文输出" : "Please output in English";

  const response = await chatCompletion([
    { role: "system", content: `你是多平台社媒内容专家。${langHint}` },
    {
      role: "user",
      content: `产品: ${productName}

请为以下每个主题生成适配 6 个平台的社媒内容:

${selectedTopics.map((t: string, i: number) => `${i + 1}. ${t}`).join("\n")}

平台要求:
${Object.entries(PLATFORM_STYLES).filter(([k]) => platforms.includes(k)).map(([k, v]) => `- ${k}: ${v}`).join("\n")}

输出 JSON 格式:
{
  "contents": {
    "主题1": {
      "linkedin": { "text": "...", "hashtags": ["..."], "cta": "..." },
      "x": { "text": "...", "hashtags": ["..."], "cta": "..." },
      ...
    }
  }
}

为 ${selectedTopics.length} 个主题 × ${platforms.length} 个平台生成内容。`,
    },
  ], { maxTokens: 16000, temperature: 0.7 });

  let contents: Record<string, Record<string, any>> = {};
  try {
    const json = response.content.match(/\{[\s\S]*\}/)?.[0] || "{}";
    contents = JSON.parse(json).contents || {};
  } catch {
    // fallback: 每个主题一个通用内容
    for (const t of selectedTopics) {
      contents[t] = {};
      for (const p of platforms) {
        contents[t][p] = { text: t, hashtags: ["#product"], cta: "Learn more" };
      }
    }
  }

  const data: PipelineData = { productName, topics: selectedTopics, contents: contents as PipelineData['contents'] };
  await savePipeline(tenantId, data);

  const contentCount = Object.keys(contents).length;
  return NextResponse.json({ success: true, data: { contents, topics: selectedTopics, contentCount } });
}

// ==================== 持久化 ====================

async function savePipeline(tenantId: string, data: PipelineData) {
  try {
    const existing = await prisma.socialKeywordSet.findUnique({ where: { tenantId } });
    const config = (existing?.config as any) || {};
    const pipeline = { ...(config.pipeline || {}), ...data };
    config.pipeline = pipeline;

    await prisma.socialKeywordSet.upsert({
      where: { tenantId },
      create: { tenantId, coreKeywords: [], longTailKeywords: [], generatedContents: [], config },
      update: { config },
    });
  } catch (err) {
    console.error("[savePipeline] Error:", err);
  }
}
