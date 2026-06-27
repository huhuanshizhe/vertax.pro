'use server';

// ==================== RFQ 询盘管理 Server Actions ====================

import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';

// ==================== Types ====================

export type InquiryStatus = 'new' | 'reading' | 'quoting' | 'quoted' | 'sampling' | 'ordered' | 'closed_won' | 'closed_lost';

export interface InquiryData {
  id: string;
  tenantId: string;
  source: string;
  sourceDetail: string | null;
  companyName: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  country: string | null;
  website: string | null;
  subject: string;
  bodyText: string | null;
  productInterest: string | null;
  quantity: string | null;
  targetPrice: string | null;
  deadline: Date | null;
  matchedCompanyId: string | null;
  matchedCandidateId: string | null;
  status: string;
  priority: string;
  assignedTo: string | null;
  quoteSentAt: Date | null;
  quoteAmount: number | null;
  quoteCurrency: string | null;
  receivedAt: Date;
  firstReplyAt: Date | null;
  closedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  notes: string | null;
  companyName_label?: string | null; // 关联公司的显示名
}

// ==================== CRUD ====================

/** 获取询盘列表 */
export async function getInquiries(options?: {
  status?: string;
  limit?: number;
  offset?: number;
}): Promise<{ inquiries: InquiryData[]; total: number }> {
  const session = await auth();
  if (!session?.user?.tenantId) throw new Error('Unauthorized');
  const tenantId = session.user.tenantId;

  const where: Record<string, unknown> = { tenantId };
  if (options?.status) where.status = options.status;

  const [inquiries, total] = await Promise.all([
    prisma.inquiry.findMany({
      where,
      orderBy: [
        { priority: 'desc' },
        { receivedAt: 'desc' },
      ],
      take: options?.limit || 50,
      skip: options?.offset || 0,
      include: {
        company: { select: { name: true } },
      },
    }),
    prisma.inquiry.count({ where }),
  ]);

  return {
    inquiries: inquiries.map(inq => ({
      ...inq,
      companyName_label: inq.company?.name || inq.companyName,
    })),
    total,
  };
}

/** 获取单个询盘 */
export async function getInquiry(id: string): Promise<InquiryData | null> {
  const session = await auth();
  if (!session?.user?.tenantId) throw new Error('Unauthorized');

  const inquiry = await prisma.inquiry.findFirst({
    where: { id, tenantId: session.user.tenantId },
    include: { company: { select: { name: true } } },
  });

  if (!inquiry) return null;

  // 标记为已读
  if (inquiry.status === 'new') {
    await prisma.inquiry.update({
      where: { id },
      data: { status: 'reading' },
    });
  }

  return { ...inquiry, companyName_label: inquiry.company?.name || inquiry.companyName };
}

/** 创建询盘（手动录入或从外部导入） */
export async function createInquiry(data: {
  source: string;
  sourceDetail?: string;
  companyName?: string;
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  country?: string;
  website?: string;
  subject: string;
  bodyText?: string;
  productInterest?: string;
  quantity?: string;
  targetPrice?: string;
  deadline?: Date;
  priority?: string;
}): Promise<InquiryData> {
  const session = await auth();
  if (!session?.user?.tenantId) throw new Error('Unauthorized');
  const tenantId = session.user.tenantId;

  // 尝试自动匹配线索库中的公司
  let matchedCompanyId: string | null = null;
  if (data.companyName || data.contactEmail) {
    matchedCompanyId = await autoMatchInquiryToCompany(tenantId, data.companyName, data.contactEmail, data.website);
  }

  const inquiry = await prisma.inquiry.create({
    data: {
      tenantId,
      source: data.source,
      sourceDetail: data.sourceDetail,
      companyName: data.companyName,
      contactName: data.contactName,
      contactEmail: data.contactEmail,
      contactPhone: data.contactPhone,
      country: data.country,
      website: data.website,
      subject: data.subject,
      bodyText: data.bodyText,
      productInterest: data.productInterest,
      quantity: data.quantity,
      targetPrice: data.targetPrice,
      deadline: data.deadline,
      priority: data.priority || 'medium',
      matchedCompanyId,
    },
  });

  revalidatePath('/customer/radar/inquiries');
  return inquiry;
}

/** 更新询盘状态 */
export async function updateInquiryStatus(
  id: string,
  status: InquiryStatus,
  notes?: string,
): Promise<InquiryData | null> {
  const session = await auth();
  if (!session?.user?.tenantId) throw new Error('Unauthorized');

  const updateData: Record<string, unknown> = { status };

  if (status === 'quoted') {
    updateData.quoteSentAt = new Date();
  }
  if (status === 'closed_won' || status === 'closed_lost') {
    updateData.closedAt = new Date();
  }
  // 首次回复时间
  if (['quoting', 'quoted', 'sampling', 'ordered'].includes(status)) {
    updateData.firstReplyAt = new Date();
  }
  if (notes) {
    updateData.notes = notes;
  }

  const inquiry = await prisma.inquiry.update({
    where: { id, tenantId: session.user.tenantId },
    data: updateData,
  });

  revalidatePath('/customer/radar/inquiries');
  return inquiry;
}

/** 更新询盘报价信息 */
export async function updateInquiryQuote(
  id: string,
  quote: { amount: number; currency: string },
): Promise<InquiryData | null> {
  const session = await auth();
  if (!session?.user?.tenantId) throw new Error('Unauthorized');

  const inquiry = await prisma.inquiry.update({
    where: { id, tenantId: session.user.tenantId },
    data: {
      quoteAmount: quote.amount,
      quoteCurrency: quote.currency,
      quoteSentAt: new Date(),
      status: 'quoted',
    },
  });

  revalidatePath('/customer/radar/inquiries');
  return inquiry;
}

/** 手动关联询盘到线索库公司 */
export async function linkInquiryToCompany(
  inquiryId: string,
  companyId: string,
): Promise<InquiryData | null> {
  const session = await auth();
  if (!session?.user?.tenantId) throw new Error('Unauthorized');
  const tenantId = session.user.tenantId;

  // 验证公司属于当前租户
  const company = await prisma.prospectCompany.findFirst({
    where: { id: companyId, tenantId },
  });
  if (!company) throw new Error('Company not found');

  const inquiry = await prisma.inquiry.update({
    where: { id: inquiryId, tenantId },
    data: { matchedCompanyId: companyId },
  });

  revalidatePath('/customer/radar/inquiries');
  return inquiry;
}

/** 删除询盘 */
export async function deleteInquiry(id: string): Promise<boolean> {
  const session = await auth();
  if (!session?.user?.tenantId) throw new Error('Unauthorized');

  await prisma.inquiry.delete({
    where: { id, tenantId: session.user.tenantId },
  });

  revalidatePath('/customer/radar/inquiries');
  return true;
}

/** 获取询盘统计 */
export async function getInquiryStats(): Promise<{
  total: number;
  newCount: number;
  activeCount: number;
  quotedCount: number;
  wonCount: number;
  lostCount: number;
  avgResponseHours: number | null;
}> {
  const session = await auth();
  if (!session?.user?.tenantId) throw new Error('Unauthorized');
  const tenantId = session.user.tenantId;

  const [total, newCount, activeCount, quotedCount, wonCount, lostCount] = await Promise.all([
    prisma.inquiry.count({ where: { tenantId } }),
    prisma.inquiry.count({ where: { tenantId, status: 'new' } }),
    prisma.inquiry.count({ where: { tenantId, status: { in: ['reading', 'quoting', 'sampling'] } } }),
    prisma.inquiry.count({ where: { tenantId, status: 'quoted' } }),
    prisma.inquiry.count({ where: { tenantId, status: 'closed_won' } }),
    prisma.inquiry.count({ where: { tenantId, status: 'closed_lost' } }),
  ]);

  // 计算平均响应时间（从收到询盘到首次回复）
  const responded = await prisma.inquiry.findMany({
    where: { tenantId, firstReplyAt: { not: null } },
    select: { receivedAt: true, firstReplyAt: true },
    take: 100,
  });

  let avgResponseHours: number | null = null;
  if (responded.length > 0) {
    const totalHours = responded.reduce((sum, r) => {
      const diffMs = r.firstReplyAt!.getTime() - r.receivedAt.getTime();
      return sum + diffMs / (1000 * 60 * 60);
    }, 0);
    avgResponseHours = Math.round(totalHours / responded.length * 10) / 10;
  }

  return { total, newCount, activeCount, quotedCount, wonCount, lostCount, avgResponseHours };
}

// ==================== 自动匹配 ====================

/** 尝试将询盘自动匹配到线索库中的公司 */
async function autoMatchInquiryToCompany(
  tenantId: string,
  companyName?: string,
  contactEmail?: string,
  website?: string,
): Promise<string | null> {
  const conditions: Record<string, unknown>[] = [];

  // 通过域名匹配
  if (website) {
    try {
      const url = new URL(website.startsWith('http') ? website : `https://${website}`);
      let domain = url.hostname.toLowerCase();
      if (domain.startsWith('www.')) domain = domain.slice(4);
      conditions.push({ website: { contains: domain, mode: 'insensitive' } });
    } catch { /* ignore */ }
  }

  // 通过邮箱域名匹配
  if (contactEmail) {
    const emailDomain = contactEmail.split('@')[1];
    if (emailDomain) {
      conditions.push({ website: { contains: emailDomain, mode: 'insensitive' } });
    }
  }

  // 通过公司名匹配
  if (companyName) {
    conditions.push({ name: { equals: companyName, mode: 'insensitive' } });
    // 模糊匹配（公司名包含询盘中的公司名关键词）
    const words = companyName.split(/\s+/).filter(w => w.length > 3);
    if (words.length > 0) {
      conditions.push({ name: { contains: words[0], mode: 'insensitive' } });
    }
  }

  if (conditions.length === 0) return null;

  const company = await prisma.prospectCompany.findFirst({
    where: { tenantId, OR: conditions },
    select: { id: true },
  });

  return company?.id || null;
}

/** 批量导入询盘（从邮件/展会等渠道） */
export async function batchCreateInquiries(
  inquiries: Array<{
    source: string;
    sourceDetail?: string;
    companyName?: string;
    contactName?: string;
    contactEmail?: string;
    contactPhone?: string;
    country?: string;
    subject: string;
    bodyText?: string;
    productInterest?: string;
  }>,
): Promise<{ created: number; matched: number }> {
  const session = await auth();
  if (!session?.user?.tenantId) throw new Error('Unauthorized');
  const tenantId = session.user.tenantId;

  let created = 0;
  let matched = 0;

  for (const inq of inquiries) {
    const matchedCompanyId = await autoMatchInquiryToCompany(
      tenantId, inq.companyName, inq.contactEmail
    );
    if (matchedCompanyId) matched++;

    await prisma.inquiry.create({
      data: {
        tenantId,
        source: inq.source,
        sourceDetail: inq.sourceDetail,
        companyName: inq.companyName,
        contactName: inq.contactName,
        contactEmail: inq.contactEmail,
        contactPhone: inq.contactPhone,
        country: inq.country,
        subject: inq.subject,
        bodyText: inq.bodyText,
        productInterest: inq.productInterest,
        matchedCompanyId,
      },
    });
    created++;
  }

  revalidatePath('/customer/radar/inquiries');
  return { created, matched };
}
