import {
  quickInvestigation,
  type CompanyInvestigationReport,
  type IdentityLayerResult,
  type RegistrationLayerResult,
} from '@/lib/osint';

export interface RadarOsintCheckpointSummary {
  checkedAt: string;
  status: 'passed' | 'review' | 'blocked';
  allowPaidEnrichment: boolean;
  allowPrimaryWriteback: boolean;
  reasons: string[];
  authenticityScore: number;
  overallRisk: CompanyInvestigationReport['overallRisk'];
  companyName: string;
  country?: string;
  resolvedDomain?: string;
  websiteUrl?: string;
  websiteStatus?: NonNullable<IdentityLayerResult['website']>['status'];
  registrationStatus?: RegistrationLayerResult['primary']['status'];
  identitySignals: {
    activeWebsite: boolean;
    linkedinVerified: boolean;
    activeRegistration: boolean;
    signalCount: number;
  };
}

export type RadarPolicyControlledSearchEngine = 'tavily';

function parseBooleanEnvFlag(rawValue?: string | null): boolean {
  if (!rawValue) {
    return false;
  }

  return ['1', 'true', 'yes', 'on'].includes(rawValue.trim().toLowerCase());
}

function normalizeDomain(value?: string | null): string | undefined {
  if (!value) {
    return undefined;
  }

  try {
    const url = new URL(value.startsWith('http') ? value : `https://${value}`);
    const hostname = url.hostname.replace(/^www\./, '').toLowerCase();
    return hostname || undefined;
  } catch {
    return value.trim().replace(/^www\./i, '').toLowerCase() || undefined;
  }
}

export function buildRadarOsintCheckpointSummary(
  report: CompanyInvestigationReport
): RadarOsintCheckpointSummary {
  const websiteStatus = report.identity?.website?.status;
  const websiteUrl = report.identity?.website?.url;
  const resolvedDomain = normalizeDomain(report.query.domain) || normalizeDomain(websiteUrl);
  const activeWebsite = websiteStatus === 'ACTIVE';
  const linkedinVerified = Boolean(report.identity?.linkedin?.verified);
  const activeRegistration = report.registration?.primary?.status === 'ACTIVE';
  const signalCount = [activeWebsite, linkedinVerified, activeRegistration].filter(Boolean).length;
  const reasons: string[] = [];

  if (!resolvedDomain) {
    reasons.push('missing_domain_anchor');
  }

  if (signalCount === 0) {
    reasons.push('identity_signals_missing');
  }

  if (report.overallRisk === 'HIGH') {
    reasons.push('high_risk');
  }

  // 策略调整：最大化联系人信息获取，OSINT 检查点仅作为风险提示，不作为拦截门槛
  // 所有候选都允许进行付费富化（Hunter.io 邮箱查找等），仅 HIGH risk 时标注警告
  const allowPaidEnrichment = Boolean(resolvedDomain || report.query.companyName);

  if (!resolvedDomain) {
    reasons.push('no_resolved_domain_for_enrichment');
  }

  if (report.overallRisk === 'HIGH') {
    reasons.push('⚠ high_risk_but_enrichment_allowed');
  }

  // 主数据回写：只要有数据就允许回写，风险仅标注不拦截
  const allowPrimaryWriteback = allowPaidEnrichment;

  return {
    checkedAt: report.generatedAt.toISOString(),
    status: allowPrimaryWriteback ? 'passed' : allowPaidEnrichment ? 'review' : 'blocked',
    allowPaidEnrichment,
    allowPrimaryWriteback,
    reasons,
    authenticityScore: report.authenticityScore,
    overallRisk: report.overallRisk,
    companyName: report.query.companyName,
    country: report.query.country,
    resolvedDomain,
    websiteUrl,
    websiteStatus,
    registrationStatus: report.registration?.primary?.status,
    identitySignals: {
      activeWebsite,
      linkedinVerified,
      activeRegistration,
      signalCount,
    },
  };
}

export async function runRadarOsintCheckpoint(input: {
  companyName: string;
  domain?: string;
  country?: string | null;
}): Promise<RadarOsintCheckpointSummary> {
  try {
    const report = await quickInvestigation(
      input.companyName,
      input.domain,
      input.country || undefined
    );

    return buildRadarOsintCheckpointSummary(report);
  } catch (error) {
    return {
      checkedAt: new Date().toISOString(),
      status: 'blocked',
      allowPaidEnrichment: false,
      allowPrimaryWriteback: false,
      reasons: [
        'checkpoint_error',
        error instanceof Error ? error.message : 'Unknown error',
      ],
      authenticityScore: 0,
      overallRisk: 'HIGH',
      companyName: input.companyName,
      country: input.country || undefined,
      resolvedDomain: normalizeDomain(input.domain),
      websiteUrl: undefined,
      websiteStatus: undefined,
      registrationStatus: undefined,
      identitySignals: {
        activeWebsite: false,
        linkedinVerified: false,
        activeRegistration: false,
        signalCount: 0,
      },
    };
  }
}

export function isRadarTavilyFallbackEnabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return parseBooleanEnvFlag(env.RADAR_ENABLE_TAVILY_FALLBACK);
}

export function isRadarSearchEngineEnabled(
  engine: RadarPolicyControlledSearchEngine,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  switch (engine) {
    case 'tavily':
      return isRadarTavilyFallbackEnabled(env);
    default:
      return false;
  }
}
