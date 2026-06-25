import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { runKeywordExpansionPipeline } from "@/lib/social-keyword-engine";
import { batchGenerateContents } from "@/lib/social-content-generator";
import { prisma } from "@/lib/prisma";
import { DEFAULT_LANGUAGE } from "@/lib/languages";

export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.tenantId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const {
      maxCoreKeywords = 30,
      maxLongTailPerCore = 10,
      minSearchVolume = 50,
      platforms = ["linkedin", "x"],
      tone = "professional",
      language = DEFAULT_LANGUAGE,
      targetRegion,
      targetIndustries = [],
      selectedKeywords = [],
    } = body;

    console.log("[API /social/generate-from-keywords] Starting pipeline...");

    // 1. 运行关键词挖掘流水线
    const keywordResult = await runKeywordExpansionPipeline(
      session.user.tenantId,
      { maxCoreKeywords, maxLongTailPerCore, minSearchVolume, targetRegion, targetIndustries, language }
    );

    console.log(`[API] Extracted ${keywordResult.stats.totalCoreKeywords} core, ${keywordResult.stats.totalLongTailKeywords} long-tail`);

    // 2. 保存关键词到数据库
    try {
      const config = { language, platforms, tone, maxCoreKeywords, maxLongTailPerCore };
      await prisma.socialKeywordSet.upsert({
        where: { tenantId: session.user.tenantId },
        create: {
          tenantId: session.user.tenantId,
          coreKeywords: keywordResult.coreKeywords as any,
          longTailKeywords: keywordResult.longTailKeywords as any,
          config: config as any,
        },
        update: {
          coreKeywords: keywordResult.coreKeywords as any,
          longTailKeywords: keywordResult.longTailKeywords as any,
          config: config as any,
        },
      });
      console.log("[API] Keywords saved to DB");
    } catch (err) {
      console.error("[API] Failed to save keywords:", err);
    }

    // 3. 筛选用于生成的关键词
    let keywordsToUse = keywordResult.longTailKeywords;
    if (selectedKeywords.length > 0) {
      keywordsToUse = keywordResult.longTailKeywords.filter((kw) => selectedKeywords.includes(kw.id));
    } else {
      keywordsToUse = keywordResult.longTailKeywords.slice(0, 20);
    }

    // 4. 批量生成社媒内容
    const generationInputs = keywordsToUse.flatMap((keyword) =>
      platforms.map((platform: string) => ({ keyword, platform, tone: tone as any, language, includeCTA: true, includeHashtags: true }))
    );

    const batchResult = await batchGenerateContents(generationInputs, { concurrency: 3, delayBetweenBatches: 500 });

    return NextResponse.json({
      success: true,
      data: {
        keywords: { core: keywordResult.coreKeywords, longTail: keywordResult.longTailKeywords, stats: keywordResult.stats },
        contents: batchResult.contents,
        stats: batchResult.stats,
      },
    });
  } catch (error) {
    console.error("[API /social/generate-from-keywords] Error:", error);
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Internal server error" }, { status: 500 });
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

    if (!saved) {
      return NextResponse.json({ success: true, data: null });
    }

    return NextResponse.json({
      success: true,
      data: {
        keywords: {
          core: saved.coreKeywords,
          longTail: saved.longTailKeywords,
          stats: null, // 统计从数据重新计算
        },
        config: saved.config,
        updatedAt: saved.updatedAt,
      },
    });
  } catch (error) {
    console.error("[API GET /social/generate-from-keywords] Error:", error);
    return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 });
  }
}
