import { aiClient } from "@/lib/ai-client";
import { getPlatformPrompt, getPlatformCharLimit, type PlatformId } from "@/lib/marketing/platform-rules";
import { getLanguageInstruction } from "@/lib/languages";

export type GenerateContentParams = {
  topic: string;
  context?: string;
  tone: string;
  platform: string;
  language: string;
};

export type GenerateMultiParams = {
  topic: string;
  context?: string;
  tone: string;
  platforms: string[];
  language: string;
};

// 平台提示词现在从 platform-rules.ts 获取（整合了 marketing-skills 框架的最佳实践）
// 旧的 PLATFORM_PROMPTS 已被替换

const TONE_INSTRUCTIONS: Record<string, string> = {
  professional: "Use a professional, authoritative tone suitable for B2B audiences.",
  casual: "Use a friendly, casual tone that feels approachable and relatable.",
  humorous: "Use a witty, humorous tone while staying relevant and professional.",
  informative: "Use an educational, informative tone that provides value to the reader.",
};

export async function generateSocialContent(
  params: GenerateContentParams
): Promise<string> {
  const platformPrompt = getPlatformPrompt(params.platform as PlatformId);
  const toneInstruction = TONE_INSTRUCTIONS[params.tone] || TONE_INSTRUCTIONS.professional;
  const charLimit = getPlatformCharLimit(params.platform as PlatformId);
  const langInstruction = getLanguageInstruction(params.language);

  const userPrompt = [
    `Topic: ${params.topic}`,
    params.context ? `Additional context: ${params.context}` : "",
    `Character limit: ${charLimit}`,
    toneInstruction,
    langInstruction,
    "Generate ONLY the post content. No explanations, no quotation marks wrapping the output.",
  ]
    .filter(Boolean)
    .join("\n");

  const response = await aiClient.chat.completions.create({
    model: process.env.AI_MODEL || "qwen-plus",
    messages: [
      { role: "system", content: platformPrompt },
      { role: "user", content: userPrompt },
    ],
    max_tokens: 500,
    temperature: 0.8,
  });

  const content = response.choices[0]?.message?.content?.trim();
  if (!content) throw new Error("AI returned empty content");
  return content;
}

export async function generateMultiPlatformContent(
  params: GenerateMultiParams
): Promise<Record<string, string>> {
  const results = await Promise.all(
    params.platforms.map(async (platform) => {
      const content = await generateSocialContent({
        topic: params.topic,
        context: params.context,
        tone: params.tone,
        platform,
        language: params.language,
      });
      return { platform, content };
    })
  );

  const output: Record<string, string> = {};
  for (const r of results) {
    output[r.platform] = r.content;
  }
  return output;
}

// ==================== SEO AUDIT SUMMARY ====================

export type GenerateAuditSummaryParams = {
  url: string;
  scores: Record<string, number>;
  findings: Array<{ factor: string; status: string; message: string }>;
  language: string;
};

export async function generateAuditSummary(
  params: GenerateAuditSummaryParams
): Promise<string> {
  const client = aiClient;

  const failedFindings = params.findings
    .filter((f) => f.status === "fail")
    .map((f) => `- [FAIL] ${f.factor}: ${f.message}`)
    .join("\n");

  const warnFindings = params.findings
    .filter((f) => f.status === "warn")
    .map((f) => `- [WARN] ${f.factor}: ${f.message}`)
    .join("\n");

  const langInstruction =
    getLanguageInstruction(params.language);

  const userPrompt = `Analyze the following SEO/GEO audit results for ${params.url}:

Overall Score: ${params.scores.overall}/100
Technical SEO: ${params.scores.technical ?? "N/A"}/100
On-Page SEO: ${params.scores.onPage ?? "N/A"}/100
Structured Data: ${params.scores.structuredData ?? "N/A"}/100
Social Sharing: ${params.scores.social ?? "N/A"}/100
GEO (AI Engine): ${params.scores.geo ?? "N/A"}/100

Critical Issues:
${failedFindings || "None"}

Warnings:
${warnFindings || "None"}

Provide a concise executive summary with:
1. Overall health assessment (2-3 sentences)
2. Top 3 priority recommendations with specific actions
3. GEO strategy advice for AI engine visibility

Use markdown formatting with ## headings. Keep it under 300 words.
${langInstruction}`;

  const response = await client.chat.completions.create({
    model: process.env.AI_MODEL || "qwen-plus",
    messages: [
      {
        role: "system",
        content:
          "You are a senior SEO and GEO (Generative Engine Optimization) expert. Provide actionable, specific, and professional audit analysis.",
      },
      { role: "user", content: userPrompt },
    ],
    max_tokens: 800,
    temperature: 0.5,
  });

  const content = response.choices[0]?.message?.content?.trim();
  if (!content) throw new Error("AI returned empty summary");
  return content;
}
