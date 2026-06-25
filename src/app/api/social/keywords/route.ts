import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { extractCoreKeywords, expandLongTailKeywords } from "@/lib/social-keyword-engine";
import { batchGenerateContents } from "@/lib/social-content-generator";
import { prisma } from "@/lib/prisma";
import { DEFAULT_LANGUAGE } from "@/lib/languages";

/**
 * 分步关键词工作流 API
 *
 * Step 1 — extract: 从知识库提取核心关键词
 * Step 2 — expand:  基于核心关键词裂变长尾词
 * Step 3 — generate: 基于长尾关键词批量生成社媒内容
 */

export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.tenantId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { step, ...params } = body;

    switch (step) {
      case "extract":
        return handleExtract(session.user.tenantId, params);
      case "expand":
        return handleExpand(session.user.tenantId, params);
      case "generate":
        return handleGenerate(session.user.tenantId, params);
      default:
        return NextResponse.json({ error: "Invalid step. Use: extract | expand | generate" }, { status: 400 });
    }
  } catch (error) {
    console.error("[API /social/keywords] Error:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    );
  }
}

// GET: 加载已保存的关键词
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.tenantId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const saved = await prisma.socialKeywordSet.findUnique({
      where: { tenantId: session.user.tenantId },
    });
    return NextResponse.json({ success: true, data: saved });
  } catch (error) {
    console.error("[API GET /social/keywords] Error:", error);
    return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 });
  }
}

// ==================== Step Handlers ====================

async function handleExtract(tenantId: string, params: any) {
  const { maxCoreKeywords = 30, minSearchVolume = 50, language = DEFAULT_LANGUAGE } = params;

  console.log("[Step 1] Extracting core keywords...");
  const coreKeywords = await extractCoreKeywords(tenantId, {
    maxKeywords: maxCoreKeywords,
    minSearchVolume,
    language,
  });

  const stats = {
    totalCoreKeywords: coreKeywords.length,
    avgSearchVolume: coreKeywords.length > 0
      ? Math.round(coreKeywords.reduce((s, k) => s + k.metrics.searchVolume, 0) / coreKeywords.length)
      : 0,
    highValueKeywords: coreKeywords.filter(k => k.metrics.commercialIntent > 0.7).length,
  };

  // 保存到数据库
  await upsertKeywords(tenantId, { coreKeywords, longTailKeywords: [], config: { language, maxCoreKeywords } });

  return NextResponse.json({ success: true, data: { coreKeywords, stats } });
}

async function handleExpand(tenantId: string, params: any) {
  const { coreKeywords, maxPerCore = 10, language = DEFAULT_LANGUAGE } = params;

  if (!coreKeywords || coreKeywords.length === 0) {
    return NextResponse.json({ error: "No core keywords provided" }, { status: 400 });
  }

  console.log(`[Step 2] Expanding long-tail for ${coreKeywords.length} core keywords...`);
  const longTailKeywords = await expandLongTailKeywords(coreKeywords, {
    maxPerCore,
    language,
  });

  const stats = {
    totalLongTailKeywords: longTailKeywords.length,
    avgSearchVolume: longTailKeywords.length > 0
      ? Math.round(longTailKeywords.reduce((s, k) => s + k.metrics.searchVolume, 0) / longTailKeywords.length)
      : 0,
    highValueKeywords: longTailKeywords.filter(k => k.metrics.commercialIntent > 0.7).length,
  };

  // 保存到数据库
  await upsertKeywords(tenantId, { coreKeywords, longTailKeywords, config: { language, maxPerCore } });

  return NextResponse.json({ success: true, data: { longTailKeywords, stats } });
}

async function handleGenerate(tenantId: string, params: any) {
  const { longTailKeywords, platforms = ["linkedin", "x"], tone = "professional", language = DEFAULT_LANGUAGE } = params;

  if (!longTailKeywords || longTailKeywords.length === 0) {
    return NextResponse.json({ error: "No long-tail keywords provided" }, { status: 400 });
  }

  console.log(`[Step 3] Generating content for ${longTailKeywords.length} keywords × ${platforms.length} platforms...`);
  const inputs = longTailKeywords.flatMap((kw: any) =>
    platforms.map((p: string) => ({ keyword: kw, platform: p, tone, language, includeCTA: true, includeHashtags: true }))
  );

  const batchResult = await batchGenerateContents(inputs, { concurrency: 3, delayBetweenBatches: 500 });

  // 给每条内容打上 platform 标记
  const contents = batchResult.contents.map((c, i) => ({
    ...c,
    platform: inputs[i]?.platform || "unknown",
  }));

  // 保存生成的内容到数据库
  try {
    await prisma.socialKeywordSet.update({
      where: { tenantId },
      data: { generatedContents: contents as any },
    });
  } catch (err) {
    console.error("[Keywords] Failed to save generatedContents:", err);
  }

  return NextResponse.json({ success: true, data: { contents, stats: batchResult.stats } });
}

// ==================== 持久化辅助 ====================

async function upsertKeywords(tenantId: string, data: { coreKeywords: any[]; longTailKeywords: any[]; config?: any }) {
  try {
    await prisma.socialKeywordSet.upsert({
      where: { tenantId },
      create: {
        tenantId,
        coreKeywords: data.coreKeywords as any,
        longTailKeywords: data.longTailKeywords as any,
        config: data.config as any,
      },
      update: {
        coreKeywords: data.coreKeywords as any,
        longTailKeywords: data.longTailKeywords as any,
        config: data.config as any,
      },
    });
    console.log("[Keywords] Saved to DB");
  } catch (err) {
    console.error("[Keywords] Failed to save:", err);
  }
}
