// ==================== Seasonal Procurement Awareness ====================
// 根据行业 × 月份感知采购周期，自动调整搜索和外联优先级

/** 行业采购周期配置 */
export interface SeasonalConfig {
  /** 行业代码或名称 */
  industry: string;
  /** 采购旺季月份 (1-12)：客户正在下单 */
  peakOrderMonths: number[];
  /** 备货期月份：客户在选品/比价/验厂 */
  sourcingMonths: number[];
  /** 淡季月份：减少外联打扰 */
  offSeasonMonths: number[];
  /** 特殊说明 */
  note?: string;
}

/** 内置行业采购周期数据（基于外贸实务经验） */
export const INDUSTRY_SEASONAL_DATA: SeasonalConfig[] = [
  {
    industry: 'consumer_electronics',
    peakOrderMonths: [3, 4, 5, 9, 10],
    sourcingMonths: [1, 2, 6, 7, 8],
    offSeasonMonths: [11, 12],
    note: '消费电子：Q1春单 + Q3-Q4 节日备货。11-12月工厂排产满，采购放缓',
  },
  {
    industry: 'textile_garment',
    peakOrderMonths: [1, 2, 3, 7, 8, 9],
    sourcingMonths: [4, 5, 10, 11],
    offSeasonMonths: [6, 12],
    note: '服装纺织：春夏款1-3月下单，秋冬款7-9月下单。6月和12月为换季空档',
  },
  {
    industry: 'building_materials',
    peakOrderMonths: [3, 4, 5, 6],
    sourcingMonths: [1, 2, 7, 8],
    offSeasonMonths: [11, 12, 1, 2],
    note: '建材：北半球春季开工旺季前1-2个月采购高峰。冬季（北半球）需求低迷',
  },
  {
    industry: 'automotive_parts',
    peakOrderMonths: [1, 2, 3, 4, 9, 10],
    sourcingMonths: [5, 6, 7, 8, 11],
    offSeasonMonths: [12],
    note: '汽车零部件：全年持续采购，但春节前后(1-2月)和中国国庆(10月)有波动',
  },
  {
    industry: 'machinery',
    peakOrderMonths: [3, 4, 5, 9, 10],
    sourcingMonths: [1, 2, 6, 7, 8],
    offSeasonMonths: [11, 12],
    note: '机械设备：年初预算审批后集中采购，Q3-Q4为来年预算规划期',
  },
  {
    industry: 'food_beverage',
    peakOrderMonths: [1, 2, 6, 7, 8, 9],
    sourcingMonths: [3, 4, 5, 10],
    offSeasonMonths: [11, 12],
    note: '食品饮料：夏季饮品备货 + 年初补货。年末预算冻结',
  },
  {
    industry: 'packaging',
    peakOrderMonths: [2, 3, 4, 8, 9, 10],
    sourcingMonths: [1, 5, 6, 7],
    offSeasonMonths: [11, 12],
    note: '包装：跟随下游行业节奏，节日季前2-3个月为高峰',
  },
  {
    industry: 'chemicals',
    peakOrderMonths: [3, 4, 5, 9, 10],
    sourcingMonths: [1, 2, 6, 7, 8],
    offSeasonMonths: [11, 12],
    note: '化工：年初生产计划确定后集中采购',
  },
  {
    industry: 'furniture',
    peakOrderMonths: [1, 2, 3, 7, 8],
    sourcingMonths: [4, 5, 9, 10],
    offSeasonMonths: [6, 11, 12],
    note: '家具：春季和夏末为采购高峰，跟随装修季',
  },
  {
    industry: 'led_lighting',
    peakOrderMonths: [3, 4, 5, 8, 9],
    sourcingMonths: [1, 2, 6, 7],
    offSeasonMonths: [10, 11, 12],
    note: 'LED照明：Q1工程项目启动 + Q3商业照明备货',
  },
  {
    industry: 'medical_devices',
    peakOrderMonths: [1, 2, 3, 4, 9, 10],
    sourcingMonths: [5, 6, 7, 8],
    offSeasonMonths: [11, 12],
    note: '医疗器械：年初预算分配后集中采购。需认证审批周期长',
  },
  {
    industry: 'agriculture',
    peakOrderMonths: [2, 3, 8, 9],
    sourcingMonths: [4, 5, 10, 11],
    offSeasonMonths: [6, 7, 12],
    note: '农业机械/物资：春播前 + 秋收前为采购高峰',
  },
];

/**
 * 获取当前月份的行业采购阶段
 */
export function getSeasonalPhase(
  industry: string | null | undefined,
  month?: number,
): 'peak_order' | 'sourcing' | 'off_season' | 'normal' {
  const currentMonth = month || new Date().getMonth() + 1;

  if (!industry) return 'normal';

  // 尝试匹配行业（支持模糊匹配）
  const industryLower = industry.toLowerCase();
  const config = INDUSTRY_SEASONAL_DATA.find(c =>
    industryLower.includes(c.industry) || c.industry.includes(industryLower)
  );

  if (!config) return 'normal';

  if (config.peakOrderMonths.includes(currentMonth)) return 'peak_order';
  if (config.sourcingMonths.includes(currentMonth)) return 'sourcing';
  if (config.offSeasonMonths.includes(currentMonth)) return 'off_season';
  return 'normal';
}

/**
 * 获取行业季节性建议（用于搜索优先级和外联策略）
 */
export function getSeasonalAdvice(
  industry: string | null | undefined,
  month?: number,
): {
  phase: string;
  phaseLabel: string;
  searchPriorityBoost: number; // -20 ~ +20
  outreachAdvice: string;
  color: string; // 用于 UI 标识
} {
  const phase = getSeasonalPhase(industry, month);

  switch (phase) {
    case 'peak_order':
      return {
        phase: 'peak_order',
        phaseLabel: '🔥 采购旺季',
        searchPriorityBoost: 15,
        outreachAdvice: '客户正在下单期，优先触达！强调交期和产能。直接报价 + 样品跟进。',
        color: '#ef4444',
      };
    case 'sourcing':
      return {
        phase: 'sourcing',
        phaseLabel: '🔍 选品比价期',
        searchPriorityBoost: 10,
        outreachAdvice: '客户在选品/比价阶段。重点展示产品优势、认证资质、价格竞争力。提供样品。',
        color: '#f59e0b',
      };
    case 'off_season':
      return {
        phase: 'off_season',
        phaseLabel: '💤 淡季',
        searchPriorityBoost: -10,
        outreachAdvice: '淡季维护关系为主，不宜强推。可以发送行业资讯、新品预告，为旺季做铺垫。',
        color: '#6b7280',
      };
    default:
      return {
        phase: 'normal',
        phaseLabel: '📋 常规期',
        searchPriorityBoost: 0,
        outreachAdvice: '常规跟进节奏。',
        color: '#3b82f6',
      };
  }
}

/**
 * 搜索组合优先级调整（结合季节性）
 * 用于 scan-engine 的 selectNextSearchCombo 增强
 */
export function applySeasonalBoost(
  baseScore: number,
  industry: string | null | undefined,
): number {
  const advice = getSeasonalAdvice(industry);
  return Math.max(0, Math.min(1, baseScore + advice.searchPriorityBoost / 100));
}

/**
 * 获取当前月份最适合联系的行业列表（用于 daily workspace 排序）
 */
export function getHotIndustriesThisMonth(month?: number): string[] {
  const currentMonth = month || new Date().getMonth() + 1;
  return INDUSTRY_SEASONAL_DATA
    .filter(c => c.peakOrderMonths.includes(currentMonth))
    .map(c => c.industry);
}

/**
 * 获取外联邮件的季节性开场白建议
 */
export function getSeasonalOpener(
  industry: string | null | undefined,
  language: string = 'en',
): string {
  const phase = getSeasonalPhase(industry);
  const month = new Date().getMonth() + 1;

  if (language === 'zh-Hans' || language === 'zh') {
    switch (phase) {
      case 'peak_order':
        return `了解到贵司正处于采购旺季，我们希望能在交期和产能上为您提供有力支持。`;
      case 'sourcing':
        return `正值行业选品季，我们整理了最新的产品线和价格方案，希望能为您的采购决策提供参考。`;
      case 'off_season':
        return `年末/假期将至，提前为您送上新一年的产品规划和合作方案，为来年的合作做好准备。`;
      default:
        return '';
    }
  }

  // English default
  switch (phase) {
    case 'peak_order':
      return `Understanding that this is your peak ordering season, we'd like to support you with competitive lead times and production capacity.`;
    case 'sourcing':
      return `As the industry enters its sourcing season, we've prepared our latest product lineup and pricing for your evaluation.`;
    case 'off_season':
      return `As the season winds down, we'd like to share our product roadmap for the coming year and explore how we can support your plans.`;
    default:
      return '';
  }
}
