// ==================== Country-Channel Adaptation ====================
// 根据国家/地区自动调整首选沟通渠道、语言、联系时间建议

export interface ChannelAdaptation {
  /** 首选渠道（按优先级排列） */
  preferredChannels: ('email' | 'whatsapp' | 'phone' | 'linkedin' | 'zalo' | 'line' | 'wechat' | 'kakao')[];
  /** 首选联系语言 */
  preferredLanguage: string;
  /** 备用语言 */
  fallbackLanguage: string;
  /** 当地时间 UTC 偏移（小时） */
  timezoneOffset: number;
  /** 推荐联系时间段（当地时间，24h 格式） */
  bestContactHours: { start: number; end: number };
  /** 周末（0=周日, 6=周六） */
  weekendDays: number[];
  /** 特殊注意事项 */
  notes?: string;
}

// 国家级渠道适配配置
const COUNTRY_CHANNEL_MAP: Record<string, ChannelAdaptation> = {
  // ==================== 东南亚 ====================
  VN: {
    preferredChannels: ['zalo', 'whatsapp', 'email', 'phone'],
    preferredLanguage: 'vi',
    fallbackLanguage: 'en',
    timezoneOffset: 7,
    bestContactHours: { start: 9, end: 17 },
    weekendDays: [0],
    notes: 'Zalo 是越南主流即时通讯工具，优先于 WhatsApp',
  },
  TH: {
    preferredChannels: ['line', 'email', 'whatsapp', 'phone'],
    preferredLanguage: 'th',
    fallbackLanguage: 'en',
    timezoneOffset: 7,
    bestContactHours: { start: 9, end: 17 },
    weekendDays: [0],
    notes: 'LINE 是泰国主流通讯工具',
  },
  ID: {
    preferredChannels: ['whatsapp', 'email', 'phone'],
    preferredLanguage: 'id',
    fallbackLanguage: 'en',
    timezoneOffset: 7,
    bestContactHours: { start: 9, end: 17 },
    weekendDays: [0, 6],
    notes: 'WhatsApp 占绝对主导',
  },
  PH: {
    preferredChannels: ['whatsapp', 'email', 'phone'],
    preferredLanguage: 'en',
    fallbackLanguage: 'en',
    timezoneOffset: 8,
    bestContactHours: { start: 9, end: 17 },
    weekendDays: [0, 6],
    notes: '英语通用度高',
  },
  MY: {
    preferredChannels: ['whatsapp', 'email', 'phone'],
    preferredLanguage: 'ms',
    fallbackLanguage: 'en',
    timezoneOffset: 8,
    bestContactHours: { start: 9, end: 17 },
    weekendDays: [6, 0], // 部分州周五-周六为周末
    notes: '马来语/英语双语',
  },

  // ==================== 东亚 ====================
  JP: {
    preferredChannels: ['email', 'phone', 'linkedin'],
    preferredLanguage: 'ja',
    fallbackLanguage: 'en',
    timezoneOffset: 9,
    bestContactHours: { start: 9, end: 17 },
    weekendDays: [0, 6],
    notes: '邮件仍是首选商务沟通方式，重视层级关系和敬语',
  },
  KR: {
    preferredChannels: ['email', 'kakao', 'phone', 'linkedin'],
    preferredLanguage: 'ko',
    fallbackLanguage: 'en',
    timezoneOffset: 9,
    bestContactHours: { start: 9, end: 18 },
    weekendDays: [0, 6],
    notes: 'KakaoTalk 用于非正式沟通，正式商务仍以邮件为主',
  },
  CN: {
    preferredChannels: ['wechat', 'phone', 'email'],
    preferredLanguage: 'zh-Hans',
    fallbackLanguage: 'en',
    timezoneOffset: 8,
    bestContactHours: { start: 9, end: 18 },
    weekendDays: [0, 6],
    notes: '微信是商务沟通首选',
  },

  // ==================== 中东 ====================
  SA: {
    preferredChannels: ['whatsapp', 'email', 'phone'],
    preferredLanguage: 'ar',
    fallbackLanguage: 'en',
    timezoneOffset: 3,
    bestContactHours: { start: 9, end: 16 },
    weekendDays: [5, 6], // 周五-周六
    notes: '周五-周六为周末，工作日为周日-周四',
  },
  AE: {
    preferredChannels: ['whatsapp', 'email', 'phone'],
    preferredLanguage: 'ar',
    fallbackLanguage: 'en',
    timezoneOffset: 4,
    bestContactHours: { start: 9, end: 17 },
    weekendDays: [0, 6],
    notes: '英语在商务中广泛使用',
  },
  TR: {
    preferredChannels: ['whatsapp', 'email', 'phone'],
    preferredLanguage: 'tr',
    fallbackLanguage: 'en',
    timezoneOffset: 3,
    bestContactHours: { start: 9, end: 17 },
    weekendDays: [0, 6],
  },

  // ==================== 南亚 ====================
  IN: {
    preferredChannels: ['whatsapp', 'email', 'phone'],
    preferredLanguage: 'en',
    fallbackLanguage: 'en',
    timezoneOffset: 5.5,
    bestContactHours: { start: 10, end: 18 },
    weekendDays: [0, 6],
    notes: 'WhatsApp 商务使用率极高，英语通用',
  },
  BD: {
    preferredChannels: ['whatsapp', 'email', 'phone'],
    preferredLanguage: 'en',
    fallbackLanguage: 'en',
    timezoneOffset: 6,
    bestContactHours: { start: 10, end: 17 },
    weekendDays: [6, 0],
  },
  PK: {
    preferredChannels: ['whatsapp', 'email', 'phone'],
    preferredLanguage: 'en',
    fallbackLanguage: 'ur',
    timezoneOffset: 5,
    bestContactHours: { start: 9, end: 17 },
    weekendDays: [0, 6],
  },

  // ==================== 拉美 ====================
  MX: {
    preferredChannels: ['whatsapp', 'email', 'phone'],
    preferredLanguage: 'es',
    fallbackLanguage: 'en',
    timezoneOffset: -6,
    bestContactHours: { start: 9, end: 18 },
    weekendDays: [0, 6],
    notes: 'WhatsApp 是主要商务沟通工具',
  },
  BR: {
    preferredChannels: ['whatsapp', 'email', 'phone'],
    preferredLanguage: 'pt',
    fallbackLanguage: 'es',
    timezoneOffset: -3,
    bestContactHours: { start: 9, end: 18 },
    weekendDays: [0, 6],
    notes: 'WhatsApp 占绝对主导，葡萄牙语为主',
  },
  CO: {
    preferredChannels: ['whatsapp', 'email', 'phone'],
    preferredLanguage: 'es',
    fallbackLanguage: 'en',
    timezoneOffset: -5,
    bestContactHours: { start: 8, end: 17 },
    weekendDays: [0, 6],
  },
  CL: {
    preferredChannels: ['whatsapp', 'email', 'phone'],
    preferredLanguage: 'es',
    fallbackLanguage: 'en',
    timezoneOffset: -4,
    bestContactHours: { start: 9, end: 18 },
    weekendDays: [0, 6],
  },

  // ==================== 欧洲 ====================
  DE: {
    preferredChannels: ['email', 'phone', 'linkedin'],
    preferredLanguage: 'de',
    fallbackLanguage: 'en',
    timezoneOffset: 1,
    bestContactHours: { start: 8, end: 17 },
    weekendDays: [0, 6],
    notes: '邮件首选，重视正式商务礼仪',
  },
  GB: {
    preferredChannels: ['email', 'phone', 'linkedin', 'whatsapp'],
    preferredLanguage: 'en',
    fallbackLanguage: 'en',
    timezoneOffset: 0,
    bestContactHours: { start: 9, end: 17 },
    weekendDays: [0, 6],
  },
  FR: {
    preferredChannels: ['email', 'phone', 'linkedin'],
    preferredLanguage: 'fr',
    fallbackLanguage: 'en',
    timezoneOffset: 1,
    bestContactHours: { start: 9, end: 17 },
    weekendDays: [0, 6],
    notes: '法语首选，商务沟通偏正式',
  },
  IT: {
    preferredChannels: ['whatsapp', 'email', 'phone'],
    preferredLanguage: 'it',
    fallbackLanguage: 'en',
    timezoneOffset: 1,
    bestContactHours: { start: 9, end: 17 },
    weekendDays: [0, 6],
  },
  ES: {
    preferredChannels: ['whatsapp', 'email', 'phone'],
    preferredLanguage: 'es',
    fallbackLanguage: 'en',
    timezoneOffset: 1,
    bestContactHours: { start: 9, end: 18 },
    weekendDays: [0, 6],
  },
  PL: {
    preferredChannels: ['email', 'phone', 'whatsapp'],
    preferredLanguage: 'pl',
    fallbackLanguage: 'en',
    timezoneOffset: 1,
    bestContactHours: { start: 8, end: 16 },
    weekendDays: [0, 6],
  },
  NL: {
    preferredChannels: ['email', 'phone', 'linkedin'],
    preferredLanguage: 'nl',
    fallbackLanguage: 'en',
    timezoneOffset: 1,
    bestContactHours: { start: 8, end: 17 },
    weekendDays: [0, 6],
    notes: '英语通用度很高',
  },
  RU: {
    preferredChannels: ['email', 'whatsapp', 'phone'],
    preferredLanguage: 'ru',
    fallbackLanguage: 'en',
    timezoneOffset: 3,
    bestContactHours: { start: 9, end: 18 },
    weekendDays: [0, 6],
  },

  // ==================== 非洲 ====================
  EG: {
    preferredChannels: ['whatsapp', 'email', 'phone'],
    preferredLanguage: 'ar',
    fallbackLanguage: 'en',
    timezoneOffset: 2,
    bestContactHours: { start: 9, end: 16 },
    weekendDays: [5, 6], // 周五-周六
  },
  NG: {
    preferredChannels: ['whatsapp', 'email', 'phone'],
    preferredLanguage: 'en',
    fallbackLanguage: 'en',
    timezoneOffset: 1,
    bestContactHours: { start: 9, end: 17 },
    weekendDays: [0, 6],
  },
  KE: {
    preferredChannels: ['whatsapp', 'email', 'phone'],
    preferredLanguage: 'en',
    fallbackLanguage: 'sw',
    timezoneOffset: 3,
    bestContactHours: { start: 8, end: 17 },
    weekendDays: [0, 6],
  },
  ZA: {
    preferredChannels: ['whatsapp', 'email', 'phone'],
    preferredLanguage: 'en',
    fallbackLanguage: 'af',
    timezoneOffset: 2,
    bestContactHours: { start: 8, end: 17 },
    weekendDays: [0, 6],
  },

  // ==================== 北美 ====================
  US: {
    preferredChannels: ['email', 'phone', 'linkedin', 'whatsapp'],
    preferredLanguage: 'en',
    fallbackLanguage: 'en',
    timezoneOffset: -5, // ET (默认)
    bestContactHours: { start: 9, end: 17 },
    weekendDays: [0, 6],
    notes: '跨时区注意：ET/CT/MT/PT 各差1-3小时',
  },
  CA: {
    preferredChannels: ['email', 'phone', 'linkedin'],
    preferredLanguage: 'en',
    fallbackLanguage: 'fr',
    timezoneOffset: -5,
    bestContactHours: { start: 9, end: 17 },
    weekendDays: [0, 6],
  },

  // ==================== 大洋洲 ====================
  AU: {
    preferredChannels: ['email', 'phone', 'linkedin'],
    preferredLanguage: 'en',
    fallbackLanguage: 'en',
    timezoneOffset: 10, // AEST
    bestContactHours: { start: 9, end: 17 },
    weekendDays: [0, 6],
  },
  NZ: {
    preferredChannels: ['email', 'phone', 'linkedin'],
    preferredLanguage: 'en',
    fallbackLanguage: 'en',
    timezoneOffset: 12,
    bestContactHours: { start: 9, end: 17 },
    weekendDays: [0, 6],
  },
};

// 默认配置（未知国家）
const DEFAULT_ADAPTATION: ChannelAdaptation = {
  preferredChannels: ['email', 'whatsapp', 'phone'],
  preferredLanguage: 'en',
  fallbackLanguage: 'en',
  timezoneOffset: 0,
  bestContactHours: { start: 9, end: 17 },
  weekendDays: [0, 6],
};

/**
 * 获取国家的渠道适配信息
 */
export function getChannelAdaptation(countryCode: string | null | undefined): ChannelAdaptation {
  if (!countryCode) return DEFAULT_ADAPTATION;
  return COUNTRY_CHANNEL_MAP[countryCode.toUpperCase()] || DEFAULT_ADAPTATION;
}

/**
 * 获取国家的首选沟通渠道
 */
export function getPreferredChannel(countryCode: string | null | undefined): string {
  return getChannelAdaptation(countryCode).preferredChannels[0] || 'email';
}

/**
 * 判断当前是否是该国家的合适联系时间
 * @param countryCode 国家代码
 * @param utcHour 当前 UTC 时间（小时）
 * @param utcDayOfWeek 当前 UTC 星期几（0=周日）
 */
export function isGoodTimeToContact(
  countryCode: string | null | undefined,
  utcHour: number,
  utcDayOfWeek: number,
): { good: boolean; reason: string } {
  const adaptation = getChannelAdaptation(countryCode);

  // 转换 UTC 到当地时间
  let localHour = utcHour + adaptation.timezoneOffset;
  if (localHour >= 24) localHour -= 24;
  if (localHour < 0) localHour += 24;

  // 转换星期几
  let localDay = utcDayOfWeek;
  if (utcHour + adaptation.timezoneOffset >= 24) localDay = (localDay + 1) % 7;
  if (utcHour + adaptation.timezoneOffset < 0) localDay = (localDay - 1 + 7) % 7;

  // 检查是否周末
  if (adaptation.weekendDays.includes(localDay)) {
    return { good: false, reason: `当地时间是周末` };
  }

  // 检查是否在联系时间段内
  if (localHour < adaptation.bestContactHours.start || localHour >= adaptation.bestContactHours.end) {
    return { good: false, reason: `当地时间 ${localHour}:00 不在推荐联系时段 (${adaptation.bestContactHours.start}:00-${adaptation.bestContactHours.end}:00)` };
  }

  return { good: true, reason: `当地时间 ${localHour}:00 适合联系` };
}

/**
 * 获取国家的所有渠道适配信息（用于外联包生成）
 */
export function getOutreachChannelAdvice(countryCode: string | null | undefined): {
  primaryChannel: string;
  emailLanguage: string;
  fallbackLanguage: string;
  timezoneNote: string;
  channelSpecificAdvice: string;
} {
  const adaptation = getChannelAdaptation(countryCode);
  const primary = adaptation.preferredChannels[0];

  let channelSpecificAdvice = '';
  switch (primary) {
    case 'zalo':
      channelSpecificAdvice = '越南客户首选 Zalo 联系。建议同时在 WhatsApp 上备份。';
      break;
    case 'line':
      channelSpecificAdvice = '泰国客户首选 LINE 联系。正式文件仍用邮件。';
      break;
    case 'wechat':
      channelSpecificAdvice = '中国客户首选微信。注意时区（UTC+8）。';
      break;
    case 'kakao':
      channelSpecificAdvice = '韩国客户可用 KakaoTalk，但正式商务仍以邮件为主。';
      break;
    case 'whatsapp':
      channelSpecificAdvice = 'WhatsApp 为该区域主流沟通工具。消息宜简洁直接。';
      break;
    case 'email':
      channelSpecificAdvice = '该区域商务沟通以邮件为主。建议正式、简洁。';
      break;
    default:
      channelSpecificAdvice = adaptation.notes || '';
  }

  const tzOffset = adaptation.timezoneOffset;
  const tzNote = tzOffset >= 0
    ? `比北京快 ${tzOffset - 8} 小时`
    : `比北京慢 ${8 - tzOffset} 小时`;

  return {
    primaryChannel: primary,
    emailLanguage: adaptation.preferredLanguage,
    fallbackLanguage: adaptation.fallbackLanguage,
    timezoneNote: tzNote,
    channelSpecificAdvice,
  };
}
