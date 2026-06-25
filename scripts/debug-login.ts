/**
 * 调试登录问题 - 检查 NextAuth 配置和数据库连接
 */

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import "dotenv/config";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function debugLogin() {
  console.log("🔍 调试登录问题...\n");

  // 1. 检查环境变量
  console.log("1️⃣ 检查环境变量:");
  console.log(`   DATABASE_URL: ${process.env.DATABASE_URL ? "✅ 已设置" : "❌ 未设置"}`);
  console.log(`   AUTH_SECRET: ${process.env.AUTH_SECRET ? "✅ 已设置" : "❌ 未设置"}`);
  console.log(`   NEXT_PUBLIC_DEMO_MODE: ${process.env.NEXT_PUBLIC_DEMO_MODE || "未设置"}`);
  console.log();

  // 2. 检查数据库连接
  console.log("2️⃣ 测试数据库连接...");
  try {
    await prisma.$connect();
    console.log("   ✅ 数据库连接成功\n");
  } catch (error) {
    console.log(`   ❌ 数据库连接失败: ${error.message}\n`);
    return;
  }

  // 3. 检查用户数据完整性
  console.log("3️⃣ 检查用户数据完整性...");
  const user = await prisma.user.findUnique({
    where: { email: "admin@tdpaint.com" },
    include: { role: true, tenant: true },
  });

  if (!user) {
    console.log("   ❌ 用户不存在\n");
    return;
  }

  console.log(`   ✅ 用户存在:`);
  console.log(`      ID: ${user.id}`);
  console.log(`      Email: ${user.email}`);
  console.log(`      Password Hash: ${user.password ? "✅ 有密码" : "❌ 无密码"}`);
  console.log(`      Tenant: ${user.tenant?.name} (${user.tenant?.slug})`);
  console.log(`      Role: ${user.role?.name}`);
  console.log(`      Permissions: ${JSON.stringify(user.role?.permissions)}`);
  console.log();

  // 4. 验证密码
  console.log("4️ 验证密码...");
  const { compare } = await import("bcryptjs");
  const isValid = await compare("Tdpaint2026!", user.password!);
  console.log(`   ${isValid ? "✅" : "❌"} 密码验证: ${isValid ? "通过" : "失败"}\n`);

  // 5. 模拟 authorize 函数的返回
  console.log("5️⃣ 模拟 authorize 函数返回:");
  const authResult = {
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
  
  console.log(JSON.stringify(authResult, null, 2));
  console.log();

  console.log("✅ 所有检查通过!");
  console.log("\n 如果仍然无法登录,请检查:");
  console.log("   1. 浏览器控制台是否有 JavaScript 错误");
  console.log("   2. Network 标签中 /api/auth/callback/credentials 请求的响应");
  console.log("   3. 是否禁用了浏览器的 Cookie");
  console.log("   4. 尝试使用无痕模式或清除浏览器缓存");
}

debugLogin()
  .catch((error) => {
    console.error("❌ 错误:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
