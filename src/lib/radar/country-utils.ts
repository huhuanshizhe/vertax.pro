const COUNTRY_CODES = [
  "US",
  "DE",
  "GB",
  "FR",
  "HK",
  "JP",
  "KR",
  "IT",
  "ES",
  "NL",
  "SE",
  "CH",
  "AT",
  "AU",
  "CA",
  "BR",
  "MX",
  "IN",
  "TH",
  "VN",
  "MY",
  "SG",
  "ID",
  "PH",
  "TR",
  "PL",
  "CZ",
  "HU",
  "SA",
  "AE",
  "EG",
  "ZA",
  "DK",
  "FI",
  "NO",
  "BE",
  "PT",
  "RO",
  "SK",
  "SI",
  "IE",
  "GR",
  "IL",
  "QA",
  "KW",
  "MA",
  "NG",
  "KE",
  "CL",
  "CO",
  "AR",
  "NZ",
  "TW",
  "CN",
  "PK",
  "BD",
  "LK",
  "KZ",
  "UA",
  "HR",
  "CY",
  "EE",
  "LV",
  "LT",
  "LU",
  "MT",
  "MO",
  "BG",
] as const;

const regionDisplay = new Intl.DisplayNames(["en"], { type: "region" });
const COUNTRY_DISPLAY_OVERRIDES: Partial<Record<(typeof COUNTRY_CODES)[number], string>> = {
  HK: "Hong Kong",
  MO: "Macao",
};

export const COUNTRY_NAME_BY_ISO = Object.fromEntries(
  COUNTRY_CODES.map((code) => [
    code,
    COUNTRY_DISPLAY_OVERRIDES[code] ?? regionDisplay.of(code) ?? code,
  ]),
) as Record<(typeof COUNTRY_CODES)[number], string>;

const COUNTRY_ALIAS_EXTRA: Partial<Record<(typeof COUNTRY_CODES)[number], string[]>> = {
  US: ["usa", "u.s.a", "u.s.", "united states of america", "america"],
  GB: ["uk", "u.k.", "britain", "great britain", "england"],
  KR: ["republic of korea", "korea republic of", "south korea"],
  AE: ["uae", "u.a.e."],
  CZ: ["czechia"],
  VN: ["viet nam"],
  TR: ["turkiye", "türkiye"],
  CN: ["chn", "prc", "pr china", "p.r. china", "people's republic of china", "mainland china"],
  TW: ["twn", "taiwan, province of china", "roc taiwan"],
  HK: ["hkg", "hong kong", "hong kong sar", "hong kong sar china", "hksar"],
  DE: ["deutschland"],
  JP: ["nippon", "nihon"],
  MO: ["mac", "macao", "macau", "macao sar", "macau sar"],
};

function normalizeCountryKey(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .toLowerCase();
}

const COUNTRY_ISO_BY_ALIAS = new Map<string, string>();

// 中文国名 → ISO 码
const ZH_COUNTRY_NAMES: Record<string, string> = {
  美国: 'US', 加拿大: 'CA', 德国: 'DE', 英国: 'GB', 法国: 'FR',
  意大利: 'IT', 西班牙: 'ES', 荷兰: 'NL', 瑞典: 'SE', 瑞士: 'CH',
  奥地利: 'AT', 澳大利亚: 'AU', 巴西: 'BR', 墨西哥: 'MX', 印度: 'IN',
  泰国: 'TH', 越南: 'VN', 马来西亚: 'MY', 新加坡: 'SG', 印尼: 'ID',
  菲律宾: 'PH', 土耳其: 'TR', 波兰: 'PL', 捷克: 'CZ', 匈牙利: 'HU',
  沙特: 'SA', 沙特阿拉伯: 'SA', 阿联酋: 'AE', 阿拉伯联合酋长国: 'AE', 埃及: 'EG', 南非: 'ZA',
  丹麦: 'DK', 芬兰: 'FI', 挪威: 'NO', 比利时: 'BE', 葡萄牙: 'PT',
  罗马尼亚: 'RO', 斯洛伐克: 'SK', 斯洛文尼亚: 'SI', 爱尔兰: 'IE',
  希腊: 'GR', 以色列: 'IL', 卡塔尔: 'QA', 科威特: 'KW', 摩洛哥: 'MA',
  尼日利亚: 'NG', 肯尼亚: 'KE', 智利: 'CL', 哥伦比亚: 'CO', 阿根廷: 'AR',
  新西兰: 'NZ', 台湾: 'TW', 中国: 'CN', 香港: 'HK', 澳门: 'MO',
  巴基斯坦: 'PK', 孟加拉: 'BD', 斯里兰卡: 'LK', 哈萨克斯坦: 'KZ',
  乌克兰: 'UA', 克罗地亚: 'HR', 塞浦路斯: 'CY', 爱沙尼亚: 'EE',
  拉脱维亚: 'LV', 立陶宛: 'LT', 卢森堡: 'LU', 马耳他: 'MT',
  保加利亚: 'BG', 日本: 'JP', 韩国: 'KR', 缅甸: 'MM', 柬埔寨: 'KH',
  老挝: 'LA', 秘鲁: 'PE',
};

for (const code of COUNTRY_CODES) {
  COUNTRY_ISO_BY_ALIAS.set(normalizeCountryKey(code), code);

  const englishName = COUNTRY_NAME_BY_ISO[code];
  COUNTRY_ISO_BY_ALIAS.set(normalizeCountryKey(englishName), code);

  for (const alias of COUNTRY_ALIAS_EXTRA[code] ?? []) {
    COUNTRY_ISO_BY_ALIAS.set(normalizeCountryKey(alias), code);
  }
}

// 中文国名映射（在英文别名之后，不覆盖已有映射）
for (const [zhName, isoCode] of Object.entries(ZH_COUNTRY_NAMES)) {
  const key = normalizeCountryKey(zhName);
  if (key && !COUNTRY_ISO_BY_ALIAS.has(key)) {
    COUNTRY_ISO_BY_ALIAS.set(key, isoCode);
  }
}

// ISO → 所有可能的字符串表示（用于 DB 查询时的模糊匹配）
const COUNTRY_MATCH_VALUES_BY_ISO = new Map<string, string[]>();

for (const code of COUNTRY_CODES) {
  const values = new Set<string>([code]);
  const en = COUNTRY_NAME_BY_ISO[code];
  if (en) values.add(en);
  for (const alias of COUNTRY_ALIAS_EXTRA[code] ?? []) values.add(alias);
  // 查找中文名
  for (const [zh, iso] of Object.entries(ZH_COUNTRY_NAMES)) {
    if (iso === code) values.add(zh);
  }
  COUNTRY_MATCH_VALUES_BY_ISO.set(code, Array.from(values));
}

/** 给定国家显示名/ISO码，返回该国家所有可能的字符串变体（用于 DB in 查询） */
export function getCountryMatchValues(displayNameOrCode: string): string[] | null {
  const iso = normalizeCountryCode(displayNameOrCode);
  if (!iso) return null;
  return COUNTRY_MATCH_VALUES_BY_ISO.get(iso) ?? [iso];
}

export function normalizeCountryCode(value?: string | null): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const upper = trimmed.toUpperCase();
  if (upper in COUNTRY_NAME_BY_ISO) {
    return upper;
  }

  return COUNTRY_ISO_BY_ALIAS.get(normalizeCountryKey(trimmed)) ?? null;
}

export function getCountryDisplayName(value?: string | null): string | null {
  const iso = normalizeCountryCode(value);
  if (!iso) {
    return value?.trim() || null;
  }

  return COUNTRY_NAME_BY_ISO[iso as keyof typeof COUNTRY_NAME_BY_ISO] ?? iso;
}

export function toTavilyCountryName(value?: string | null): string | undefined {
  const display = getCountryDisplayName(value);
  return display ? display.toLowerCase() : undefined;
}

export function doesCountryMatchTargets(
  value: string | null | undefined,
  targets: string[] | null | undefined,
): boolean {
  const candidateIso = normalizeCountryCode(value);
  if (!candidateIso || !targets || targets.length === 0) {
    return false;
  }

  return targets.some((target) => normalizeCountryCode(target) === candidateIso);
}

export function getCountryMatchPriority(
  value: string | null | undefined,
  targets: string[] | null | undefined,
): 0 | 1 | 2 {
  const candidateIso = normalizeCountryCode(value);
  if (!candidateIso) {
    return 1;
  }

  return doesCountryMatchTargets(candidateIso, targets) ? 0 : 2;
}

// ==================== Outreach Language Inference ====================

const COUNTRY_TO_OUTREACH_LANG: Record<string, string> = {
  VN: 'vi', TH: 'th', ID: 'id', MY: 'ms', PH: 'fil',
  JP: 'ja', KR: 'ko', CN: 'zh-Hans', TW: 'zh-Hant', HK: 'zh-Hant',
  BR: 'pt', PT: 'pt',
  ES: 'es', MX: 'es', AR: 'es', CO: 'es', CL: 'es', PE: 'es',
  FR: 'fr', DE: 'de', IT: 'it', NL: 'nl',
  SA: 'ar', AE: 'ar', EG: 'ar', QA: 'ar', KW: 'ar', MA: 'ar',
  RU: 'ru', TR: 'tr', PL: 'pl',
  US: 'en', GB: 'en', AU: 'en', CA: 'en', NZ: 'en', IE: 'en', SG: 'en', IN: 'en',
};

export const OUTREACH_LANGUAGE_OPTIONS = [
  { code: 'en', label: 'English' },
  { code: 'vi', label: 'Tieng Viet' },
  { code: 'th', label: 'Thai' },
  { code: 'id', label: 'Bahasa Indonesia' },
  { code: 'ms', label: 'Bahasa Melayu' },
  { code: 'fil', label: 'Filipino' },
  { code: 'ja', label: 'Japanese' },
  { code: 'ko', label: 'Korean' },
  { code: 'zh-Hans', label: 'Chinese (Simplified)' },
  { code: 'zh-Hant', label: 'Chinese (Traditional)' },
  { code: 'pt', label: 'Portugues' },
  { code: 'es', label: 'Espanol' },
  { code: 'fr', label: 'Francais' },
  { code: 'de', label: 'Deutsch' },
  { code: 'it', label: 'Italiano' },
  { code: 'nl', label: 'Nederlands' },
  { code: 'ar', label: 'Arabic' },
  { code: 'ru', label: 'Russian' },
  { code: 'tr', label: 'Turkce' },
  { code: 'pl', label: 'Polski' },
] as const;

const VALID_LANG_CODES = new Set<string>(OUTREACH_LANGUAGE_OPTIONS.map((o) => o.code));

const TLD_TO_COUNTRY: Record<string, string> = {
  vn: 'VN', th: 'TH', id: 'ID', my: 'MY', ph: 'PH',
  jp: 'JP', kr: 'KR', cn: 'CN', tw: 'TW',
  br: 'BR', pt: 'PT', es: 'ES', mx: 'MX', ar: 'AR',
  fr: 'FR', de: 'DE', it: 'IT', nl: 'NL',
  sa: 'SA', ae: 'AE', eg: 'EG', ru: 'RU', tr: 'TR', pl: 'PL',
};

function inferCountryFromTLD(website: string | null | undefined): string | null {
  if (!website) return null;
  try {
    const hostname = new URL(
      website.startsWith('http') ? website : `https://${website}`,
    ).hostname;
    const tld = hostname.split('.').pop()?.toLowerCase();
    return tld ? TLD_TO_COUNTRY[tld] ?? null : null;
  } catch {
    return null;
  }
}

/** Infer outreach language from country (priority) and website TLD (fallback). Always returns a valid code. */
export function inferOutreachLanguage(opts: {
  country?: string | null;
  website?: string | null;
}): string {
  const countryCode =
    normalizeCountryCode(opts.country) || inferCountryFromTLD(opts.website);
  if (!countryCode) return 'en';
  return COUNTRY_TO_OUTREACH_LANG[countryCode] || 'en';
}

/**
 * Validate a language code against whitelist.
 * Returns the code if valid, undefined if not.
 * Does NOT fallback to 'en' so downstream auto-inference can still run.
 */
export function getValidOutreachLanguage(lang: unknown): string | undefined {
  if (typeof lang !== 'string') return undefined;
  const trimmed = lang.trim();
  return VALID_LANG_CODES.has(trimmed) ? trimmed : undefined;
}

/** Get display label for a language code. */
export function getOutreachLanguageLabel(code: string): string {
  return (
    OUTREACH_LANGUAGE_OPTIONS.find((o) => o.code === code)?.label || code
  );
}

/** Exported for testing: returns all country-to-language entries for consistency checks. */
export function getSupportedCountryLanguageEntries(): ReadonlyArray<
  [string, string]
> {
  return Object.entries(COUNTRY_TO_OUTREACH_LANG);
}
