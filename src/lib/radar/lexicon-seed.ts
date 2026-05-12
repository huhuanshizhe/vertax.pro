/**
 * Lexicon Seed — Upsert hardcoded FallbackLexiconProvider data into CountryLanguageLexicon table.
 *
 * Usage: npx tsx src/lib/radar/lexicon-seed.ts
 * Or import and call seedLexicon() programmatically.
 */

import { prisma } from '@/lib/prisma';

interface LexiconSeedRow {
  countryCode: string;
  language: string;
  packId: string | null;
  manufacturerTerms: string[];
  industryTerms: string[];
  processTerms: string[];
  productTerms: string[];
  exclusionTerms: string[];
}

const PAINTING_AUTOMATION_SEEDS: LexiconSeedRow[] = [
  {
    countryCode: 'VN',
    language: 'vi',
    packId: 'painting_automation',
    manufacturerTerms: ['nhà sản xuất', 'công ty', 'xí nghiệp', 'nhà máy'],
    industryTerms: ['linh kiện ô tô', 'thiết bị gia dụng', 'xe máy', 'đồ nhựa'],
    processTerms: ['sơn phun', 'xưởng sơn', 'dây chuyền sơn', 'phun sơn tự động', 'buồng sơn'],
    productTerms: ['vỏ nhựa', 'linh kiện kim loại', 'chi tiết ô tô'],
    exclusionTerms: ['sửa chữa ô tô', 'bán lẻ sơn', 'dịch vụ sơn nhà'],
  },
  {
    countryCode: 'TH',
    language: 'th',
    packId: 'painting_automation',
    manufacturerTerms: ['ผู้ผลิต', 'โรงงาน', 'บริษัท'],
    industryTerms: ['ผู้ผลิตชิ้นส่วนยานยนต์', 'เครื่องใช้ไฟฟ้า', 'มอเตอร์ไซค์'],
    processTerms: ['พ่นสี', 'โรงพ่นสี', 'สายพ่นสี', 'ระบบพ่นสีอัตโนมัติ'],
    productTerms: ['ชิ้นส่วนพลาสติก', 'ตัวถังรถ'],
    exclusionTerms: ['ซ่อมรถ', 'ร้านขายสี'],
  },
  {
    countryCode: 'ID',
    language: 'id',
    packId: 'painting_automation',
    manufacturerTerms: ['pabrik', 'produsen', 'perusahaan'],
    industryTerms: ['produsen komponen otomotif', 'peralatan rumah tangga'],
    processTerms: ['pengecatan semprot', 'lini pengecatan', 'booth pengecatan'],
    productTerms: ['casing plastik', 'komponen logam'],
    exclusionTerms: ['bengkel mobil', 'toko cat'],
  },
  {
    countryCode: 'SA',
    language: 'ar',
    packId: 'painting_automation',
    manufacturerTerms: ['مصنع', 'شركة تصنيع'],
    industryTerms: ['مصنع قطع غيار السيارات', 'مصنع الأجهزة المنزلية'],
    processTerms: ['دهان بالرش', 'خط دهان', 'غرفة الدهان'],
    productTerms: ['أجزاء بلاستيكية', 'مكونات معدنية'],
    exclusionTerms: ['ورشة إصلاح سيارات', 'محل دهانات'],
  },
  {
    countryCode: 'AE',
    language: 'ar',
    packId: 'painting_automation',
    manufacturerTerms: ['مصنع', 'شركة تصنيع'],
    industryTerms: ['مصنع قطع غيار السيارات', 'مصنع الأجهزة المنزلية'],
    processTerms: ['دهان بالرش', 'خط دهان', 'غرفة الدهان'],
    productTerms: ['أجزاء بلاستيكية', 'مكونات معدنية'],
    exclusionTerms: ['ورشة إصلاح سيارات', 'محل دهانات'],
  },
  {
    countryCode: 'MY',
    language: 'ms',
    packId: 'painting_automation',
    manufacturerTerms: ['pengeluar', 'kilang', 'syarikat'],
    industryTerms: ['pengeluar komponen automotif', 'peralatan rumah'],
    processTerms: ['semburan cat', 'barisan pengecat', 'gerai semburan'],
    productTerms: ['casing plastik', 'komponen logam'],
    exclusionTerms: ['bengkel kereta', 'kedai cat'],
  },
];

export async function seedLexicon(): Promise<{ upserted: number; errors: string[] }> {
  let upserted = 0;
  const errors: string[] = [];

  for (const row of PAINTING_AUTOMATION_SEEDS) {
    try {
      await prisma.countryLanguageLexicon.upsert({
        where: {
          countryCode_language_packId_tenantId: {
            countryCode: row.countryCode,
            language: row.language,
            packId: row.packId || '',
            tenantId: '',
          },
        },
        create: {
          countryCode: row.countryCode,
          language: row.language,
          packId: row.packId,
          tenantId: null,
          manufacturerTerms: row.manufacturerTerms,
          industryTerms: row.industryTerms,
          processTerms: row.processTerms,
          productTerms: row.productTerms,
          exclusionTerms: row.exclusionTerms,
          source: 'manual',
        },
        update: {
          manufacturerTerms: row.manufacturerTerms,
          industryTerms: row.industryTerms,
          processTerms: row.processTerms,
          productTerms: row.productTerms,
          exclusionTerms: row.exclusionTerms,
          source: 'manual',
        },
      });
      upserted++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${row.countryCode}/${row.language}: ${msg}`);
    }
  }

  return { upserted, errors };
}

// Allow direct execution
if (require.main === module) {
  seedLexicon()
    .then((result) => {
      console.log(`Lexicon seed complete: ${result.upserted} upserted, ${result.errors.length} errors`);
      if (result.errors.length > 0) {
        console.error('Errors:', result.errors);
      }
      process.exit(result.errors.length > 0 ? 1 : 0);
    })
    .catch((err) => {
      console.error('Seed failed:', err);
      process.exit(1);
    });
}
