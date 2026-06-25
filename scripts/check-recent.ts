import { prisma } from '../src/lib/prisma';

async function main() {
  // 找所有最近10分钟创建的候选
  const recent = await prisma.radarCandidate.findMany({
    where: { createdAt: { gte: new Date(Date.now() - 30 * 60 * 1000) } },
    orderBy: { createdAt: 'desc' },
    select: { id: true, displayName: true, country: true, createdAt: true, taskId: true, externalId: true },
    take: 30,
  });
  console.log('=== 最近30分钟新增的所有候选 ===');
  for (const c of recent) {
    const task = c.taskId ? await prisma.radarTask.findUnique({ where: { id: c.taskId }, select: { name: true, status: true } }) : null;
    console.log(JSON.stringify({
      name: c.displayName, country: c.country, task: task?.name, taskStatus: task?.status, createdAt: c.createdAt
    }, null, 2));
  }

  // 统计总数
  console.log(`\n总计: ${recent.length} 个候选在过去30分钟创建`);

  // 也检查下 candidate 总数
  const totalCandidates = await prisma.radarCandidate.count();
  console.log(`\n数据库总候选数: ${totalCandidates}`);

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
