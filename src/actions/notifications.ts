'use server';

import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { revalidatePath } from 'next/cache';

// 容错包装：数据库偶发连接断开时不崩溃页面
async function safeCall<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    console.error('[notifications] DB error, returning fallback:', (e as Error).message);
    return fallback;
  }
}

export async function getNotifications(limit = 20) {
  const session = await auth();
  if (!session?.user?.tenantId) return [];

  return safeCall(() => db.notification.findMany({
    where: { tenantId: session.user.tenantId },
    orderBy: { createdAt: 'desc' },
    take: limit,
  }), []);
}

export async function getUnreadCount() {
  const session = await auth();
  if (!session?.user?.tenantId) return 0;

  return safeCall(() => db.notification.count({
    where: { tenantId: session.user.tenantId, readAt: null },
  }), 0);
}

export async function markNotificationRead(id: string) {
  return markAsRead(id);
}

export async function markAsRead(id: string) {
  const session = await auth();
  if (!session?.user?.tenantId) return { success: false };

  await db.notification.update({
    where: {
      id,
      tenantId: session.user.tenantId,
    },
    data: {
      readAt: new Date(),
    },
  });

  revalidatePath('/');
  return { success: true };
}

export async function markAllAsRead() {
  const session = await auth();
  if (!session?.user?.tenantId) return { success: false };

  await db.notification.updateMany({
    where: {
      tenantId: session.user.tenantId,
      readAt: null,
    },
    data: {
      readAt: new Date(),
    },
  });

  revalidatePath('/');
  return { success: true };
}

/**
 * 内部辅助函数：创建通知
 */
export async function createNotification(data: {
  tenantId: string;
  type: 'tier_a_lead' | 'geo_citation' | 'publish_failed' | 'system';
  title: string;
  body: string;
  actionUrl?: string;
}) {
  return await db.notification.create({
    data,
  });
}
