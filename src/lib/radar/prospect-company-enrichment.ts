/**
 * ProspectCompany 公共 Enrichment 服务层
 *
 * 供批量导入、一次性脚本、Cron 等 ProspectCompany 场景使用。
 * 底层复用 intelligence-enricher 中的搜索/联系人能力，对外提供干净接口。
 *
 * 设计原则：
 * - 不改动 enrich-pipeline.ts (RadarCandidate 路径保持原样)
 * - 所有外部 API 调用带 AbortSignal.timeout(15s)
 * - Exa → Tavily 自动 fallback
 * - Hunter.io 邮箱补全
 */

import { prisma } from '@/lib/prisma';
import { chatCompletion } from '@/lib/ai-client';
import {
  unifiedSearch,
  hunterFindEmail,
  normalizeCompanyDomain,
  type SearchResult,
} from './intelligence-enricher';

// ==================== 类型定义 ====================

export interface ContactResult {
  name: string;
  title: string;
  email?: string | null;
  emailConfidence?: number;
  phone?: string | null;
  linkedIn?: string | null;
  source?: string;
}

export interface EnrichResult {
  success: boolean;
  website?: string | null;
  description?: string | null;
  contacts: ContactResult[];
  errors: string[];
}

// ==================== 常量 ====================

const API_TIMEOUT_MS = 15_000;

// ==================== 公共 API ====================

/**
 * 搜索公司官网
 * 链路: Exa search → Tavily fallback → AI 从结果中提取官网域名
 */
export async function searchCompanyWebsite(
  companyName: string,
  country?: string | null,
): Promise<string | null> {
  try {
    const query = `"${companyName}" official website`;
    const results = await unifiedSearch(query, 'auto', 5, country);

    if (results.length === 0) return null;

    // 尝试从搜索结果中提取最可能的官网 URL
    const website = extractOfficialWebsite(companyName, results);
    return website;
  } catch (error) {
    console.error(`[ProspectEnrich] searchCompanyWebsite failed for "${companyName}":`, error);
    return null;
  }
}

/**
 * 搜索公司联系人 (决策者)
 * 链路: Exa/Tavily 搜索 → AI 结构化提取 → Hunter.io 邮箱补全
 */
export async function searchCompanyContacts(
  companyName: string,
  domain?: string | null,
  country?: string | null,
): Promise<ContactResult[]> {
  try {
    const query = `"${companyName}" decision makers leadership "LinkedIn" contact`;
    const results = await unifiedSearch(query, 'auto', 10, country);

    if (results.length === 0) return [];

    // AI 提取联系人
    const contacts = await extractContactsFromSearch(companyName, results);

    // Hunter.io 邮箱补全
    const normalizedDomain = domain ? normalizeCompanyDomain(domain) : null;
    if (normalizedDomain && contacts.length > 0) {
      await enrichContactsWithHunter(contacts, normalizedDomain);
    }

    return contacts;
  } catch (error) {
    console.error(`[ProspectEnrich] searchCompanyContacts failed for "${companyName}":`, error);
    return [];
  }
}

/**
 * 完整的 ProspectCompany enrichment (V2 — 带 fallback)
 * 链路: searchCompanyWebsite → searchCompanyContacts → 更新 DB
 *
 * 供 batch-import cron 和 CLI 使用，替代原始 enrichProspectCompany()
 */
export async function enrichProspectCompanyV2(
  companyId: string,
  options?: { timeout?: number },
): Promise<EnrichResult> {
  const timeout = options?.timeout ?? API_TIMEOUT_MS;
  const errors: string[] = [];
  const result: EnrichResult = { success: false, contacts: [], errors };

  const company = await prisma.prospectCompany.findUnique({
    where: { id: companyId },
  });

  if (!company) {
    errors.push('Company not found');
    return result;
  }

  // 标记为进行中
  await prisma.prospectCompany.update({
    where: { id: companyId },
    data: { enrichmentStatus: 'IN_PROGRESS' },
  });

  try {
    // 1. 如果缺少官网，搜索官网
    let website = company.website;
    if (!website) {
      const foundWebsite = await withTimeout(
        searchCompanyWebsite(company.name, company.country),
        timeout,
      );
      if (foundWebsite) {
        website = foundWebsite;
        result.website = foundWebsite;
      }
    }

    // 2. 搜索联系人
    const domain = website ? normalizeCompanyDomain(website) : null;
    const contacts = await withTimeout(
      searchCompanyContacts(company.name, domain, company.country),
      timeout,
    );
    result.contacts = contacts;

    // 3. 更新数据库
    const updateData: Record<string, unknown> = {
      enrichmentStatus: 'COMPLETED',
      lastEnrichedAt: new Date(),
    };

    if (result.website && !company.website) {
      updateData.website = result.website;
    }

    await prisma.prospectCompany.update({
      where: { id: companyId },
      data: updateData,
    });

    // 4. 写入联系人
    if (contacts.length > 0) {
      for (const contact of contacts) {
        // 去重: 按 email 或 name+role 判断是否已存在
        const existingContact = await prisma.prospectContact.findFirst({
          where: {
            companyId: company.id,
            deletedAt: null,
            OR: [
              ...(contact.email ? [{ email: contact.email }] : []),
              { name: contact.name, role: contact.title },
            ],
          },
        });

        if (existingContact) continue;

        await prisma.prospectContact.create({
          data: {
            tenantId: company.tenantId,
            companyId: company.id,
            name: contact.name,
            role: contact.title,
            email: contact.email || null,
            phone: contact.phone || null,
            linkedInUrl: contact.linkedIn || null,
            status: 'new',
            notes: `AI auto-discovered via ${contact.source || 'search'}`,
          },
        });
      }
    }

    result.success = true;
    return result;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    errors.push(msg);
    console.error(`[ProspectEnrich] enrichProspectCompanyV2 failed for ${company.name}:`, error);

    await prisma.prospectCompany.update({
      where: { id: companyId },
      data: {
        enrichmentStatus: 'FAILED',
        lastEnrichedAt: new Date(),
      },
    });

    return result;
  }
}

// ==================== 内部辅助函数 ====================

/**
 * 从搜索结果中提取最可能的官网 URL
 */
function extractOfficialWebsite(
  companyName: string,
  results: SearchResult[],
): string | null {
  const nameLower = companyName.toLowerCase().replace(/[^a-z0-9]/g, '');

  for (const r of results) {
    if (!r.url) continue;

    try {
      const url = new URL(r.url);
      const domain = url.hostname.replace(/^www\./, '').toLowerCase();

      // 跳过明显的聚合站点
      if (isAggregatorDomain(domain)) continue;

      // 检查域名是否包含公司名的关键词
      const domainClean = domain.replace(/\.[^.]+$/, '').replace(/[^a-z0-9]/g, '');
      if (domainClean.includes(nameLower.slice(0, 5)) || nameLower.includes(domainClean.slice(0, 5))) {
        return `https://${domain}`;
      }
    } catch {
      continue;
    }
  }

  // fallback: 取第一个非聚合站点的结果
  for (const r of results) {
    if (!r.url) continue;
    try {
      const url = new URL(r.url);
      const domain = url.hostname.replace(/^www\./, '').toLowerCase();
      if (!isAggregatorDomain(domain)) {
        return `https://${domain}`;
      }
    } catch {
      continue;
    }
  }

  return null;
}

/**
 * 判断是否为聚合/平台站点 (非公司官网)
 */
function isAggregatorDomain(domain: string): boolean {
  const aggregators = [
    'linkedin.com', 'facebook.com', 'twitter.com', 'x.com',
    'bloomberg.com', 'crunchbase.com', 'glassdoor.com',
    'indeed.com', 'yelp.com', 'wikipedia.org', 'reddit.com',
    'youtube.com', 'instagram.com', 'tiktok.com',
    'google.com', 'bing.com', 'yahoo.com',
    'dnb.com', 'zoominfo.com', 'apollo.io',
    'amazon.com', 'alibaba.com', 'aliexpress.com',
  ];
  return aggregators.some(a => domain === a || domain.endsWith(`.${a}`));
}

/**
 * 使用 AI 从搜索结果中提取联系人信息
 */
async function extractContactsFromSearch(
  companyName: string,
  results: SearchResult[],
): Promise<ContactResult[]> {
  const context = results
    .map(r => `${r.title || ''}\n${r.text?.slice(0, 500) || ''}`)
    .join('\n\n');

  try {
    const aiResponse = await chatCompletion([
      {
        role: 'system',
        content: `Extract decision-maker contacts from search snippets for "${companyName}". Return ONLY valid JSON: {"contacts": [{"name": "...", "title": "...", "email": "...", "phone": "...", "linkedIn": "..."}]}. Only include people clearly associated with the company.`,
      },
      { role: 'user', content: context },
    ], { model: 'qwen-plus', temperature: 0.1 });

    let jsonStr = aiResponse.content.trim();
    if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
    }

    const parsed = JSON.parse(jsonStr);
    const rawContacts = parsed.contacts || parsed.decisionMakers || [];

    return rawContacts
      .filter((c: { name?: string; title?: string }) => c.name && c.title)
      .map((c: { name: string; title: string; email?: string; phone?: string; linkedIn?: string }) => ({
        name: c.name,
        title: c.title,
        email: c.email || null,
        phone: c.phone || null,
        linkedIn: c.linkedIn || null,
        source: 'search+ai',
      }));
  } catch {
    return [];
  }
}

/**
 * 使用 Hunter.io 为联系人补全邮箱
 */
async function enrichContactsWithHunter(
  contacts: ContactResult[],
  domain: string,
): Promise<void> {
  for (const contact of contacts) {
    if (contact.email) continue; // 已有邮箱则跳过

    try {
      const result = await withTimeout(
        hunterFindEmail(domain, contact.name),
        API_TIMEOUT_MS,
      );
      if (result.email) {
        contact.email = result.email;
        contact.emailConfidence = result.confidence;
      }
    } catch {
      // Hunter 超时或失败，跳过此联系人
    }
  }
}

/**
 * Promise 超时包装
 */
async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms),
  );
  return Promise.race([promise, timeout]);
}
