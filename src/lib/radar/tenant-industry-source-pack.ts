type ProductModel = 'project' | 'procurement';

export interface TenantIndustryProfileInput {
  tenantSlug?: string | null;
  companyName?: string | null;
  companyIntro?: string | null;
  coreProducts?: unknown;
  targetIndustries?: unknown;
  scenarios?: unknown;
  buyerPersonas?: unknown;
  painPoints?: unknown;
  buyingTriggers?: unknown;
}

export interface PackScoringConfig {
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

export interface TenantIndustrySourcePack {
  id: 'painting_automation' | 'mro_industrial_supplies';
  label: string;
  productModel: ProductModel;
  matchTerms: string[];
  discoveryKeywords: string[];
  triggerKeywords: string[];
  competitorKeywords: string[];
  targetIndustries: string[];
  buyerRoles: string[];
  sourceSignals: string[];
  negativeKeywords: string[];
  verificationQueries?: string[];
  scoringConfig?: PackScoringConfig;
  targetCountries?: string[];
}

export interface TenantIndustryRadarHints {
  packIds: TenantIndustrySourcePack['id'][];
  keywords: string[];
  targetIndustries: string[];
  buyerRoles: string[];
  buyingTriggers: string[];
  sourceSignals: string[];
  negativeKeywords: string[];
  verificationQueries: string[];
  productModels: ProductModel[];
}

const TENANT_INDUSTRY_SOURCE_PACKS: TenantIndustrySourcePack[] = [
  {
    id: 'painting_automation',
    label: 'Robotic spray painting cells and automated paint line upgrades',
    productModel: 'project',
    matchTerms: [
      'tdpaint',
      'td paint',
      'paintcell',
      'robotic painting system',
      'robotic painting',
      'spray painting',
      'spray painting automation',
      'robotic spray cell',
      'robotic spray painting cell',
      'industrial paint automation',
      'automatic paint spraying system',
      'liquid paint finishing',
      'paint finishing line',
      'paint coating',
      'industrial painting',
      'automated spray painting line',
      'manual spray painting',
      'semi-automatic spray painting',
      'paint booth',
      'spray booth',
      'paint booth automation',
      'paint shop',
      'paint line',
      'paint line automation',
      'paint robot',
      'paint automation',
      'atex',
      'nfpa 33',
      'abb',
      'fanuc',
      'kuka',
      'yaskawa',
      'graco',
      'sames',
    ],
    discoveryKeywords: [
      'automotive parts manufacturer Vietnam painting line factory',
      'motorcycle parts manufacturer Thailand spray painting facility',
      'appliance housing manufacturer Indonesia paint shop',
      'electronics enclosure manufacturer Malaysia painted parts',
      'robotic painting system',
      'spray painting automation',
      'industrial paint automation',
      'automatic paint spraying system',
      'liquid paint finishing line',
      'manufacturer upgrading manual spray painting to robots',
      'manual spray painting automation project',
      'semi-automatic spray painting line upgrade',
      'robotic spray painting cell integration',
      'automated spray painting line integrator',
      'paint booth automation integrator',
      'paint booth robot retrofit project',
      'paint shop automation retrofit',
      'automotive component robotic painting line',
      'appliance spray painting line automation',
      'metal parts spray painting robot cell',
      'plastic parts robotic spray painting line',
      'industrial equipment paint line upgrade',
      'paint supply system integration for spray robots',
      'ATEX spray booth robot upgrade',
      'VOC compliant robotic paint booth',
      'paint atomization and film thickness control',
      'paint color change system automation',
    ],
    triggerKeywords: [
      'paint line expansion',
      'manual spray painting bottleneck',
      'semi-automatic paint line upgrade',
      'spray booth retrofit',
      'robotic paint cell feasibility',
      'paint booth automation project',
      'finish quality consistency',
      'paint waste reduction',
      'VOC compliance',
      'ATEX compliance',
      'manual spray painting labor shortage',
      'film thickness variation',
      'paint color change waste',
      'paint atomization quality issue',
      'paint shop throughput improvement',
      'paint shop commissioning',
      'new paint line capacity expansion',
      'new factory painting line',
      'painting supervisor recruitment',
      'spray painter hiring',
      'process engineer painting line',
      'OEM approval paint quality',
      'Tier 1 supplier certification',
      'paint rework rate',
      'color difference issue',
      'ventilation compliance',
      'fire safety compliance',
      'explosion proof spray booth',
      'lean manufacturing automation',
    ],
    competitorKeywords: [
      'ABB painting robot customer',
      'FANUC paint robot customer',
      'KUKA painting robot customer',
      'Yaskawa paint robot customer',
      'Graco paint spray system integrator',
      'SAMES Kremlin paint finishing customer',
      'Binks spray booth automation',
    ],
    targetIndustries: [
      'manufacturers upgrading manual spray painting',
      'manufacturers upgrading semi-automatic spray painting',
      'automotive component manufacturing',
      'EV component manufacturing',
      'appliance manufacturing',
      'metal parts manufacturing',
      'industrial equipment manufacturing',
      'furniture manufacturers with spray painting lines',
      'woodworking manufacturers with liquid paint finishing lines',
      'plastic parts manufacturers with spray painting lines',
      'construction machinery manufacturers with paint shops',
    ],
    buyerRoles: [
      'Plant Manager',
      'Production Manager',
      'Paint Shop Manager',
      'Process Engineer',
      'Automation Engineer',
      'EHS Manager',
      'Maintenance Manager',
      'Project Manager',
      'Purchasing Manager',
    ],
    sourceSignals: [
      'case studies',
      'robot OEM ecosystem',
      'paint booth integrator directories',
      'paint shop upgrade projects',
      'industrial painting trade shows',
      'hiring pages',
      'safety compliance pages',
      'project references',
      'industrial park directories',
      'association directories',
      'factory videos',
      'environmental impact assessment filings',
      'expansion news',
    ],
    negativeKeywords: [
      'body shop repair',
      'car detailing',
      'residential painting',
      'house painting',
      'powder coating only',
      'dip coating',
      'adhesive dispensing',
      'glue dispensing',
      'sealant dispensing',
      'battery slurry coating',
      'medical coating',
      'functional film coating',
      'electroplating',
      'anodizing',
      'pvd coating',
      'thermal spray',
      'floor coating',
      'roof coating',
      'waterproof coating',
      'generic coating equipment',
      'coating materials supplier',
      'artist paint',
      'paint store',
    ],
    verificationQueries: [
      'painting supervisor recruitment manufacturer',
      'spray painter hiring automotive parts factory',
      'process engineer painting line manufacturer',
      'factory expansion painting line',
      'new plant paint shop automotive parts',
      'environmental impact assessment painting line factory',
      'VOC compliance paint shop factory',
      'fire safety spray booth factory',
      'site:youtube.com factory painting line',
      'industrial park automotive parts painting line',
      'OEM approval painted parts supplier',
      'Tier 1 supplier paint shop',
    ],
    scoringConfig: {
      weights: { process: 30, industry: 20, object: 15, region: 10, scale: 10, pain: 15 },
      thresholds: { a: 75, b: 55, c: 40 },
      strongSignals: [
        'paint shop', 'spray painting', 'painting line', 'spray booth',
        'robotic painting', 'automated painting line', 'painted plastic parts',
        'automotive exterior painting', 'appliance housing painting',
        'paint booth automation', 'paint robot', 'liquid paint line',
        'wet painting line', 'in-house paint shop', 'painting facility',
        'spray painting facility',
      ],
      mediumSignals: [
        'surface finishing', 'painted parts', 'decorative finish',
        'in-house finishing', 'metal enclosure finishing',
        'liquid coating', 'painted components',
      ],
      weakSignals: [
        'automotive exterior parts', 'motorcycle body parts',
        'home appliance casing', 'plastic molded parts', 'metal cabinets',
        'bumper manufacturer', 'fairing manufacturer', 'painted housing',
      ],
      objectSignals: {
        highValue: [
          'automotive bumper', 'car bumper', 'motorcycle fairing',
          'motorcycle cover', 'appliance housing', 'electronics enclosure',
          'visible exterior part', 'painted plastic exterior',
          'curved surface part', 'class a surface', 'high gloss surface',
        ],
        standard: [
          'metal enclosure', 'plastic housing', 'cabinet', 'cover panel',
          'machine cover', 'tractor body panel', 'construction machinery panel',
          'wood panel', 'furniture panel', 'batch painted parts',
        ],
        lowFit: [
          'pipe internal coating', 'tank lining', 'floor coating',
          'roof coating', 'protective coating only',
        ],
      },
      hardExclusions: [
        'repair body shop', 'car detailing', 'car repainting service',
        'small coating shop', 'paint retailer', 'equipment reseller only',
        'paint distributor', 'coating materials supplier',
        'electroplating', 'anodizing', 'pvd coating', 'thermal spray',
        'e-coat only', 'powder coating only', 'adhesive dispensing',
        'glue dispensing', 'battery slurry coating', 'film coating',
        'medical coating',
      ],
    },
    targetCountries: ['VN', 'TH', 'ID', 'MY', 'PH', 'MX', 'TR', 'IN', 'SA', 'AE'],
  },
  {
    id: 'mro_industrial_supplies',
    label: 'Cross-border MRO industrial supplies with B2B procurement workflow (RFQ/PO/DDP)',
    productModel: 'procurement',
    matchTerms: [
      // Brand
      'machrio',
      'mach rio',
      // Core MRO identity
      'mro',
      'maintenance repair operations',
      'industrial essentials',
      'industrial supplies',
      'tools parts',
      // Traditional MRO categories
      'fasteners',
      'abrasives',
      'adhesives',
      'sealants',
      'safety ppe',
      'ppe',
      'material handling',
      'hvac',
      'hydraulics',
      'electrical supplies',
      'hardware',
      'bearings',
      'belts',
      'o-ring',
      // High-traffic categories: oil seals, lockout, PPE
      'oil seal',
      'seal kit',
      'mechanical seal',
      'lockout',
      'loto',
      'tagout',
      'lockout tagout',
      'safety padlock',
      // Sensors & automation MRO
      'proximity sensor',
      'photoelectric sensor',
      'pressure sensor',
      'temperature sensor',
      'encoder',
      'industrial sensor',
      'vibration sensor',
      'level sensor',
      'gas detector',
      // Robotics & automation spare parts
      'robot gripper',
      'vacuum cup',
      'cable chain',
      'drag chain',
      'industrial connector',
      'servo motor',
      'reducer',
      'plc module',
      'relay',
      'terminal block',
      'din rail',
      'industrial power supply',
      // Drone & inspection robot parts
      'drone battery',
      'drone propeller',
      'drone motor',
      'gimbal camera',
      // B2B procurement workflow signals
      'rfq',
      'volume pricing',
      'net 30',
      'purchase order',
      'bulk order',
      'ddp shipping',
      'landed cost',
      'cross-border procurement',
    ],
    discoveryKeywords: [
      // Core MRO discovery
      'MRO industrial supplies buyer',
      'maintenance repair operations procurement',
      'industrial supplies RFQ',
      'factory maintenance supplies',
      'plant maintenance spare parts',
      'bulk fasteners procurement',
      'abrasives supplier bulk order',
      'safety PPE procurement',
      'material handling supplies buyer',
      'electrical supplies procurement',
      'hardware and fasteners distributor',
      'facility maintenance supplies',
      'warehouse operations supplies',
      'industrial consumables buyer',
      // Oil seal & sealing
      'oil seal industrial buyer',
      'mechanical seal supplier bulk',
      'o-ring seal kit procurement',
      'seal replacement parts manufacturer',
      // Lockout / LOTO
      'lockout tagout supplier',
      'LOTO safety devices procurement',
      'safety lockout kit industrial',
      'lockout station supplier bulk',
      // Sensors & automation MRO
      'industrial sensor replacement buyer',
      'proximity sensor supplier bulk order',
      'photoelectric sensor procurement',
      'encoder replacement parts',
      'pressure transmitter supplier',
      'temperature sensor industrial bulk',
      'vibration monitoring sensor supplier',
      // Robotics & automation spare parts
      'robot maintenance spare parts',
      'robot gripper vacuum cup supplier',
      'cable chain drag chain bulk',
      'industrial connector supplier',
      'PLC relay terminal block procurement',
      'servo motor reducer supplier',
      // Warehouse & logistics
      'warehouse packing materials bulk',
      'pallet jack hand truck supplier',
      'warehouse shelving racking supplier',
      'pick cart order fulfillment supplies',
      'high bay LED lighting industrial',
      // Cross-border MRO
      'cross-border industrial supplies procurement',
      'DDP MRO supplies shipping',
      'international factory supplies buyer',
      'import industrial parts customs clearance',
    ],
    triggerKeywords: [
      // Supplier friction
      'supplier consolidation',
      'volume pricing request',
      'bulk order industrial supplies',
      'replacement parts shortage',
      'current supplier lead time too long',
      'supplier cost too high',
      'reduce number of suppliers',
      'procurement cost reduction',
      'MRO vendor onboarding',
      'RFQ industrial supplies',
      // Operational triggers
      'maintenance downtime reduction',
      'production line downtime',
      'equipment breakdown',
      'emergency spare parts',
      'preventive maintenance schedule',
      // Expansion triggers
      'new warehouse opening',
      'new factory construction',
      'new production line',
      'facility expansion',
      'warehouse expansion',
      'new project startup',
      // Automation & upgrade triggers
      'automation upgrade',
      'equipment upgrade',
      'sensor replacement program',
      'robot maintenance contract',
      'conveyor system maintenance',
      // Compliance triggers
      'OSHA compliance',
      'safety audit',
      'EHS compliance upgrade',
      'lockout tagout program',
      'PPE compliance review',
      // Cross-border triggers
      'cross-border procurement complexity',
      'customs clearance difficulty',
      'looking for DDP supplier',
      'need purchase order payment terms',
      'facility maintenance contract',
    ],
    competitorKeywords: [
      'Grainger alternative supplier',
      'Fastenal customer procurement',
      'MSC Industrial supply buyer',
      'McMaster Carr alternative',
      'Motion Industries MRO customer',
      'Zoro industrial supplies customer',
      'MROSupply customer',
      'RS Components alternative',
      'Misumi alternative supplier',
      'MonotaRO customer',
      'Amazon Business industrial buyer',
      'Uline alternative supplier',
      'Global Industrial customer',
    ],
    targetIndustries: [
      // Tier 1: Highest priority
      'manufacturing',
      'discrete manufacturing',
      'process manufacturing',
      'warehouse and logistics',
      '3PL fulfillment',
      'plant maintenance',
      // Tier 2: Strong fit
      'automotive repair and fleet maintenance',
      'automotive aftermarket',
      'light industrial workshop',
      'construction contracting',
      'general contracting',
      'facility management',
      // Tier 3: Adjacent (non-core MRO only)
      'food and beverage manufacturing',
      'healthcare facilities',
      'pharmaceutical manufacturing',
      // Automation-adjacent
      'industrial automation',
      'robotics maintenance',
      'factory automation',
    ],
    buyerRoles: [
      'Procurement Manager',
      'Purchasing Officer',
      'Sourcing Specialist',
      'MRO Buyer',
      'Maintenance Manager',
      'Maintenance Engineer',
      'Facility Manager',
      'Operations Manager',
      'Warehouse Manager',
      'Plant Manager',
      'Supply Chain Manager',
      'EHS Manager',
      'Safety Manager',
      'Automation Engineer',
      'Operations Director',
    ],
    sourceSignals: [
      'industrial catalogs',
      'procurement pages',
      'supplier portals',
      'hiring pages',
      'facility management directories',
      'warehouse directories',
      'maintenance service pages',
      'industrial park directories',
      'MRO procurement RFP postings',
      'safety compliance audit pages',
      'factory expansion announcements',
      'equipment maintenance blogs',
      'industrial trade show attendees',
    ],
    negativeKeywords: [
      'aviation MRO',
      'aircraft maintenance',
      'consumer hardware',
      'home improvement retail',
      'used machinery marketplace',
      'individual DIY',
      'hobbyist tools',
      'home garden tools',
      'arts and crafts supplies',
      'personal protective cosmetics',
      'residential plumbing',
      'home electrical repair',
    ],
    verificationQueries: [
      'verify company has industrial operations or manufacturing facility',
      'check company procurement team or purchasing department',
      'check for repeat MRO buying patterns or vendor relationships',
      'verify multi-site operations or cross-border logistics needs',
      'check maintenance team or facility management signals',
      'verify company size supports bulk purchasing volume',
      'check for automation or equipment upgrade signals',
      'verify B2B procurement workflow (PO/invoice/net terms)',
    ],
    scoringConfig: {
      weights: { process: 30, industry: 25, object: 10, region: 15, scale: 10, pain: 10 },
      thresholds: { a: 75, b: 55, c: 40 },
      strongSignals: [
        // Core MRO procurement signals
        'mro', 'maintenance repair operations', 'industrial supplies procurement',
        'factory maintenance', 'plant spare parts', 'industrial mro buyer',
        'mro procurement', 'maintenance supplies',
        // High-traffic categories
        'oil seal', 'lockout tagout', 'loto program', 'safety lockout',
        'industrial ppe', 'bulk ppe',
        // Sensors & automation MRO
        'industrial sensor', 'proximity sensor', 'photoelectric sensor',
        'encoder replacement', 'pressure transmitter',
        // Robot/automation maintenance
        'robot spare parts', 'automation spare parts', 'conveyor maintenance',
        // B2B workflow
        'purchase order', 'bulk procurement', 'rfq',
      ],
      mediumSignals: [
        'procurement manager', 'facility maintenance', 'warehouse operations',
        'maintenance engineer', 'plant operations', 'industrial buyer',
        'bulk order', 'volume pricing', 'net terms',
        'seal replacement', 'bearing replacement', 'fastener supply',
        'safety supplies', 'warehouse supplies', 'packing materials',
        'industrial connector', 'cable chain', 'plc module',
      ],
      weakSignals: [
        'industrial consumables', 'hardware supplies',
        'factory operations', 'manufacturing plant',
        'warehouse facility', 'distribution center',
        'fleet maintenance', 'vehicle maintenance',
        'construction site', 'building maintenance',
      ],
      objectSignals: {
        highValue: [
          // Oil seals & sealing (high-traffic, high-intent)
          'oil seal', 'mechanical seal', 'seal kit', 'o-ring',
          'shaft seal', 'hydraulic seal',
          // Lockout/LOTO (compliance-driven, sticky)
          'lockout tagout', 'loto', 'safety padlock', 'lockout station',
          'lockout hasp', 'valve lockout',
          // Sensors (automation MRO, high-margin)
          'proximity sensor', 'photoelectric sensor', 'encoder',
          'pressure sensor', 'temperature sensor', 'vibration sensor',
          // Robot/automation parts
          'robot gripper', 'vacuum cup', 'end effector',
        ],
        standard: [
          // General MRO staples
          'bearing', 'belt', 'fastener', 'bolt', 'nut',
          'abrasive', 'adhesive', 'tape',
          'glove', 'safety glass', 'hard hat', 'ear plug',
          'cable chain', 'connector', 'terminal',
          'relay', 'contactor', 'circuit breaker',
          'packing material', 'stretch wrap', 'pallet',
          'hand truck', 'shelving', 'bin',
          'led high bay', 'industrial lighting',
        ],
        lowFit: [
          // Low fit for Machrio
          'consumer electronics', 'home appliance',
          'personal care product', 'food ingredient',
          'pharmaceutical raw material', 'medical implant',
          'aircraft engine part', 'military grade component',
        ],
      },
      hardExclusions: [
        'consumer retail', 'home improvement', 'used machinery marketplace',
        'non-industrial', 'aviation MRO', 'aircraft maintenance',
        'individual DIY buyer', 'hobbyist', 'arts crafts',
        'residential contractor only', 'home gardening',
        'military defense only', 'nuclear facility',
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
          'check_equipment_downtime_or_maintenance_needs',
        ],
        lowConfidence: [
          'collect_procurement_workflow_evidence',
          'verify_bulk_buying_or_repeat_purchase_patterns',
        ],
      },
    },
    targetCountries: ['US', 'MX', 'CA', 'BR', 'CO', 'CL', 'PE', 'AE', 'SA', 'AU', 'GB', 'VN', 'TH', 'ID', 'MY', 'PH'],
  },
];

function flattenText(value: unknown): string[] {
  if (value == null) {
    return [];
  }

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return [String(value)];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => flattenText(item));
  }

  if (typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).flatMap((item) => flattenText(item));
  }

  return [];
}

function dedupe(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const normalized = value.trim();
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(normalized);
  }

  return result;
}

function matchesTerm(haystack: string, term: string): boolean {
  const normalizedTerm = term.toLowerCase();
  if (normalizedTerm.length <= 3 && /^[a-z0-9]+$/.test(normalizedTerm)) {
    return new RegExp(`\\b${normalizedTerm}\\b`, 'i').test(haystack);
  }

  return haystack.includes(normalizedTerm);
}

function scorePack(pack: TenantIndustrySourcePack, input: TenantIndustryProfileInput): number {
  const slug = input.tenantSlug?.toLowerCase() || '';
  const companyName = input.companyName?.toLowerCase() || '';
  const text = flattenText(input).join(' ').toLowerCase();
  let score = 0;

  for (const term of pack.matchTerms) {
    if (matchesTerm(slug, term)) {
      score += 4;
    }
    if (matchesTerm(companyName, term)) {
      score += 3;
    }
    if (matchesTerm(text, term)) {
      score += 1;
    }
  }

  return score;
}

export function selectTenantIndustrySourcePacks(
  input: TenantIndustryProfileInput
): TenantIndustrySourcePack[] {
  return TENANT_INDUSTRY_SOURCE_PACKS
    .map((pack) => ({ pack, score: scorePack(pack, input) }))
    .filter(({ score }) => score >= 2)
    .sort((a, b) => b.score - a.score)
    .map(({ pack }) => pack);
}

export function buildTenantIndustryRadarHints(
  input: TenantIndustryProfileInput
): TenantIndustryRadarHints {
  const packs = selectTenantIndustrySourcePacks(input);

  return {
    packIds: packs.map((pack) => pack.id),
    keywords: dedupe(
      packs.flatMap((pack) => [
        ...pack.discoveryKeywords,
        ...pack.triggerKeywords,
        ...pack.competitorKeywords,
      ])
    ),
    targetIndustries: dedupe(packs.flatMap((pack) => pack.targetIndustries)),
    buyerRoles: dedupe(packs.flatMap((pack) => pack.buyerRoles)),
    buyingTriggers: dedupe(packs.flatMap((pack) => pack.triggerKeywords)),
    sourceSignals: dedupe(packs.flatMap((pack) => pack.sourceSignals)),
    negativeKeywords: dedupe(packs.flatMap((pack) => pack.negativeKeywords)),
    verificationQueries: dedupe(packs.flatMap((pack) => pack.verificationQueries || [])),
    productModels: dedupe(packs.map((pack) => pack.productModel)) as ProductModel[],
  };
}

export function mergeRadarKeywordHints(
  keywords: Record<string, string[]> | null | undefined,
  hints: TenantIndustryRadarHints
): Record<string, string[]> {
  return {
    ...(keywords || {}),
    en: dedupe([...(keywords?.en || []), ...hints.keywords]),
  };
}
