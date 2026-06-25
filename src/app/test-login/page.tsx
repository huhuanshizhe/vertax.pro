"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";

export default function TestLogin() {
  const [email, setEmail] = useState("admin@tdpaint.com");
  const [password, setPassword] = useState("Tdpaint2026!");
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  async function handleLogin() {
    setLoading(true);
    setResult(null);

    try {
      const res = await signIn("credentials", {
        email,
        password,
        redirect: false,
      });

      setResult({
        success: !res?.error,
        error: res?.error,
        status: res?.status,
        url: res?.url,
        ok: res?.ok,
      });
    } catch (error: any) {
      setResult({
        success: false,
        error: error.message || String(error),
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-md mx-auto bg-white rounded-lg shadow p-6">
        <h1 className="text-2xl font-bold mb-6"> 登录测试页面</h1>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">邮箱</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3 py-2 border rounded"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">密码</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3 py-2 border rounded"
            />
          </div>

          <button
            onClick={handleLogin}
            disabled={loading}
            className="w-full bg-blue-500 text-white py-2 rounded hover:bg-blue-600 disabled:opacity-50"
          >
            {loading ? "登录中..." : "测试登录"}
          </button>
        </div>

        {result && (
          <div className={`mt-6 p-4 rounded ${result.success ? 'bg-green-50' : 'bg-red-50'}`}>
            <h2 className="font-semibold mb-2">
              {result.success ? "✅ 登录成功!" : "❌ 登录失败"}
            </h2>
            <pre className="text-xs overflow-auto bg-white p-2 rounded border">
              {JSON.stringify(result, null, 2)}
            </pre>
          </div>
        )}

        <div className="mt-6 text-sm text-gray-600">
          <p><strong>💡 说明:</strong></p>
          <ul className="list-disc list-inside mt-2 space-y-1">
            <li>这个页面直接调用 NextAuth 的 signIn 函数</li>
            <li>如果这里能登录成功,说明认证逻辑没问题</li>
            <li>如果这里也失败,请查看浏览器控制台的详细错误</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
