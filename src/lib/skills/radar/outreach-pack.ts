import { z } from 'zod';
import type { SkillDefinition, PromptContext } from '../types';
import { formatEvidenceForPrompt, formatCompanyProfileForPrompt } from '../evidence-loader';
import { SKILL_NAMES } from '../names';
import { getOutreachLanguageLabel } from '@/lib/radar/country-utils';

// ==================== Input/Output Schemas ====================

const inputSchema = z.object({
  persona: z.record(z.string(), z.unknown()).describe('买家 Persona'),
  messagingMatrix: z.record(z.string(), z.unknown()).optional().describe('消息矩阵'),
  tier: z.enum(['A', 'B', 'C']).optional().describe('目标客户层级'),
  prospectDossier: z.record(z.string(), z.unknown()).nullable().optional(),
  contacts: z.array(z.record(z.string(), z.unknown())).optional(),
  contactProfile: z.record(z.string(), z.unknown()).nullable().optional(),
  matchReasons: z.array(z.string()).optional(),
  approachAngle: z.string().nullable().optional(),
  language: z.string().optional().describe('Target outreach language code (e.g. "vi", "zh-Hans", "en")'),
});

const playbookEntrySchema = z.object({
  replyType: z.enum([
    'interested', 'need_info', 'price_sensitive',
    'not_relevant', 'referral', 'unsubscribe'
  ]),
  goal: z.string(),
  responseTemplate: z.string(),
  nextStepTasks: z.array(z.string()),
  evidenceIds: z.array(z.string()),
});

const outputSchema = z.object({
  outreachPack: z.object({
    forPersona: z.string(),
    forTier: z.enum(['A', 'B', 'C']),
    openings: z.array(z.object({
      text: z.string(),
      evidenceIds: z.array(z.string()),
    })),
    emails: z.array(z.object({
      subject: z.string(),
      body: z.string(),
      evidenceIds: z.array(z.string()),
    })),
    whatsapps: z.array(z.object({
      text: z.string(),
      evidenceIds: z.array(z.string()),
    })),
    playbook: z.array(playbookEntrySchema),
    evidenceMap: z.array(z.object({
      label: z.string(),
      evidenceId: z.string(),
      why: z.string(),
    })),
    warnings: z.array(z.string()),
  }),
});

// ==================== Skill Definition ====================

export const outreachPackSkill: SkillDefinition<typeof inputSchema, typeof outputSchema> = {
  name: SKILL_NAMES.RADAR_GENERATE_OUTREACH_PACK,
  displayName: '生成外联包',
  engine: 'radar',
  outputEntityType: 'OutreachPack',
  inputSchema,
  outputSchema,
  suggestedNextSkills: [
    SKILL_NAMES.RADAR_GENERATE_WEEKLY_CADENCE,
  ],
  model: 'qwen-max',
  temperature: 0.4,
  
  systemPrompt: `你是B2B出海获客文案与合规官。基于Persona、Messaging Matrix、Evidence、BrandGuideline，为每个Tier输出外联包。

When a Prospect Dossier is provided, treat it as the primary source for personalization. Use its decision-maker analysis, business opportunities, intelligence summary, match analysis, risks, talking points, and avoid-topics before falling back to generic persona assumptions.
Use source labels D1-D7 for dossier-backed claims, and C1 for contact execution context, when no injected Evidence [E1] labels are available. Do not invent funding, news, production scale, role, or buying intent that is not present in the provided context.

要求：
1. Opening lines 3-5条（短、具体、包含为何找你 + 1条证据 + 轻量下一步）
2. Email 2封（首封+跟进）
3. WhatsApp 2条（更短）
4. Follow-up Playbook（按回复类型分支）

合规约束：
1. 每条核心主张必须引用至少1条Evidence（用[E1]形式标注）
2. 禁词/合规边界命中要在warnings里输出
3. 语气真实克制，不夸大，不承诺无法证明的指标
4. 必须包含尊重隐私/退订选项的句子（英文版用opt-out）

邮件正文特殊约束：
5. 【关键】邮件 body 和 subject 中禁止出现任何方括号引用标记如 [D1]、[E1]、[C1]、[Your Name] 等。
   所有证据引用仅通过 evidenceIds 数组传递，正文直接使用具体公司名/人名/数据。
6. 邮件末尾签名统一使用 {{SENDER_SIGNATURE}} 占位符（单独一行），系统会自动替换为发件人真实信息。
   不要输出 [Your Name]、[Your Position] 等方括号占位符。

语言本地化：
7. 当 input 中提供 language 参数且不为 "en" 时：
   - 邮件 subject、body 正文段落、greeting、closing：用目标语言撰写
   - Opening lines 和 WhatsApp 消息：用目标语言
   - 产品名、品牌名、型号、技术规格参数：保留英文原文
   - Playbook responseTemplate：用目标语言
   - 退订/opt-out 句子：同时提供目标语言版本和英文版本
   - 【重要】仍然遵守第5、6条：正文中不出现 [D1]/[E1]/[Your Name]，签名用 {{SENDER_SIGNATURE}}
   当 language 为 "en" 或未提供时，全部用英文输出（当前默认行为不变）。`,
  
  buildUserPrompt: (ctx: PromptContext) => {
    const { input, companyProfile, evidences } = ctx;
    
    let prompt = '';
    
    if (companyProfile) {
      prompt += formatCompanyProfileForPrompt(companyProfile);
    }
    
    if (evidences?.length) {
      prompt += formatEvidenceForPrompt(evidences);
    }
    
    const dossier = input.prospectDossier;
    const contacts = input.contacts;
    const contactProfile = input.contactProfile;
    const matchReasons = input.matchReasons;
    const approachAngle = input.approachAngle;

    prompt += `
=== Persona ===
${JSON.stringify(input.persona, null, 2)}

${input.messagingMatrix ? `=== Messaging Matrix ===\n${JSON.stringify(input.messagingMatrix, null, 2)}` : ''}

${dossier ? `=== Prospect Dossier (primary personalization source) ===
Use these stable source labels when citing dossier-backed details:
- D1: companyOverview
- D2: decisionMakerAnalysis
- D3: businessOpportunities
- D4: intelligenceSummary
- D5: matchAnalysis
- D6: recommendedApproach
- D7: riskAlerts
${JSON.stringify(dossier, null, 2)}` : ''}

${Array.isArray(contacts) && contacts.length > 0 ? `=== Contact Execution Context (C1) ===
${JSON.stringify({
  contacts,
  contactProfile: contactProfile || null,
}, null, 2)}` : ''}

${Array.isArray(matchReasons) && matchReasons.length > 0 ? `=== Match Reasons ===
${JSON.stringify(matchReasons, null, 2)}` : ''}

${typeof approachAngle === 'string' && approachAngle.trim() ? `=== Existing Approach Angle ===
${approachAngle}` : ''}

${Array.isArray(input.matchedContentLinks) && input.matchedContentLinks.length > 0 ? `=== 相关营销内容（可在邮件中自然引用）===
以下文章/案例与这个潜在客户相关，可以在邮件中适当引用链接：
${input.matchedContentLinks.map((link: any, i: number) =>
  `- [C${i + 1}] ${link.title || '文章'}: ${link.url || link.slug || ''}${link.matchScore ? ` (匹配度 ${link.matchScore}%)` : ''}`
).join('\n')}
在邮件中引用时请自然嵌入，例如："我们在最近的文章中分享了相关案例: [文章标题](链接)"` : ''}

目标层级：${input.tier || 'A'}

=== 任务要求 ===
请生成外联包，包含开场白、邮件模板、WhatsApp消息和跟进剧本。所有核心主张必须引用证据。

Additional requirements:
1. Email and WhatsApp copy must reference at least one concrete dossier-backed detail when Prospect Dossier is provided.
2. Use decision-maker approach angles and talking points from D2/D6 where available.
3. Respect avoid-topics and risk alerts from D6/D7; mention these boundaries in warnings.
4. When choosing channel language, use C1 recommended contact, compliance note, and available email/phone/LinkedIn context.
5. Fill nested evidenceIds with D1-D7/C1 labels when the detail came from dossier/contact context.`;

    const lang = input.language as string | undefined;
    if (lang && lang !== 'en') {
      const label = getOutreachLanguageLabel(lang);
      prompt += `

=== Language Requirement ===
Output language: ${label} (${lang})
Rules:
- Email subject, body, greeting, closing: write in ${label}
- Opening lines, WhatsApp messages: write in ${label}
- Product names, brand names, technical terms, model numbers: keep in English
- Playbook response templates: write in ${label}
- Opt-out sentence: provide one line in ${label} AND one line in English
- Do NOT write the entire email in both languages. The main content is in ${label} only, with English terms inline where needed.`;
    }

    return prompt;
  },
};
