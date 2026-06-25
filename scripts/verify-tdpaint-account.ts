/**
 * 验证并创建 tdpaint 测试账号
 */

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { hash } from "bcryptjs";
import "dotenv/config";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log(" 检查 tdpaint 租户...");
  
  // 1. 检查 tdpaint 租户是否存在
  const tdpaintTenant = await prisma.tenant.findUnique({
    where: { slug: "tdpaint" },
  });

  if (!tdpaintTenant) {
    console.log("❌ tdpaint 租户不存在,正在创建...");
    
    const createdTenant = await prisma.tenant.create({
      data: {
        name: "涂豆科技",
        slug: "tdpaint",
        plan: "pro",
        status: "active",
      },
    });
    
    console.log(`✅ 已创建 tdpaint 租户: ${createdTenant.id}`);
  } else {
    console.log(`✅ tdpaint 租户已存在: ${tdpaintTenant.id}`);
  }

  // 2. 检查 admin@tdpaint.com 用户是否存在
  const existingUser = await prisma.user.findUnique({
    where: { email: "admin@tdpaint.com" },
    include: { role: true, tenant: true },
  });

  if (existingUser) {
    console.log(`⚠️  用户 admin@tdpaint.com 已存在`);
    console.log(`   - ID: ${existingUser.id}`);
    console.log(`   - 租户: ${existingUser.tenant?.name} (${existingUser.tenant?.slug})`);
    console.log(`   - 角色: ${existingUser.role?.displayName}`);
    console.log(`   - 密码哈希: ${existingUser.password?.substring(0, 20)}...`);
    
    // 询问是否重新创建
    console.log("\n提示: 如果需要重新创建账号,请先在 Prisma Studio 中删除此用户");
  } else {
    console.log("🔨 创建 admin@tdpaint.com 用户...");
    
    // 获取 COMPANY_ADMIN 角色
    const companyAdminRole = await prisma.role.findUnique({
      where: { name: "COMPANY_ADMIN" },
    });

    if (!companyAdminRole) {
      throw new Error("❌ 未找到 COMPANY_ADMIN 角色,请先运行完整的种子脚本");
    }

    // 创建用户
    const password = "Tdpaint2026!";
    const hashedPassword = await hash(password, 10);
    
    const newUser = await prisma.user.create({
      data: {
        email: "admin@tdpaint.com",
        name: "TDPaint 管理员",
        password: hashedPassword,
        tenantId: tdpaintTenant!.id,
        roleId: companyAdminRole.id,
      },
      include: { role: true, tenant: true },
    });

    console.log(`✅ 已创建用户 admin@tdpaint.com`);
    console.log(`   - ID: ${newUser.id}`);
    console.log(`   - 租户: ${newUser.tenant.name} (${newUser.tenant.slug})`);
    console.log(`   - 角色: ${newUser.role.displayName}`);
    console.log(`   - 密码: ${password}`);
  }

  console.log("\n✅ 验证完成!");
  console.log("\n📝 登录信息:");
  console.log("   邮箱: admin@tdpaint.com");
  console.log("   密码: Tdpaint2026!");
  console.log("   租户: tdpaint (涂豆科技)");
  console.log("   角色: 企业管理员");
}

main()
  .catch((e) => {
    console.error("❌ 错误:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
