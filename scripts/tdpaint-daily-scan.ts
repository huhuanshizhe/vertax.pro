/**
 * TDPaint 每日雷达扫描
 * 
 * 目标：找到东南亚有涂装工序的制造商（TDPaint 的工序升级型客户）
 * 
 * 策略：
 * - 搜索 "制造商 + 涂装产线/设施" 而非 "automation"
 * - 排除涂料供应商、设备商、贸易商
 * - Exa 为主力（语义搜索精准度高）+ Brave/SERP 补充
 * - 三层去重（externalId + domain + name）保证不重复
 * 
 * 用法: npx tsx scripts/tdpaint-daily-scan.ts
 * Cron: 每日一次
 */
import { PrismaClient } from '@prisma/client';
import { createRadarTask, runRadarTask } from '../src/lib/radar/sync-service';
import type { RadarSearchQuery } from '../src/lib/radar/adapters/types';

const p = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL + '&connect_timeout=30' } },
});
const TDPAINT_TENANT_ID = 'c3d1e593-8c4f-4c52-9ff0-0aa62061f29d';

// ==================== 负向过滤 ====================
// 涂料供应商、设备商、贸易公司 — 不是 TDPaint 的客户
const EXCLUDE_KEYWORDS = [
  'paint supplier', 'paint distributor', 'coatings manufacturer',
  'paint manufacturer', 'coating supplier', 'paint dealer',
  'paint store', 'paint retailer', 'auto refinish',
  'powder coating service', 'coating equipment',
];

// 排除已知涂料品牌域名
const EXCLUDE_DOMAINS = [
  'nipponpaint.com', 'akzonobel.com', 'ppg.com', 'sherwin-williams.com',
  'axalta.com', 'basf.com', 'jotun.com', 'kansai.com', 'toagroup.com',
  'asianpaints.com', 'dulux.com', 'hempel.com',
];

// ==================== Exa Query Packs (8个) ====================
const EXA_QUERIES: Array<{ name: string; query: Omit<RadarSearchQuery, 'excludeKeywords' | 'excludeDomains'> }> = [
  // 1. 越南汽车零部件制造商（含涂装线）
  {
    name: 'Exa: 越南汽车零部件+涂装线',
    query: {
      keywords: ['Vietnam automotive parts manufacturer with painting line spray painting facility factory'],
      countries: ['VN'],
      targetIndustries: ['automotive'],
      companyTypes: ['manufacturer'],
      maxResults: 10,
    },
  },
  // 2. 泰国汽车/摩托车零部件（含涂装）
  {
    name: 'Exa: 泰国汽车摩托车零件涂装',
    query: {
      keywords: ['Thailand motorcycle automotive parts manufacturer painting production line factory'],
      countries: ['TH'],
      targetIndustries: ['automotive', 'motorcycle'],
      companyTypes: ['manufacturer'],
      maxResults: 10,
    },
  },
  // 3. 印尼家电外壳制造商（有喷涂工段）
  {
    name: 'Exa: 印尼家电外壳喷涂制造',
    query: {
      keywords: ['Indonesia home appliance housing manufacturer spray painting production facility'],
      countries: ['ID'],
      targetIndustries: ['appliance', 'consumer electronics'],
      companyTypes: ['manufacturer'],
      maxResults: 10,
    },
  },
  // 4. SEA 塑料注塑+涂装一体化工厂
  {
    name: 'Exa: SEA塑料注塑+涂装工厂',
    query: {
      keywords: ['plastic injection molding manufacturer with painting line Southeast Asia Vietnam Thailand Indonesia'],
      countries: ['VN', 'TH', 'ID'],
      targetIndustries: ['plastics', 'manufacturing'],
      companyTypes: ['manufacturer'],
      maxResults: 10,
    },
  },
  // 5. 越南/印尼金属冲压+表面处理
  {
    name: 'Exa: 金属冲压+表面涂装工厂',
    query: {
      keywords: ['metal stamping manufacturer painting finishing line factory Vietnam Indonesia'],
      countries: ['VN', 'ID'],
      targetIndustries: ['metal fabrication'],
      companyTypes: ['manufacturer'],
      maxResults: 10,
    },
  },
  // 6. 马来西亚/菲律宾电子外壳制造
  {
    name: 'Exa: MY/PH电子外壳涂装制造',
    query: {
      keywords: ['electronics enclosure housing manufacturer spray painting Malaysia Philippines factory'],
      countries: ['MY', 'PH'],
      targetIndustries: ['electronics', 'manufacturing'],
      companyTypes: ['manufacturer'],
      maxResults: 10,
    },
  },
  // 7. SEA 汽车保险杠/外饰件（强信号：必然有涂装）
  {
    name: 'Exa: SEA汽车保险杠外饰件制造',
    query: {
      keywords: ['automotive bumper exterior trim parts manufacturer Vietnam Thailand Indonesia production'],
      countries: ['VN', 'TH', 'ID'],
      targetIndustries: ['automotive'],
      companyTypes: ['manufacturer'],
      maxResults: 10,
    },
  },
  // 8. SEA 家具/建材涂装制造商
  {
    name: 'Exa: SEA家具建材涂装制造商',
    query: {
      keywords: ['furniture manufacturer painting line wood metal finishing factory Vietnam Indonesia Thailand'],
      countries: ['VN', 'ID', 'TH'],
      targetIndustries: ['furniture', 'building materials'],
      companyTypes: ['manufacturer'],
      maxResults: 10,
    },
  },
];

// ==================== AI Search (SERP) Queries (3个) ====================
const SERP_QUERIES: Array<{ name: string; query: Omit<RadarSearchQuery, 'excludeKeywords' | 'excludeDomains'> }> = [
  {
    name: 'SERP: 越南汽车零部件工厂涂装',
    query: {
      keywords: ['automotive parts factory Vietnam painting line spray booth production manufacturer'],
      countries: ['VN'],
      targetIndustries: ['automotive'],
      companyTypes: ['manufacturer'],
      maxResults: 10,
    },
  },
  {
    name: 'SERP: 泰国塑料件涂装制造商',
    query: {
      keywords: ['plastic parts manufacturer Thailand painting facility spray painting production'],
      countries: ['TH'],
      targetIndustries: ['plastics', 'manufacturing'],
      companyTypes: ['manufacturer'],
      maxResults: 10,
    },
  },
  {
    name: 'SERP: 印尼金属家电涂装工厂',
    query: {
      keywords: ['metal home appliance manufacturer Indonesia painting finishing production line factory'],
      countries: ['ID'],
      targetIndustries: ['appliance', 'metal fabrication'],
      companyTypes: ['manufacturer'],
      maxResults: 10,
    },
  },
];

// ==================== Brave Queries (3个) ====================
const BRAVE_QUERIES: Array<{ name: string; query: Omit<RadarSearchQuery, 'excludeKeywords' | 'excludeDomains'> }> = [
  {
    name: 'Brave: SEA汽车塑料件涂装制造商',
    query: {
      keywords: ['automotive plastic parts manufacturer Vietnam Thailand Indonesia painting line factory production'],
      countries: ['ALL'],
      targetIndustries: ['automotive'],
      companyTypes: ['manufacturer'],
      maxResults: 10,
    },
  },
  {
    name: 'Brave: SEA摩托车零部件涂装工厂',
    query: {
      keywords: ['motorcycle parts manufacturer painting production line Vietnam Indonesia Thailand factory'],
      countries: ['ALL'],
      targetIndustries: ['motorcycle', 'automotive'],
      companyTypes: ['manufacturer'],
      maxResults: 10,
    },
  },
  {
    name: 'Brave: SEA家电金属件涂装制造',
    query: {
      keywords: ['home appliance metal parts manufacturer spray painting factory Southeast Asia Indonesia Philippines'],
      countries: ['ALL'],
      targetIndustries: ['appliance', 'metal fabrication'],
      companyTypes: ['manufacturer'],
      maxResults: 10,
    },
  },
];

// ==================== Main ====================

async function main() {
  const startTime = Date.now();
  console.log('=== TDPaint Daily Radar Scan ===');
  console.log(`Time: ${new Date().toISOString()}\n`);

  // Fix stuck tasks
  const stuck = await p.radarTask.updateMany({
    where: { tenantId: TDPAINT_TENANT_ID, status: 'RUNNING' },
    data: { status: 'FAILED' },
  });
  if (stuck.count > 0) console.log(`Fixed ${stuck.count} stuck tasks\n`);

  // Get owner user
  const user = await p.user.findFirst({
    where: { tenantId: TDPAINT_TENANT_ID },
    select: { id: true },
  });
  if (!user) throw new Error('No user found for TDPaint');

  // Get source IDs
  const sources = await p.radarSource.findMany({
    where: { code: { in: ['exa', 'brave_search', 'ai_search'] }, isEnabled: true },
    select: { id: true, code: true },
  });
  const sourceMap = Object.fromEntries(sources.map(s => [s.code, s.id]));

  if (!sourceMap.exa) throw new Error('Exa source not found');
  console.log(`Sources: exa=${sourceMap.exa?.slice(-6)}, brave=${sourceMap.brave_search?.slice(-6) || 'N/A'}, serp=${sourceMap.ai_search?.slice(-6) || 'N/A'}\n`);

  // Collect all queries
  const allQueries = [
    ...EXA_QUERIES.map(q => ({ ...q, sourceId: sourceMap.exa! })),
    ...(sourceMap.ai_search ? SERP_QUERIES.map(q => ({ ...q, sourceId: sourceMap.ai_search! })) : []),
    ...(sourceMap.brave_search ? BRAVE_QUERIES.map(q => ({ ...q, sourceId: sourceMap.brave_search! })) : []),
  ];

  console.log(`Total queries: ${allQueries.length} (Exa:${EXA_QUERIES.length} SERP:${SERP_QUERIES.length} Brave:${BRAVE_QUERIES.length})\n---\n`);

  const results: { name: string; created: number; dupes: number; errors: number }[] = [];

  for (const item of allQueries) {
    process.stdout.write(`[${item.name}] `);

    try {
      const task = await createRadarTask({
        tenantId: TDPAINT_TENANT_ID,
        sourceId: item.sourceId,
        queryConfig: {
          ...item.query,
          excludeKeywords: EXCLUDE_KEYWORDS,
          excludeDomains: EXCLUDE_DOMAINS,
        },
        triggeredBy: user.id,
        name: item.name,
      });

      const result = await runRadarTask(task.id);
      const r = { name: item.name, created: result.stats.created, dupes: result.stats.duplicates, errors: result.stats.errors.length };
      results.push(r);
      console.log(`✓ ${r.created} new, ${r.dupes} filtered/dupes${r.errors > 0 ? `, ${r.errors} errs` : ''}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message.slice(0, 100) : 'Unknown';
      console.log(`✗ ${msg}`);
      results.push({ name: item.name, created: 0, dupes: 0, errors: 1 });
    }

    // Rate limit
    await new Promise(r => setTimeout(r, 3000));
  }

  // ==================== Summary ====================
  const totalNew = results.reduce((s, r) => s + r.created, 0);
  const totalDupes = results.reduce((s, r) => s + r.dupes, 0);
  const totalErrors = results.reduce((s, r) => s + r.errors, 0);
  const duration = ((Date.now() - startTime) / 1000).toFixed(0);

  console.log(`\n=== Summary (${duration}s) ===`);
  console.log(`New candidates: ${totalNew}`);
  console.log(`Filtered/Dupes: ${totalDupes}`);
  console.log(`Errors: ${totalErrors}`);

  console.log('\nPer-query:');
  for (const r of results) {
    const icon = r.errors === 0 && r.created > 0 ? '✓' : r.errors > 0 ? '✗' : '○';
    console.log(`  ${icon} ${r.name}: +${r.created} (${r.dupes} filtered)`);
  }

  // DB state
  const total = await p.radarCandidate.count({ where: { task: { tenantId: TDPAINT_TENANT_ID } } });
  const todayNew = await p.radarCandidate.count({
    where: { task: { tenantId: TDPAINT_TENANT_ID }, createdAt: { gte: new Date(new Date().toISOString().slice(0, 10)) } },
  });
  console.log(`\nDB: ${total} total, ${todayNew} added today`);

  await p.$disconnect();
}

main()
  .then(() => process.exit(0))
  .catch((e) => { console.error('Fatal:', e.message?.slice(0, 300) || e); process.exit(1); });
