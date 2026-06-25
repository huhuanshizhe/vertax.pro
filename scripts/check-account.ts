/**
 * 检查 tdpaint 账号是否存在
 */

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import "dotenv/config";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log("🔍 检查 tdpaint 租户...");
  
  const tenant = await prisma.tenant.findUnique({
    where: { slug: "tdpaint" },
  });

  if (!tenant) {
    console.log("❌ tdpaint 租户不存在!");
    return;
  }

  console.log("✅ tdpaint 租户存在:", JSON.stringify(tenant, null, 2));

  console.log("\n🔍 检查该租户下的用户...");
  
  const users = await prisma.user.findMany({
    where: { tenantId: tenant.id },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      password: true,
    },
  });

  if (users.length === 0) {
    console.log("❌ 该租户下没有任何用户!");
    return;
  }

  console.log(`✅ 找到 ${users.length} 个用户:`);
  users.forEach((user, idx) => {
    console.log(`\n用户 ${idx + 1}:`);
    console.log(`  ID: ${user.id}`);
    console.log(`  Email: ${user.email}`);
    console.log(`  Name: ${user.name}`);
    console.log(`  Role: ${user.role}`);
    console.log(`  Password: ${user.password?.substring(0, 30)}...`);
    
    // 检查是否是 admin@tdpaint.com
    if (user.email === "admin@tdpaint.com") {
      console.log("  ✅ 这是我们要找的 admin@tdpaint.com 账号!");
    }
  });
}

main()
  .catch((error) => {
    console.error("❌ 错误:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
