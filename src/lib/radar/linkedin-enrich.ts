/**
 * LinkedIn 富化模块
 *
 * 策略：
 *   1. Apollo People Search → 查找决策者姓名、职位、LinkedIn URL、邮箱
 *   2. 搜索发现 → 通过 Exa/Tavily 搜索公司 LinkedIn 页面
 *   3. 网站 HTML 提取 → 从官网解析 LinkedIn URL
 *
 * 集成点：
 *   - intelligence-enricher.ts：在收集完基本信息后补充 LinkedIn 数据
 */

import { resolveApiKey } from '@/lib/services/api-key-resolver';
import { safeFetch } from '@/lib/ssrf';

// ==================== 类型定义 ====================

export interface LinkedInPerson {
  name: string;
  title: string;
  linkedInUrl: string;
  seniority?: string;
  email?: string;
  emailStatus?: string;
  companyName?: string;
}

export interface LinkedInCompanyInfo {
  linkedInUrl: string;
  name?: string;
  industry?: string;
  companySize?: string;
  description?: string;
}

export interface LinkedInEnrichmentResult {
  companyLinkedIn: LinkedInCompanyInfo | null;
  decisionMakers: LinkedInPerson[];
  errors: string[];
}

// ==================== Apollo People Search ====================

interface ApolloPerson {
  id: string;
  first_name: string;
  last_name: string;
  title: string;
  linkedin_url?: string;
  email?: string;
  email_status?: string;
  organization_name?: string;
  seniority?: string;
  headshot_url?: string;
}

interface ApolloPeopleSearchResponse {
  people?: ApolloPerson[];
  pagination?: {
    page: number;
    per_page: number;
    total_entries: number;
    total_pages: number;
  };
}

/**
 * 通过 Apollo People Search 查找决策者
 * 
 * 搜索策略：按采购决策相关职位搜索
 *   - C-level: CEO, CFO, CTO, COO
 *   - VP/Director: VP of Sales, Director of Procurement
 *   - Manager: Purchasing Manager, Procurement Manager, Supply Chain Manager
 */
async function searchApolloPeople(
  companyName: string,
  country?: string | null,
  maxResults: number = 10
): Promise<LinkedInPerson[]> {
  try {
    const apiKey = process.env.APOLLO_API_KEY?.trim();
    if (!apiKey) return [];

    // 采购决策相关职位关键词
    const decisionMakerTitles = [
      'CEO', 'Founder', 'Owner', 'Managing Director', 'General Manager',
      'VP of Sales', 'VP of Procurement', 'VP of Supply Chain',
      'Director of Purchasing', 'Director of Procurement', 'Director of Supply Chain',
      'Purchasing Manager', 'Procurement Manager', 'Sourcing Manager',
      'Supply Chain Manager', 'Import Manager', 'Export Manager',
      'Head of Procurement', 'Head of Purchasing', 'Head of Supply Chain',
    ];

    const body: Record<string, unknown> = {
      q_organization_name: companyName,
      person_titles: decisionMakerTitles,
      per_page: Math.min(maxResults, 25),
      page: 1,
    };

    if (country) {
      body.organization_locations = [country];
    }

    const response = await fetch('https://api.apollo.io/api/v1/mixed_people/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      console.warn(`[LinkedInEnrich] Apollo People Search error ${response.status}`);
      return [];
    }

    const data = (await response.json()) as ApolloPeopleSearchResponse;

    return (data.people || []).map(p => ({
      name: [p.first_name, p.last_name].filter(Boolean).join(' '),
      title: p.title || '',
      linkedInUrl: p.linkedin_url || '',
      seniority: p.seniority,
      email: p.email,
      emailStatus: p.email_status,
      companyName: p.organization_name,
    }));
  } catch (error) {
    console.warn('[LinkedInEnrich] Apollo People Search failed:', 
      error instanceof Error ? error.message : error);
    return [];
  }
}

// ==================== 搜索发现 LinkedIn 页面 ====================

interface ExaSearchResult {
  title?: string;
  url?: string;
}

interface ExaSearchResponse {
  results?: ExaSearchResult[];
}

/**
 * 通过 Exa 搜索公司 LinkedIn 页面
 */
async function searchCompanyLinkedIn(
  companyName: string
): Promise<string | null> {
  try {
    const apiKey = await resolveApiKey('exa');
    if (!apiKey) return null;

    const response = await fetch('https://api.exa.ai/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        query: `${companyName} site:linkedin.com/company`,
        numResults: 3,
        type: 'auto',
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) return null;

    const data = (await response.json()) as ExaSearchResponse;

    for (const result of data.results || []) {
      const url = result.url || '';
      // 匹配 LinkedIn 公司页面: linkedin.com/company/xxx
      const match = url.match(/linkedin\.com\/company\/([^/?&#]+)/i);
      if (match) {
        return url;
      }
    }
    
    return null;
  } catch (error) {
    console.warn('[LinkedInEnrich] Company LinkedIn search failed:', 
      error instanceof Error ? error.message : error);
    return null;
  }
}

// ==================== 网站 HTML 提取 LinkedIn ====================

/**
 * 从网站 HTML 中提取 LinkedIn URL
 */
async function extractLinkedInFromWebsite(websiteUrl: string): Promise<string | null> {
  try {
    const response = await safeFetch(websiteUrl, {
      headers: {
        'User-Agent': 'VertaxRadarBot/1.0 (+https://vertax.com)',
      },
      signal: AbortSignal.timeout(12_000),
    });

    if (!response.ok) return null;

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text/html')) return null;

    const html = await response.text();
    
    // 匹配 LinkedIn 公司页面 URL
    const linkedInMatch = html.match(
      /https?:\/\/(?:[\w-]+\.)?linkedin\.com\/company\/([^\s"'<>?#]+)/i
    );
    
    if (linkedInMatch) {
      return linkedInMatch[0];
    }

    return null;
  } catch {
    return null;
  }
}

// ==================== 统一富化入口 ====================

/**
 * 对候选公司执行 LinkedIn 富化
 * 
 * 并行执行：
 *   1. Apollo People Search → 找决策者（有 API key 时）
 *   2. 搜索 LinkedIn 公司页面
 *   3. 从网站 HTML 提取 LinkedIn
 */
export async function enrichLinkedIn(
  companyName: string,
  options: {
    domain?: string;
    country?: string | null;
    websiteUrl?: string;
    maxDecisionMakers?: number;
  } = {}
): Promise<LinkedInEnrichmentResult> {
  const result: LinkedInEnrichmentResult = {
    companyLinkedIn: null,
    decisionMakers: [],
    errors: [],
  };

  const { domain, country, websiteUrl, maxDecisionMakers = 10 } = options;

  // 并行执行搜索和提取
  const [apolloPeople, exaLinkedInUrl, websiteLinkedInUrl] = await Promise.allSettled([
    searchApolloPeople(companyName, country, maxDecisionMakers),
    searchCompanyLinkedIn(companyName),
    websiteUrl ? extractLinkedInFromWebsite(websiteUrl) : Promise.resolve(null),
  ]);

  // 处理 Apollo People 结果
  if (apolloPeople.status === 'fulfilled') {
    result.decisionMakers = apolloPeople.value;
  } else {
    result.errors.push(`Apollo People: ${apolloPeople.reason}`);
  }

  // 处理 LinkedIn 公司页面发现
  let companyLinkedInUrl: string | null = null;
  
  if (exaLinkedInUrl.status === 'fulfilled' && exaLinkedInUrl.value) {
    companyLinkedInUrl = exaLinkedInUrl.value;
  } else if (exaLinkedInUrl.status === 'rejected') {
    result.errors.push(`Exa LinkedIn search: ${exaLinkedInUrl.reason}`);
  }

  if (!companyLinkedInUrl && websiteLinkedInUrl.status === 'fulfilled' && websiteLinkedInUrl.value) {
    companyLinkedInUrl = websiteLinkedInUrl.value;
  }

  if (companyLinkedInUrl) {
    result.companyLinkedIn = {
      linkedInUrl: companyLinkedInUrl,
    };
  }

  // 从 Apollo People 结果中补充公司 LinkedIn URL
  if (!result.companyLinkedIn) {
    const personWithCompany = result.decisionMakers.find(
      p => p.linkedInUrl && !p.linkedInUrl.includes('/in/')
    );
    // Apollo people 结果中的 linkedin_url 可能是公司页面
    // 实际上 Apollo people 返回的是个人信息，linkedin_url 是个人主页
  }

  return result;
}

/**
 * 将 LinkedIn 富化结果转化为可合并的联系人数据
 */
export function linkedInResultToContacts(
  linkedInResult: LinkedInEnrichmentResult
): {
  companyLinkedInUrl: string | null;
  decisionMakers: Array<{
    name: string;
    title: string;
    linkedIn?: string;
    email?: string;
    emailConfidence?: number;
  }>;
} {
  return {
    companyLinkedInUrl: linkedInResult.companyLinkedIn?.linkedInUrl || null,
    decisionMakers: linkedInResult.decisionMakers.map(p => ({
      name: p.name,
      title: p.title,
      linkedIn: p.linkedInUrl || undefined,
      email: p.email,
      emailConfidence: p.emailStatus === 'verified' ? 90 : p.email ? 60 : undefined,
    })),
  };
}
