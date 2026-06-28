/**
 * AI 生成评分配置
 *
 * 基于企业画像自动生成匹配的评分规则
 */

import { chatCompletion } from "@/lib/ai-client";
import type { ScoringProfile } from "@/types/scoring-profile";
import type { CompanyProfile } from "@prisma/client";

const SCORING_PROFILE_SYSTEM_PROMPT = `你是一个B2B出海获客专家。基于企业画像，生成客户评分配置。

评分配置用于自动评估潜在客户的质量，决定哪些客户值得优先跟进。

你需要生成：
1. 正面信号（positiveSignals）：什么样的客户是好客户
   - 每个信号包含：名称、关键词列表、权重(1-5)、描述、分类
   - 关键词要具体、可匹配，包含中英文
   - 权重越高表示越重要

2. 负面信号（negativeSignals）：什么样的客户应该排除
   - 每个信号包含：名称、关键词列表、描述、分类
   - 关键词要能准确识别非目标客户

3. 联系人评分（contactScoring）：联系人信息完整度加分
   - hasWebsite: 有网站加分
   - hasPhone: 有电话加分
   - hasEmail: 有邮箱加分

4. 渠道评分（channelScoring）：不同来源的信号强度
   - tender/ungm/ted/sam_gov: 招标信号（最高）
   - google_places/ai_search/apollo: 企业发现
   - directory/hunter: 其他来源

5. 分级阈值（thresholds）：
   - tierA: A级客户最低分数
   - tierB: B级客户最低分数

要求：
- 基于企业的核心产品、技术优势、目标行业生成匹配的评分规则
- 关键词要具体、实用，避免过于宽泛
- 正面信号 3-5 个，负面信号 2-3 个
- 权重分配要合理，最重要的信号权重最高
- 只输出 JSON，不要有其他文字`;

/**
 * 基于企业画像生成评分配置
 */
export async function generateScoringProfile(
  companyProfile: Pick<CompanyProfile,
    | 'companyName'
    | 'companyIntro'
    | 'coreProducts'
    | 'techAdvantages'
    | 'targetIndustries'
    | 'buyerPersonas'
  >
): Promise<ScoringProfile> {
  const context = buildCompanyContext(companyProfile);

  const response = await chatCompletion(
    [
      { role: "system", content: SCORING_PROFILE_SYSTEM_PROMPT },
      {
        role: "user",
        content: `请基于以下企业画像，生成客户评分配置：\n\n${context}`,
      },
    ],
    {
      model: "qwen-plus",
      temperature: 0.3,
      maxTokens: 2048,
      timeout: 60,
    }
  );

  // 提取 JSON
  let jsonStr = response.content.trim();
  const codeBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    jsonStr = codeBlockMatch[1].trim();
  } else {
    // 尝试提取 JSON 对象
    const objectStart = jsonStr.indexOf("{");
    if (objectStart > 0) {
      jsonStr = jsonStr.slice(objectStart);
    }
  }

  try {
    const profile = JSON.parse(jsonStr) as ScoringProfile;

    // 验证和补充默认值
    return validateAndCompleteProfile(profile);
  } catch (error) {
    console.error('[generateScoringProfile] Failed to parse AI response:', error);
    throw new Error('AI 生成的评分配置格式异常');
  }
}

function buildCompanyContext(
  profile: Pick<CompanyProfile,
    | 'companyName'
    | 'companyIntro'
    | 'coreProducts'
    | 'techAdvantages'
    | 'targetIndustries'
    | 'buyerPersonas'
  >
): string {
  const sections: string[] = [];

  if (profile.companyName) {
    sections.push(`公司名称：${profile.companyName}`);
  }

  if (profile.companyIntro) {
    sections.push(`公司简介：${profile.companyIntro}`);
  }

  const coreProducts = profile.coreProducts as Array<{ name: string; description?: string }> | null;
  if (coreProducts && coreProducts.length > 0) {
    sections.push('\n【核心产品/服务】');
    for (const p of coreProducts) {
      sections.push(`- ${p.name}${p.description ? `: ${p.description}` : ''}`);
    }
  }

  const techAdvantages = profile.techAdvantages as Array<{ title: string; description?: string }> | null;
  if (techAdvantages && techAdvantages.length > 0) {
    sections.push('\n【技术优势】');
    for (const t of techAdvantages) {
      sections.push(`- ${t.title}${t.description ? `: ${t.description}` : ''}`);
    }
  }

  const targetIndustries = profile.targetIndustries as string[] | null;
  if (targetIndustries && targetIndustries.length > 0) {
    sections.push(`\n【目标行业】${targetIndustries.join('、')}`);
  }

  const buyerPersonas = profile.buyerPersonas as Array<{ role: string; title?: string; concerns?: string[] }> | null;
  if (buyerPersonas && buyerPersonas.length > 0) {
    sections.push('\n【典型买家角色】');
    for (const p of buyerPersonas) {
      sections.push(`- ${p.role}${p.title ? ` (${p.title})` : ''}`);
    }
  }

  return sections.join('\n');
}

function validateAndCompleteProfile(profile: any): ScoringProfile {
  // 确保必需字段存在
  const validated: ScoringProfile = {
    positiveSignals: Array.isArray(profile.positiveSignals)
      ? profile.positiveSignals.map((s: any) => ({
          id: s.id || `signal-${Math.random().toString(36).slice(7)}`,
          name: s.name || '未命名信号',
          keywords: Array.isArray(s.keywords) ? s.keywords : [],
          weight: typeof s.weight === 'number' ? s.weight : 3,
          description: s.description || '',
          category: s.category || '其他',
        }))
      : [],

    negativeSignals: Array.isArray(profile.negativeSignals)
      ? profile.negativeSignals.map((s: any) => ({
          id: s.id || `negative-${Math.random().toString(36).slice(7)}`,
          name: s.name || '未命名信号',
          keywords: Array.isArray(s.keywords) ? s.keywords : [],
          description: s.description || '',
          category: s.category || '其他',
        }))
      : [],

    contactScoring: {
      hasWebsite: profile.contactScoring?.hasWebsite ?? 2,
      hasPhone: profile.contactScoring?.hasPhone ?? 1,
      hasEmail: profile.contactScoring?.hasEmail ?? 1,
    },

    channelScoring: {
      tender: profile.channelScoring?.tender ?? 5,
      ungm: profile.channelScoring?.ungm ?? 6,
      ted: profile.channelScoring?.ted ?? 5,
      sam_gov: profile.channelScoring?.sam_gov ?? 6,
      google_places: profile.channelScoring?.google_places ?? 2,
      ai_search: profile.channelScoring?.ai_search ?? 2,
      apollo_org_search: profile.channelScoring?.apollo_org_search ?? 3,
      directory: profile.channelScoring?.directory ?? 1,
      hunter: profile.channelScoring?.hunter ?? 1,
    },

    thresholds: {
      tierA: profile.thresholds?.tierA ?? 8,
      tierB: profile.thresholds?.tierB ?? 5,
    },

    targetCountryBonus: profile.targetCountryBonus ?? 1,
    baseScore: profile.baseScore ?? 0,
  };

  return validated;
}
