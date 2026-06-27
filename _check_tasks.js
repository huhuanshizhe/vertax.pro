const { PrismaClient } = require('@prisma/client');

const db = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL || "postgresql://neondb_owner:npg_LhyV0pkf5dXo@ep-ancient-cherry-aill6whf-pooler.c-4.us-east-1.aws.neon.tech/neondb?sslmode=require"
    }
  }
});

async function main() {
  const tasks = await db.crawlQueue.findMany({
    where: {
      userId: { not: "test-user" }
    },
    orderBy: { createdAt: 'desc' },
    take: 5,
  });
  for (const t of tasks) {
    console.log('=== Task ===');
    console.log('ID:', t.id);
    console.log('UserId:', t.userId);
    console.log('Status:', t.status);
    console.log('Root:', t.rootUrl);
    console.log('Total:', t.totalPages, 'Processed:', t.processedPages);
    console.log('Metadata:', JSON.stringify(t.metadata, null, 2));
    console.log('URLs count:', t.urls.length);
    const statuses = t.urls.reduce((acc, u) => {
      acc[u.status] = (acc[u.status] || 0) + 1;
      return acc;
    }, {});
    console.log('URL statuses:', statuses);
    console.log('');
  }
  await db.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
