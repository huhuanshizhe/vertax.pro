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

    // 检查演示模式
    const isDemoMode = process.env.NEXT_PUBLIC_DEMO_MODE === "true";
    
    if (isDemoMode) {
      console.log("[API /social/generate-from-keywords] Demo mode detected, returning mock data");
      return NextResponse.json({
        success: true,
        data: generateMockData(maxCoreKeywords, maxLongTailPerCore, platforms),
      });
    }

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
      platforms.map((platform: string) => ({
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

// ==================== 演示模式辅助函数 ====================

/**
 * 生成模拟数据用于演示
 */
function generateMockData(
  maxCoreKeywords: number,
  maxLongTailPerCore: number,
  platforms: string[]
) {
  // 模拟核心关键词
  const coreKeywords = Array.from({ length: Math.min(maxCoreKeywords, 10) }, (_, i) => ({
    id: `core-${i}`,
    term: ["工业涂料", "防腐技术", "环保涂装", "智能喷涂", "表面处理"][i % 5],
    category: ["product", "technology", "industry", "scenario", "pain_point"][i % 5],
    metrics: {
      searchVolume: Math.floor(Math.random() * 5000) + 100,
      competition: ["low", "medium", "high"][Math.floor(Math.random() * 3)] as any,
      commercialIntent: Math.random(),
      relevance: 0.7 + Math.random() * 0.3,
    },
    confidence: 0.8 + Math.random() * 0.2,
  }));

  // 模拟长尾关键词
  const longTailKeywords = Array.from(
    { length: Math.min(maxCoreKeywords * maxLongTailPerCore, 50) },
    (_, i) => ({
      id: `longtail-${i}`,
      coreKeywordId: `core-${i % coreKeywords.length}`,
      term: `${coreKeywords[i % coreKeywords.length].term} ${[
        "解决方案",
        "最佳实践",
        "成本分析",
        "技术指南",
        "案例研究",
      ][i % 5]}`,
      category: coreKeywords[i % coreKeywords.length].category,
      metrics: {
        searchVolume: Math.floor(Math.random() * 1000) + 50,
        competition: ["low", "medium", "high"][Math.floor(Math.random() * 3)] as any,
        commercialIntent: Math.random(),
        relevance: 0.6 + Math.random() * 0.4,
      },
      contentAngle: [
        "如何选择合适的工业涂料",
        "防腐涂层的最新技术趋势",
        "环保涂装的成本效益分析",
        "智能喷涂系统的应用场景",
        "表面处理的质量控制要点",
      ][i % 5],
      searchIntent: ["informational", "commercial", "transactional"][i % 3] as any,
    })
  );

  // 计算统计数据
  const avgSearchVolume =
    longTailKeywords.reduce((sum, kw) => sum + kw.metrics.searchVolume, 0) /
    longTailKeywords.length;

  const highValueKeywords = longTailKeywords.filter(
    (kw) => kw.metrics.searchVolume > 500 && kw.metrics.commercialIntent > 0.7
  ).length;

  // 模拟生成的内容
  const contents = platforms.flatMap((platform) =>
    longTailKeywords.slice(0, 5).map((keyword, idx) => ({
      text: `【${keyword.term}】\n\n在${keyword.contentAngle}方面，我们提供专业的解决方案。通过创新技术和丰富经验，帮助客户实现降本增效的目标。\n\n我们的优势：\n• 15年行业经验\n• 500+成功案例\n• ISO9001认证\n• 24/7技术支持`,
      hashtags: [`#${keyword.term.replace(/\s+/g, "")}`, `#VertaX`, `#${platform}`],
      cta: "立即联系我们获取免费方案！",
      imagePrompt: `Professional industrial ${keyword.term} solution showcase, modern factory setting, clean and professional photography style, blue and white color scheme, high quality product demonstration`,
      metadata: {
        keywordUsed: keyword.term,
        searchIntent: keyword.searchIntent,
        contentAngle: keyword.contentAngle || "general",
        estimatedReadTime: Math.floor(Math.random() * 30) + 15,
      },
    }))
  );

  return {
    keywords: {
      core: coreKeywords,
      longTail: longTailKeywords,
      stats: {
        totalCoreKeywords: coreKeywords.length,
        totalLongTailKeywords: longTailKeywords.length,
        avgSearchVolume: Math.round(avgSearchVolume),
        highValueKeywords,
      },
    },
    contents,
    stats: {
      totalGenerated: contents.length,
      successCount: contents.length,
      failedCount: 0,
      avgLength: Math.round(contents.reduce((sum, c) => sum + c.text.length, 0) / contents.length),
    },
  };
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
