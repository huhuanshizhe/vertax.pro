"use server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function saveSocialKeywords(data: {
  coreKeywords: any[];
  longTailKeywords: any[];
  config?: Record<string, unknown>;
}) {
  const session = await auth();
  if (!session?.user?.tenantId) throw new Error("Unauthorized");

  return prisma.socialKeywordSet.upsert({
    where: { tenantId: session.user.tenantId },
    create: {
      tenantId: session.user.tenantId,
      coreKeywords: data.coreKeywords,
      longTailKeywords: data.longTailKeywords,
      config: data.config as any,
    },
    update: {
      coreKeywords: data.coreKeywords,
      longTailKeywords: data.longTailKeywords,
      config: data.config as any,
    },
  });
}

export async function loadSocialKeywords() {
  const session = await auth();
  if (!session?.user?.tenantId) return null;

  return prisma.socialKeywordSet.findUnique({
    where: { tenantId: session.user.tenantId },
  });
}
