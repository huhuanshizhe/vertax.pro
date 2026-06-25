/**
 * 测试 NextAuth 登录 API
 */

import "dotenv/config";

async function testNextAuthLogin() {
  console.log("🧪 测试 NextAuth 登录 API...\n");

  const email = "admin@tdpaint.com";
  const password = "Tdpaint2026!";

  try {
    // 模拟浏览器请求
    const response = await fetch("http://localhost:3000/api/auth/callback/credentials", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email,
        password,
        redirect: false,
      }),
    });

    console.log(`响应状态: ${response.status}`);
    console.log(`响应头:`, Object.fromEntries(response.headers.entries()));
    
    const text = await response.text();
    console.log(`\n响应体:\n${text}`);

    if (response.ok) {
      console.log("\n✅ 登录成功!");
    } else {
      console.log("\n❌ 登录失败!");
      console.log("可能原因:");
      console.log("  - 服务器未运行");
      console.log("  - CSRF token 缺失或无效");
      console.log("  - 认证逻辑有问题");
    }
  } catch (error) {
    console.error("❌ 请求失败:", error.message);
    console.log("\n💡 请确保本地开发服务器正在运行: npm run dev");
  }
}

testNextAuthLogin();
