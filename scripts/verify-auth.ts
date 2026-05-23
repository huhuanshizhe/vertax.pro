/**
 * 验证认证配置和数据库连接
 */

import { Pool } from 'pg';
import bcrypt from 'bcryptjs';
import 'dotenv/config';

async function main() {
  console.log('🔐 验证认证配置\n');
  
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  const client = await pool.connect();
  try {
    // 1. 检查数据库连接
    console.log('✅ 数据库连接成功');
    
    // 2. 检查用户
    const userResult = await client.query(
      'SELECT id, email, name, password, "tenantId", "roleId" FROM "User" WHERE email = $1',
      ['admin@tdpaint.com']
    );
    
    if (userResult.rows.length === 0) {
      console.log('❌ 用户不存在：admin@tdpaint.com');
      return;
    }
    
    const user = userResult.rows[0];
    console.log('\n👤 用户信息:');
    console.log(`   Email: ${user.email}`);
    console.log(`   Name: ${user.name}`);
    console.log(`   TenantId: ${user.tenantId}`);
    console.log(`   RoleId: ${user.roleId}`);
    
    // 3. 验证密码
    const testPassword = 'Tdpaint2026!';
    const isValid = await bcrypt.compare(testPassword, user.password);
    console.log(`\n🔑 密码验证：${isValid ? '✅ 匹配' : '❌ 不匹配'}`);
    
    if (!isValid) {
      console.log('\n⚠️  正在重置密码...');
      const hashedPassword = await bcrypt.hash(testPassword, 10);
      await client.query(
        'UPDATE "User" SET password = $1 WHERE id = $2',
        [hashedPassword, user.id]
      );
      console.log('✅ 密码已重置为：Tdpaint2026!');
    }
    
    // 4. 检查租户
    const tenantResult = await client.query(
      'SELECT id, name, slug, domain FROM "Tenant" WHERE id = $1',
      [user.tenantId]
    );
    
    if (tenantResult.rows.length > 0) {
      const tenant = tenantResult.rows[0];
      console.log('\n🏢 租户信息:');
      console.log(`   Slug: ${tenant.slug}`);
      console.log(`   Name: ${tenant.name}`);
      console.log(`   Domain: ${tenant.domain}`);
    }
    
    // 5. 检查角色
    const roleResult = await client.query(
      'SELECT id, name, "displayName", permissions FROM "Role" WHERE id = $1',
      [user.roleId]
    );
    
    if (roleResult.rows.length > 0) {
      const role = roleResult.rows[0];
      console.log('\n🎭 角色信息:');
      console.log(`   Name: ${role.name}`);
      console.log(`   DisplayName: ${role.displayName}`);
      console.log(`   Permissions: ${JSON.stringify(role.permissions)}`);
    }
    
    // 6. 检查环境变量
    console.log('\n⚙️  环境变量:');
    console.log(`   DATABASE_URL: ${process.env.DATABASE_URL ? '✅ 已配置' : '❌ 未配置'}`);
    console.log(`   JWT_SECRET: ${process.env.JWT_SECRET ? '✅ 已配置' : '❌ 未配置'}`);
    console.log(`   NEXT_PUBLIC_BASE_DOMAIN: ${process.env.NEXT_PUBLIC_BASE_DOMAIN || 'vertax.pro'}`);
    
    console.log('\n✅ 验证完成！');
    
  } catch (error: any) {
    console.error('❌ 错误:', error.message);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(console.error);
