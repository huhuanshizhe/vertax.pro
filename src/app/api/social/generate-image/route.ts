import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";

/**
 * 文生图 API — 调用阿里云 DashScope 生成配图
 * 免费且快速，不需要额外配置
 */
export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.tenantId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { prompt } = await request.json();
    if (!prompt) {
      return NextResponse.json({ error: "Prompt is required" }, { status: 400 });
    }

    const apiKey = process.env.IMAGE_API_KEY;
    const model = process.env.IMAGE_MODEL || "wanx2.1-t2i-turbo";
    // DashScope wanx 模型使用 image-generation 端点
    const baseUrl = "https://dashscope.aliyuncs.com/api/v1";

    if (!apiKey) {
      return NextResponse.json({ error: "IMAGE_API_KEY not configured" }, { status: 500 });
    }

    // DashScope wanx 文生图
    const response = await fetch(
      `${baseUrl}/services/aigc/image-generation/generation`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
          "X-DashScope-Async": "enable",
        },
        body: JSON.stringify({
          model,
          input: { prompt },
          parameters: { size: "1024*1024", n: 1 },
        }),
      }
    );

    const data = await response.json();

    if (!response.ok || data.code) {
      console.error("[generate-image] Error:", data);
      return NextResponse.json(
        { error: data.message || data.code || "Image generation failed" },
        { status: 500 }
      );
    }

    // DashScope 返回 output.task_id，需要轮询获取结果
    const taskId = data.output?.task_id;
    if (!taskId) {
      console.error("[generate-image] No task_id:", data);
      return NextResponse.json({ error: "No task_id returned" }, { status: 500 });
    }

    // 轮询获取结果（最多等待 60s）
    const imageUrl = await pollTaskResult(taskId, apiKey, baseUrl, 60000);
    if (!imageUrl) {
      return NextResponse.json({ error: "Image generation timeout" }, { status: 500 });
    }

    return NextResponse.json({ success: true, imageUrl });
  } catch (error) {
    console.error("[generate-image] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal error" },
      { status: 500 }
    );
  }
}

async function pollTaskResult(
  taskId: string,
  apiKey: string,
  baseUrl: string,
  timeout: number
): Promise<string | null> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const res = await fetch(
      `https://dashscope.aliyuncs.com/api/v1/tasks/${taskId}`,
      { headers: { Authorization: `Bearer ${apiKey}` } }
    );
    const data = await res.json();

    if (data.output?.task_status === "SUCCEEDED") {
      return data.output?.results?.[0]?.url || null;
    }
    if (data.output?.task_status === "FAILED") {
      console.error("[generate-image] Task failed:", data.output);
      return null;
    }
    // 等待 2 秒再试
    await new Promise((r) => setTimeout(r, 2000));
  }
  return null;
}
