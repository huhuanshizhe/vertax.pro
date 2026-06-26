import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { discoverPages, normalizeUrl, detectLanguagePrefix, matchesLanguagePrefix } from "@/lib/services/site-crawler";
import crypto from "crypto";

export const maxDuration = 60; // 1 minute - return quickly after queueing task

/**
 * Web Import API - 双模式
 * 
 * 模式 A (sitemap): 一次性发现全部页面 → 全量入队
 * 模式 B (增量爬取): 无 sitemap 时，仅排队根 URL
 *   → cron 每批处理时顺便发现新链接追加到队列
 *   → 多语言网站自动锁定一种语言
 */
export async function POST(req: NextRequest) {
  // Auth check
  const session = await auth();
  if (!session?.user?.tenantId) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const tenantId = session.user.tenantId;
  const userId = session.user.id;

  // Parse body
  let body: { url: string; maxPages?: number; folderId?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid request body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { url, maxPages = 500, folderId } = body;

  // URL validation
  if (!url || typeof url !== "string") {
    return new Response(JSON.stringify({ error: "URL is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  let normalizedRoot: string;
  try {
    normalizedRoot = normalizeUrl(url);
    new URL(normalizedRoot); // validate
  } catch {
    return new Response(JSON.stringify({ error: "Invalid URL format" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const crawlBatchId = crypto.randomUUID();

  try {
    // 检测语言前缀（多语言网站仅采一种语言）
    const rootPathname = new URL(normalizedRoot).pathname;
    const langPrefix = detectLanguagePrefix(rootPathname);

    // Phase 1: 尝试 sitemap（快速路径）
    const { urls: sitemapUrls, method } = await discoverPages(normalizedRoot, {
      maxPages: Math.min(maxPages, 1000),
    });

    if (sitemapUrls.length > 0) {
      // ========== 模式 A：Sitemap 全量入队（过滤语言） ==========
      const filteredUrls = langPrefix
        ? sitemapUrls.filter(u => matchesLanguagePrefix(u, langPrefix))
        : sitemapUrls;

      console.log(`[web-import] Sitemap found ${sitemapUrls.length} URLs${langPrefix ? `, filtered to ${filteredUrls.length} (lang: ${langPrefix})` : ""}`);

      if (filteredUrls.length === 0) {
        return new Response(JSON.stringify({
          error: `No pages found for language "${langPrefix}". Try a URL matching the desired language.`,
          method,
          languagePrefix: langPrefix,
        }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }

      const crawlTask = await db.crawlQueue.create({
        data: {
          tenantId,
          userId,
          batchId: crawlBatchId,
          rootUrl: normalizedRoot,
          totalPages: filteredUrls.length,
          processedPages: 0,
          status: "pending",
          folderId: folderId || null,
          urls: filteredUrls.map((url, index) => ({
            url,
            status: "pending" as const,
            priority: index < 20 ? 1 : index < 100 ? 2 : 3,
          })),
          metadata: {
            discoveryMethod: method,
            languagePrefix: langPrefix,
            requestedAt: new Date().toISOString(),
            maxPagesRequested: maxPages,
          },
        },
      });

      triggerCrawlProcessing(req, crawlTask.id);

      return new Response(JSON.stringify({
        success: true,
        taskId: crawlTask.id,
        batchId: crawlBatchId,
        discoveredPages: filteredUrls.length,
        method,
        languagePrefix: langPrefix,
        message: `Crawl task queued. Processing ${filteredUrls.length} pages in background.`,
        estimatedTimeSeconds: Math.ceil(filteredUrls.length / 20),
      }), {
        status: 202,
        headers: { "Content-Type": "application/json" },
      });
    }

    // ========== 模式 B：增量爬取（无 sitemap） ==========
    console.log(`[web-import] No sitemap found, starting incremental crawl${langPrefix ? ` (lang: ${langPrefix})` : ""}`);

    const crawlTask = await db.crawlQueue.create({
      data: {
        tenantId,
        userId,
        batchId: crawlBatchId,
        rootUrl: normalizedRoot,
        totalPages: 1, // 初始仅根 URL，会随增量发现增长
        processedPages: 0,
        status: "pending",
        folderId: folderId || null,
        urls: [{
          url: normalizedRoot,
          status: "pending" as const,
          priority: 1,
        }],
        metadata: {
          discoveryMethod: "incremental-crawl",
          languagePrefix: langPrefix,
          requestedAt: new Date().toISOString(),
          maxPagesRequested: maxPages,
        },
      },
    });

    triggerCrawlProcessing(req, crawlTask.id);

    return new Response(JSON.stringify({
      success: true,
      taskId: crawlTask.id,
      batchId: crawlBatchId,
      discoveredPages: 1,
      method: "incremental-crawl",
      message: `Incremental crawl started. Pages will be discovered and processed in background.`,
      estimatedTimeSeconds: null, // 增量模式无法预估
      languagePrefix: langPrefix,
    }), {
      status: 202,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[web-import] Error:", err);
    return new Response(JSON.stringify({ 
      error: err instanceof Error ? err.message : "Failed to start crawl task" 
    }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

/**
 * 触发后台爬取处理（fire-and-forget）
 */
function triggerCrawlProcessing(req: NextRequest, taskId: string) {
  const requestOrigin = req.headers.get("origin") ||
    req.headers.get("host") ||
    process.env.NEXT_PUBLIC_BASE_DOMAIN ||
    "localhost:3000";
  const protocol = requestOrigin.startsWith("http") ? "" : "https://";
  const cronUrl = `${protocol}${requestOrigin}/api/cron/web-crawl`;

  fetch(cronUrl, {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${process.env.CRON_SECRET || "dev-secret"}`,
    },
  }).catch((err) => {
    console.warn(`[web-import] Failed to trigger immediate processing for task ${taskId}:`, err);
  });
}

/**
 * GET - Check crawl task status
 */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.tenantId) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const tenantId = session.user.tenantId;
  const { searchParams } = new URL(req.url);
  const taskId = searchParams.get("taskId");
  const batchId = searchParams.get("batchId");

  if (!taskId && !batchId) {
    return new Response(JSON.stringify({ error: "taskId or batchId required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const task = await db.crawlQueue.findFirst({
      where: {
        tenantId,
        id: taskId || undefined,
        batchId: batchId || undefined,
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!task) {
      return new Response(JSON.stringify({ error: "Task not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    const metadata = task.metadata as Record<string, unknown> | null;
    return new Response(JSON.stringify({
      id: task.id,
      batchId: task.batchId,
      status: task.status,
      totalPages: task.totalPages,
      processedPages: task.processedPages,
      progress: task.totalPages > 0 ? Math.round((task.processedPages / task.totalPages) * 100) : 0,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      discoveryMethod: metadata?.discoveryMethod ?? null,
      languagePrefix: metadata?.languagePrefix ?? null,
      metadata: task.metadata,
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[web-import-status] Error:", err);
    return new Response(JSON.stringify({ 
      error: err instanceof Error ? err.message : "Failed to get status" 
    }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
