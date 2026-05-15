import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { executeSkill } from '@/lib/skills/runner';
import { SKILL_NAMES } from '@/lib/skills/names';
import {
  buildProspectOutreachStateValue,
  mergeProspectContactsWithSnapshot,
  getProspectCompanyOutreachContactProfile,
} from '@/lib/radar/prospect-outreach-state';
import {
  inferOutreachLanguage,
  getValidOutreachLanguage,
  getOutreachLanguageLabel,
} from '@/lib/radar/country-utils';

export const runtime = 'nodejs';
export const maxDuration = 120;

interface RouteContext {
  params: Promise<{ companyId: string }>;
}

export async function POST(
  req: NextRequest,
  context: RouteContext
) {
  const session = await auth();
  if (!session?.user?.tenantId || !session?.user?.id) {
    return NextResponse.json(
      { ok: false, error: 'Unauthorized', code: 'UNAUTHORIZED' },
      { status: 401 }
    );
  }

  const { companyId } = await context.params;
  const tenantId = session.user.tenantId;
  const userId = session.user.id;

  // 0. Parse optional request body for language override
  let requestedLanguage: string | undefined;
  try {
    const body = await req.json();
    requestedLanguage = getValidOutreachLanguage(body?.language);
  } catch {
    // No body or invalid JSON is acceptable for batch calls and backward compat.
  }

  // 1. Load ProspectCompany (with tenant boundary check)
  const company = await prisma.prospectCompany.findUnique({
    where: { id: companyId, tenantId },
  });

  if (!company) {
    return NextResponse.json(
      { ok: false, error: 'Company not found', code: 'NOT_FOUND' },
      { status: 404 }
    );
  }

  // 1b. Resolve outreach language (request > DB override > auto-infer)
  const dbLanguage = company.outreachLanguage
    ? getValidOutreachLanguage(company.outreachLanguage)
    : undefined;

  const resolvedLanguage = requestedLanguage
    ?? dbLanguage
    ?? inferOutreachLanguage({ country: company.country, website: company.website });

  // 1c. Persist manual override if valid and different from stored value
  if (requestedLanguage && requestedLanguage !== company.outreachLanguage) {
    await prisma.prospectCompany.update({
      where: { id: companyId, tenantId },
      data: { outreachLanguage: requestedLanguage },
    });
  }

  // 2. Load contacts
  const contacts = await prisma.prospectContact.findMany({
    where: { tenantId, companyId, deletedAt: null },
    orderBy: { createdAt: 'asc' },
  });

  // 3. Load latest Dossier
  const latestDossierVersion = await prisma.artifactVersion.findFirst({
    where: { tenantId, entityType: 'ProspectDossier', entityId: companyId },
    orderBy: { version: 'desc' },
  });
  const prospectDossier = latestDossierVersion
    ? (latestDossierVersion.content as Record<string, unknown>)
    : null;

  // 4. Build contact context
  const companyContext = {
    id: company.id,
    name: company.name,
    email: company.email,
    phone: company.phone,
    outreachArtifacts: company.outreachArtifacts,
  };
  const mergedContacts = mergeProspectContactsWithSnapshot(companyContext, contacts);
  const contactProfile = getProspectCompanyOutreachContactProfile(companyContext);

  // 5. Sanitize matchReasons to string[]
  const matchReasons: string[] = Array.isArray(company.matchReasons)
    ? company.matchReasons.filter((r): r is string => typeof r === 'string')
    : [];

  // 6. Call Skill Runner
  try {
    const result = await executeSkill(
      SKILL_NAMES.RADAR_GENERATE_OUTREACH_PACK,
      {
        input: {
          persona: {
            companyName: company.name,
            industry: company.industry || 'General',
            country: company.country || 'Unknown',
            description: company.description || '',
            website: company.website || '',
          },
          tier: (company.tier as 'A' | 'B' | 'C') || 'B',
          prospectDossier,
          contacts: mergedContacts.map((contact) => ({
            name: contact.name,
            role: contact.role,
            seniority: contact.seniority,
            email: contact.email,
            phone: contact.phone,
            linkedInUrl: contact.linkedInUrl,
            source: contact.source,
            note: contact.note,
          })),
          contactProfile: {
            email: contactProfile.email,
            phone: contactProfile.phone,
            recommendedContact: contactProfile.recommendedContact,
            complianceNote: contactProfile.complianceNote,
            primaryEmail: contactProfile.primaryEmail ?? null,
            primaryPhone: contactProfile.primaryPhone ?? null,
            completenessScore: contactProfile.snapshot?.completenessScore ?? null,
            leadQualityScore: contactProfile.snapshot?.leadQualityScore ?? null,
            informationGaps: contactProfile.snapshot?.informationGaps ?? [],
            dataSources: contactProfile.snapshot?.dataSources ?? [],
          },
          matchReasons,
          approachAngle: company.approachAngle || null,
          language: resolvedLanguage,
        },
        entityType: 'OutreachPack',
        entityId: company.id,
        mode: 'generate',
        useCompanyProfile: true,
      },
      { tenantId, userId }
    );

    if (!result.ok) {
      return NextResponse.json(
        { ok: false, error: 'AI generation failed', code: 'GENERATION_FAILED' },
        { status: 500 }
      );
    }

    // 7. Persist to ProspectCompany.outreachArtifacts (with language metadata)
    const artifactEntry = {
      ...(result.output as Record<string, unknown>),
      timestamp: new Date().toISOString(),
      language: resolvedLanguage,
      languageLabel: getOutreachLanguageLabel(resolvedLanguage),
    };

    if (result.versionId) {
      await prisma.artifactVersion.updateMany({
        where: {
          id: result.versionId,
          tenantId,
          entityType: 'OutreachPack',
          entityId: company.id,
        },
        data: {
          content: artifactEntry as object,
        },
      });
    }

    await prisma.prospectCompany.update({
      where: { id: companyId, tenantId },
      data: {
        outreachArtifacts: buildProspectOutreachStateValue(
          company.outreachArtifacts,
          { appendVersion: artifactEntry }
        ),
      },
    });

    return NextResponse.json({
      ok: true,
      versionId: result.versionId || null,
      pack: artifactEntry,
      language: resolvedLanguage,
    });
  } catch (err) {
    console.error('[outreach-pack] Generation error:', err);
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json(
      { ok: false, error: message, code: 'INTERNAL_ERROR' },
      { status: 500 }
    );
  }
}
