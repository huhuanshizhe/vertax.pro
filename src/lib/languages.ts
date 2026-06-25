/**
 * 共享多语言支持配置
 * 
 * 用于关键词生成、社媒内容生成、SEO 内容等模块的统一语言选择
 */

export type LanguageOption = {
  code: string;       // ISO 语言代码 (如 en, zh-CN, ja)
  name: string;       // 显示名称 (如 English, 简体中文, 日本語)
  nativeName: string; // 本地化名称 (如 English, 中文, 日本語)
  aiInstruction: string; // AI 提示词中的语言指令
};

export const SUPPORTED_LANGUAGES: LanguageOption[] = [
  { code: "en",    name: "English",              nativeName: "English",             aiInstruction: "CRITICAL LANGUAGE REQUIREMENT: You MUST generate ALL output (keywords, content, hashtags) in English only. Do NOT use Chinese or any other language, even if the input data contains Chinese text. Translate all concepts into English." },
  { code: "zh-CN", name: "简体中文",              nativeName: "简体中文",            aiInstruction: "CRITICAL LANGUAGE REQUIREMENT: You MUST generate ALL output (keywords, content, hashtags) in Simplified Chinese (简体中文) only." },
  { code: "zh-TW", name: "繁體中文",              nativeName: "繁體中文",            aiInstruction: "CRITICAL LANGUAGE REQUIREMENT: You MUST generate ALL output (keywords, content, hashtags) in Traditional Chinese (繁體中文) only." },
  { code: "ja",    name: "日本語",                nativeName: "日本語",              aiInstruction: "CRITICAL LANGUAGE REQUIREMENT: You MUST generate ALL output (keywords, content, hashtags) in Japanese (日本語) only. Do NOT use Chinese or any other language, even if the input data contains Chinese text." },
  { code: "ko",    name: "한국어",                nativeName: "한국어",              aiInstruction: "CRITICAL LANGUAGE REQUIREMENT: You MUST generate ALL output (keywords, content, hashtags) in Korean (한국어) only. Do NOT use Chinese or any other language, even if the input data contains Chinese text." },
  { code: "es",    name: "Español",              nativeName: "Español",            aiInstruction: "CRITICAL LANGUAGE REQUIREMENT: You MUST generate ALL output (keywords, content, hashtags) in Spanish (Español) only. Do NOT use Chinese or any other language, even if the input data contains Chinese text." },
  { code: "pt",    name: "Português",            nativeName: "Português",          aiInstruction: "CRITICAL LANGUAGE REQUIREMENT: You MUST generate ALL output (keywords, content, hashtags) in Portuguese (Português) only. Do NOT use Chinese or any other language, even if the input data contains Chinese text." },
  { code: "de",    name: "Deutsch",              nativeName: "Deutsch",            aiInstruction: "CRITICAL LANGUAGE REQUIREMENT: You MUST generate ALL output (keywords, content, hashtags) in German (Deutsch) only. Do NOT use Chinese or any other language, even if the input data contains Chinese text." },
  { code: "fr",    name: "Français",             nativeName: "Français",           aiInstruction: "CRITICAL LANGUAGE REQUIREMENT: You MUST generate ALL output (keywords, content, hashtags) in French (Français) only. Do NOT use Chinese or any other language, even if the input data contains Chinese text." },
  { code: "ar",    name: "العربية",               nativeName: "العربية",             aiInstruction: "CRITICAL LANGUAGE REQUIREMENT: You MUST generate ALL output (keywords, content, hashtags) in Arabic (العربية) only. Do NOT use Chinese or any other language, even if the input data contains Chinese text." },
  { code: "ru",    name: "Русский",              nativeName: "Русский",            aiInstruction: "CRITICAL LANGUAGE REQUIREMENT: You MUST generate ALL output (keywords, content, hashtags) in Russian (Русский) only. Do NOT use Chinese or any other language, even if the input data contains Chinese text." },
  { code: "it",    name: "Italiano",             nativeName: "Italiano",           aiInstruction: "CRITICAL LANGUAGE REQUIREMENT: You MUST generate ALL output (keywords, content, hashtags) in Italian (Italiano) only. Do NOT use Chinese or any other language, even if the input data contains Chinese text." },
  { code: "nl",    name: "Nederlands",           nativeName: "Nederlands",         aiInstruction: "CRITICAL LANGUAGE REQUIREMENT: You MUST generate ALL output (keywords, content, hashtags) in Dutch (Nederlands) only. Do NOT use Chinese or any other language, even if the input data contains Chinese text." },
  { code: "tr",    name: "Türkçe",               nativeName: "Türkçe",             aiInstruction: "CRITICAL LANGUAGE REQUIREMENT: You MUST generate ALL output (keywords, content, hashtags) in Turkish (Türkçe) only. Do NOT use Chinese or any other language, even if the input data contains Chinese text." },
  { code: "vi",    name: "Tiếng Việt",           nativeName: "Tiếng Việt",         aiInstruction: "CRITICAL LANGUAGE REQUIREMENT: You MUST generate ALL output (keywords, content, hashtags) in Vietnamese (Tiếng Việt) only. Do NOT use Chinese or any other language, even if the input data contains Chinese text." },
  { code: "th",    name: "ไทย",                   nativeName: "ไทย",                aiInstruction: "CRITICAL LANGUAGE REQUIREMENT: You MUST generate ALL output (keywords, content, hashtags) in Thai (ไทย) only. Do NOT use Chinese or any other language, even if the input data contains Chinese text." },
  { code: "id",    name: "Bahasa Indonesia",     nativeName: "Bahasa Indonesia",   aiInstruction: "CRITICAL LANGUAGE REQUIREMENT: You MUST generate ALL output (keywords, content, hashtags) in Indonesian (Bahasa Indonesia) only. Do NOT use Chinese or any other language, even if the input data contains Chinese text." },
  { code: "hi",    name: "हिन्दी",                 nativeName: "हिन्दी",              aiInstruction: "CRITICAL LANGUAGE REQUIREMENT: You MUST generate ALL output (keywords, content, hashtags) in Hindi (हिन्दी) only. Do NOT use Chinese or any other language, even if the input data contains Chinese text." },
];

/**
 * 根据语言代码获取语言配置
 */
export function getLanguageOption(code: string): LanguageOption | undefined {
  return SUPPORTED_LANGUAGES.find((l) => l.code === code);
}

/**
 * 获取 AI 语言指令
 */
export function getLanguageInstruction(code: string): string {
  const lang = getLanguageOption(code);
  return lang?.aiInstruction ?? "Write the content in English.";
}

/**
 * 默认语言
 */
export const DEFAULT_LANGUAGE = "en";
