/**
 * 测试完整的认证流程
 */

import 'dotenv/config';
import { Pool } from 'pg';
import bcrypt from 'bcryptjs';

async function testAuthFlow() {
  console.log('🔐 测试认证流程\n');
  console.log('═'.repeat(60));
  
  // 1. 检查环境变量
  console.log('\n📋 环境变量检查:');
  console.log(`   DATABASE_URL: ${process.env.DATABASE_URL ? '✅ 已配置' : '❌ 未配置'}`);
  console.log(`   JWT_SECRET: ${process.env.JWT_SECRET ? '✅ 已配置' : '❌ 未配置'}`);
  console.log(`   NEXT_PUBLIC_BASE_DOMAIN: ${process.env.NEXT_PUBLIC_BASE_DOMAIN || 'vertax.pro'}`);
  
  // 2. 连接数据库
  console.log('\n💾 数据库连接测试...');
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  
  const client = await pool.connect();
  try {
    await client.query('SELECT 1');
    console.log('   ✅ 数据库连接成功');
    
    // 3. 查询用户
    console.log('\n👤 查询用户...');
    const email = 'admin@tdpaint.com';
    const userResult = await client.query(
      'SELECT id, email, name, password, "tenantId", "roleId" FROM "User" WHERE email = $1',
      [email]
    );
    
    if (userResult.rows.length === 0) {
      console.log('   ❌ 用户不存在');
      return;
    }
    
    const user = userResult.rows[0];
    console.log('   ✅ 用户找到');
    console.log(`      ID: ${user.id}`);
    console.log(`      Email: ${user.email}`);
    console.log(`      Name: ${user.name}`);
    console.log(`      TenantId: ${user.tenantId}`);
    console.log(`      RoleId: ${user.roleId}`);
    
    // 4. 验证密码
    console.log('\n🔑 密码验证...');
    const testPassword = 'Tdpaint2026!';
    const isValid = await bcrypt.compare(testPassword, user.password);
    console.log(`   密码：${testPassword}`);
    console.log(`   验证结果：${isValid ? '✅ 匹配' : '❌ 不匹配'}`);
    
    // 5. 查询租户信息
    if (user.tenantId) {
      console.log('\n🏢 租户信息...');
      const tenantResult = await client.query(
        'SELECT id, name, slug, domain FROM "Tenant" WHERE id = $1',
        [user.tenantId]
      );
      
      if (tenantResult.rows.length > 0) {
        const tenant = tenantResult.rows[0];
        console.log('   ✅ 租户找到');
        console.log(`      Slug: ${tenant.slug}`);
        console.log(`      Name: ${tenant.name}`);
        console.log(`      Domain: ${tenant.domain || 'N/A'}`);
      }
    }
    
    // 6. 查询角色信息
    if (user.roleId) {
      console.log('\n🎭 角色信息...');
      const roleResult = await client.query(
        'SELECT id, name, "displayName", permissions FROM "Role" WHERE id = $1',
        [user.roleId]
      );
      
      if (roleResult.rows.length > 0) {
        const role = roleResult.rows[0];
        console.log('   ✅ 角色找到');
        console.log(`      Name: ${role.name}`);
        console.log(`      DisplayName: ${role.displayName}`);
        console.log(`      Permissions: ${JSON.stringify(role.permissions)}`);
      }
    }
    
    // 7. 模拟 NextAuth 返回的用户对象
    console.log('\n📦 NextAuth 用户对象:');
    const authUser = {
      id: user.id,
      email: user.email,
      name: user.name,
      tenantId: user.tenantId,
      tenantName: '涂豆科技',
      tenantSlug: 'tdpaint',
      roleId: user.roleId,
      roleName: '企业管理员',
      permissions: { all: true },
    };
    console.log('   ', JSON.stringify(authUser, null, 2));
    
    console.log('\n✅ 认证流程测试完成！');
    console.log('\n⚠️  如果本地测试成功但线上登录失败，可能是:');
    console.log('   1. Vercel 环境变量未正确配置');
    console.log('   2. Vercel 部署未使用最新的环境变量');
    console.log('   3. Prisma 在 Vercel 上的数据库连接问题');
    
  } catch (error: any) {
    console.error('\n❌ 错误:', error.message);
    console.error(error);
  } finally {
    client.release();
    await pool.end();
  }
}

testAuthFlow().catch(console.error);
