/**
 * 验证 admin@tdpaint.com 的密码
 */

import { compare } from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import "dotenv/config";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log("🔐 验证 admin@tdpaint.com 的密码...\n");

  // 获取用户
  const tenant = await prisma.tenant.findUnique({
    where: { slug: "tdpaint" },
  });

  if (!tenant) {
    console.log("❌ tdpaint 租户不存在!");
    return;
  }

  const user = await prisma.user.findFirst({
    where: {
      email: "admin@tdpaint.com",
      tenantId: tenant.id,
    },
  });

  if (!user) {
    console.log("❌ admin@tdpaint.com 用户不存在!");
    return;
  }

  console.log(`✅ 找到用户: ${user.email}`);
  console.log(`   Name: ${user.name}`);
  console.log(`   Password Hash: ${user.password?.substring(0, 40)}...\n`);

  // 测试几个可能的密码
  const testPasswords = [
    "Tdpaint2026!",
    "password123",
    "admin123",
    "123456789",
  ];

  console.log("🧪 开始测试密码:\n");

  for (const password of testPasswords) {
    const isValid = await compare(password, user.password!);
    console.log(`  ${isValid ? "✅" : "❌"} 密码 "${password}": ${isValid ? "正确!" : "错误"}`);
    
    if (isValid) {
      console.log("\n🎉 找到正确的密码了!");
      break;
    }
  }

  // 如果没有找到匹配的,提示用户
  console.log("\n💡 如果以上密码都不对,可能需要重新设置密码。");
  console.log("   你可以运行以下命令来重置密码:");
  console.log("   npx tsx scripts/reset-password.ts admin@tdpaint.com YourNewPassword123!");
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
