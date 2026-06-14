/**
 * 关键词反馈闭环模块
 * 
 * 在 Qualify Cron 完成后，根据 A/B 级候选触发关键词扩展
 * 形成「画像→关键词→搜索→反馈→新关键词」的飞轮
 */

import { prisma } from '@/lib/prisma';
import { 
  generateKeywords, 
  appendToKeywordPool,
  type KeywordPoolItem,
  type SearchLogItem,
} from './keyword-generator';

// ==================== 类型定义 ====================

export interface FeedbackCheckResult {
  expanded: boolean;
  newKeywords: number;
  reason?: string;
}

// ==================== 配置常量 ====================

/** 触发扩展的最小 A/B 级候选数 */
const MIN_AB_FOR_EXPANSION = 5;

/** 扩展冷却时间（天） */
const EXPANSION_COOLDOWN_DAYS = 3;

/** 最多保留的搜索日志条数 */
const MAX_SEARCH_LOG_SIZE = 500;

/** 最多保留的关键词池大小 */
const MAX_KEYWORD_POOL_SIZE = 100;

// ==================== 核心函数 ====================

/**
 * 检查是否需要扩展关键词，如果需要则触发
 */
export async function checkAndExpandKeywords(
  tenantId: string,
  profileId: string
): Promise<FeedbackCheckResult> {
  // 1. 获取 Profile
  const profile = await prisma.radarSearchProfile.findUnique({
    where: { id: profileId },
    select: {
      keywordPool: true,
      searchLog: true,
      feedbackLog: true,
      targetCountries: true,
    },
  });

  if (!profile) {
    return { expanded: false, newKeywords: 0, reason: 'Profile not found' };
  }

  // 2. 获取最近的 A/B 级候选
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const recentAB = await prisma.radarCandidate.findMany({
    where: {
      profileId,
      qualifyTier: { in: ['A', 'B'] },
      qualifiedAt: { gte: sevenDaysAgo },
    },
    select: {
      displayName: true,
      country: true,
      industry: true,
      description: true,
    },
    take: 20,
    orderBy: { qualifiedAt: 'desc' },
  });

  // 3. 检查是否达到扩展阈值
  if (recentAB.length < MIN_AB_FOR_EXPANSION) {
    return { 
      expanded: false, 
      newKeywords: 0, 
      reason: `Only ${recentAB.length} A/B candidates (need ${MIN_AB_FOR_EXPANSION})` 
    };
  }

  // 4. 检查上次扩展时间（冷却期）
  const keywordPool = (profile.keywordPool as unknown as KeywordPoolItem[]) || [];
  const aiExpansions = keywordPool.filter(k => k.source === 'ai_expansion');
  const lastExpansion = aiExpansions.length > 0
    ? new Date(Math.max(...aiExpansions.map(k => new Date(k.generatedAt).getTime())))
    : null;

  if (lastExpansion) {
    const daysSinceLastExpansion = (Date.now() - lastExpansion.getTime()) / (24 * 60 * 60 * 1000);
    if (daysSinceLastExpansion < EXPANSION_COOLDOWN_DAYS) {
      return { 
        expanded: false, 
        newKeywords: 0, 
        reason: `Last expansion was ${daysSinceLastExpansion.toFixed(1)} days ago (cooldown: ${EXPANSION_COOLDOWN_DAYS} days)` 
      };
    }
  }

  // 5. 调用 AI 生成新关键词
  const existingKeywords = keywordPool.map(k => k.keyword);
  const newKeywords = await generateKeywords(tenantId, profile.targetCountries, {
    mode: 'expansion',
    abCandidates: recentAB,
    existingKeywords,
    maxKeywords: 10,
  });

  if (newKeywords.length === 0) {
    return { expanded: false, newKeywords: 0, reason: 'AI generated no new keywords' };
  }

  // 6. 追加到关键词池
  await appendToKeywordPool(profileId, newKeywords, 'ai_expansion');

  // 7. 清理过大的数据
  await trimProfileData(profileId);

  // 8. 记录反馈日志
  await logFeedback(profileId, {
    triggeredAt: new Date().toISOString(),
    abCandidateCount: recentAB.length,
    newKeywordsGenerated: newKeywords.length,
    abSample: recentAB.slice(0, 5).map(c => c.displayName),
  });

  console.log(`[keyword-feedback] Expanded keywords: +${newKeywords.length} (from ${recentAB.length} A/B candidates)`);

  return { 
    expanded: true, 
    newKeywords: newKeywords.length,
    reason: `Generated from ${recentAB.length} A/B candidates` 
  };
}

/**
 * 记录反馈日志
 */
async function logFeedback(
  profileId: string,
  feedback: {
    triggeredAt: string;
    abCandidateCount: number;
    newKeywordsGenerated: number;
    abSample: string[];
  }
): Promise<void> {
  const profile = await prisma.radarSearchProfile.findUnique({
    where: { id: profileId },
    select: { feedbackLog: true },
  });

  if (!profile) return;

  const feedbackLog = (profile.feedbackLog as any[]) || [];
  feedbackLog.push(feedback);

  // 只保留最近 20 条
  const trimmed = feedbackLog.slice(-20);

  await prisma.radarSearchProfile.update({
    where: { id: profileId },
    data: { feedbackLog: trimmed as any },
  });
}

/**
 * 清理过大的数据（搜索日志、关键词池）
 */
async function trimProfileData(profileId: string): Promise<void> {
  const profile = await prisma.radarSearchProfile.findUnique({
    where: { id: profileId },
    select: { searchLog: true, keywordPool: true },
  });

  if (!profile) return;

  const searchLog = (profile.searchLog as unknown as SearchLogItem[]) || [];
  const keywordPool = (profile.keywordPool as unknown as KeywordPoolItem[]) || [];

  const updates: any = {};

  // 裁剪搜索日志
  if (searchLog.length > MAX_SEARCH_LOG_SIZE) {
    updates.searchLog = searchLog.slice(-MAX_SEARCH_LOG_SIZE);
  }

  // 裁剪关键词池：优先保留质量高的
  if (keywordPool.length > MAX_KEYWORD_POOL_SIZE) {
    // 按质量分排序（qualityCount / searchCount）
    const sorted = [...keywordPool].sort((a, b) => {
      const aQuality = a.searchCount > 0 ? a.qualityCount / a.searchCount : 0;
      const bQuality = b.searchCount > 0 ? b.qualityCount / b.searchCount : 0;
      return bQuality - aQuality;
    });
    updates.keywordPool = sorted.slice(0, MAX_KEYWORD_POOL_SIZE);
  }

  if (Object.keys(updates).length > 0) {
    await prisma.radarSearchProfile.update({
      where: { id: profileId },
      data: updates,
    });
  }
}

/**
 * 选择下一个要搜索的「关键词 × 国家」组合
 */
export function selectNextSearchCombo(
  keywordPool: KeywordPoolItem[],
  targetCountries: string[],
  searchLog: SearchLogItem[]
): { keyword: string; country: string; poolItem: KeywordPoolItem } | null {
  if (keywordPool.length === 0 || targetCountries.length === 0) {
    return null;
  }

  // 1. 找出未搜过的组合
  const searchedKeys = new Set(
    searchLog.map(l => `${l.keyword.toLowerCase()}|${l.country}`)
  );

  const unsearched: Array<{ keyword: string; country: string; poolItem: KeywordPoolItem }> = [];
  
  for (const item of keywordPool) {
    for (const country of targetCountries) {
      const key = `${item.keyword.toLowerCase()}|${country}`;
      if (!searchedKeys.has(key)) {
        unsearched.push({ keyword: item.keyword, country, poolItem: item });
      }
    }
  }

  if (unsearched.length === 0) {
    return null;
  }

  // 2. 优先选质量高的关键词（历史搜索中 A/B 级比例高的）
  unsearched.sort((a, b) => {
    const aQuality = a.poolItem.searchCount > 0 
      ? a.poolItem.qualityCount / a.poolItem.searchCount 
      : 0.5; // 未搜过的给默认分 0.5
    const bQuality = b.poolItem.searchCount > 0 
      ? b.poolItem.qualityCount / b.poolItem.searchCount 
      : 0.5;
    return bQuality - aQuality;
  });

  // 3. 返回第一个
  return unsearched[0];
}

/**
 * 获取搜索进度统计
 */
export function getSearchProgress(
  keywordPool: KeywordPoolItem[],
  targetCountries: string[],
  searchLog: SearchLogItem[]
): {
  totalKeywords: number;
  searchedKeywords: number;
  totalCombinations: number;
  searchedCombinations: number;
  remainingCombinations: number;
  totalResults: number;
  totalQuality: number;
} {
  const totalKeywords = keywordPool.length;
  const searchedKeywords = keywordPool.filter(k => k.searchCount > 0).length;
  const totalCombinations = totalKeywords * targetCountries.length;
  const searchedCombinations = searchLog.length;
  const remainingCombinations = totalCombinations - searchedCombinations;
  const totalResults = keywordPool.reduce((sum, k) => sum + k.resultCount, 0);
  const totalQuality = keywordPool.reduce((sum, k) => sum + k.qualityCount, 0);

  return {
    totalKeywords,
    searchedKeywords,
    totalCombinations,
    searchedCombinations,
    remainingCombinations: Math.max(0, remainingCombinations),
    totalResults,
    totalQuality,
  };
}
