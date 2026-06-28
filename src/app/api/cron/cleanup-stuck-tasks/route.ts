import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ensureCronAuthorized } from '@/lib/cron-auth';

/**
 * 自动清理卡住的搜索任务
 *
 * 逻辑：
 * 1. 查找所有状态为 RUNNING 且 startedAt 超过 10 分钟的任务
 * 2. 将这些任务标记为 FAILED
 * 3. 记录错误信息
 *
 * 建议：每 5 分钟执行一次
 */
export async function GET(req: NextRequest) {
  const authResult = ensureCronAuthorized(req);
  if (authResult) {
    return authResult;
  }

  try {
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);

    // 查找卡住的任务
    const stuckTasks = await prisma.radarTask.findMany({
      where: {
        status: 'RUNNING',
        startedAt: {
          lt: tenMinutesAgo,
        },
      },
      select: {
        id: true,
        name: true,
        startedAt: true,
        stats: true,
      },
    });

    if (stuckTasks.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No stuck tasks found',
        cleaned: 0,
      });
    }

    console.log(`[cleanup-stuck-tasks] Found ${stuckTasks.length} stuck tasks`);

    // 批量更新为 FAILED
    const updatePromises = stuckTasks.map(task =>
      prisma.radarTask.update({
        where: { id: task.id },
        data: {
          status: 'FAILED',
          completedAt: new Date(),
          errorMessage: 'Task was stuck in RUNNING state for more than 10 minutes',
          stats: {
            ...(task.stats as Record<string, unknown> || {}),
            autoCleanup: true,
            cleanupReason: 'Timeout - stuck in RUNNING state',
          },
        },
      })
    );

    await Promise.all(updatePromises);

    console.log(`[cleanup-stuck-tasks] Cleaned up ${stuckTasks.length} stuck tasks`);

    return NextResponse.json({
      success: true,
      message: 'Cleaned up stuck tasks',
      cleaned: stuckTasks.length,
      tasks: stuckTasks.map(t => ({
        id: t.id,
        name: t.name,
        startedAt: t.startedAt,
      })),
    });
  } catch (error) {
    console.error('[cleanup-stuck-tasks] Error:', error);
    return NextResponse.json(
      { error: 'Failed to cleanup stuck tasks' },
      { status: 500 }
    );
  }
}
