const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');

const db = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL || "postgresql://neondb_owner:npg_LhyV0pkf5dXo@ep-ancient-cherry-aill6whf-pooler.c-4.us-east-1.aws.neon.tech/neondb?sslmode=require"
    }
  }
});

async function main() {
  // Get a real tenant
  const tenant = await db.tenant.findFirst({ select: { id: true } });
  console.log('Using tenant:', tenant.id);

  // Create a test task
  const task = await db.crawlQueue.create({
    data: {
      tenantId: tenant.id,
      userId: "test-user",
      batchId: crypto.randomUUID(),
      rootUrl: "https://www.farmetra.com/",
      totalPages: 1,
      processedPages: 0,
      status: "pending",
      urls: [{
        url: "https://www.farmetra.com/",
        status: "pending",
        priority: 1,
      }],
      metadata: {
        discoveryMethod: "incremental-crawl",
        languagePrefix: null,
        maxPagesRequested: 50,
        requestedAt: new Date().toISOString(),
      },
    },
  });

  console.log('Created task:', task.id);

  // Trigger cron with longer timeout
  const CRON_SECRET = "88aa159a6f5b0395ba8d2c13fa587fd6c231a1e675d05e6224bc21ffff2e27aa";
  console.log('Triggering cron...');
  const res = await fetch("https://vertax.pro/api/cron/web-crawl", {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${CRON_SECRET}`,
    },
    signal: AbortSignal.timeout(300000),
  });

  console.log('Cron status:', res.status);
  const body = await res.text();
  console.log('Cron response:', body.slice(0, 2000));

  // Check task after processing
  await new Promise(r => setTimeout(r, 3000));
  const updated = await db.crawlQueue.findUnique({ where: { id: task.id } });
  console.log('\n=== After processing ===');
  console.log('Status:', updated.status);
  console.log('Total:', updated.totalPages);
  console.log('Processed:', updated.processedPages);
  console.log('URLs count:', updated.urls.length);
  console.log('URLs:', JSON.stringify(updated.urls, null, 2));

  await db.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
