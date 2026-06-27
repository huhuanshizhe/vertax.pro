import { NextRequest, NextResponse } from "next/server";
import { ensureCronAuthorized } from "@/lib/cron-auth";
import { db } from "@/lib/db";
import * as cheerio from "cheerio";
import { extractLinksFromHtml, matchesLanguagePrefix, normalizeUrl } from "@/lib/services/site-crawler";
import { fetchWebContent } from "@/lib/services/web-scraper";
import { splitTextIntoChunks } from "@/lib/utils/chunk-utils";

export const maxDuration = 300; // 5 minutes

// Time budget: stop processing with 30s margin to ensure response is sent
const TIME_BUDGET_MS = 240_000;

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
  // 阈值从 200 降到 100 — 很多有效页面（导航页、索引页）正文在 100-200 字符之间
  if (content.trim().length < 100) return true;
  return false;
}

/**
 * 从原始 HTML 中提取正文文本（cheerio，用于增量模式合并请求）
 */
function extractTextFromHtml(html: string): { content: string; title: string } {
  const $ = cheerio.load(html);

  // 提取标题
  const title = $("title").first().text().trim()
    || $("h1").first().text().trim()
    || "";

  // 移除非内容元素
  $("script, style, nav, header, footer, aside, noscript, iframe, svg, .nav, .sidebar, .footer, .header, .menu, .ad, .advertisement, .cookie-banner").remove();

  // 优先提取正文区域
  const contentSelectors = ["article", "main", ".content", ".post-content", ".entry-content", ".article-body", "#content", ".main-content"];
  let mainContent = "";

  for (const selector of contentSelectors) {
    const el = $(selector).first();
    if (el.length > 0) {
      mainContent = el.text().trim();
      if (mainContent.length > 200) break;
    }
  }

  // 降级：使用 body
  if (mainContent.length < 100) {
    mainContent = $("body").text().trim();
  }

  // 清理多余空白
  const content = mainContent
    .replace(/\s+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return { content, title };
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
 * Processes crawl tasks in batches of 20 URLs per iteration.
 * Loops within a single function call until all URLs are processed or time budget is reached.
 * Called by Vercel Cron Jobs (daily) or triggered manually after task creation.
 * 
 * IMPORTANT: Vercel Cron Jobs only send GET requests, must export GET handler
 */
export async function GET(req: NextRequest) {
  const unauthorizedResponse = ensureCronAuthorized(req);
  if (unauthorizedResponse) {
    return unauthorizedResponse;
  }

  const startTime = Date.now();

  try {
    const tasks = await db.crawlQueue.findMany({
      where: { status: { in: ["pending", "processing"] } },
      orderBy: [{ createdAt: "asc" }],
      take: 3,
    });

    if (tasks.length === 0) {
      return NextResponse.json({ message: "No pending crawl tasks", processed: 0 });
    }

    let totalProcessed = 0;
    const results: Array<{ taskId: string; processed: number; error?: string }> = [];

    for (const task of tasks) {
      // Time budget check before each task
      if (Date.now() - startTime > TIME_BUDGET_MS) {
        console.log(`[web-crawl] Time budget reached, stopping`);
        break;
      }

      try {
        // Loop: process batches until done or time budget
        let currentTask = task;
        let taskTotalProcessed = 0;
        let iterations = 0;
        const MAX_ITERATIONS = 25; // safety limit

        while (iterations < MAX_ITERATIONS) {
          if (Date.now() - startTime > TIME_BUDGET_MS) {
            console.log(`[web-crawl] Time budget reached during task ${currentTask.id}`);
            break;
          }

          const result = await processCrawlTask(currentTask);
          taskTotalProcessed += result.processed;
          iterations++;

          if (!result.hasMoreWork) break;

          // Re-fetch task to get updated URLs (new links discovered)
          const refreshed = await db.crawlQueue.findUnique({ where: { id: currentTask.id } });
          if (!refreshed) break;
          currentTask = refreshed;
        }

        results.push({ taskId: task.id, processed: taskTotalProcessed });
        totalProcessed += taskTotalProcessed;
      } catch (err) {
        console.error(`[web-crawl] Task ${task.id} error:`, err);
        results.push({
          taskId: task.id,
          processed: 0,
          error: err instanceof Error ? err.message : "Unknown error",
        });

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
      message: `Processed ${totalProcessed} pages across ${results.length} tasks`,
      tasks: results,
      totalProcessed,
      elapsedMs: Date.now() - startTime,
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

    return { taskId, processed: 0, hasMoreWork: false, message: "Task completed" };
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

      // Incremental discovery: fetch raw HTML for link extraction
      // Must fetch raw HTML because fetchWebContent's first priority (Jina) returns Markdown,
      // and cheerio cannot extract <a href> links from Markdown
      // Also, fetchWebContent's scrape fallback returns only body content (not full HTML)
      const isIncremental = taskMetadata.discoveryMethod === "incremental-crawl";
      let rawHtmlForLinks = "";
      if (isIncremental) {
        try {
          const rawRes = await fetch(pageUrl, {
            headers: {
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
              Accept: "text/html,application/xhtml+xml",
            },
            signal: AbortSignal.timeout(30_000),
          });
          if (rawRes.ok) {
            const ct = rawRes.headers.get("content-type") || "";
            if (ct.includes("text/html")) {
              rawHtmlForLinks = await rawRes.text();
            }
          }
        } catch {
          // raw HTML fetch failed — will retry below if needed
        }
      }

      // Fetch content for asset creation
      // 增量模式优化：如果已有 rawHtmlForLinks，直接用 cheerio 提取正文，省去 fetchWebContent 的第二次 HTTP 请求
      let scraped: { success: boolean; content: string; title: string; error?: string };

      if (isIncremental && rawHtmlForLinks.length > 500) {
        const extracted = extractTextFromHtml(rawHtmlForLinks);
        scraped = {
          success: extracted.content.length > 0,
          content: extracted.content,
          title: extracted.title,
          error: extracted.content.length === 0 ? "Failed to extract content from HTML" : undefined,
        };
      } else {
        scraped = await fetchWebContent(pageUrl, {
          maxChars: 30000,
          timeout: 15000,
        });
      }

      // Incremental discovery: extract new links from HTML (regardless of page success/failure)
      if (isIncremental) {
        try {
          const langPrefix = taskMetadata.languagePrefix ?? null;
          const maxPages = (taskMetadata.maxPagesRequested as number) || 500;
          const rootHostname = new URL(task.rootUrl).hostname;

          // Prefer raw fetch HTML; if empty, retry fetch specifically for links
          let htmlForLinks = rawHtmlForLinks;
          if (!htmlForLinks) {
            try {
              const retryRes = await fetch(pageUrl, {
                headers: {
                  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                  Accept: "text/html,application/xhtml+xml",
                },
                signal: AbortSignal.timeout(30_000),
              });
              if (retryRes.ok) {
                htmlForLinks = await retryRes.text();
              }
            } catch {
              // Second attempt also failed
            }
          }
          const newLinks = extractLinksFromHtml(htmlForLinks, pageUrl, rootHostname);

          // Dedup + language prefix filter
          const knownUrls = new Set(urlsArray.map(u => normalizeUrl(u.url)));
          const addedUrls: string[] = [];

          for (const link of newLinks) {
            if (addedUrls.length >= 50) break; // 提升发现效率：每页最多发现 50 个新链接
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

  // Incremental mode: complete when no pending URLs remain
  const stillPending = urlsArray.filter(u => u.status === "pending").length;
  const isComplete = isIncremental
    ? (stillPending === 0)
    : (newProcessedCount >= task.totalPages);

  await db.crawlQueue.update({
    where: { id: taskId },
    data: {
      urls: urlsArray,
      totalPages: urlsArray.length, // Reflect actual page count in incremental mode
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

  return { taskId, processed, failed, skipped, hasMoreWork: !isComplete };
}
