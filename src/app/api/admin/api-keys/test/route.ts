import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { isPlatformAdminRoleName } from '@/lib/permissions';
import { getAdapter, ensureAdaptersInitialized } from '@/lib/radar/adapters/registry';
import { prisma } from '@/lib/prisma';

async function getPlatformAdminUser(userId?: string) {
  if (!userId) return null;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { role: true },
  });

  if (!user || !isPlatformAdminRoleName(user.role.name)) {
    return null;
  }

  return user;
}

/**
 * POST /api/admin/api-keys/test
 * 测试指定 API 的连接
 */
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = await getPlatformAdminUser(session.user.id);
    if (!user) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { service } = await req.json();
    if (!service) {
      return NextResponse.json({ error: 'Service is required' }, { status: 400 });
    }

    ensureAdaptersInitialized();

    // 尝试获取适配器
    let adapter;
    try {
      adapter = getAdapter(service);
    } catch (error) {
      return NextResponse.json({
        success: false,
        error: `适配器未找到: ${service}`,
        message: '该服务可能没有对应的适配器实现',
      });
    }

    // 执行健康检查
    const startTime = Date.now();
    const health = await adapter.healthCheck();
    const latency = Date.now() - startTime;

    if (health.healthy) {
      return NextResponse.json({
        success: true,
        message: '连接成功',
        latency: `${latency}ms`,
        health,
      });
    } else {
      return NextResponse.json({
        success: false,
        error: health.error || '连接失败',
        latency: `${latency}ms`,
        health,
      });
    }
  } catch (error) {
    console.error('[API Test] Error:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : '测试失败',
    }, { status: 500 });
  }
}
