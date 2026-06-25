/**
 * 检查用户角色关联
 */

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import "dotenv/config";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function checkUserRole() {
  console.log("🔍 检查用户角色关联...\n");

  // 1. 查找用户
  const user = await prisma.user.findUnique({
    where: { email: "admin@tdpaint.com" },
    include: { role: true, tenant: true },
  });

  if (!user) {
    console.log("❌ 用户不存在!");
    return;
  }

  console.log("✅ 用户信息:");
  console.log(`   ID: ${user.id}`);
  console.log(`   Email: ${user.email}`);
  console.log(`   Name: ${user.name}`);
  console.log(`   Tenant: ${user.tenant?.name} (${user.tenant?.slug})`);
  console.log(`   RoleId: ${user.roleId}`);
  console.log();

  // 2. 检查角色是否存在
  if (user.roleId) {
    console.log(" 检查角色...");
    const role = await prisma.role.findUnique({
      where: { id: user.roleId },
    });

    if (!role) {
      console.log(`❌ 角色不存在! roleId: ${user.roleId}`);
      console.log("\n💡 需要创建角色或修复用户的 roleId");
    } else {
      console.log("✅ 角色存在:");
      console.log(`   ID: ${role.id}`);
      console.log(`   Name: ${role.name}`);
      console.log(`   Permissions: ${JSON.stringify(role.permissions)}`);
    }
  } else {
    console.log("❌ 用户没有分配角色 (roleId is null)");
  }

  console.log();

  // 3. 列出所有可用的角色
  console.log(" 数据库中的所有角色:");
  const roles = await prisma.role.findMany({
    orderBy: { name: "asc" },
  });

  if (roles.length === 0) {
    console.log("   ❌ 没有任何角色!");
  } else {
    roles.forEach((role) => {
      console.log(`   - ${role.name} (${role.id})`);
    });
  }
}

checkUserRole()
  .catch((error) => {
    console.error("❌ 错误:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
