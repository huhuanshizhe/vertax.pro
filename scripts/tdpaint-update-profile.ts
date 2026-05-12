/**
 * 更新 TDPaint RadarSearchProfile 配置
 * 
 * 将现有 profile 的关键词、负向词、源配置更新为优化后的版本
 * 让 cron/radar-scan 自动每天执行优化后的查询
 */
import { PrismaClient } from '@prisma/client';

const p = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL + '&connect_timeout=30' } },
});
const TDPAINT_TENANT_ID = 'c3d1e593-8c4f-4c52-9ff0-0aa62061f29d';

async function main() {
  // Find existing profile
  const profile = await p.radarSearchProfile.findFirst({
    where: { tenantId: TDPAINT_TENANT_ID, isActive: true },
  });

  if (!profile) {
    console.log('No active profile found, creating new one...');
    await createProfile();
    return;
  }

  console.log(`Found profile: ${profile.name} (${profile.id})`);
  console.log(`  Schedule: ${profile.scheduleRule}`);
  console.log(`  Last run: ${profile.lastRunAt?.toISOString() || 'never'}`);
  console.log(`  Next run: ${profile.nextRunAt?.toISOString() || 'not set'}`);
  console.log('');

  // Get source IDs
  const sources = await p.radarSource.findMany({
    where: { code: { in: ['exa', 'brave_search', 'ai_search'] }, isEnabled: true },
    select: { id: true, code: true },
  });
  const sourceIds = sources.map(s => s.id);
  console.log(`Sources to bind: ${sources.map(s => s.code).join(', ')}`);

  // Update profile with optimized config
  await p.radarSearchProfile.update({
    where: { id: profile.id },
    data: {
      name: 'TDPaint_SEA_Manufacturing_Painting',
      description: '搜索东南亚有涂装工序的制造商 — TDPaint 工序升级型客户',

      // 优化后的多语言关键词
      keywords: {
        en: [
          // 汽车零部件+涂装
          'automotive parts manufacturer painting line factory Vietnam Thailand Indonesia',
          'motorcycle parts manufacturer painting production line Vietnam Indonesia',
          'automotive bumper exterior trim manufacturer painting facility Southeast Asia',
          // 家电/电子+涂装
          'home appliance housing manufacturer spray painting factory Indonesia Philippines',
          'electronics enclosure manufacturer painting line Malaysia Philippines',
          // 塑料/金属+涂装
          'plastic injection molding manufacturer with painting line Southeast Asia',
          'metal stamping manufacturer painting finishing factory Vietnam Indonesia',
          // 家具/建材
          'furniture manufacturer painting line wood metal finishing Vietnam Indonesia Thailand',
        ],
        vi: [
          'nhà máy sản xuất phụ tùng ô tô có dây chuyền sơn',
          'nhà máy nhựa có xưởng sơn phun',
        ],
        th: [
          'โรงงานผลิตชิ้นส่วนรถยนต์ สายการพ่นสี',
          'ผู้ผลิตเครื่องใช้ไฟฟ้า โรงพ่นสี',
        ],
        id: [
          'pabrik suku cadang otomotif dengan fasilitas pengecatan',
          'produsen peralatan rumah tangga pengecatan spray',
        ],
      },

      // 负向关键词 — 排除涂料供应商
      negativeKeywords: [
        'paint supplier', 'paint distributor', 'coatings manufacturer',
        'paint manufacturer', 'coating supplier', 'paint dealer',
        'paint store', 'paint retailer', 'auto refinish',
        'powder coating service', 'coating equipment supplier',
        'paint brand', 'paint company',
      ],

      // 目标区域
      targetCountries: ['VN', 'TH', 'ID', 'MY', 'PH'],
      targetRegions: ['APAC'],

      // 行业代码
      industryCodes: [
        'automotive', 'motorcycle', 'appliance', 'electronics',
        'plastics', 'metal_fabrication', 'furniture', 'manufacturing',
      ],

      // 绑定源
      sourceIds,
      enabledChannels: ['DIRECTORY', 'CUSTOM'],

      // 调度：每天早上 6 点
      scheduleRule: '0 6 * * *',
      isActive: true,

      // 自动 qualify（AI 评分）
      autoQualify: true,
      autoEnrich: false, // 暂不自动详情补全

      // 立即触发下一次运行
      nextRunAt: new Date(),
    },
  });

  console.log('\n✓ Profile updated successfully!');
  console.log('  Next scheduled scan will use optimized config.');
  console.log('  Keywords: 8 EN + 2 VI + 2 TH + 2 ID query packs');
  console.log('  Negative: 12 exclusion terms');
  console.log('  Sources: exa, brave_search, ai_search');
  console.log('  Schedule: 0 6 * * * (daily 6AM)');

  await p.$disconnect();
}

async function createProfile() {
  const sources = await p.radarSource.findMany({
    where: { code: { in: ['exa', 'brave_search', 'ai_search'] }, isEnabled: true },
    select: { id: true },
  });

  await p.radarSearchProfile.create({
    data: {
      tenantId: TDPAINT_TENANT_ID,
      name: 'TDPaint_SEA_Manufacturing_Painting',
      description: '搜索东南亚有涂装工序的制造商 — TDPaint 工序升级型客户',
      keywords: {
        en: [
          'automotive parts manufacturer painting line factory Vietnam Thailand Indonesia',
          'motorcycle parts manufacturer painting production line Vietnam Indonesia',
          'home appliance housing manufacturer spray painting factory Indonesia Philippines',
          'plastic injection molding manufacturer with painting line Southeast Asia',
          'metal stamping manufacturer painting finishing factory Vietnam Indonesia',
          'automotive bumper exterior trim manufacturer painting facility Southeast Asia',
          'electronics enclosure manufacturer painting line Malaysia Philippines',
          'furniture manufacturer painting line wood metal finishing Vietnam Indonesia Thailand',
        ],
      },
      negativeKeywords: [
        'paint supplier', 'paint distributor', 'coatings manufacturer',
        'paint manufacturer', 'coating supplier', 'paint dealer',
        'paint store', 'paint retailer', 'auto refinish',
        'powder coating service', 'coating equipment supplier',
        'paint brand', 'paint company',
      ],
      targetCountries: ['VN', 'TH', 'ID', 'MY', 'PH'],
      targetRegions: ['APAC'],
      industryCodes: ['automotive', 'motorcycle', 'appliance', 'electronics', 'plastics', 'metal_fabrication', 'furniture', 'manufacturing'],
      sourceIds: sources.map(s => s.id),
      enabledChannels: ['DIRECTORY', 'CUSTOM'],
      scheduleRule: '0 6 * * *',
      isActive: true,
      autoQualify: true,
      autoEnrich: false,
      nextRunAt: new Date(),
    },
  });

  console.log('✓ New profile created!');
  await p.$disconnect();
}

main().catch(e => { console.error('Fatal:', e.message?.slice(0, 200)); process.exit(1); });
