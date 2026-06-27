import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { requireDecider } from '@/lib/permissions';
import {
  getAllApiHealth,
  API_REGISTRY,
  flushUsageToDb,
  loadUsageFromDb,
  startUsageFlusher,
} from '@/lib/services/api-usage-tracker';

// 启动时加载历史数据 + 启动定期刷新
let initialized = false;
async function ensureInit() {
  if (initialized) return;
  await loadUsageFromDb();
  startUsageFlusher();
  initialized = true;
}

/**
 * GET /api/admin/api-health
 * 获取所有外部 API 的实时健康状态
 */
export async function GET(req: NextRequest) {
  const session = await auth();
  const decider = requireDecider(session);
  if (!decider.authorized) {
    return NextResponse.json({ error: decider.error }, { status: 401 });
  }

  await ensureInit();

  const health = await getAllApiHealth();

  // 汇总统计
  const totalCallsToday = health.reduce((sum, h) => sum + h.todayUsage.calls, 0);
  const totalErrorsToday = health.reduce((sum, h) => sum + h.todayUsage.errors, 0);
  const paidApis = health.filter(h => !h.isFree);
  const freeApis = health.filter(h => h.isFree);
  const warningApis = health.filter(h => h.quotaStatus === 'warning' || h.quotaStatus === 'exhausted');

  // 按类别分组
  const byCategory: Record<string, typeof health> = {};
  for (const h of health) {
    if (!byCategory[h.category]) byCategory[h.category] = [];
    byCategory[h.category].push(h);
  }

  // 强制刷新到 DB（管理员查看时触发）
  await flushUsageToDb();

  return NextResponse.json({
    ok: true,
    timestamp: new Date().toISOString(),
    summary: {
      totalApis: API_REGISTRY.length,
      totalCallsToday,
      totalErrorsToday,
      errorRate: totalCallsToday > 0
        ? Math.round((totalErrorsToday / totalCallsToday) * 10000) / 100
        : 0,
      paidApiCount: paidApis.length,
      freeApiCount: freeApis.length,
      warningCount: warningApis.length,
    },
    byCategory,
    apis: health,
  });
}

/**
 * POST /api/admin/api-health
 * 手动刷新用量数据到 DB
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  const decider = requireDecider(session);
  if (!decider.authorized) {
    return NextResponse.json({ error: decider.error }, { status: 401 });
  }

  await flushUsageToDb();

  return NextResponse.json({ ok: true, message: 'Usage data flushed to DB' });
}
