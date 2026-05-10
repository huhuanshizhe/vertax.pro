/**
 * Machrio 数据补全脚本
 *
 * 目标: 补全 ~40 家缺官网 + ~3 家缺联系方式的 ProspectCompany
 *
 * 用法:
 *   npx tsx scripts/machrio-supplement.ts [--dry-run]
 *
 * 设计:
 * - 使用 prospect-company-enrichment.ts 公共服务层
 * - 5 并行, 每个调用 15s timeout
 * - 输出统计汇总
 */

import { prisma } from '../src/lib/prisma';
import {
  searchCompanyWebsite,
  searchCompanyContacts,
} from '../src/lib/radar/prospect-company-enrichment';

const CONCURRENCY = 5;
const DRY_RUN = process.argv.includes('--dry-run');

interface Stats {
  totalMissingWebsite: number;
  totalMissingContacts: number;
  websiteFound: number;
  websiteFailed: number;
  contactsFound: number;
  contactsFailed: number;
}

async function main() {
  console.log('=== Machrio 数据补全脚本 ===');
  console.log(`模式: ${DRY_RUN ? 'DRY RUN (不写入)' : '正式运行'}`);
  console.log('');

  // 1. 找到 Machrio 租户
  const tenant = await prisma.tenant.findFirst({
    where: { slug: 'machrio' },
  });

  if (!tenant) {
    console.error('ERROR: Machrio 租户不存在');
    process.exit(1);
  }

  console.log(`租户: ${tenant.name} (${tenant.id})`);

  // 2. 查询缺官网的公司
  const missingWebsite = await prisma.prospectCompany.findMany({
    where: {
      tenantId: tenant.id,
      deletedAt: null,
      OR: [
        { website: null },
        { website: '' },
      ],
    },
    select: { id: true, name: true, country: true, website: true },
  });

  // 3. 查询缺联系方式的公司 (没有任何联系人)
  const missingContacts = await prisma.prospectCompany.findMany({
    where: {
      tenantId: tenant.id,
      deletedAt: null,
      contacts: { none: { deletedAt: null } },
    },
    select: { id: true, name: true, country: true, website: true },
  });

  const stats: Stats = {
    totalMissingWebsite: missingWebsite.length,
    totalMissingContacts: missingContacts.length,
    websiteFound: 0,
    websiteFailed: 0,
    contactsFound: 0,
    contactsFailed: 0,
  };

  console.log(`缺官网公司: ${missingWebsite.length} 家`);
  console.log(`缺联系方式公司: ${missingContacts.length} 家`);
  console.log('');

  if (DRY_RUN) {
    console.log('[DRY RUN] 仅输出统计，不写入数据库');
    console.log('');
    console.log('缺官网公司列表:');
    missingWebsite.forEach((c, i) => console.log(`  ${i + 1}. ${c.name} (${c.country || 'N/A'})`));
    console.log('');
    console.log('缺联系方式公司列表:');
    missingContacts.forEach((c, i) => console.log(`  ${i + 1}. ${c.name} (${c.country || 'N/A'})`));
    await prisma.$disconnect();
    return;
  }

  // 4. 补全官网 (分批并行)
  console.log('--- 阶段 1: 补全官网 ---');
  await processInChunks(missingWebsite, CONCURRENCY, async (company) => {
    try {
      const website = await searchCompanyWebsite(company.name, company.country);
      if (website) {
        await prisma.prospectCompany.update({
          where: { id: company.id },
          data: { website },
        });
        stats.websiteFound++;
        console.log(`  ✓ ${company.name} → ${website}`);
      } else {
        stats.websiteFailed++;
        console.log(`  ✗ ${company.name} — 未找到官网`);
      }
    } catch (error) {
      stats.websiteFailed++;
      console.log(`  ✗ ${company.name} — 错误: ${error instanceof Error ? error.message : 'Unknown'}`);
    }
  });

  // 5. 补全联系方式 (包括已有官网但无联系人的)
  console.log('');
  console.log('--- 阶段 2: 补全联系方式 ---');

  // 重新查询: 包含刚补全官网的
  const contactTargets = await prisma.prospectCompany.findMany({
    where: {
      tenantId: tenant.id,
      deletedAt: null,
      contacts: { none: { deletedAt: null } },
    },
    select: { id: true, name: true, country: true, website: true },
    take: 50, // 限制数量，避免过度消耗 API
  });

  console.log(`待补全联系人公司: ${contactTargets.length} 家`);

  await processInChunks(contactTargets, CONCURRENCY, async (company) => {
    try {
      const contacts = await searchCompanyContacts(
        company.name,
        company.website,
        company.country,
      );

      if (contacts.length > 0) {
        // 写入联系人
        for (const contact of contacts) {
          await prisma.prospectContact.create({
            data: {
              tenantId: tenant.id,
              companyId: company.id,
              name: contact.name,
              role: contact.title,
              email: contact.email || null,
              phone: contact.phone || null,
              linkedInUrl: contact.linkedIn || null,
              status: 'new',
              notes: 'Machrio 补全脚本自动发现',
            },
          });
        }

        // 更新 enrichment 状态
        await prisma.prospectCompany.update({
          where: { id: company.id },
          data: {
            enrichmentStatus: 'COMPLETED',
            lastEnrichedAt: new Date(),
          },
        });

        stats.contactsFound++;
        console.log(`  ✓ ${company.name} → ${contacts.length} 个联系人`);
      } else {
        stats.contactsFailed++;
        console.log(`  ✗ ${company.name} — 未找到联系人`);
      }
    } catch (error) {
      stats.contactsFailed++;
      console.log(`  ✗ ${company.name} — 错误: ${error instanceof Error ? error.message : 'Unknown'}`);
    }
  });

  // 6. 输出汇总
  console.log('');
  console.log('=== 补全结果汇总 ===');
  console.log(`官网补全: ${stats.websiteFound}/${stats.totalMissingWebsite} 成功`);
  console.log(`联系方式补全: ${stats.contactsFound}/${stats.totalMissingContacts} 成功`);
  console.log(`官网未找到: ${stats.websiteFailed}`);
  console.log(`联系方式未找到: ${stats.contactsFailed}`);

  // 最终覆盖率
  const totalCompanies = await prisma.prospectCompany.count({
    where: { tenantId: tenant.id, deletedAt: null },
  });
  const withWebsite = await prisma.prospectCompany.count({
    where: { tenantId: tenant.id, deletedAt: null, website: { not: null } },
  });
  const withContacts = await prisma.prospectCompany.count({
    where: {
      tenantId: tenant.id,
      deletedAt: null,
      contacts: { some: { deletedAt: null } },
    },
  });

  console.log('');
  console.log('=== 覆盖率 ===');
  console.log(`总公司数: ${totalCompanies}`);
  console.log(`有官网: ${withWebsite}/${totalCompanies} (${Math.round(withWebsite / totalCompanies * 100)}%)`);
  console.log(`有联系人: ${withContacts}/${totalCompanies} (${Math.round(withContacts / totalCompanies * 100)}%)`);

  await prisma.$disconnect();
}

/**
 * 分批并行处理
 */
async function processInChunks<T>(
  items: T[],
  concurrency: number,
  handler: (item: T) => Promise<void>,
): Promise<void> {
  for (let i = 0; i < items.length; i += concurrency) {
    const chunk = items.slice(i, i + concurrency);
    await Promise.allSettled(chunk.map(handler));
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
