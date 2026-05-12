// ==================== Discovery Query Planner ====================
// Multi-language query planning with cursor stability.
// Platform-level capability: all tenants benefit from local-language discovery.

import { createHash } from 'crypto';
import type { SourceCategory } from './adapters/types';
import type { TenantIndustryRadarHints } from './tenant-industry-source-pack';
import { getCountryDisplayName } from './country-utils';

// ==================== Core Types ====================

export interface PlannedQuery {
  text: string;
  language: string;
  countryCode: string;
  sourceCategory: SourceCategory;
  intent: 'discovery' | 'trigger' | 'competitor' | 'verification';
  priority: number;
  prefix?: string;
  metadata: {
    packId?: string;
    termsUsed: string[];
    templateUsed?: string;
  };
}

export interface QueryPlanInput {
  tenantId: string;
  tenantSlug?: string;
  packHints: TenantIndustryRadarHints;
  targetCountries: string[];
  enabledSourceCategories?: SourceCategory[];
  currentAdapterCode?: string;
  customKeywords?: string[];
}

export interface QueryPlanResult {
  queries: PlannedQuery[];
  planVersion: string;
  totalQueries: number;
  byCountry: Record<string, number>;
  byLanguage: Record<string, number>;
  bySourceCategory: Record<string, number>;
}

// ==================== Lexicon Provider Interface ====================

export interface MergedLexicon {
  languages: string[];
  terms: Record<string, LanguageTerms>;
  exclusionTerms: Record<string, string[]>;
}

export interface LanguageTerms {
  manufacturerTerms: string[];
  industryTerms: string[];
  processTerms: string[];
  productTerms: string[];
}

export interface CountryLanguageLexiconProvider {
  getCountryLexicon(countryCode: string, packId?: string, tenantId?: string): Promise<MergedLexicon>;
  getSupportedCountries(): Promise<string[]>;
}

// ==================== Fallback Lexicon Provider (Phase 1) ====================

interface CountryLexiconData {
  languages: string[];
  shared: Record<string, LanguageTerms>;
  exclusionTerms?: Record<string, string[]>;
}

export class FallbackLexiconProvider implements CountryLanguageLexiconProvider {
  // Pack-specific lexicon: only painting_automation has paint process terms
  private static readonly PACK_LEXICON: Record<string, Record<string, CountryLexiconData>> = {
    painting_automation: {
      VN: {
        languages: ['vi', 'en'],
        shared: {
          vi: {
            manufacturerTerms: ['nhà sản xuất', 'công ty', 'xí nghiệp', 'nhà máy'],
            industryTerms: ['linh kiện ô tô', 'thiết bị gia dụng', 'xe máy', 'đồ nhựa'],
            processTerms: ['sơn phun', 'xưởng sơn', 'dây chuyền sơn', 'phun sơn tự động', 'buồng sơn'],
            productTerms: ['vỏ nhựa', 'linh kiện kim loại', 'chi tiết ô tô'],
          },
        },
        exclusionTerms: {
          vi: ['sửa chữa ô tô', 'bán lẻ sơn', 'dịch vụ sơn nhà'],
        },
      },
      TH: {
        languages: ['th', 'en'],
        shared: {
          th: {
            manufacturerTerms: ['ผู้ผลิต', 'โรงงาน', 'บริษัท'],
            industryTerms: ['ผู้ผลิตชิ้นส่วนยานยนต์', 'เครื่องใช้ไฟฟ้า', 'มอเตอร์ไซค์'],
            processTerms: ['พ่นสี', 'โรงพ่นสี', 'สายพ่นสี', 'ระบบพ่นสีอัตโนมัติ'],
            productTerms: ['ชิ้นส่วนพลาสติก', 'ตัวถังรถ'],
          },
        },
        exclusionTerms: {
          th: ['ซ่อมรถ', 'ร้านขายสี'],
        },
      },
      ID: {
        languages: ['id', 'en'],
        shared: {
          id: {
            manufacturerTerms: ['pabrik', 'produsen', 'perusahaan'],
            industryTerms: ['produsen komponen otomotif', 'peralatan rumah tangga'],
            processTerms: ['pengecatan semprot', 'lini pengecatan', 'booth pengecatan'],
            productTerms: ['casing plastik', 'komponen logam'],
          },
        },
        exclusionTerms: {
          id: ['bengkel mobil', 'toko cat'],
        },
      },
      SA: {
        languages: ['ar', 'en'],
        shared: {
          ar: {
            manufacturerTerms: ['مصنع', 'شركة تصنيع'],
            industryTerms: ['مصنع قطع غيار السيارات', 'مصنع الأجهزة المنزلية'],
            processTerms: ['دهان بالرش', 'خط دهان', 'غرفة الدهان'],
            productTerms: ['أجزاء بلاستيكية', 'مكونات معدنية'],
          },
        },
        exclusionTerms: {
          ar: ['ورشة إصلاح سيارات', 'محل دهانات'],
        },
      },
      AE: {
        languages: ['ar', 'en'],
        shared: {
          ar: {
            manufacturerTerms: ['مصنع', 'شركة تصنيع'],
            industryTerms: ['مصنع قطع غيار السيارات', 'مصنع الأجهزة المنزلية'],
            processTerms: ['دهان بالرش', 'خط دهان', 'غرفة الدهان'],
            productTerms: ['أجزاء بلاستيكية', 'مكونات معدنية'],
          },
        },
        exclusionTerms: {
          ar: ['ورشة إصلاح سيارات', 'محل دهانات'],
        },
      },
      MY: {
        languages: ['ms', 'en'],
        shared: {
          ms: {
            manufacturerTerms: ['pengeluar', 'kilang', 'syarikat'],
            industryTerms: ['pengeluar komponen automotif', 'peralatan rumah'],
            processTerms: ['semburan cat', 'barisan pengecat', 'gerai semburan'],
            productTerms: ['casing plastik', 'komponen logam'],
          },
        },
        exclusionTerms: {
          ms: ['bengkel kereta', 'kedai cat'],
        },
      },
    },
    mro_industrial_supplies: {
      VN: {
        languages: ['vi', 'en'],
        shared: {
          vi: {
            manufacturerTerms: ['nhà máy', 'công ty', 'xí nghiệp', 'kho hàng', 'nhà sản xuất'],
            industryTerms: ['sản xuất', 'kho vận', 'logistics', 'bảo trì công nghiệp', 'xây dựng'],
            processTerms: ['mua sắm', 'đặt hàng số lượng lớn', 'bảo trì', 'phụ tùng thay thế', 'vật tư công nghiệp', 'mua hàng công nghiệp'],
            productTerms: ['phớt dầu', 'vòng bi', 'bu lông', 'đai ốc', 'cảm biến', 'bảo hộ lao động', 'khóa an toàn', 'đồ bảo hộ', 'băng tải', 'dây đai'],
          },
        },
        exclusionTerms: {
          vi: ['bán lẻ', 'đồ gia dụng', 'sửa chữa tại nhà'],
        },
      },
      TH: {
        languages: ['th', 'en'],
        shared: {
          th: {
            manufacturerTerms: ['โรงงาน', 'บริษัท', 'คลังสินค้า', 'ผู้ผลิต'],
            industryTerms: ['การผลิต', 'โลจิสติกส์', 'คลังสินค้า', 'บำรุงรักษา', 'ก่อสร้าง'],
            processTerms: ['จัดซื้อ', 'สั่งซื้อจำนวนมาก', 'บำรุงรักษา', 'อะไหล่', 'วัสดุอุตสาหกรรม', 'จัดหาสินค้า'],
            productTerms: ['ซีลน้ำมัน', 'ตลับลูกปืน', 'สลักเกลียว', 'เซ็นเซอร์', 'อุปกรณ์ความปลอดภัย', 'ล็อคเอาท์', 'สายพาน', 'ข้อต่อ'],
          },
        },
        exclusionTerms: {
          th: ['ค้าปลีก', 'เครื่องใช้ในบ้าน', 'งานอดิเรก'],
        },
      },
      ID: {
        languages: ['id', 'en'],
        shared: {
          id: {
            manufacturerTerms: ['pabrik', 'perusahaan', 'gudang', 'produsen'],
            industryTerms: ['manufaktur', 'logistik', 'pergudangan', 'pemeliharaan industri', 'konstruksi'],
            processTerms: ['pengadaan', 'pemesanan massal', 'pemeliharaan', 'suku cadang', 'material industri', 'pembelian industri'],
            productTerms: ['seal oli', 'bearing', 'baut', 'mur', 'sensor', 'alat pelindung diri', 'gembok keselamatan', 'sabuk', 'konektor'],
          },
        },
        exclusionTerms: {
          id: ['ritel', 'peralatan rumah tangga', 'hobi'],
        },
      },
      MY: {
        languages: ['ms', 'en'],
        shared: {
          ms: {
            manufacturerTerms: ['kilang', 'syarikat', 'gudang', 'pengeluar'],
            industryTerms: ['pembuatan', 'logistik', 'pergudangan', 'penyelenggaraan', 'pembinaan'],
            processTerms: ['perolehan', 'pesanan pukal', 'penyelenggaraan', 'alat ganti', 'bahan industri', 'pembelian industri'],
            productTerms: ['pengedap minyak', 'galas', 'bolt', 'nat', 'sensor', 'peralatan keselamatan', 'kunci keselamatan', 'tali sawat', 'penyambung'],
          },
        },
        exclusionTerms: {
          ms: ['runcit', 'peralatan rumah', 'hobi'],
        },
      },
      PH: {
        languages: ['tl', 'en'],
        shared: {
          tl: {
            manufacturerTerms: ['pabrika', 'kumpanya', 'bodega', 'tagagawa'],
            industryTerms: ['pagmamanupaktura', 'logistik', 'bodega', 'pagpapanatili', 'konstruksiyon'],
            processTerms: ['pagkuha', 'maramihang order', 'pagpapanatili', 'spare parts', 'industriyal na materyales', 'pagbili ng industriyal'],
            productTerms: ['oil seal', 'bearing', 'bolt', 'nut', 'sensor', 'kagamitan sa kaligtasan', 'lockout', 'sinturon', 'konektor'],
          },
        },
        exclusionTerms: {
          tl: ['tingi', 'gamit sa bahay', 'libangan'],
        },
      },
      SA: {
        languages: ['ar', 'en'],
        shared: {
          ar: {
            manufacturerTerms: ['مصنع', 'شركة', 'مستودع', 'منتج'],
            industryTerms: ['تصنيع', 'لوجستيات', 'مستودعات', 'صيانة صناعية', 'بناء'],
            processTerms: ['مشتريات', 'طلب بالجملة', 'صيانة', 'قطع غيار', 'مواد صناعية', 'شراء صناعي'],
            productTerms: ['حشوة زيت', 'محمل', 'برغي', 'صامولة', 'مستشعر', 'معدات سلامة', 'قفل أمان', 'حزام', 'موصل'],
          },
        },
        exclusionTerms: {
          ar: ['تجزئة', 'أدوات منزلية', 'هواية'],
        },
      },
      AE: {
        languages: ['ar', 'en'],
        shared: {
          ar: {
            manufacturerTerms: ['مصنع', 'شركة', 'مستودع', 'منتج'],
            industryTerms: ['تصنيع', 'لوجستيات', 'مستودعات', 'صيانة صناعية', 'بناء'],
            processTerms: ['مشتريات', 'طلب بالجملة', 'صيانة', 'قطع غيار', 'مواد صناعية', 'شراء صناعي'],
            productTerms: ['حشوة زيت', 'محمل', 'برغي', 'صامولة', 'مستشعر', 'معدات سلامة', 'قفل أمان', 'حزام', 'موصل'],
          },
        },
        exclusionTerms: {
          ar: ['تجزئة', 'أدوات منزلية', 'هواية'],
        },
      },
    },
  };

  // Shared generic manufacturing terms (available to all packs)
  private static readonly SHARED_LEXICON: Record<string, CountryLexiconData> = {
    VN: {
      languages: ['vi', 'en'],
      shared: {
        vi: {
          manufacturerTerms: ['nhà sản xuất', 'công ty', 'nhà máy'],
          industryTerms: [],
          processTerms: [],
          productTerms: [],
        },
      },
      exclusionTerms: {},
    },
    TH: {
      languages: ['th', 'en'],
      shared: {
        th: {
          manufacturerTerms: ['ผู้ผลิต', 'โรงงาน', 'บริษัท'],
          industryTerms: [],
          processTerms: [],
          productTerms: [],
        },
      },
      exclusionTerms: {},
    },
    ID: {
      languages: ['id', 'en'],
      shared: {
        id: {
          manufacturerTerms: ['pabrik', 'produsen', 'perusahaan'],
          industryTerms: [],
          processTerms: [],
          productTerms: [],
        },
      },
      exclusionTerms: {},
    },
  };

  async getCountryLexicon(countryCode: string, packId?: string, _tenantId?: string): Promise<MergedLexicon> {
    const upper = countryCode.toUpperCase();

    // Get pack-specific lexicon
    const packData = packId
      ? FallbackLexiconProvider.PACK_LEXICON[packId]?.[upper]
      : undefined;

    // Get shared lexicon
    const sharedData = FallbackLexiconProvider.SHARED_LEXICON[upper];

    if (!packData && !sharedData) {
      return { languages: ['en'], terms: {}, exclusionTerms: {} };
    }

    // Pack data takes precedence, fallback to shared
    const data = packData || sharedData;
    return {
      languages: data!.languages,
      terms: data!.shared,
      exclusionTerms: data!.exclusionTerms || {},
    };
  }

  async getSupportedCountries(): Promise<string[]> {
    const countries = new Set<string>();
    for (const pack of Object.values(FallbackLexiconProvider.PACK_LEXICON)) {
      for (const country of Object.keys(pack)) {
        countries.add(country);
      }
    }
    for (const country of Object.keys(FallbackLexiconProvider.SHARED_LEXICON)) {
      countries.add(country);
    }
    return Array.from(countries);
  }
}

// ==================== Adapter Source Category Mapping ====================

const ADAPTER_SOURCE_CATEGORIES: Record<string, SourceCategory[]> = {
  brave_search: [
    'web_serp_english',
    'web_serp_local_language',
    'hiring_signal',
    'expansion_news',
    'environmental_permit',
    'factory_video',
    'industrial_directory',
    'social_serp_facebook',
    'social_serp_linkedin',
  ],
  exa: ['exa_semantic'],
  exa_search: ['exa_semantic'],
  social_facebook_serp: ['social_serp_facebook'],
  social_linkedin_serp: ['social_serp_linkedin'],
};

function getValidSourceCategories(adapterCode?: string, enabled?: SourceCategory[]): Set<SourceCategory> {
  let valid: SourceCategory[];
  if (adapterCode && ADAPTER_SOURCE_CATEGORIES[adapterCode]) {
    valid = ADAPTER_SOURCE_CATEGORIES[adapterCode];
  } else {
    // Default: web SERP + local language (most adapters can handle these)
    valid = ['web_serp_english', 'web_serp_local_language'];
  }

  if (enabled && enabled.length > 0) {
    return new Set(valid.filter(c => enabled.includes(c)));
  }
  return new Set(valid);
}

// ==================== Unicode NFKC Normalization ====================

export function normalizeUnicode(text: string): string {
  return text.normalize('NFKC');
}

// ==================== Query Plan Generation ====================

const defaultLexiconProvider = new FallbackLexiconProvider();

export async function planDiscoveryQueries(
  input: QueryPlanInput,
  lexiconProvider: CountryLanguageLexiconProvider = defaultLexiconProvider
): Promise<QueryPlanResult> {
  const validCategories = getValidSourceCategories(input.currentAdapterCode, input.enabledSourceCategories);
  const queries: PlannedQuery[] = [];
  const packId = input.packHints.packIds[0];

  for (const country of input.targetCountries) {
    const countryCode = country.toUpperCase();
    const lexicon = await lexiconProvider.getCountryLexicon(countryCode, packId, input.tenantId);
    const countryName = getCountryDisplayName(countryCode) || countryCode;

    // Exa semantic queries. Keep these adapter-compatible: Exa consumes the raw query text.
    if (validCategories.has('exa_semantic')) {
      const semanticKeywords = [
        ...input.packHints.keywords.slice(0, 10),
        ...(input.customKeywords || []),
      ];

      for (const kw of semanticKeywords) {
        queries.push({
          text: normalizeUnicode(`${kw} ${countryName}`),
          language: 'en',
          countryCode,
          sourceCategory: 'exa_semantic',
          intent: 'discovery',
          priority: 18,
          metadata: { packId, termsUsed: [kw, countryName] },
        });
      }
    }

    // English web SERP queries (from pack discovery keywords)
    if (validCategories.has('web_serp_english')) {
      const englishKeywords = [
        ...input.packHints.keywords.slice(0, 15),
        ...(input.customKeywords || []),
      ];

      for (const kw of englishKeywords) {
        queries.push({
          text: normalizeUnicode(kw),
          language: 'en',
          countryCode,
          sourceCategory: 'web_serp_english',
          intent: 'discovery',
          priority: 20,
          metadata: { packId, termsUsed: [kw] },
        });
      }

      // Trigger-intent queries (English)
      const triggerKws = input.packHints.keywords
        .filter(k => input.packHints.buyingTriggers.some(t =>
          k.toLowerCase().includes(t.toLowerCase().split(' ')[0])
        ))
        .slice(0, 5);

      for (const kw of triggerKws) {
        queries.push({
          text: normalizeUnicode(kw),
          language: 'en',
          countryCode,
          sourceCategory: 'web_serp_english',
          intent: 'trigger',
          priority: 15,
          metadata: { packId, termsUsed: [kw] },
        });
      }
    }

    // Verification and buying-window queries. These look for evidence that a thin
    // company profile really operates an in-house paint process or is in an upgrade window.
    const verificationQueries = generateVerificationQueries(input.packHints.verificationQueries, countryName);
    const verificationCategoryPriority: Array<{ category: SourceCategory; priority: number }> = [
      { category: 'hiring_signal', priority: 8 },
      { category: 'expansion_news', priority: 9 },
      { category: 'environmental_permit', priority: 9 },
      { category: 'factory_video', priority: 11 },
      { category: 'industrial_directory', priority: 13 },
    ];

    for (const { category, priority } of verificationCategoryPriority) {
      if (!validCategories.has(category)) continue;
      for (const q of verificationQueries[category] || []) {
        queries.push({
          text: normalizeUnicode(q),
          language: 'en',
          countryCode,
          sourceCategory: category,
          intent: 'verification',
          priority,
          metadata: { packId, termsUsed: [q], templateUsed: category },
        });
      }
    }

    // Local-language queries
    if (validCategories.has('web_serp_local_language')) {
      for (const lang of lexicon.languages) {
        if (lang === 'en') continue;
        const terms = lexicon.terms[lang];
        if (!terms) continue;

        const localQueries = generateLocalLanguageQueries(terms, countryCode, lang, packId);
        // Local language queries get higher priority in SEA/MENA
        for (const q of localQueries) {
          queries.push({ ...q, priority: 10 });
        }
      }
    }

    // Social SERP queries (if enabled)
    if (validCategories.has('social_serp_facebook')) {
      const socialKeywords = input.packHints.keywords.slice(0, 5);
      for (const kw of socialKeywords) {
        queries.push({
          text: normalizeUnicode(`site:facebook.com ${kw}`),
          language: 'en',
          countryCode,
          sourceCategory: 'social_serp_facebook',
          intent: 'discovery',
          priority: 30,
          prefix: 'site:facebook.com',
          metadata: { packId, termsUsed: [kw] },
        });
      }
    }

    if (validCategories.has('social_serp_linkedin')) {
      const socialKeywords = input.packHints.keywords.slice(0, 5);
      for (const kw of socialKeywords) {
        queries.push({
          text: normalizeUnicode(`site:linkedin.com/company ${kw}`),
          language: 'en',
          countryCode,
          sourceCategory: 'social_serp_linkedin',
          intent: 'discovery',
          priority: 30,
          prefix: 'site:linkedin.com/company',
          metadata: { packId, termsUsed: [kw] },
        });
      }
    }
  }

  // Sort by priority (lower number = higher priority)
  queries.sort((a, b) => a.priority - b.priority);

  // Compute plan version hash
  const planVersion = computePlanVersion(queries);

  // Build stats
  const byCountry: Record<string, number> = {};
  const byLanguage: Record<string, number> = {};
  const bySourceCategory: Record<string, number> = {};

  for (const q of queries) {
    byCountry[q.countryCode] = (byCountry[q.countryCode] || 0) + 1;
    byLanguage[q.language] = (byLanguage[q.language] || 0) + 1;
    bySourceCategory[q.sourceCategory] = (bySourceCategory[q.sourceCategory] || 0) + 1;
  }

  return {
    queries,
    planVersion,
    totalQueries: queries.length,
    byCountry,
    byLanguage,
    bySourceCategory,
  };
}

// ==================== Local Language Query Templates ====================

function generateLocalLanguageQueries(
  terms: LanguageTerms,
  countryCode: string,
  language: string,
  packId?: string
): PlannedQuery[] {
  const queries: PlannedQuery[] = [];

  // Template: "{processTerms} + {industryTerms}"
  for (const process of terms.processTerms.slice(0, 3)) {
    for (const industry of terms.industryTerms.slice(0, 2)) {
      const text = normalizeUnicode(`${process} ${industry}`);
      queries.push({
        text,
        language,
        countryCode,
        sourceCategory: 'web_serp_local_language',
        intent: 'discovery',
        priority: 10,
        metadata: {
          packId,
          termsUsed: [process, industry],
          templateUsed: '{process} {industry}',
        },
      });
    }
  }

  // Template: "{manufacturerTerms} + {processTerms}"
  for (const mfg of terms.manufacturerTerms.slice(0, 2)) {
    for (const process of terms.processTerms.slice(0, 2)) {
      const text = normalizeUnicode(`${mfg} ${process}`);
      queries.push({
        text,
        language,
        countryCode,
        sourceCategory: 'web_serp_local_language',
        intent: 'discovery',
        priority: 12,
        metadata: {
          packId,
          termsUsed: [mfg, process],
          templateUsed: '{manufacturer} {process}',
        },
      });
    }
  }

  // Template: "{productTerms} + {manufacturerTerms}"
  for (const product of terms.productTerms.slice(0, 2)) {
    for (const mfg of terms.manufacturerTerms.slice(0, 2)) {
      const text = normalizeUnicode(`${product} ${mfg}`);
      queries.push({
        text,
        language,
        countryCode,
        sourceCategory: 'web_serp_local_language',
        intent: 'discovery',
        priority: 14,
        metadata: {
          packId,
          termsUsed: [product, mfg],
          templateUsed: '{product} {manufacturer}',
        },
      });
    }
  }

  return queries;
}

function generateVerificationQueries(
  baseQueries: string[] | undefined,
  countryName: string
): Partial<Record<SourceCategory, string[]>> {
  const queries = baseQueries || [];

  return {
    hiring_signal: queries
      .filter((query) => /recruitment|hiring|supervisor|spray painter|process engineer/i.test(query))
      .map((query) => `${query} ${countryName}`),
    expansion_news: queries
      .filter((query) => /expansion|new plant|new factory|capacity|OEM|Tier 1/i.test(query))
      .map((query) => `${query} ${countryName}`),
    environmental_permit: queries
      .filter((query) => /environmental|VOC|fire safety|spray booth|compliance/i.test(query))
      .map((query) => `${query} ${countryName}`),
    factory_video: queries
      .filter((query) => /youtube|video|factory/i.test(query))
      .map((query) => `${query} ${countryName}`),
    industrial_directory: queries
      .filter((query) => /industrial park|directory|supplier|manufacturer/i.test(query))
      .map((query) => `${query} ${countryName}`),
  };
}

// ==================== Plan Version Hash ====================

function computePlanVersion(queries: PlannedQuery[]): string {
  const sortedTexts = queries.map(q => q.text).sort();
  const hash = createHash('sha256')
    .update(sortedTexts.join('\n'))
    .digest('hex')
    .slice(0, 12);
  return hash;
}
