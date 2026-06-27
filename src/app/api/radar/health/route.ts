import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { generateHealthReport } from "@/lib/radar/health-monitor";

export const dynamic = "force-dynamic";

/**
 * GET /api/radar/health
 *
 * 获取获客雷达健康状态（需认证）
 */
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.tenantId) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const report = await generateHealthReport();

    return NextResponse.json({
      ok: true,
      ...report,
    });
  } catch (error) {
    console.error("[RadarHealth] Error:", error);

    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown error",
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}
