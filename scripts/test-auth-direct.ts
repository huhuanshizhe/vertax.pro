/**
 * 直接测试认证逻辑(绕过 NextAuth)
 */

import { compare } from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import "dotenv/config";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function testAuthDirectly() {
  console.log("🧪 直接测试认证逻辑...\n");

  const email = "admin@tdpaint.com";
  const password = "Tdpaint2026!";

  try {
    // 模拟 authorize 函数的完整流程
    console.log("1️⃣ 查找用户...");
    const user = await prisma.user.findUnique({
      where: { email },
      include: { role: true, tenant: true },
    });

    if (!user || !user.password) {
      console.log("❌ 用户不存在或无密码!");
      return;
    }

    console.log("✅ 用户存在");
    console.log(`   ID: ${user.id}`);
    console.log(`   Email: ${user.email}`);
    console.log(`   Has Role: ${!!user.role}`);
    console.log();

    // 验证密码
    console.log("2️ 验证密码...");
    const isValid = await compare(password, user.password);
    
    if (!isValid) {
      console.log(" 密码不正确!");
      return;
    }

    console.log("✅ 密码正确\n");

    // 检查角色
    console.log("3️⃣ 检查角色...");
    if (!user.role) {
      console.log("❌ 用户没有分配角色!");
      return;
    }

    console.log("✅ 角色存在");
    console.log(`   Name: ${user.role.name}`);
    console.log(`   Permissions: ${JSON.stringify(user.role.permissions)}`);
    console.log();

    // 更新最后登录时间
    console.log("4️⃣ 更新 lastLoginAt...");
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });
    console.log("✅ 更新成功\n");

    // 构建返回数据
    console.log("5️ 构建返回数据...");
    const authResult = {
      id: user.id,
      email: user.email,
      name: user.name,
      image: user.image,
      tenantId: user.tenantId ?? undefined,
      tenantName: user.tenant?.name ?? '',
      tenantSlug: user.tenant?.slug ?? '',
      roleId: user.roleId,
      roleName: user.role.name,
      permissions: user.role.permissions as string[],
    };

    console.log("✅ 返回数据:");
    console.log(JSON.stringify(authResult, null, 2));

    console.log("\n🎉 认证逻辑完全正常!");
    console.log("\n💡 如果网页上仍然无法登录,问题可能出在:");
    console.log("   1. NextAuth 路由配置问题");
    console.log("   2. CSRF token 问题");
    console.log("   3. Session cookie 设置问题");
    console.log("   4. 前端 signIn 调用方式问题");
    
  } catch (error: any) {
    console.error("❌ 认证过程中发生错误:", error.message);
    console.error("详细错误:", error);
  }
}

testAuthDirectly()
  .catch((error) => {
    console.error("❌ 未捕获的错误:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
