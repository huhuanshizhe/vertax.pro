/**
 * API: 基于关键词的社媒内容生成
 * 
 * 完整工作流:
 * 1. 从知识库提取核心关键词
 * 2. 裂变长尾关键词
 * 3. 为每个长尾词生成社媒内容(带企业画像)
 * 4. 返回内容和配图建议
 */

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { runKeywordExpansionPipeline } from "@/lib/social-keyword-engine";
import { batchGenerateContents } from "@/lib/social-content-generator";

export async function POST(request: Request) {
  try {
    // 验证身份
    const session = await auth();
    if (!session?.user?.tenantId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 解析请求参数
    const body = await request.json();
    const {
      maxCoreKeywords = 30,
      maxLongTailPerCore = 10,
      minSearchVolume = 50,
      platforms = ["linkedin", "x"],
      tone = "professional",
      language = "zh-CN",
      targetRegion,
      targetIndustries = [],
      selectedKeywords = [], // 用户手动选择的关键词ID列表
    } = body;

    console.log("[API /social/generate-from-keywords] Starting pipeline...");

    // 1. 运行关键词挖掘流水线
    const keywordResult = await runKeywordExpansionPipeline(
      session.user.tenantId,
      {
        maxCoreKeywords,
        maxLongTailPerCore,
        minSearchVolume,
        targetRegion,
        targetIndustries,
      }
    );

    console.log(
      `[API] Extracted ${keywordResult.stats.totalCoreKeywords} core keywords, ` +
        `${keywordResult.stats.totalLongTailKeywords} long-tail keywords`
    );

    // 2. 筛选用于生成的关键词
    let keywordsToUse = keywordResult.longTailKeywords;
    
    if (selectedKeywords.length > 0) {
      // 如果用户指定了关键词,只使用这些
      keywordsToUse = keywordResult.longTailKeywords.filter((kw) =>
        selectedKeywords.includes(kw.id)
      );
    } else {
      // 否则选择高价值关键词(前20个)
      keywordsToUse = keywordResult.longTailKeywords.slice(0, 20);
    }

    console.log(`[API] Will generate content for ${keywordsToUse.length} keywords`);

    // 3. 批量生成社媒内容
    const generationInputs = keywordsToUse.flatMap((keyword) =>
      platforms.map((platform) => ({
        keyword,
        platform,
        tone: tone as any,
        language,
        includeCTA: true,
        includeHashtags: true,
      }))
    );

    console.log(
      `[API] Generating ${generationInputs.length} contents (${keywordsToUse.length} keywords × ${platforms.length} platforms)`
    );

    const batchResult = await batchGenerateContents(generationInputs, {
      concurrency: 3,
      delayBetweenBatches: 500,
    });

    console.log(
      `[API] Generation complete: ${batchResult.stats.successCount} succeeded, ` +
        `${batchResult.stats.failedCount} failed`
    );

    // 4. 组织响应数据
    const response = {
      success: true,
      data: {
        keywords: {
          core: keywordResult.coreKeywords,
          longTail: keywordResult.longTailKeywords,
          stats: keywordResult.stats,
        },
        contents: batchResult.contents,
        stats: batchResult.stats,
      },
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error("[API /social/generate-from-keywords] Error:", error);
    
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Internal server error",
      },
      { status: 500 }
    );
  }
}

// GET方法:获取已有的生成结果(可选)
export async function GET(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.tenantId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // TODO: 从数据库查询已保存的生成结果
    return NextResponse.json({
      success: true,
      data: {
        message: "功能开发中:获取历史生成记录",
      },
    });
  } catch (error) {
    console.error("[API /social/generate-from-keywords GET] Error:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}
