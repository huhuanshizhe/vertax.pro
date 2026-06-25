/**
 * 测试登录功能
 */

import { compare } from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import "dotenv/config";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function testLogin() {
  console.log("🧪 测试登录流程...\n");

  const email = "admin@tdpaint.com";
  const password = "Tdpaint2026!";

  // 1. 查找用户
  console.log("1️ 查找用户...");
  const user = await prisma.user.findUnique({
    where: { email },
    include: { role: true, tenant: true },
  });

  if (!user || !user.password) {
    console.log("❌ 用户不存在或没有密码!");
    return;
  }

  console.log(`✅ 找到用户:`);
  console.log(`   ID: ${user.id}`);
  console.log(`   Email: ${user.email}`);
  console.log(`   Name: ${user.name}`);
  console.log(`   Tenant: ${user.tenant?.name} (${user.tenant?.slug})`);
  console.log(`   Role: ${user.role?.name}`);
  console.log();

  // 2. 验证密码
  console.log("2️ 验证密码...");
  const isValid = await compare(password, user.password);
  
  if (!isValid) {
    console.log("❌ 密码不正确!");
    return;
  }

  console.log("✅ 密码正确!\n");

  // 3. 模拟返回的用户数据(与 auth.ts 中的 authorize 函数一致)
  console.log("3️⃣ 模拟返回的用户数据:");
  const userData = {
    id: user.id,
    email: user.email,
    name: user.name,
    image: user.image,
    tenantId: user.tenantId ?? undefined,
    tenantName: user.tenant?.name ?? '',
    tenantSlug: user.tenant?.slug ?? '',
    roleId: user.roleId,
    roleName: user.role?.name,
    permissions: user.role?.permissions as string[],
  };

  console.log(JSON.stringify(userData, null, 2));

  console.log("\n✅ 登录测试成功!账号和密码都正确。");
  console.log("\n💡 如果网页上仍然无法登录,可能是以下原因:");
  console.log("   1. 浏览器缓存问题 - 尝试清除缓存或使用无痕模式");
  console.log("   2. NextAuth session 问题 - 检查 /api/auth/session 是否正常工作");
  console.log("   3. 前端代码问题 - 检查 login/page.tsx 中的 signIn 调用");
}

testLogin()
  .catch((error) => {
    console.error("❌ 错误:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
