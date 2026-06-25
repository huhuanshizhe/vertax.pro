/**
 * 检查 NextAuth 配置是否正确加载
 */

import { auth } from "@/lib/auth";

console.log("[DEBUG] auth module loaded");
console.log("[DEBUG] auth handlers:", !!auth);

export default async function handler(req: any, res: any) {
  console.log("[DEBUG] Test route called");
  res.json({ message: "Test route working", timestamp: new Date() });
}
