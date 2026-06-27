/**
 * 站点爬虫服务
 *
 * 自动发现并爬取网站所有页面：
 * 1. 优先解析 sitemap.xml
 * 2. 降级为 BFS 链接爬取
 *
 * 配合 web-scraper.ts 的 fetchWebContent 使用
 */

import * as cheerio from "cheerio";

// ==================== 类型定义 ====================

export interface CrawlOptions {
  /** 最大爬取页数（默认 50） */
  maxPages: number;
  /** 排除路径前缀 */
  excludePaths?: string[];
  /** 单页超时（毫秒，默认 15000） */
  timeout: number;
}

export interface DiscoveredPage {
  url: string;
  title: string;
  status: "pending" | "fetched" | "failed" | "skipped";
  contentLength?: number;
  error?: string;
}

export interface CrawlProgress {
  phase: "sitemap" | "discovering" | "fetching" | "done" | "error";
  discovered: number;
  fetched: number;
  failed: number;
  skipped: number;
  currentUrl?: string;
  pages: DiscoveredPage[];
  error?: string;
}

// 网页发现阶段总时间预算（Vercel Hobby 60s → 安全值 25s）
const DISCOVERY_TIME_BUDGET_MS = 25_000;
// BFS 爬取每页超时（收紧以适配时间预算）
const CRAWL_PAGE_TIMEOUT_MS = 8_000;
// BFS 页面间延迟
const CRAWL_INTER_PAGE_DELAY_MS = 150;
// BFS 最大爬取页数（时间预算内安全值）
const CRAWL_MAX_PAGES = 80;

const DEFAULT_OPTIONS: CrawlOptions = {
  maxPages: 500,
  excludePaths: [
    // 后台/管理/账户（必排）
    "/admin", "/login", "/wp-admin", "/wp-login", "/dashboard", "/cpanel",
    "/account", "/my-account", "/signin", "/signup", "/register",
    // 法律/合规页面（内容少、无价值）
    "/privacy", "/terms", "/cookie", "/legal", "/gdpr", "/disclaimer",
    "/imprint", "/unsubscribe",
    // Sitemap/RSS（非用户页面）
    "/sitemap", "/feed", "/rss",
    // WordPress 内部（非内容页）
    "/wp-content", "/wp-includes", "/wp-json", "/cdn-cgi",
    // 搜索/过滤/排序（动态页面，重复内容多）
    "/search", "/?s=", "/?q=",
    // 媒体/下载（非文本内容）
    "/downloads/", "/download/",
    // 电商购物车/结账（非内容）
    "/cart", "/checkout",
  ],
  timeout: CRAWL_PAGE_TIMEOUT_MS,
};

// 跳过的文件扩展名
const SKIP_EXTENSIONS = new Set([
  ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
  ".jpg", ".jpeg", ".png", ".gif", ".svg", ".webp", ".ico", ".bmp",
  ".mp4", ".mp3", ".avi", ".mov", ".wmv", ".flv", ".wav",
  ".zip", ".rar", ".gz", ".tar", ".7z",
  ".css", ".js", ".json", ".xml", ".txt", ".csv",
  ".woff", ".woff2", ".ttf", ".eot",
]);

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// ==================== 主函数 ====================

/**
 * 发现网站所有页面
 *
 * 1. 先尝试 sitemap.xml
 * 2. sitemap 不可用则 BFS 爬取首页链接
 *
 * 返回去重后的 URL 列表
 */
export async function discoverPages(
  rootUrl: string,
  options: Partial<CrawlOptions> = {}
): Promise<{ urls: string[]; method: "sitemap" | "crawl" }> {
  const discoveryStart = Date.now();
  const opts = { ...DEFAULT_OPTIONS, ...options };

  // 规范化根 URL
  const normalizedRoot = normalizeUrl(rootUrl);
  const rootOrigin = new URL(normalizedRoot).origin;
  const rootHostname = new URL(normalizedRoot).hostname;

  // 1. 尝试 sitemap（sitemap 解析内部有逐 URL 10s 超时）
  const sitemapElapsed = Date.now() - discoveryStart;
  if (sitemapElapsed < DISCOVERY_TIME_BUDGET_MS - 5_000) {
    const sitemapUrls = await parseSitemap(normalizedRoot);
    if (sitemapUrls.length > 0) {
      // Vercel/Netlify 自定义域名兼容：sitemap 中的 URL 可能使用部署域名
      // (如 xxx.vercel.app) 而非用户输入的自定义域名 (如 www.example.com)
      // 检测：如果 sitemap URL 全部不匹配 rootHostname，尝试重写
      const matchingCount = sitemapUrls.filter(u => {
        try { return new URL(u).hostname === rootHostname; } catch { return false; }
      }).length;

      let finalUrls: string[];
      if (matchingCount === 0 && sitemapUrls.length > 0) {
        // 所有 sitemap URL 使用了不同的 hostname — 重写为 rootOrigin
        console.log(`[discoverPages] Sitemap URLs use different hostname, rewriting to ${rootOrigin}`);
        finalUrls = sitemapUrls.map(u => {
          try {
            const parsed = new URL(u);
            parsed.protocol = new URL(rootOrigin).protocol;
            parsed.hostname = rootHostname;
            parsed.port = new URL(rootOrigin).port;
            return parsed.href;
          } catch {
            return u;
          }
        });
      } else {
        finalUrls = sitemapUrls;
      }

      const filtered = filterUrls(finalUrls, rootHostname, opts);
      if (filtered.length > 0) {
        return {
          urls: filtered.slice(0, opts.maxPages),
          method: "sitemap",
        };
      }
    }
  }

  // 2. BFS 链接爬取（限时 + 限量）
  const remainingMs = DISCOVERY_TIME_BUDGET_MS - (Date.now() - discoveryStart);
  if (remainingMs <= 3_000) {
    console.warn(`[discoverPages] Insufficient time budget for BFS crawl (${remainingMs}ms remaining), returning empty`);
    return { urls: [], method: "crawl" };
  }

  const bfsOpts = { ...opts, maxPages: Math.min(opts.maxPages, CRAWL_MAX_PAGES) };
  const crawledUrls = await crawlLinks(normalizedRoot, rootHostname, bfsOpts, discoveryStart);
  return {
    urls: crawledUrls.slice(0, opts.maxPages),
    method: "crawl",
  };
}

// ==================== Sitemap 解析 ====================

/**
 * 解析 sitemap.xml，支持 sitemap index
 * 优先从 robots.txt 获取 sitemap 路径，然后尝试常见位置
 */
async function parseSitemap(rootUrl: string): Promise<string[]> {
  const origin = new URL(rootUrl).origin;
  const urls: string[] = [];

  // 收集所有可能的 sitemap 路径（去重）
  const sitemapPaths: string[] = [];

  // 0. 从 robots.txt 发现 sitemap 路径（最权威）
  try {
    const robotsRes = await fetch(`${origin}/robots.txt`, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(5000),
    });
    if (robotsRes.ok) {
      const robotsText = await robotsRes.text();
      const sitemapMatches = robotsText.matchAll(/Sitemap:\s*(.+)/gi);
      for (const match of sitemapMatches) {
        const sitemapUrl = match[1].trim();
        if (sitemapUrl) sitemapPaths.push(new URL(sitemapUrl).pathname);
      }
    }
  } catch {
    // robots.txt 不可用，继续尝试常见路径
  }

  // 1. 常见 sitemap 位置（按可能性排序）
  const commonPaths = [
    "/sitemap.xml",
    "/sitemap_index.xml",
    "/sitemap-index.xml",
    "/sitemap.xml.gz",
    "/sitemap1.xml",
    "/sitemaps/sitemap.xml",
    "/wp-sitemap.xml",            // WordPress 5.5+
    "/post-sitemap.xml",          // Yoast SEO
    "/page-sitemap.xml",          // Yoast SEO
    "/product-sitemap.xml",       // WooCommerce
    "/news-sitemap.xml",
    "/video-sitemap.xml",
    "/image-sitemap.xml",
    "/en-sitemap.xml",            // 多语言
    "/zh-sitemap.xml",
    "/sitemap/sitemap.xml",
    "/static/sitemap.xml",        // Next.js / Gatsby
    "/_next/static/sitemap.xml",   // Next.js
    "/feed/sitemap.xml",
  ];

  for (const p of commonPaths) {
    if (!sitemapPaths.includes(p)) {
      sitemapPaths.push(p);
    }
  }

  // 尝试每个 sitemap 路径
  for (const path of sitemapPaths) {
    try {
      const sitemapUrl = path.startsWith("http") ? path : `${origin}${path}`;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      const res = await fetch(sitemapUrl, {
        signal: controller.signal,
        headers: { "User-Agent": USER_AGENT },
      });

      clearTimeout(timeoutId);

      if (!res.ok) continue;

      const xml = await res.text();

      // 检查是否是 sitemap index（包含多个 sitemap）
      if (xml.includes("<sitemapindex")) {
        const childSitemaps = extractSitemapIndexUrls(xml);
        for (const childUrl of childSitemaps.slice(0, 10)) {
          // 放宽到最多 10 个子 sitemap
          const childUrls = await fetchSingleSitemap(childUrl);
          urls.push(...childUrls);
        }
      } else {
        // 普通 sitemap
        const pageUrls = extractSitemapUrls(xml);
        urls.push(...pageUrls);
      }

      if (urls.length > 0) break; // 找到有效 sitemap 就停止
    } catch {
      // 尝试下一个路径
      continue;
    }
  }

  return [...new Set(urls)];
}

/**
 * 从 sitemap index 提取子 sitemap URL
 */
function extractSitemapIndexUrls(xml: string): string[] {
  const urls: string[] = [];
  const $ = cheerio.load(xml, { xml: true });
  $("sitemap > loc").each((_, el) => {
    const loc = $(el).text().trim();
    if (loc) urls.push(loc);
  });
  return urls;
}

/**
 * 从单个 sitemap 提取页面 URL
 */
function extractSitemapUrls(xml: string): string[] {
  const urls: string[] = [];
  const $ = cheerio.load(xml, { xml: true });
  $("url > loc").each((_, el) => {
    const loc = $(el).text().trim();
    if (loc) urls.push(loc);
  });
  return urls;
}

/**
 * 获取并解析单个子 sitemap
 */
async function fetchSingleSitemap(url: string): Promise<string[]> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": USER_AGENT },
    });

    clearTimeout(timeoutId);

    if (!res.ok) return [];

    const xml = await res.text();
    return extractSitemapUrls(xml);
  } catch {
    return [];
  }
}

// ==================== BFS 链接爬取 ====================

/**
 * BFS 广度优先爬取站内链接
 */
async function crawlLinks(
  startUrl: string,
  rootHostname: string,
  opts: CrawlOptions,
  discoveryStart: number = Date.now()
): Promise<string[]> {
  const visited = new Set<string>();
  const queue: string[] = [startUrl];
  const discovered: string[] = [];

  visited.add(normalizeUrl(startUrl));

  while (queue.length > 0 && discovered.length < opts.maxPages) {
    // 时间预算检查
    const elapsed = Date.now() - discoveryStart;
    if (elapsed > DISCOVERY_TIME_BUDGET_MS - 2_000) {
      console.warn(`[crawlLinks] Time budget exhausted after ${discovered.length} pages (${elapsed}ms), stopping BFS`);
      break;
    }

    const currentUrl = queue.shift()!;
    discovered.push(currentUrl);

    // 延迟避免被封
    if (discovered.length > 1) {
      await delay(CRAWL_INTER_PAGE_DELAY_MS);
    }

    try {
      const links = await extractPageLinks(currentUrl, rootHostname, opts);

      for (const link of links) {
        const normalized = normalizeUrl(link);
        if (!visited.has(normalized) && discovered.length + queue.length < opts.maxPages) {
          visited.add(normalized);

          // 过滤检查
          if (shouldIncludeUrl(normalized, rootHostname, opts)) {
            queue.push(normalized);
          }
        }
      }
    } catch {
      // 单页失败不影响整体
      continue;
    }
  }

  return discovered;
}

/**
 * 从 HTML 字符串中提取所有站内链接（供 cron 增量发现复用）
 */
export function extractLinksFromHtml(
  html: string,
  baseUrl: string,
  rootHostname: string,
  opts: Partial<CrawlOptions> = {}
): string[] {
  const mergedOpts = { ...DEFAULT_OPTIONS, ...opts };
  const $ = cheerio.load(html);
  const links: string[] = [];

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;

    try {
      const resolved = new URL(href, baseUrl).href;
      const parsedLink = new URL(resolved);

      // 仅保留同域名链接
      if (parsedLink.hostname === rootHostname) {
        const normalized = normalizeUrl(resolved);
        if (shouldIncludeUrl(normalized, rootHostname, mergedOpts)) {
          links.push(normalized);
        }
      }
    } catch {
      // 无效 URL，跳过
    }
  });

  return [...new Set(links)];
}

/**
 * 从路径中检测语言前缀
 * 支持: /en/xxx, /zh/xxx, /zh-CN/xxx, /fr/xxx 等
 */
export function detectLanguagePrefix(pathname: string): string | null {
  const match = pathname.match(/^\/([a-z]{2}(-[A-Z]{2})?)\//);
  return match ? match[1].toLowerCase() : null;
}

/**
 * 检查 URL 是否匹配指定语言前缀
 */
export function matchesLanguagePrefix(url: string, langPrefix: string | null): boolean {
  if (!langPrefix) return true; // 无语言前缀，全部通过
  try {
    const parsed = new URL(url);
    // 根路径始终通过
    if (parsed.pathname === "/" || parsed.pathname === "") return true;
    // 匹配语言前缀路径
    return parsed.pathname.startsWith(`/${langPrefix}/`) ||
           parsed.pathname === `/${langPrefix}`;
  } catch {
    return true;
  }
}

/**
 * 提取页面中的所有站内链接（BFS 爬取用，会发起 HTTP 请求）
 */
async function extractPageLinks(
  url: string,
  rootHostname: string,
  opts: CrawlOptions
): Promise<string[]> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), opts.timeout);

    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.5",
      },
    });

    clearTimeout(timeoutId);

    if (!res.ok) return [];

    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("text/html")) return [];

    const html = await res.text();
    return extractLinksFromHtml(html, url, rootHostname, opts);
  } catch {
    return [];
  }
}

// ==================== 工具函数 ====================

/**
 * URL 标准化（去重用）
 */
export function normalizeUrl(url: string): string {
  try {
    // 自动补全协议
    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      url = `https://${url}`;
    }

    const parsed = new URL(url);

    // 移除 fragment
    parsed.hash = "";

    // 移除尾部斜杠（非根路径）
    if (parsed.pathname !== "/" && parsed.pathname.endsWith("/")) {
      parsed.pathname = parsed.pathname.slice(0, -1);
    }

    // 小写化 hostname
    return parsed.href;
  } catch {
    return url;
  }
}

/**
 * 检查 URL 是否应该被包含
 */
function shouldIncludeUrl(
  url: string,
  rootHostname: string,
  opts: CrawlOptions
): boolean {
  try {
    const parsed = new URL(url);

    // 同域名检查
    if (parsed.hostname !== rootHostname) return false;

    // 扩展名检查
    const ext = getExtension(parsed.pathname);
    if (ext && SKIP_EXTENSIONS.has(ext)) return false;

    // 排除路径检查
    if (opts.excludePaths) {
      for (const excludePath of opts.excludePaths) {
        if (parsed.pathname.startsWith(excludePath)) return false;
      }
    }

    // 排除锚点链接和 javascript:
    if (url.startsWith("javascript:") || url.startsWith("mailto:") || url.startsWith("tel:")) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * 过滤 URL 列表
 */
function filterUrls(urls: string[], rootHostname: string, opts: CrawlOptions): string[] {
  const seen = new Set<string>();
  const filtered: string[] = [];

  for (const url of urls) {
    const normalized = normalizeUrl(url);
    if (!seen.has(normalized) && shouldIncludeUrl(normalized, rootHostname, opts)) {
      seen.add(normalized);
      filtered.push(normalized);
    }
  }

  return filtered;
}

/**
 * 提取 URL 路径的文件扩展名
 */
function getExtension(pathname: string): string | null {
  const lastDot = pathname.lastIndexOf(".");
  if (lastDot === -1 || lastDot < pathname.lastIndexOf("/")) return null;
  return pathname.slice(lastDot).toLowerCase();
}

/**
 * 延迟
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
