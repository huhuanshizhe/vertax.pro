import { prisma } from '../src/lib/prisma';

async function main() {
  const tasks = await prisma.radarTask.findMany({
    where: { status: { in: ['FAILED', 'RUNNING'] } },
    orderBy: { startedAt: 'desc' },
    take: 5,
  });
  for (const t of tasks) {
    console.log(JSON.stringify({
      id: t.id,
      name: t.name,
      status: t.status,
      error: t.errorMessage,
      startedAt: t.startedAt,
      completedAt: t.completedAt,
      stats: t.stats,
      queryConfig: t.queryConfig,
    }, null, 2));
    console.log('---');
  }
  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
