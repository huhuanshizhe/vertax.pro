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
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .toLowerCase();
}

const COUNTRY_ISO_BY_ALIAS = new Map<string, string>();

for (const code of COUNTRY_CODES) {
  COUNTRY_ISO_BY_ALIAS.set(normalizeCountryKey(code), code);

  const englishName = COUNTRY_NAME_BY_ISO[code];
  COUNTRY_ISO_BY_ALIAS.set(normalizeCountryKey(englishName), code);

  for (const alias of COUNTRY_ALIAS_EXTRA[code] ?? []) {
    COUNTRY_ISO_BY_ALIAS.set(normalizeCountryKey(alias), code);
  }
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
