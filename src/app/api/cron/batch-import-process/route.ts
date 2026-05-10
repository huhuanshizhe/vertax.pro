/**
 * Cron: 批量导入处理
 *
 * 每次调用处理一个活跃的 ImportBatch:
 * - IMPORTING 阶段: dedup → 创建 ProspectCompany (50 rows/chunk, 10 concurrency)
 * - ENRICHING 阶段: 调用 enrichProspectCompanyV2 (15 rows/chunk, 3 concurrency)
 *
 * 超时控制: 55s deadline (Vercel 60s limit - 5s buffer)
 * 失败重试: status=FAILED AND attempts < 3
 */

import { NextRequest, NextResponse } from 'next/server';
import { ensureCronAuthorized } from '@/lib/cron-auth';
import { processCronTick } from '@/lib/radar/batch-import-engine';

export async function GET(req: NextRequest) {
  const unauthorizedResponse = ensureCronAuthorized(req);
  if (unauthorizedResponse) {
    return unauthorizedResponse;
  }

  try {
    const result = await processCronTick();

    if (!result) {
      return NextResponse.json(
        { message: 'No active import batch to process' },
        { status: 200 }
      );
    }

    return NextResponse.json({
      batchId: result.batchId,
      phase: result.phase,
      processed: result.processed,
      remaining: result.remaining,
      hitDeadline: result.hitDeadline,
      errors: result.errors.slice(0, 10), // 只返回前 10 个错误
    });
  } catch (error) {
    console.error('[batch-import-process] Cron error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
