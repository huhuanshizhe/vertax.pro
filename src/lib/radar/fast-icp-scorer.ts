// ==================== Fast ICP Scorer ====================
// Rule-based pre-scoring with a verification pool for inferred process signals.
// Platform-level capability shared by all tenants.

import type { DiscoveryEvidence, NormalizedCandidate } from './adapters/types';
import type { MergedLexicon, PlannedQuery } from './discovery-query-planner';
import { normalizeUnicode } from './discovery-query-planner';

// ==================== Types ====================

export interface ScoringConfig {
  weights: {
    process: number;
    industry: number;
    object?: number;
    region: number;
    scale: number;
    pain: number;
  };
  thresholds: {
    a: number;
    b: number;
    c: number;
  };
  strongSignals: string[];
  mediumSignals: string[];
  weakSignals: string[];
  objectSignals?: {
    highValue: string[];
    standard: string[];
    lowFit: string[];
  };
  hardExclusions: string[];
  verificationTemplates?: {
    processInferred: string[];
    objectMissing: string[];
    triggerMissing: string[];
    lowConfidence: string[];
  };
}

export interface ScoringContext {
  scoringConfig: ScoringConfig;
  targetCountries: string[];
  targetIndustries: string[];
  targetRegions: string[];
  triggerKeywords: string[];
  localExclusions?: string[];
}

export type ScoreTier = 'A' | 'B' | 'C' | 'needs_review' | 'reject';
export type ProcessSignalStrength = 'strong' | 'medium' | 'inferred' | 'none';
export type EligibilityGate = 'QUALIFIED_FOR_SCORING' | 'VERIFY_PROCESS' | 'HARD_REJECT';

export interface FastScoreResult {
  gate: 'PASS' | 'HARD_REJECT';
  eligibilityGate: EligibilityGate;
  processSignalStrength: ProcessSignalStrength;
  evidenceConfidence: number;
  verificationActions: string[];
  score: number;
  tier: ScoreTier;
  shouldDeepQualify: boolean;
  breakdown: {
    processSignal: number;
    industryFit: number;
    objectFit: number;
    regionFit: number;
    companyScale: number;
    painTrigger: number;
    penalty: number;
    total: number;
  };
  matchedPositiveTerms: string[];
  matchedWeakTerms: string[];
  matchedObjectTerms: string[];
  matchedExclusionTerms: string[];
  reason: string;
}

interface ProcessSignalScore {
  score: number;
  strength: ProcessSignalStrength;
}

interface ObjectSignalScore {
  score: number;
  penalty: number;
  matchedTerms: string[];
}

// ==================== Default Scoring Config ====================

export const DEFAULT_SCORING_CONFIG: ScoringConfig = {
  weights: { process: 35, industry: 25, object: 0, region: 15, scale: 15, pain: 10 },
  thresholds: { a: 75, b: 55, c: 40 },
  strongSignals: [],
  mediumSignals: [],
  weakSignals: [],
  objectSignals: { highValue: [], standard: [], lowFit: [] },
  hardExclusions: [],
};

// ==================== Core Scoring Function ====================

export function fastICPScore(
  candidate: NormalizedCandidate,
  context: ScoringContext
): FastScoreResult {
  const text = buildCandidateText(candidate);
  const normalizedText = normalizeUnicode(text).toLowerCase();
  const { scoringConfig } = context;

  const matchedExclusionTerms = findMatchedTerms(normalizedText, [
    ...scoringConfig.hardExclusions,
    ...(context.localExclusions || []),
  ]);

  if (matchedExclusionTerms.length > 0) {
    return buildRejectedResult(`Hard exclusion matched: ${matchedExclusionTerms[0]}`, matchedExclusionTerms);
  }

  const matchedPositiveTerms: string[] = [];
  const matchedWeakTerms: string[] = [];

  const processSignal = scoreProcessSignal(
    normalizedText,
    scoringConfig,
    matchedPositiveTerms,
    matchedWeakTerms
  );
  const industryFit = scoreIndustryFit(normalizedText, candidate, context, matchedPositiveTerms);
  const objectSignal = scoreObjectSignal(normalizedText, scoringConfig);
  const regionFit = scoreRegionFit(candidate, context);
  const companyScale = scoreCompanyScale(normalizedText, candidate, scoringConfig);
  const painTrigger = scorePainTrigger(normalizedText, context, matchedPositiveTerms);

  const relatedFit = industryFit + objectSignal.score + painTrigger;
  if (processSignal.strength === 'none' && relatedFit < 20) {
    return buildRejectedResult(
      'No core process/procurement evidence and no related industry/object fit',
      []
    );
  }

  const rawTotal =
    processSignal.score +
    industryFit +
    objectSignal.score +
    regionFit +
    companyScale +
    painTrigger +
    objectSignal.penalty;
  const total = Math.max(0, Math.min(100, Math.round(rawTotal)));

  const evidenceConfidence = computeEvidenceConfidence({
    processSignalStrength: processSignal.strength,
    matchedPositiveTerms,
    matchedWeakTerms,
    matchedObjectTerms: objectSignal.matchedTerms,
    painTrigger,
  });

  const verificationActions = buildVerificationActions(
    processSignal.strength,
    evidenceConfidence,
    objectSignal.score,
    painTrigger,
    scoringConfig.verificationTemplates
  );

  if (processSignal.strength === 'inferred' || processSignal.strength === 'none') {
    return {
      gate: 'PASS',
      eligibilityGate: 'VERIFY_PROCESS',
      processSignalStrength: processSignal.strength,
      evidenceConfidence,
      verificationActions,
      score: total,
      tier: 'needs_review',
      shouldDeepQualify: false,
      breakdown: {
        processSignal: processSignal.score,
        industryFit,
        objectFit: objectSignal.score,
        regionFit,
        companyScale,
        painTrigger,
        penalty: objectSignal.penalty,
        total,
      },
      matchedPositiveTerms,
      matchedWeakTerms,
      matchedObjectTerms: objectSignal.matchedTerms,
      matchedExclusionTerms: [],
      reason: 'Inferred or missing core-process signal; verify evidence before qualification',
    };
  }

  const { thresholds } = scoringConfig;
  let tier: ScoreTier;
  let shouldDeepQualify = true;
  let reason: string;

  if (total >= thresholds.a && painTrigger > 0) {
    tier = 'A';
    reason = 'Strong fit with explicit process/procurement evidence and buying-window signal';
  } else if (total >= thresholds.a) {
    tier = 'B';
    reason = 'High fit, but no current buying-window trigger; keep below immediate A priority';
  } else if (total >= thresholds.b) {
    tier = 'B';
    reason = 'Good fit with explicit process/procurement evidence';
  } else if (total >= thresholds.c) {
    tier = 'C';
    reason = 'Partial fit with process/procurement evidence';
  } else {
    tier = 'needs_review';
    shouldDeepQualify = false;
    reason = 'Weak fit after scoring; keep for manual review';
  }

  return {
    gate: 'PASS',
    eligibilityGate: tier === 'needs_review' ? 'VERIFY_PROCESS' : 'QUALIFIED_FOR_SCORING',
    processSignalStrength: processSignal.strength,
    evidenceConfidence,
    verificationActions,
    score: total,
    tier,
    shouldDeepQualify,
    breakdown: {
      processSignal: processSignal.score,
      industryFit,
      objectFit: objectSignal.score,
      regionFit,
      companyScale,
      painTrigger,
      penalty: objectSignal.penalty,
      total,
    },
    matchedPositiveTerms,
    matchedWeakTerms,
    matchedObjectTerms: objectSignal.matchedTerms,
    matchedExclusionTerms: [],
    reason,
  };
}

// ==================== Build Discovery Evidence ====================

export function buildDiscoveryEvidence(
  scoreResult: FastScoreResult,
  plannedQuery: PlannedQuery | undefined,
  adapterCode: string,
  planVersion?: string
): DiscoveryEvidence {
  return {
    _v: 2,
    sourceCategory: plannedQuery?.sourceCategory || 'web_serp_english',
    adapterCode,
    queryText: plannedQuery?.text || '',
    queryLanguage: plannedQuery?.language || 'en',
    queryCountry: plannedQuery?.countryCode || '',
    queryIntent: plannedQuery?.intent || 'discovery',
    matchedPositiveTerms: scoreResult.matchedPositiveTerms,
    matchedWeakTerms: scoreResult.matchedWeakTerms,
    matchedExclusionTerms: scoreResult.matchedExclusionTerms,
    scoreBreakdown: {
      processSignal: scoreResult.breakdown.processSignal,
      industryFit: scoreResult.breakdown.industryFit,
      objectFit: scoreResult.breakdown.objectFit,
      regionFit: scoreResult.breakdown.regionFit,
      companyScale: scoreResult.breakdown.companyScale,
      painTrigger: scoreResult.breakdown.painTrigger,
      penalty: scoreResult.breakdown.penalty,
      total: scoreResult.breakdown.total,
      tier: scoreResult.tier,
      shouldDeepQualify: scoreResult.shouldDeepQualify,
      reason: scoreResult.reason,
    },
    confidence: scoreResult.evidenceConfidence,
    fitScore: scoreResult.score,
    evidenceConfidence: scoreResult.evidenceConfidence,
    eligibilityGate: scoreResult.eligibilityGate,
    processSignalStrength: scoreResult.processSignalStrength,
    matchedObjectTerms: scoreResult.matchedObjectTerms,
    verificationActions: scoreResult.verificationActions,
    enrichmentStatus: 'pending',
    planVersion,
  };
}

// ==================== Scoring Sub-functions ====================

function buildRejectedResult(reason: string, matchedExclusionTerms: string[]): FastScoreResult {
  return {
    gate: 'HARD_REJECT',
    eligibilityGate: 'HARD_REJECT',
    processSignalStrength: 'none',
    evidenceConfidence: 0,
    verificationActions: [],
    score: 0,
    tier: 'reject',
    shouldDeepQualify: false,
    breakdown: {
      processSignal: 0,
      industryFit: 0,
      objectFit: 0,
      regionFit: 0,
      companyScale: 0,
      painTrigger: 0,
      penalty: 0,
      total: 0,
    },
    matchedPositiveTerms: [],
    matchedWeakTerms: [],
    matchedObjectTerms: [],
    matchedExclusionTerms,
    reason,
  };
}

function buildCandidateText(candidate: NormalizedCandidate): string {
  return [
    candidate.displayName,
    candidate.description || '',
    candidate.industry || '',
    candidate.address || '',
    candidate.categoryName || '',
    candidate.rawData ? JSON.stringify(candidate.rawData).slice(0, 1500) : '',
  ].join(' ');
}

function scoreProcessSignal(
  text: string,
  config: ScoringConfig,
  matchedPositive: string[],
  matchedWeak: string[]
): ProcessSignalScore {
  const maxWeight = config.weights.process;

  const strong = findFirstMatchedTerm(text, config.strongSignals);
  if (strong) {
    matchedPositive.push(strong);
    return { score: Math.round(maxWeight * 0.95), strength: 'strong' };
  }

  const medium = findFirstMatchedTerm(text, config.mediumSignals);
  if (medium) {
    matchedPositive.push(medium);
    return { score: Math.round(maxWeight * 0.65), strength: 'medium' };
  }

  const weak = findFirstMatchedTerm(text, config.weakSignals);
  if (weak) {
    matchedWeak.push(weak);
    return { score: Math.round(maxWeight * 0.25), strength: 'inferred' };
  }

  return { score: 0, strength: 'none' };
}

function scoreIndustryFit(
  text: string,
  candidate: NormalizedCandidate,
  context: ScoringContext,
  matchedPositive: string[]
): number {
  const maxWeight = context.scoringConfig.weights.industry;

  if (candidate.industry) {
    const candidateIndustry = normalizeUnicode(candidate.industry).toLowerCase();
    for (const target of context.targetIndustries) {
      const normalizedTarget = normalizeUnicode(target).toLowerCase();
      if (candidateIndustry.includes(normalizedTarget) || normalizedTarget.includes(candidateIndustry)) {
        matchedPositive.push(`industry:${target}`);
        return maxWeight;
      }
    }
  }

  for (const target of context.targetIndustries) {
    const normalizedTarget = normalizeUnicode(target).toLowerCase();
    const words = normalizedTarget.split(/\s+/).filter((word) => word.length > 3);
    const matchCount = words.filter((word) => text.includes(word)).length;
    if (matchCount >= 2 || (words.length === 1 && matchCount === 1)) {
      matchedPositive.push(`industry:${target}`);
      return Math.round(maxWeight * 0.8);
    }
  }

  return 0;
}

function scoreObjectSignal(text: string, config: ScoringConfig): ObjectSignalScore {
  const maxWeight = config.weights.object || 0;
  const objectSignals = config.objectSignals || { highValue: [], standard: [], lowFit: [] };
  const lowFitTerms = findMatchedTerms(text, objectSignals.lowFit);
  const highValueTerm = findFirstMatchedTerm(text, objectSignals.highValue);

  if (highValueTerm) {
    return {
      score: maxWeight,
      penalty: lowFitTerms.length > 0 ? -10 : 0,
      matchedTerms: [highValueTerm, ...lowFitTerms],
    };
  }

  const standardTerm = findFirstMatchedTerm(text, objectSignals.standard);
  if (standardTerm) {
    return {
      score: Math.round(maxWeight * 0.65),
      penalty: lowFitTerms.length > 0 ? -10 : 0,
      matchedTerms: [standardTerm, ...lowFitTerms],
    };
  }

  return {
    score: 0,
    penalty: lowFitTerms.length > 0 ? -10 : 0,
    matchedTerms: lowFitTerms,
  };
}

function scoreRegionFit(candidate: NormalizedCandidate, context: ScoringContext): number {
  const maxWeight = context.scoringConfig.weights.region;
  const country = (candidate.country || candidate.buyerCountry || '').toUpperCase();

  if (!country) return Math.round(maxWeight * 0.2);

  if (context.targetCountries.some((target) => target.toUpperCase() === country)) {
    return maxWeight;
  }

  if (context.targetRegions.length > 0) {
    return Math.round(maxWeight * 0.5);
  }

  return Math.round(maxWeight * 0.1);
}

function scoreCompanyScale(
  text: string,
  candidate: NormalizedCandidate,
  config: ScoringConfig
): number {
  const maxWeight = config.weights.scale;

  const mfgSignals = ['manufacturer', 'factory', 'production', 'oem', 'plant', 'facility'];
  if (mfgSignals.some((signal) => text.includes(signal))) {
    return maxWeight;
  }

  if (candidate.companySize) {
    const size = normalizeUnicode(candidate.companySize).toLowerCase();
    if (size.includes('medium') || size.includes('200') || size.includes('500')) {
      return maxWeight;
    }
    if (size.includes('large') || size.includes('enterprise') || size.includes('1000')) {
      return Math.round(maxWeight * 0.8);
    }
  }

  const exportSignals = ['export', 'international', 'global', 'tier 1', 'tier one'];
  if (exportSignals.some((signal) => text.includes(signal))) {
    return Math.round(maxWeight * 0.7);
  }

  return 0;
}

function scorePainTrigger(
  text: string,
  context: ScoringContext,
  matchedPositive: string[]
): number {
  const maxWeight = context.scoringConfig.weights.pain;

  const trigger = findFirstMatchedTerm(text, context.triggerKeywords);
  if (trigger) {
    matchedPositive.push(`trigger:${trigger}`);
    return maxWeight;
  }

  return 0;
}

// ==================== Helpers ====================

function findFirstMatchedTerm(text: string, terms: string[]): string | null {
  return findMatchedTerms(text, terms)[0] || null;
}

function findMatchedTerms(text: string, terms: string[]): string[] {
  const matched: string[] = [];

  for (const term of terms) {
    const normalizedTerm = normalizeUnicode(term).toLowerCase().trim();
    if (!normalizedTerm) continue;
    if (text.includes(normalizedTerm)) {
      matched.push(term);
    }
  }

  return matched;
}

function computeEvidenceConfidence(input: {
  processSignalStrength: ProcessSignalStrength;
  matchedPositiveTerms: string[];
  matchedWeakTerms: string[];
  matchedObjectTerms: string[];
  painTrigger: number;
}): number {
  const baseByProcess: Record<ProcessSignalStrength, number> = {
    strong: 0.68,
    medium: 0.55,
    inferred: 0.35,
    none: 0.15,
  };

  let confidence = baseByProcess[input.processSignalStrength];
  confidence += Math.min(input.matchedPositiveTerms.length, 3) * 0.04;
  confidence += Math.min(input.matchedObjectTerms.length, 2) * 0.05;
  if (input.painTrigger > 0) confidence += 0.08;

  if (input.processSignalStrength === 'inferred') {
    confidence = Math.min(confidence, 0.49);
  }
  if (input.processSignalStrength === 'none') {
    confidence = Math.min(confidence, 0.3);
  }

  return Math.max(0, Math.min(0.95, Number(confidence.toFixed(2))));
}

function buildVerificationActions(
  processSignalStrength: ProcessSignalStrength,
  evidenceConfidence: number,
  objectFit: number,
  painTrigger: number,
  templates?: ScoringConfig['verificationTemplates']
): string[] {
  const actions: string[] = [];

  if (processSignalStrength === 'inferred' || processSignalStrength === 'none') {
    if (templates?.processInferred && templates.processInferred.length > 0) {
      actions.push(...templates.processInferred);
    } else {
      actions.push('verify_in_house_liquid_paint_line');
      actions.push('check_factory_photos_or_videos_for_paint_shop');
      actions.push('check_hiring_pages_for_painting_roles');
    }
  }

  if (objectFit === 0) {
    if (templates?.objectMissing && templates.objectMissing.length > 0) {
      actions.push(...templates.objectMissing);
    } else {
      actions.push('verify_painted_object_type');
    }
  }

  if (painTrigger === 0) {
    if (templates?.triggerMissing && templates.triggerMissing.length > 0) {
      actions.push(...templates.triggerMissing);
    } else {
      actions.push('check_expansion_news_jobs_or_compliance_filings');
    }
  }

  if (evidenceConfidence < 0.55) {
    if (templates?.lowConfidence && templates.lowConfidence.length > 0) {
      actions.push(...templates.lowConfidence);
    } else {
      actions.push('collect_official_or_high_confidence_evidence');
    }
  }

  return Array.from(new Set(actions));
}

// ==================== Utility: Extract Local Exclusions from Lexicon ====================

export function extractLocalExclusions(
  lexicon: MergedLexicon,
  queryLanguage: string
): string[] {
  if (!lexicon.exclusionTerms) return [];
  return lexicon.exclusionTerms[queryLanguage] || [];
}
