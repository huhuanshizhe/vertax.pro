import { prisma } from '../src/lib/prisma';

async function main() {
  // 1. 查看 TDPaint 租户现有源
  const sources = await prisma.radarSource.findMany({
    where: { tenantId: 'cmmanspb30000anfp2ldflrov' },
    select: { id: true, name: true, code: true, channelType: true, isEnabled: true, countries: true }
  });
  console.log('=== TDPaint Existing Sources ===');
  console.log(JSON.stringify(sources, null, 2));
  console.log(`Total: ${sources.length}`);

  // 2. 系统级源
  const systemSources = await prisma.radarSource.findMany({
    where: { tenantId: null },
    select: { id: true, name: true, code: true, channelType: true, isEnabled: true }
  });
  console.log('\n=== System Sources ===');
  console.log(JSON.stringify(systemSources, null, 2));
  console.log(`Total: ${systemSources.length}`);

  // 3. 已有任务
  const tasks = await prisma.radarTask.findMany({
    where: { tenantId: 'cmmanspb30000anfp2ldflrov' },
    select: { id: true, status: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
    take: 5,
  });
  console.log('\n=== Recent Tasks ===');
  console.log(JSON.stringify(tasks, null, 2));

  // 4. 已有候选人
  const candidateCount = await prisma.radarCandidate.count({
    where: { source: { tenantId: 'cmmanspb30000anfp2ldflrov' } }
  });
  console.log(`\nExisting candidates: ${candidateCount}`);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
