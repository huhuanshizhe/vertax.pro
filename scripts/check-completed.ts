import { prisma } from '../src/lib/prisma';

async function main() {
  const tasks = await prisma.radarTask.findMany({
    where: { status: 'COMPLETED' },
    orderBy: { completedAt: 'desc' },
    take: 5,
  });
  console.log('=== 最近完成的任务 ===');
  for (const t of tasks) {
    console.log(JSON.stringify({
      name: t.name,
      status: t.status,
      stats: t.stats,
      completedAt: t.completedAt,
      queryConfig: t.queryConfig,
    }, null, 2));
    console.log('---');
  }
  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
