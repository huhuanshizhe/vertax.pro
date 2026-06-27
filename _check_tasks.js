const { PrismaClient } = require('@prisma/client');
const cheerio = require('cheerio');

const db = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL || "postgresql://neondb_owner:npg_LhyV0pkf5dXo@ep-ancient-cherry-aill6whf-pooler.c-4.us-east-1.aws.neon.tech/neondb?sslmode=require"
    }
  }
});

function normalizeUrl(url) {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    parsed.searchParams.sort();
    if (parsed.pathname !== "/" && parsed.pathname.endsWith("/")) {
      parsed.pathname = parsed.pathname.slice(0, -1);
    }
    return parsed.href.replace(/\/$/, "");
  } catch {
    return url;
  }
}

const NON_HTML_EXTENSIONS = [
  ".css", ".js", ".json", ".xml", ".png", ".jpg", ".jpeg", ".gif",
  ".svg", ".ico", ".woff", ".woff2", ".ttf", ".eot",
  ".pdf", ".zip", ".tar", ".gz", ".mp4", ".webm",
  ".map", ".ts", ".tsx", ".jsx", ".vue", ".scss", ".less",
];

const LOW_VALUE_URL_PATTERNS = [
  /\/(login|signin|signup|register|logout|auth|account)\/.*/i,
  /\/search/,
  /\/tag\//,
  /\/category\//,
  /\/author\//,
  /\/page\/\d+/,
  /\/wp-(admin|content|includes)/,
  /\/(cdn-cgi|assets|static|dist|build)\//,
  /\/\.well-known\//,
];

function shouldIncludeUrl(url, rootHostname, opts) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== rootHostname) return false;
    const pathname = parsed.pathname.toLowerCase();
    if (NON_HTML_EXTENSIONS.some(ext => pathname.endsWith(ext))) return false;
    if (LOW_VALUE_URL_PATTERNS.some(re => re.test(pathname))) return false;
    return true;
  } catch { return false; }
}

function extractLinksFromHtml(html, baseUrl, rootHostname) {
  const $ = cheerio.load(html);
  const links = [];
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    try {
      const resolved = new URL(href, baseUrl).href;
      const parsedLink = new URL(resolved);
      if (parsedLink.hostname === rootHostname) {
        const normalized = normalizeUrl(resolved);
        if (shouldIncludeUrl(normalized, rootHostname, {})) {
          links.push(normalized);
        }
      }
    } catch {}
  });
  return [...new Set(links)];
}

async function main() {
  const pageUrl = "https://www.farmetra.com/";
  const rootHostname = "www.farmetra.com";
  
  console.log("Fetching raw HTML from:", pageUrl);
  const rawRes = await fetch(pageUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      Accept: "text/html,application/xhtml+xml",
    },
    signal: AbortSignal.timeout(15000),
  });
  
  console.log("Status:", rawRes.status);
  console.log("Content-Type:", rawRes.headers.get("content-type"));
  
  const html = await rawRes.text();
  console.log("HTML length:", html.length);
  
  const links = extractLinksFromHtml(html, pageUrl, rootHostname);
  console.log("\nExtracted links:", links.length);
  console.log(links);
  
  await db.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
