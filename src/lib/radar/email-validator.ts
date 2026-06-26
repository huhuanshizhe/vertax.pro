/**
 * 邮箱验证管线
 *
 * 多层级验证策略：
 *   1. Hunter.io Email Verifier API（最准确，有 score）
 *   2. MX DNS 记录验证（免费，无需 API key）
 *   3. 格式正则校验（兜底）
 *
 * 集成点：
 *   - intelligence-enricher.ts：在收集完所有邮箱后批量验证
 */

import { promises as dnsPromises } from 'node:dns';

// ==================== 类型定义 ====================

export interface EmailValidationResult {
  email: string;
  isValid: boolean;
  score: number;           // 0-100，越高越可信
  status: string;          // valid | invalid | risky | unknown
  method: 'hunter' | 'mx' | 'regex' | 'none';
  didYouMean?: string;     // Hunter 提供的修正建议
  mxRecords?: string[];    // MX 记录
  error?: string;
}

export interface BatchValidationResult {
  results: EmailValidationResult[];
  summary: {
    total: number;
    valid: number;
    invalid: number;
    risky: number;
    unknown: number;
  };
}

// ==================== Hunter 邮箱验证 ====================

interface HunterVerifyResponse {
  data: {
    email: string;
    status: string;        // valid | invalid | risky | unknown
    score: number;         // 0-100
    did_you_mean?: string;
    regexp: boolean;
    gibberish: boolean;
    disposable: boolean;
    webmail: boolean;
    mx_records: boolean;
    smtp_server: boolean;
    smtp_check: boolean;
    accept_all: boolean;
  };
}

async function verifyViaHunter(email: string): Promise<EmailValidationResult | null> {
  try {
    const apiKey = process.env.HUNTER_API_KEY?.trim();
    if (!apiKey) return null;

    const params = new URLSearchParams({ email, api_key: apiKey });
    const response = await fetch(`https://api.hunter.io/v2/email-verifier?${params}`, {
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      console.warn(`[EmailValidator] Hunter API error ${response.status} for ${email}`);
      return null;
    }

    const { data } = (await response.json()) as HunterVerifyResponse;

    return {
      email,
      isValid: data.status === 'valid',
      score: data.score,
      status: data.status,
      method: 'hunter',
      didYouMean: data.did_you_mean,
    };
  } catch (error) {
    console.warn(`[EmailValidator] Hunter verify failed for ${email}:`, 
      error instanceof Error ? error.message : error);
    return null;
  }
}

// ==================== MX 记录验证 ====================

async function verifyViaMX(email: string): Promise<EmailValidationResult | null> {
  try {
    const domain = email.split('@')[1]?.toLowerCase();
    if (!domain) return null;

    const mxRecords = await dnsPromises.resolveMx(domain);
    
    if (mxRecords && mxRecords.length > 0) {
      return {
        email,
        isValid: true,
        score: 70,
        status: 'valid',
        method: 'mx',
        mxRecords: mxRecords.map(r => r.exchange),
      };
    }

    return {
      email,
      isValid: false,
      score: 20,
      status: 'invalid',
      method: 'mx',
      mxRecords: [],
    };
  } catch {
    // DNS 解析失败（可能是网络问题），不算 invalid
    return {
      email,
      isValid: true,  // 宽松处理：DNS 失败不判死
      score: 50,
      status: 'risky',
      method: 'mx',
      error: 'DNS resolution failed',
    };
  }
}

// ==================== 格式验证（兜底） ====================

function verifyViaRegex(email: string): EmailValidationResult {
  const basicValid = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
  const noDisposable = !/(mailinator|guerrillamail|tempmail|10minute|throwaway|yopmail|sharklasers|trashmail)\./i.test(email);
  const noRoleAccount = !/^(admin|info|support|sales|contact|hello|marketing|hr|jobs|careers|noreply|no-reply|help|service|billing|office|team|press|media|webmaster|postmaster|abuse|security)@/i.test(email);

  const isValid = basicValid && noDisposable && noRoleAccount;
  
  return {
    email,
    isValid,
    score: isValid ? 40 : 10,
    status: isValid ? 'valid' : 'invalid',
    method: 'regex',
  };
}

// ==================== 统一验证入口 ====================

/**
 * 验证单个邮箱（多层级 fallback）
 * 
 * 策略：
 *   1. 有 Hunter key → Hunter 验证（最准确）
 *   2. Hunter 失败/无 key → MX 记录验证
 *   3. MX 失败 → 正则格式验证
 */
export async function validateEmail(email: string): Promise<EmailValidationResult> {
  // 快速格式预检
  if (!email.includes('@') || email.length > 254) {
    return {
      email,
      isValid: false,
      score: 0,
      status: 'invalid',
      method: 'regex',
    };
  }

  // 1. 尝试 Hunter
  const hunterResult = await verifyViaHunter(email);
  if (hunterResult) return hunterResult;

  // 2. 尝试 MX 验证
  const mxResult = await verifyViaMX(email);
  if (mxResult) return mxResult;

  // 3. 兜底正则
  return verifyViaRegex(email);
}

/**
 * 批量验证邮箱（并发控制）
 */
export async function validateEmailBatch(
  emails: string[],
  concurrency: number = 5
): Promise<BatchValidationResult> {
  const uniqueEmails = [...new Set(emails.filter(Boolean))];

  if (uniqueEmails.length === 0) {
    return {
      results: [],
      summary: { total: 0, valid: 0, invalid: 0, risky: 0, unknown: 0 },
    };
  }

  // 分批并发
  const results: EmailValidationResult[] = [];
  for (let i = 0; i < uniqueEmails.length; i += concurrency) {
    const batch = uniqueEmails.slice(i, i + concurrency);
    const batchResults = await Promise.all(batch.map(validateEmail));
    results.push(...batchResults);
  }

  // 汇总
  const summary = {
    total: results.length,
    valid: results.filter(r => r.isValid).length,
    invalid: results.filter(r => !r.isValid && r.status === 'invalid').length,
    risky: results.filter(r => r.status === 'risky').length,
    unknown: results.filter(r => r.status === 'unknown').length,
  };

  return { results, summary };
}

/**
 * 从验证结果中获取高分邮箱（推荐使用）
 */
export function pickBestEmails(
  results: EmailValidationResult[],
  minScore: number = 70,
  maxCount: number = 5
): EmailValidationResult[] {
  return results
    .filter(r => r.isValid && r.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxCount);
}
