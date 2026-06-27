"use server";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";

async function getSession() {
  const session = await auth();
  if (!session?.user?.tenantId) {
    throw new Error("Unauthorized");
  }
  return session;
}

export async function getLeads() {
  const session = await getSession();
  return db.lead.findMany({
    where: { tenantId: session.user.tenantId, deletedAt: null },
    include: { owner: true },
    orderBy: { updatedAt: "desc" },
  });
}

export async function getLead(id: string) {
  const session = await getSession();
  return db.lead.findFirst({
    where: { id, tenantId: session.user.tenantId, deletedAt: null },
    include: { owner: true, campaigns: { include: { campaign: true } } },
  });
}

export async function createLead(data: {
  companyName: string;
  contactName?: string;
  email?: string;
  phone?: string;
  website?: string;
  country?: string;
  city?: string;
  industry?: string;
  companySize?: string;
  status?: string;
  priority?: string;
  notes?: string;
}) {
  const session = await getSession();

  const lead = await db.lead.create({
    data: {
      tenantId: session.user.tenantId,
      ownerId: session.user.id,
      companyName: data.companyName,
      contactName: data.contactName,
      email: data.email,
      phone: data.phone,
      website: data.website,
      country: data.country,
      city: data.city,
      industry: data.industry,
      companySize: data.companySize,
      status: data.status || "new",
      priority: data.priority || "medium",
      notes: data.notes,
    },
  });

  revalidatePath("/zh-CN/leads");
  return lead;
}

export async function updateLead(
  id: string,
  data: {
    companyName?: string;
    contactName?: string;
    email?: string;
    phone?: string;
    status?: string;
    priority?: string;
    notes?: string;
  }
) {
  const session = await getSession();
  const lead = await db.lead.update({
    where: { id, tenantId: session.user.tenantId },
    data,
  });
  revalidatePath("/zh-CN/leads");
  revalidatePath(`/zh-CN/leads/${id}`);
  return lead;
}

export async function getCampaigns() {
  const session = await getSession();
  return db.campaign.findMany({
    where: { tenantId: session.user.tenantId, deletedAt: null },
    include: { _count: { select: { leads: true } } },
    orderBy: { updatedAt: "desc" },
  });
}

export async function createCampaign(data: {
  name: string;
  description?: string;
  emailTemplate: string;
  subject: string;
  status?: string;
}) {
  const session = await getSession();

  const campaign = await db.campaign.create({
    data: {
      tenantId: session.user.tenantId,
      name: data.name,
      description: data.description,
      emailTemplate: data.emailTemplate,
      subject: data.subject,
      status: data.status || "draft",
    },
  });

  revalidatePath("/zh-CN/leads/campaigns");
  return campaign;
}
