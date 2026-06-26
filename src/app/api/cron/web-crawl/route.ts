import { NextRequest, NextResponse } from "next/server";
import { ensureCronAuthorized } from "@/lib/cron-auth";
import { db } from "@/lib/db";
import { extractLinksFromHtml, matchesLanguagePrefix, normalizeUrl } from "@/lib/services/site-crawler";
import { fetchWebContent } from "@/lib/services/web-scraper";
import { splitTextIntoChunks } from "@/lib/utils/chunk-utils";

export const maxDuration = 300; // 5 minutes per batch

// URL patterns that indicate low-value pages
const LOW_VALUE_URL_PATTERNS = [
  /\/privacy/i, /\/terms/i, /\/cookie/i, /\/legal/i, /\/gdpr/i,
  /\/disclaimer/i, /\/imprint/i, /\/unsubscribe/i,
  /\/sitemap/i, /\/feed/i, /\/rss/i,
  /\/tag\//i, /\/tags\//i, /\/author\//i,
  /\/wp-content/i, /\/cdn-cgi/i,
];

function isLowValuePage(url: string, content: string): boolean {
  const pathname = new URL(url).pathname.toLowerCase();
  if (LOW_VALUE_URL_PATTERNS.some((re) => re.test(pathname))) return true;
  if (content.trim().length < 200) return true;
  return false;
}

type CrawlQueueUrlItem = {
  url: string;
  status: string;
  priority: number;
  assetId?: string;
  error?: string;
  processedAt?: string;
};

type CrawlQueueMetadata = {
  discoveryMethod?: string;
  languagePrefix?: string | null;
  requestedAt?: string;
  maxPagesRequested?: number;
  lastProcessedAt?: string;
  lastStats?: { processed: number; failed: number; skipped: number };
  completedAt?: string;
  lastError?: string;
  failedAt?: string;
};

/**
 * Web Crawl Background Worker
 * 
 * 鍒嗘澶勭悊鐖彇浠诲姟锛屾瘡娆″鐞?20 椤? * 鐢?Vercel Cron 瀹氭椂璋冪敤锛氭瘡 5 鍒嗛挓鎵ц涓€娆? * 
 * 閲嶈锛歏ercel Cron Jobs 鍙彂閫?GET 璇锋眰锛屽繀椤诲鍑?GET handler
 */
export async function GET(req: NextRequest) {
  // 楠岃瘉 cron secret
  const unauthorizedResponse = ensureCronAuthorized(req);
  if (unauthorizedResponse) {
    return unauthorizedResponse;
  }

  try {
    // Find pending/processing tasks
    const tasks = await db.crawlQueue.findMany({
      where: {
        status: { in: ["pending", "processing"] },
      },
      orderBy: [
        { createdAt: "asc" }, // Process oldest first
      ],
      take: 3, // Process up to 3 tasks per run
    });

    if (tasks.length === 0) {
      return NextResponse.json({ 
        message: "No pending crawl tasks",
        processed: 0,
      });
    }

    let totalProcessed = 0;
    const results: Array<{ taskId: string; processed: number; error?: string }> = [];

    for (const task of tasks) {
      try {
        const result = await processCrawlTask(task);
        results.push(result);
        totalProcessed += result.processed;
      } catch (err) {
        console.error(`[web-crawl] Task ${task.id} error:`, err);
        results.push({
          taskId: task.id,
          processed: 0,
          error: err instanceof Error ? err.message : "Unknown error",
        });

        // Mark task as failed
        await db.crawlQueue.update({
          where: { id: task.id },
          data: {
            status: "failed",
            metadata: {
              ...(task.metadata as Record<string, unknown> ?? {}),
              lastError: err instanceof Error ? err.message : "Unknown error",
              failedAt: new Date().toISOString(),
            },
          },
        });
      }
    }

    return NextResponse.json({
      message: `Processed ${totalProcessed} pages across ${tasks.length} tasks`,
      tasks: results,
      totalProcessed,
    });
  } catch (err) {
    console.error("[web-crawl] Critical error:", err);
    return NextResponse.json({ 
      error: err instanceof Error ? err.message : "Critical error" 
    }, { status: 500 });
  }
}

/**
 * Process a single crawl task (20 pages per run)
 */
async function processCrawlTask(task: {
  id: string;
  tenantId: string;
  userId: string;
  batchId: string;
  rootUrl: string;
  totalPages: number;
  processedPages: number;
  status: string;
  folderId: string | null;
  urls: unknown;
  metadata: unknown;
}) {
  const { id: taskId, tenantId, userId, batchId, folderId, urls, metadata } = task;
  const taskMetadata: CrawlQueueMetadata =
    metadata && typeof metadata === "object"
      ? (metadata as CrawlQueueMetadata)
      : {};
  
  // Mark as processing
  await db.crawlQueue.update({
    where: { id: taskId },
    data: { status: "processing" },
  });

  const urlsArray: CrawlQueueUrlItem[] = Array.isArray(urls)
    ? (urls as CrawlQueueUrlItem[])
    : [];

  // Find next 20 unprocessed URLs (respecting priority)
  const pendingUrls = urlsArray
    .filter(u => u.status === "pending")
    .sort((a, b) => a.priority - b.priority)
    .slice(0, 20); // Process 20 pages per batch

  if (pendingUrls.length === 0) {
    // All URLs processed, mark task as complete
    await db.crawlQueue.update({
      where: { id: taskId },
      data: {
        status: "completed",
        metadata: {
          ...taskMetadata,
          completedAt: new Date().toISOString(),
        },
      },
    });

    return { taskId, processed: 0, message: "Task completed" };
  }

  let processed = 0;
  let failed = 0;
  let skipped = 0;

  for (const item of pendingUrls) {
    try {
      const pageUrl = item.url;
      const storageKey = `web://${pageUrl}`;

      // Dedup check
      const existing = await db.asset.findFirst({
        where: { tenantId, storageKey },
        select: { id: true },
      });

      if (existing) {
        skipped++;
        item.status = "skipped";
        item.processedAt = new Date().toISOString();
        continue;
      }

      // ===== 增量发现：先获取原始 HTML 提取链接 =====
      // 必须单独 fetch 原始 HTML，因为 fetchWebContent 第一优先级 Jina 返回 Markdown，
      // cheerio 无法从 Markdown 中提取 <a href> 链接
      const isIncremental = taskMetadata.discoveryMethod === "incremental-crawl";
      let rawHtmlForLinks = "";
      if (isIncremental) {
        try {
          const rawRes = await fetch(pageUrl, {
            headers: {
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
              Accept: "text/html,application/xhtml+xml",
            },
            signal: AbortSignal.timeout(8_000),
          });
          if (rawRes.ok) {
            const ct = rawRes.headers.get("content-type") || "";
            if (ct.includes("text/html")) {
              rawHtmlForLinks = await rawRes.text();
            }
          }
        } catch {
          // raw HTML fetch failed — will try scraped.html fallback below
        }
      }

      // Fetch content (for asset creation)
      const scraped = await fetchWebContent(pageUrl, {
        maxChars: 30000,
        timeout: 15000,
      });

      // ===== 增量发现：从 HTML 提取新链接（无论页面成功与否） =====
      if (isIncremental) {
        try {
          const langPrefix = taskMetadata.languagePrefix ?? null;
          const maxPages = (taskMetadata.maxPagesRequested as number) || 500;
          const rootHostname = new URL(task.rootUrl).hostname;

          // 优先用 raw fetch 的 HTML，降级到 scraped.html
          const htmlForLinks = rawHtmlForLinks || scraped.html || "";
          const newLinks = extractLinksFromHtml(htmlForLinks, pageUrl, rootHostname);

          // 去重 + 语言前缀过滤
          const knownUrls = new Set(urlsArray.map(u => normalizeUrl(u.url)));
          const addedUrls: string[] = [];

          for (const link of newLinks) {
            if (addedUrls.length >= 20) break;
            if (urlsArray.length + addedUrls.length >= maxPages) break;

            const normalized = normalizeUrl(link);
            if (knownUrls.has(normalized)) continue;
            if (!matchesLanguagePrefix(normalized, langPrefix)) continue;

            knownUrls.add(normalized);
            addedUrls.push(normalized);
          }

          if (addedUrls.length > 0) {
            const currentMaxPriority = urlsArray.reduce((max, u) => Math.max(max, u.priority), 0);
            for (const newUrl of addedUrls) {
              urlsArray.push({
                url: newUrl,
                status: "pending",
                priority: currentMaxPriority + 1,
              });
            }
            console.log(`[web-crawl] Incremental: +${addedUrls.length} new URLs (total: ${urlsArray.length})`);
          }
        } catch (err) {
          console.warn(`[web-crawl] Link extraction failed for ${pageUrl}:`, err);
        }
      }

      if (!scraped.success || isLowValuePage(pageUrl, scraped.content)) {
        failed++;
        item.status = "failed";
        item.error = scraped.error || "Content too short or low-value page";
        item.processedAt = new Date().toISOString();
        continue;
      }

      // Chunk the content
      const chunks = splitTextIntoChunks(scraped.content, {
        maxTokensPerChunk: 500,
        overlapTokens: 50,
      });

      // Derive page title
      const pageTitle =
        scraped.title ||
        new URL(pageUrl).pathname.split("/").filter(Boolean).pop() ||
        pageUrl;

      // Create Asset record
      const contentBytes = Buffer.byteLength(scraped.content, "utf8");

      const asset = await db.asset.create({
        data: {
          tenantId,
          uploadedById: userId,
          folderId: folderId || null,
          originalName: pageTitle,
          storageKey,
          mimeType: "text/html",
          fileSize: BigInt(contentBytes),
          extension: ".html",
          fileCategory: "document",
          purpose: ["knowledge"],
          tags: ["web-import", batchId],
          title: pageTitle,
          description: `Imported from ${new URL(pageUrl).hostname}`,
          status: "active",
          metadata: {
            source: "web",
            sourceUrl: pageUrl,
            processingStatus: "ready",
            processedAt: new Date().toISOString(),
            chunkCount: chunks.length,
            crawlBatchId: batchId,
            crawledAt: new Date().toISOString(),
          },
        },
      });

      // Create AssetChunk records
      if (chunks.length > 0) {
        await db.assetChunk.createMany({
          data: chunks.map((chunk) => ({
            tenantId,
            assetId: asset.id,
            content: chunk.content,
            chunkIndex: chunk.chunkIndex,
            charStart: chunk.charStart,
            charEnd: chunk.charEnd,
            tokenCount: chunk.tokenCount,
          })),
        });
      }

      item.status = "completed";
      item.assetId = asset.id;
      item.processedAt = new Date().toISOString();
      processed++;

      // Rate limiting: 200ms between pages
      await new Promise((r) => setTimeout(r, 200));
    } catch (err) {
      console.error(`[web-crawl] URL ${item.url} error:`, err);
      item.status = "failed";
      item.error = err instanceof Error ? err.message : "Unknown error";
      item.processedAt = new Date().toISOString();
      failed++;
    }
  }

  // Update task progress
  const newProcessedCount = task.processedPages + processed + failed + skipped;
  const isIncremental = taskMetadata.discoveryMethod === "incremental-crawl";

  // 增量模式：所有 URL 已处理完（无 pending）且本批未发现新链接时才算完成
  const stillPending = urlsArray.filter(u => u.status === "pending").length;
  const isComplete = isIncremental
    ? (stillPending === 0)
    : (newProcessedCount >= task.totalPages);

  await db.crawlQueue.update({
    where: { id: taskId },
    data: {
      urls: urlsArray,
      totalPages: urlsArray.length, // 增量模式下实时反映实际页面数
      processedPages: newProcessedCount,
      status: isComplete ? "completed" : "processing",
      metadata: {
        ...taskMetadata,
        lastProcessedAt: new Date().toISOString(),
        lastStats: { processed, failed, skipped },
        ...(isComplete ? { completedAt: new Date().toISOString() } : {}),
      },
    },
  });

  return { taskId, processed, failed, skipped };
}

