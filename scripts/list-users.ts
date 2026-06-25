import { prisma } from '../src/lib/prisma';

async function main() {
  const users = await prisma.user.findMany({
    select: { email: true, name: true, tenant: { select: { slug: true, name: true } } }
  });
  console.log('=== 用户列表 ===');
  for (const u of users) {
    console.log(`邮箱: ${u.email} | 姓名: ${u.name || '-'} | 租户: ${u.tenant?.slug || '-'} (${u.tenant?.name || '-'})`);
  }

  const tenants = await prisma.tenant.findMany({ select: { slug: true, name: true } });
  console.log('\n=== 租户列表 ===');
  for (const t of tenants) {
    console.log(`${t.slug} → ${t.name}`);
  }

  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
