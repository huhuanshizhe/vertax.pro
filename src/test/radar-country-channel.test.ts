import { describe, it, expect } from 'vitest';
import {
  getChannelAdaptation,
  getPreferredChannel,
  isGoodTimeToContact,
  getOutreachChannelAdvice,
} from '@/lib/radar/country-channel-adaptation';

describe('country-channel-adaptation', () => {
  describe('getChannelAdaptation', () => {
    it('returns Zalo-first for Vietnam', () => {
      const vn = getChannelAdaptation('VN');
      expect(vn.preferredChannels[0]).toBe('zalo');
      expect(vn.preferredLanguage).toBe('vi');
      expect(vn.timezoneOffset).toBe(7);
    });

    it('returns LINE-first for Thailand', () => {
      const th = getChannelAdaptation('TH');
      expect(th.preferredChannels[0]).toBe('line');
      expect(th.preferredLanguage).toBe('th');
    });

    it('returns email-first for Japan', () => {
      const jp = getChannelAdaptation('JP');
      expect(jp.preferredChannels[0]).toBe('email');
      expect(jp.preferredLanguage).toBe('ja');
      expect(jp.notes).toContain('邮件');
    });

    it('returns WhatsApp-first for India', () => {
      const ind = getChannelAdaptation('IN');
      expect(ind.preferredChannels[0]).toBe('whatsapp');
      expect(ind.preferredLanguage).toBe('en');
    });

    it('returns Friday-Saturday weekend for Saudi Arabia', () => {
      const sa = getChannelAdaptation('SA');
      expect(sa.weekendDays).toContain(5); // Friday
      expect(sa.weekendDays).toContain(6); // Saturday
    });

    it('returns default for unknown country', () => {
      const xx = getChannelAdaptation('XX');
      expect(xx.preferredChannels[0]).toBe('email');
      expect(xx.preferredLanguage).toBe('en');
    });

    it('returns default for null/undefined', () => {
      expect(getChannelAdaptation(null).preferredChannels[0]).toBe('email');
      expect(getChannelAdaptation(undefined).preferredChannels[0]).toBe('email');
    });

    it('handles case-insensitive input', () => {
      const vn = getChannelAdaptation('vn');
      expect(vn.preferredChannels[0]).toBe('zalo');
    });
  });

  describe('getPreferredChannel', () => {
    it('returns the first preferred channel', () => {
      expect(getPreferredChannel('VN')).toBe('zalo');
      expect(getPreferredChannel('TH')).toBe('line');
      expect(getPreferredChannel('DE')).toBe('email');
    });
  });

  describe('isGoodTimeToContact', () => {
    it('returns good during business hours in target timezone', () => {
      // UTC 02:00 = Vietnam 09:00 (UTC+7), Tuesday
      const result = isGoodTimeToContact('VN', 2, 2); // Tuesday = 2
      expect(result.good).toBe(true);
    });

    it('returns bad during weekend', () => {
      // Vietnam: Sunday is weekend (weekendDays: [0])
      // UTC 17:00 Sunday = Vietnam 00:00 Monday — but UTC 00:00 Sunday = Vietnam 07:00 Sunday
      const result = isGoodTimeToContact('VN', 0, 0); // Sunday 00:00 UTC = 07:00 Sunday Vietnam
      expect(result.good).toBe(false);
      expect(result.reason).toContain('周末');
    });

    it('returns bad outside business hours', () => {
      // UTC 20:00 = Vietnam 03:00 (next day) — too early
      const result = isGoodTimeToContact('VN', 20, 1); // Monday UTC
      expect(result.good).toBe(false);
    });

    it('handles Friday-Saturday weekend for Saudi', () => {
      // Friday in Saudi = weekend
      // UTC 05:00 Friday = Saudi 08:00 Friday
      const result = isGoodTimeToContact('SA', 5, 5); // Friday
      expect(result.good).toBe(false);
    });
  });

  describe('getOutreachChannelAdvice', () => {
    it('provides Zalo advice for Vietnam', () => {
      const advice = getOutreachChannelAdvice('VN');
      expect(advice.primaryChannel).toBe('zalo');
      expect(advice.emailLanguage).toBe('vi');
      expect(advice.channelSpecificAdvice).toContain('Zalo');
    });

    it('provides LINE advice for Thailand', () => {
      const advice = getOutreachChannelAdvice('TH');
      expect(advice.primaryChannel).toBe('line');
      expect(advice.channelSpecificAdvice).toContain('LINE');
    });

    it('provides email advice for Germany', () => {
      const advice = getOutreachChannelAdvice('DE');
      expect(advice.primaryChannel).toBe('email');
      expect(advice.emailLanguage).toBe('de');
    });
  });
});
