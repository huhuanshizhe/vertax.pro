import { prisma } from '../src/lib/prisma';

async function main() {
  // 1. 找最近完成的印尼搜索任务
  const completedTasks = await prisma.radarTask.findMany({
    where: { status: 'COMPLETED', name: { contains: 'ID' } },
    orderBy: { completedAt: 'desc' },
    take: 5,
  });
  console.log('=== 已完成的印尼任务 ===');
  for (const t of completedTasks) {
    console.log(JSON.stringify({
      id: t.id, name: t.name, status: t.status,
      stats: t.stats, completedAt: t.completedAt,
      queryConfig: t.queryConfig,
    }, null, 2));
    console.log('---');
  }

  // 2. 找最近新增的印尼候选
  const recentCandidates = await prisma.radarCandidate.findMany({
    where: { country: { in: ['ID', 'Indonesia', '印尼'] } },
    orderBy: { createdAt: 'desc' },
    take: 10,
    select: { id: true, displayName: true, country: true, sourceId: true, taskId: true, createdAt: true, externalId: true }
  });
  console.log('\n=== 最近新增的印尼候选 ===');
  for (const c of recentCandidates) {
    // 找 task name
    const task = c.taskId ? await prisma.radarTask.findUnique({ where: { id: c.taskId }, select: { name: true } }) : null;
    console.log(JSON.stringify({
      id: c.id, displayName: c.displayName, country: c.country, taskName: task?.name, createdAt: c.createdAt
    }, null, 2));
  }

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
