/**
 * Firecrawl 联系人补全模块
 *
 * 使用 Firecrawl API 替代裸 fetch() 抓取官网，
 * 解决了 JS 渲染、反爬、结构化提取三大痛点。
 *
 * 管线：
 *   1. discoverContactsPages(websiteUrl) → Firecrawl /v2/map 发现联系页面
 *   2. scrapePages(urls) → Firecrawl /v2/scrape 批量抓取 Markdown
 *   3. extractContactsFromMarkdown(markdown) → AI (qwen3.7-plus) 结构化提取
 *   4. enrichCompanyContacts(websiteUrl, companyName) → 编排器
 *
 * 集成点：
 *   - intelligence-enricher.ts：替换 WebsiteContactScraper 的裸 fetch
 *   - prospect-company-enrichment.ts：作为联系人提取的新来源
 */

import { resolveApiKey } from '@/lib/services/api-key-resolver';
import { chatCompletion } from '@/lib/ai-client';
import type {
  PhoneContact,
  EmailContact,
  AddressContact,
  ContactForm,
  Capabilities,
  ContactSourceType,
} from '@/lib/osint/contact-enrichment/types';

// ==================== 常量 ====================

const FIRECRAWL_BASE_URL = 'https://api.firecrawl.dev/v2';
const DEFAULT_TIMEOUT_MS = 30_000;
const CONTACT_PAGE_PATHS = [
  '/contact', '/contact-us', '/about', '/about-us', '/team',
  '/our-team', '/leadership', '/management', '/locations',
  '/offices', '/global', '/get-in-touch', '/inquiry',
  '/request-quote', '/quote', '/support', '/help',
];

// ==================== 类型定义 ====================

export interface FirecrawlContactResult {
  /** 提取的联系电话 */
  phones: PhoneContact[];
  /** 提取的邮箱 */
  emails: EmailContact[];
  /** 提取的地址 */
  addresses: AddressContact[];
  /** 发现的可抓取联系页面 URL */
  contactPageUrls: string[];
  /** 提取的联系表单 */
  forms: ContactForm[];
  /** 公司能力描述 */
  capabilities: Capabilities | null;
  /** 原始数据来源页 */
  sourcePages: string[];
  /** 是否有错误 */
  errors: string[];
}

interface FirecrawlMapResponse {
  success: boolean;
  links?: string[];
  error?: string;
}

interface FirecrawlScrapeResponse {
  success: boolean;
  data?: {
    markdown?: string;
    html?: string;
    metadata?: {
      title?: string;
      description?: string;
      ogTitle?: string;
      ogDescription?: string;
      language?: string;
      statusCode?: number;
    };
  };
  error?: string;
}

// ==================== AI 提取 Schema ====================

const CONTACT_EXTRACTION_PROMPT = `You are a B2B contact extraction assistant. Extract ALL business contact information from the provided web page markdown content.

Return a strict JSON object with this structure:
{
  "phones": [{"value": "+1-555-123-4567", "type": "main|sales|support|service|unknown", "label": "Main Office"}],
  "emails": [{"value": "sales@company.com", "type": "role|personal|unknown", "roleType": "sales|info|support|quotes|rfq|contact|engineering", "label": "Sales Inquiries"}],
  "addresses": [{"full": "123 Main St, City, State 12345", "street": "123 Main St", "city": "City", "state": "State", "country": "US", "postalCode": "12345", "type": "headquarters|branch|warehouse|unknown"}],
  "forms": [{"url": "https://example.com/contact", "type": "contact|quote|support|inquiry", "fields": ["name", "email", "phone", "message"], "requiresLogin": false}],
  "capabilities": {"products": ["Product A"], "services": ["Service B"], "certifications": ["ISO 9001"], "industries": ["Manufacturing"], "summary": "Brief company description"}
}

Rules:
- Only extract REAL contact info from the page content. Do NOT invent or hallucinate.
- If a field is not found, return empty array/string.
- Phone: include country code if available. Detect type from context (main switchboard vs sales line).
- Email: classfy as "role" for info@/sales@, "personal" for named emails. Do NOT include noreply/no-reply/example addresses.
- Address: parse into components. Guess country from context.
- Forms: include the full URL. List field names if visible in the markdown.
- Capabilities: extract products, services, certifications, industries served.

Content to analyze:
`;

// ==================== 核心功能 ====================

/**
 * 使用 Firecrawl 发现官网的联系页面
 */
export async function discoverContactPages(
  websiteUrl: string,
): Promise<string[]> {
  const apiKey = await resolveApiKey('firecrawl');
  if (!apiKey) return CONTACT_PAGE_PATHS.map(p => `${websiteUrl}${p}`);

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

    const response = await fetch(`${FIRECRAWL_BASE_URL}/map`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        url: websiteUrl,
        search: 'contact|about|team|leadership|location|office',
        includeSubdomains: false,
        ignoreSitemap: false,
        limit: 20,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      console.warn(`[FirecrawlContact] Map failed: ${response.status}, falling back to path guessing`);
      return CONTACT_PAGE_PATHS.map(p => `${websiteUrl}${p}`);
    }

    const data = (await response.json()) as FirecrawlMapResponse;
    const contactLinks = (data.links || []).filter(link => {
      const lower = link.toLowerCase();
      return CONTACT_PAGE_PATHS.some(path => lower.includes(path.replace(/^\//, '')))
        || /contact|about|team|leadership|location|office|get-in-touch|inquiry|quote/i.test(lower);
    });

    if (contactLinks.length > 0) return contactLinks.slice(0, 10);

    return CONTACT_PAGE_PATHS.map(p => `${websiteUrl}${p}`);
  } catch (error) {
    console.warn(`[FirecrawlContact] Map error:`, error instanceof Error ? error.message : error);
    return CONTACT_PAGE_PATHS.map(p => `${websiteUrl}${p}`);
  }
}

/**
 * 使用 Firecrawl scrape 抓取单个页面
 */
export async function scrapePage(url: string): Promise<{
  success: boolean;
  markdown: string;
  title: string;
  error?: string;
}> {
  const apiKey = await resolveApiKey('firecrawl');
  if (!apiKey) {
    return { success: false, markdown: '', title: '', error: 'FIRECRAWL_API_KEY not configured' };
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

    const response = await fetch(`${FIRECRAWL_BASE_URL}/scrape`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        url,
        formats: ['markdown'],
        onlyMainContent: true,
        waitFor: 2000,
        timeout: 25000,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return { success: false, markdown: '', title: '', error: `HTTP ${response.status}` };
    }

    const data = (await response.json()) as FirecrawlScrapeResponse;
    if (!data.success || !data.data?.markdown?.trim()) {
      return { success: false, markdown: '', title: '', error: 'Empty response' };
    }

    return {
      success: true,
      markdown: data.data.markdown.trim(),
      title: data.data.metadata?.ogTitle || data.data.metadata?.title || '',
    };
  } catch (error) {
    return {
      success: false,
      markdown: '',
      title: '',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * 使用 AI 从 Markdown 中提取结构化联系人数据
 */
export async function extractContactsFromMarkdown(
  markdown: string,
  sourceUrl: string,
  sourceType: ContactSourceType = 'official_contact_page',
): Promise<{
  phones: PhoneContact[];
  emails: EmailContact[];
  addresses: AddressContact[];
  forms: ContactForm[];
  capabilities: Capabilities | null;
}> {
  const empty = {
    phones: [] as PhoneContact[],
    emails: [] as EmailContact[],
    addresses: [] as AddressContact[],
    forms: [] as ContactForm[],
    capabilities: null as Capabilities | null,
  };

  try {
    // 截断超长内容，保留足够上下文
    const truncated = markdown.slice(0, 12000);

    const aiResponse = await chatCompletion([
      { role: 'system', content: CONTACT_EXTRACTION_PROMPT },
      { role: 'user', content: truncated },
    ], { temperature: 0.1 });

    const cleaned = aiResponse.content.trim()
      .replace(/```json\s*/gi, '')
      .replace(/```\s*/g, '')
      .trim();

    const parsed = JSON.parse(cleaned);

    const baseConfidence = sourceType === 'official_contact_page' ? 100
      : sourceType === 'official_homepage' ? 95
      : sourceType === 'official_about_page' ? 90
      : 85;

    return {
      phones: (parsed.phones || []).map((p: Record<string, unknown>, i: number) => ({
        value: String(p.value || ''),
        confidence: baseConfidence,
        sources: [sourceType],
        sourceUrls: [sourceUrl],
        type: (p.type as PhoneContact['type']) || 'unknown',
        isPrimary: i === 0,
      })),
      emails: (parsed.emails || []).map((e: Record<string, unknown>, i: number) => {
        const isRoleBased = /^(info|sales|support|contact|hello|admin|office|quotes|rfq|service|marketing|hr|careers|jobs|press|media)@/i.test(String(e.value || ''));
        return {
          value: String(e.value || ''),
          confidence: baseConfidence,
          sources: [sourceType],
          sourceUrls: [sourceUrl],
          type: isRoleBased ? 'role' as const : 'personal' as const,
          roleType: isRoleBased ? (e.roleType as EmailContact['roleType']) : undefined,
          isPrimary: i === 0,
        };
      }),
      addresses: (parsed.addresses || []).map((a: Record<string, unknown>, i: number) => ({
        value: a.full ? String(a.full) : [a.street, a.city, a.state, a.country].filter(Boolean).join(', '),
        confidence: baseConfidence - 5,
        sources: [sourceType],
        sourceUrls: [sourceUrl],
        type: (a.type as AddressContact['type']) || 'unknown',
        street: a.street ? String(a.street) : undefined,
        city: a.city ? String(a.city) : undefined,
        state: a.state ? String(a.state) : undefined,
        country: a.country ? String(a.country) : undefined,
        postalCode: a.postalCode ? String(a.postalCode) : undefined,
        hasConflict: false,
        isPrimary: i === 0,
      })),
      forms: (parsed.forms || []).map((f: Record<string, unknown>) => ({
        url: String(f.url || sourceUrl),
        type: String(f.type || 'contact'),
        source: 'firecrawl',
        fields: Array.isArray(f.fields) ? f.fields.map(String) : [],
        requiresLogin: Boolean(f.requiresLogin),
      })),
      capabilities: parsed.capabilities ? {
        products: Array.isArray(parsed.capabilities.products) ? parsed.capabilities.products : [],
        services: Array.isArray(parsed.capabilities.services) ? parsed.capabilities.services : [],
        certifications: Array.isArray(parsed.capabilities.certifications) ? parsed.capabilities.certifications : [],
        industries: Array.isArray(parsed.capabilities.industries) ? parsed.capabilities.industries : [],
        summary: String(parsed.capabilities.summary || ''),
      } : null,
    };
  } catch (error) {
    console.warn(`[FirecrawlContact] AI extraction failed:`, error instanceof Error ? error.message : error);
    return empty;
  }
}

/**
 * 编排器：完整的企业联系人 Firecrawl 补全
 *
 * 流程：
 *   1. 发现联系页面 URL
 *   2. 并发抓取（最多 5 页）
 *   3. AI 从每页提取结构化数据
 *   4. 合并去重
 */
export async function enrichCompanyContacts(
  websiteUrl: string,
  companyName: string,
): Promise<FirecrawlContactResult> {
  const result: FirecrawlContactResult = {
    phones: [],
    emails: [],
    addresses: [],
    contactPageUrls: [],
    forms: [],
    capabilities: null,
    sourcePages: [],
    errors: [],
  };

  if (!websiteUrl) {
    result.errors.push('No website URL provided');
    return result;
  }

  const apiKey = await resolveApiKey('firecrawl');
  if (!apiKey) {
    // Firecrawl 不可用时优雅降级
    result.errors.push('FIRECRAWL_API_KEY not configured');
    return result;
  }

  try {
    // Step 1: 发现联系页面
    const contactPages = await discoverContactPages(websiteUrl);
    result.contactPageUrls = contactPages;

    // 首页总是包含
    const allPages = [websiteUrl, ...contactPages.filter(p => p !== websiteUrl)].slice(0, 5);

    console.log(`[FirecrawlContact] Scraping ${allPages.length} pages for ${companyName} (${websiteUrl})`);

    // Step 2: 并发抓取（限制并发为 3）
    const scrapeResults: Array<{
      url: string;
      success: boolean;
      markdown: string;
      title: string;
    }> = [];

    for (let i = 0; i < allPages.length; i += 3) {
      const batch = allPages.slice(i, i + 3);
      const batchResults = await Promise.all(
        batch.map(async (url) => {
          const scrapeResult = await scrapePage(url);
          return { url, ...scrapeResult };
        })
      );
      scrapeResults.push(...batchResults);
    }

    const successfulScrapes = scrapeResults.filter(r => r.success);
    if (successfulScrapes.length === 0) {
      result.errors.push('All page scrapes failed');
      return result;
    }

    result.sourcePages = successfulScrapes.map(r => r.url);

    // Step 3: AI 提取每页的联系人数据
    for (const scraped of successfulScrapes) {
      const sourceType: ContactSourceType =
        scraped.url === websiteUrl ? 'official_homepage'
        : scraped.url.includes('/contact') ? 'official_contact_page'
        : scraped.url.includes('/about') ? 'official_about_page'
        : scraped.url.includes('/team') ? 'official_team_page'
        : 'official_contact_page';

      const extracted = await extractContactsFromMarkdown(scraped.markdown, scraped.url, sourceType);

      // 合并（去重）
      const existingPhones = new Set(result.phones.map(p => p.value));
      for (const phone of extracted.phones) {
        if (phone.value && !existingPhones.has(phone.value)) {
          result.phones.push(phone);
          existingPhones.add(phone.value);
        }
      }

      const existingEmails = new Set(result.emails.map(e => e.value.toLowerCase()));
      for (const email of extracted.emails) {
        if (email.value && !existingEmails.has(email.value.toLowerCase())
          && !email.value.includes('example.')
          && !email.value.includes('noreply')
          && !email.value.includes('no-reply')) {
          result.emails.push(email);
          existingEmails.add(email.value.toLowerCase());
        }
      }

      const existingAddresses = new Set(result.addresses.map(a => a.value.toLowerCase()));
      for (const addr of extracted.addresses) {
        if (addr.value && !existingAddresses.has(addr.value.toLowerCase())) {
          result.addresses.push(addr);
          existingAddresses.add(addr.value.toLowerCase());
        }
      }

      result.forms.push(...extracted.forms);

      // 优先使用从 about/contact 页面提取的 capabilities
      if (extracted.capabilities && !result.capabilities) {
        result.capabilities = extracted.capabilities;
      }
    }
  } catch (error) {
    result.errors.push(error instanceof Error ? error.message : 'Unknown error');
  }

  return result;
}
