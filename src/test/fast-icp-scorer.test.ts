import { describe, expect, it } from 'vitest';

import {
  buildDiscoveryEvidence,
  extractLocalExclusions,
  fastICPScore,
  type ScoringContext,
} from '@/lib/radar/fast-icp-scorer';
import type { NormalizedCandidate } from '@/lib/radar/adapters/types';
import type { MergedLexicon, PlannedQuery } from '@/lib/radar/discovery-query-planner';

const tdpaintContext: ScoringContext = {
  scoringConfig: {
    weights: { process: 30, industry: 20, object: 15, region: 10, scale: 10, pain: 15 },
    thresholds: { a: 75, b: 55, c: 40 },
    strongSignals: ['paint shop', 'spray painting', 'painting line', 'spray booth'],
    mediumSignals: ['surface finishing', 'painted parts', 'in-house finishing'],
    weakSignals: ['automotive exterior parts', 'motorcycle body parts', 'home appliance casing'],
    objectSignals: {
      highValue: ['automotive bumper', 'motorcycle fairing', 'appliance housing'],
      standard: ['metal enclosure', 'plastic housing', 'cabinet'],
      lowFit: ['pipe internal coating', 'floor coating'],
    },
    hardExclusions: ['car detailing', 'paint retailer', 'electroplating', 'powder coating only'],
  },
  targetCountries: ['VN', 'TH', 'ID'],
  targetIndustries: ['automotive component manufacturing', 'appliance manufacturing'],
  targetRegions: ['APAC'],
  triggerKeywords: ['paint line expansion', 'painting supervisor recruitment', 'VOC compliance'],
};

const machRioContext: ScoringContext = {
  scoringConfig: {
    weights: { process: 30, industry: 25, object: 10, region: 15, scale: 10, pain: 10 },
    thresholds: { a: 75, b: 55, c: 40 },
    strongSignals: [
      'mro', 'maintenance repair operations', 'industrial supplies procurement',
      'factory maintenance', 'plant spare parts', 'oil seal', 'lockout tagout',
      'industrial sensor', 'proximity sensor', 'purchase order', 'bulk procurement', 'rfq',
    ],
    mediumSignals: [
      'procurement manager', 'facility maintenance', 'warehouse operations',
      'maintenance engineer', 'bulk order', 'volume pricing', 'net terms',
      'seal replacement', 'bearing replacement', 'safety supplies',
    ],
    weakSignals: [
      'industrial consumables', 'hardware supplies',
      'factory operations', 'manufacturing plant',
      'warehouse facility', 'distribution center',
    ],
    objectSignals: {
      highValue: [
        'oil seal', 'mechanical seal', 'seal kit', 'o-ring',
        'lockout tagout', 'loto', 'safety padlock',
        'proximity sensor', 'photoelectric sensor', 'encoder',
        'robot gripper', 'vacuum cup',
      ],
      standard: [
        'bearing', 'belt', 'fastener', 'bolt',
        'abrasive', 'adhesive', 'glove', 'safety glass',
        'cable chain', 'connector', 'relay',
        'packing material', 'hand truck', 'shelving',
      ],
      lowFit: [
        'consumer electronics', 'home appliance',
        'personal care product', 'food ingredient',
      ],
    },
    hardExclusions: [
      'consumer retail', 'home improvement', 'used machinery marketplace',
      'non-industrial', 'aviation MRO', 'aircraft maintenance',
      'individual DIY buyer', 'hobbyist',
    ],
    verificationTemplates: {
      processInferred: [
        'verify_company_has_industrial_operations_or_facility',
        'check_procurement_team_or_purchasing_department',
        'check_for_mro_buying_patterns_or_vendor_relationships',
      ],
      objectMissing: [
        'verify_product_categories_purchased',
        'check_maintenance_or_operations_needs',
      ],
      triggerMissing: [
        'check_expansion_or_new_facility_signals',
        'check_supplier_dissatisfaction_or_switching_signals',
      ],
      lowConfidence: [
        'collect_procurement_workflow_evidence',
        'verify_bulk_buying_or_repeat_purchase_patterns',
      ],
    },
  },
  targetCountries: ['US', 'MX', 'CA', 'BR', 'AE', 'AU', 'GB'],
  targetIndustries: ['manufacturing', 'warehouse and logistics', 'facility management', 'plant maintenance'],
  targetRegions: [],
  triggerKeywords: [
    'supplier consolidation', 'maintenance downtime reduction', 'new warehouse opening',
    'new factory construction', 'automation upgrade', 'procurement cost reduction',
  ],
};

function makeCandidate(overrides: Partial<NormalizedCandidate>): NormalizedCandidate {
  return {
    externalId: 'test-1',
    sourceUrl: 'https://example.com',
    displayName: 'Test Company',
    candidateType: 'COMPANY',
    ...overrides,
  };
}

describe('FastICPScorer', () => {
  it('rejects candidates matching hard exclusion terms', () => {
    const result = fastICPScore(
      makeCandidate({
        displayName: 'AutoBody Express Car Detailing Service',
        description: 'Professional car detailing and paint correction.',
      }),
      tdpaintContext
    );

    expect(result.gate).toBe('HARD_REJECT');
    expect(result.tier).toBe('reject');
    expect(result.matchedExclusionTerms).toContain('car detailing');
  });

  it('rejects no-process and non-related candidates', () => {
    const result = fastICPScore(
      makeCandidate({
        displayName: 'ABC Trading Corp',
        description: 'General import export trading company.',
      }),
      tdpaintContext
    );

    expect(result.gate).toBe('HARD_REJECT');
    expect(result.reason).toContain('No core process/procurement evidence');
  });

  it('puts inferred paint-process candidates into needs_review instead of C', () => {
    const result = fastICPScore(
      makeCandidate({
        displayName: 'Vina Exterior Parts Manufacturing',
        description: 'Automotive exterior parts manufacturer with plastic injection production.',
        country: 'VN',
        industry: 'automotive component manufacturing',
      }),
      tdpaintContext
    );

    expect(result.gate).toBe('PASS');
    expect(result.eligibilityGate).toBe('VERIFY_PROCESS');
    expect(result.processSignalStrength).toBe('inferred');
    expect(result.tier).toBe('needs_review');
    expect(result.shouldDeepQualify).toBe(false);
    expect(result.verificationActions).toContain('verify_in_house_liquid_paint_line');
  });

  it('scores explicit paint-process plus buying-window evidence as Tier A', () => {
    const result = fastICPScore(
      makeCandidate({
        displayName: 'Vietnam Auto Bumper Manufacturing',
        description:
          'Automotive component manufacturing plant with spray painting line, automotive bumper production, and paint line expansion.',
        country: 'VN',
        industry: 'automotive component manufacturing',
      }),
      tdpaintContext
    );

    expect(result.gate).toBe('PASS');
    expect(result.tier).toBe('A');
    expect(result.breakdown.objectFit).toBeGreaterThan(0);
    expect(result.breakdown.painTrigger).toBeGreaterThan(0);
    expect(result.evidenceConfidence).toBeGreaterThanOrEqual(0.7);
  });

  it('does not promote high fit to A without a buying-window trigger', () => {
    const result = fastICPScore(
      makeCandidate({
        displayName: 'Thai Appliance Housing Co',
        description: 'Appliance manufacturing factory with paint shop and appliance housing production.',
        country: 'TH',
        industry: 'appliance manufacturing',
      }),
      tdpaintContext
    );

    expect(result.score).toBeGreaterThanOrEqual(75);
    expect(result.tier).toBe('B');
    expect(result.reason).toContain('no current buying-window trigger');
  });

  it('keeps medium or large industrial painting service providers for scoring', () => {
    const result = fastICPScore(
      makeCandidate({
        displayName: 'Asia Industrial Painting Services',
        description:
          'Batch production finishing service provider with painting line, spray booth, VOC compliance project, and plant operations.',
        country: 'ID',
      }),
      tdpaintContext
    );

    expect(result.gate).toBe('PASS');
    expect(result.tier).not.toBe('reject');
    expect(result.shouldDeepQualify).toBe(true);
  });

  it('does not leak paint terms into MachRio scoring', () => {
    const result = fastICPScore(
      makeCandidate({
        displayName: 'Paint Shop Automation Inc',
        description: 'Spray painting line automation for automotive manufacturers.',
        country: 'US',
      }),
      machRioContext
    );

    expect(result.breakdown.processSignal).toBe(0);
    expect(result.gate).toBe('HARD_REJECT');
  });

  it('extracts local exclusions for a given language', () => {
    const lexicon: MergedLexicon = {
      languages: ['vi', 'en'],
      terms: {},
      exclusionTerms: { vi: ['auto repair shop', 'paint retailer'] },
    };

    expect(extractLocalExclusions(lexicon, 'vi')).toEqual(['auto repair shop', 'paint retailer']);
    expect(extractLocalExclusions(lexicon, 'th')).toEqual([]);
  });

  it('builds structured discovery evidence with fit and evidence confidence split', () => {
    const scoreResult = fastICPScore(
      makeCandidate({
        displayName: 'Vietnam Auto Bumper Manufacturing',
        description: 'Automotive bumper factory with spray painting line and paint line expansion.',
        country: 'VN',
        industry: 'automotive component manufacturing',
      }),
      tdpaintContext
    );

    const plannedQuery: PlannedQuery = {
      text: 'automotive parts manufacturer Vietnam painting line factory',
      language: 'en',
      countryCode: 'VN',
      sourceCategory: 'web_serp_english',
      intent: 'discovery',
      priority: 20,
      metadata: { termsUsed: ['painting line'] },
    };

    const evidence = buildDiscoveryEvidence(scoreResult, plannedQuery, 'brave_search');

    expect(evidence._v).toBe(2);
    expect(evidence.fitScore).toBe(scoreResult.score);
    expect(evidence.evidenceConfidence).toBe(scoreResult.evidenceConfidence);
    expect(evidence.processSignalStrength).toBe(scoreResult.processSignalStrength);
    expect(evidence.matchedObjectTerms.length).toBeGreaterThan(0);
    expect(evidence.scoreBreakdown.objectFit).toBeGreaterThan(0);
  });

  // ==================== Machrio MRO-specific tests ====================

  it('scores MRO buyer with strong procurement signals as high tier', () => {
    const result = fastICPScore(
      makeCandidate({
        displayName: 'Acme Manufacturing Corp',
        description:
          'Manufacturing plant with MRO procurement team. Bulk procurement of industrial supplies, factory maintenance spare parts and safety PPE. Supplier consolidation initiative underway.',
        country: 'US',
        industry: 'manufacturing',
      }),
      machRioContext
    );

    expect(result.gate).toBe('PASS');
    expect(result.tier).toBe('A');
    expect(result.breakdown.processSignal).toBeGreaterThan(0);
    expect(result.breakdown.industryFit).toBeGreaterThan(0);
    expect(result.breakdown.painTrigger).toBeGreaterThan(0);
  });

  it('scores oil seal buyer with purchasing trigger as Tier A', () => {
    const result = fastICPScore(
      makeCandidate({
        displayName: 'Global Logistics Warehouse Inc',
        description: 'Warehouse and logistics facility. Oil seal replacement for conveyor systems, procurement cost reduction initiative.',
        country: 'US',
        industry: 'warehouse and logistics',
      }),
      machRioContext
    );

    expect(result.gate).toBe('PASS');
    expect(result.tier).toBe('A');
    expect(result.matchedPositiveTerms.length).toBeGreaterThan(0);
  });

  it('scores industrial sensor buyer with facility signals as at least Tier B', () => {
    const result = fastICPScore(
      makeCandidate({
        displayName: 'AutoParts Fleet Services',
        description: 'Fleet maintenance facility with proximity sensor and encoder replacement needs for automated inspection systems.',
        country: 'MX',
      }),
      machRioContext
    );

    expect(result.gate).toBe('PASS');
    expect(['A', 'B']).toContain(result.tier);
    expect(result.breakdown.objectFit).toBeGreaterThan(0);
  });

  it('rejects individual DIY buyer in MRO context', () => {
    const result = fastICPScore(
      makeCandidate({
        displayName: 'John Home Workshop',
        description: 'Individual DIY buyer looking for hobbyist tools and home improvement materials.',
        country: 'US',
      }),
      machRioContext
    );

    expect(result.gate).toBe('HARD_REJECT');
    expect(result.matchedExclusionTerms.length).toBeGreaterThan(0);
  });

  it('uses MRO-specific verification actions for inferred candidates', () => {
    const result = fastICPScore(
      makeCandidate({
        displayName: 'Pacific Distribution Center',
        description: 'Large distribution center with warehouse facility operations.',
        country: 'US',
      }),
      machRioContext
    );

    expect(result.gate).toBe('PASS');
    expect(result.eligibilityGate).toBe('VERIFY_PROCESS');
    expect(result.verificationActions).toContain('verify_company_has_industrial_operations_or_facility');
    expect(result.verificationActions).not.toContain('verify_in_house_liquid_paint_line');
  });
});
