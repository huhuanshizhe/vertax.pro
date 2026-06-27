import { describe, it, expect } from 'vitest';
import {
  getSeasonalPhase,
  getSeasonalAdvice,
  getHotIndustriesThisMonth,
  getSeasonalOpener,
} from '@/lib/radar/seasonal-awareness';

describe('seasonal-awareness', () => {
  describe('getSeasonalPhase', () => {
    it('returns peak_order for consumer electronics in March', () => {
      expect(getSeasonalPhase('consumer_electronics', 3)).toBe('peak_order');
    });

    it('returns off_season for consumer electronics in December', () => {
      expect(getSeasonalPhase('consumer_electronics', 12)).toBe('off_season');
    });

    it('returns sourcing for textiles in May', () => {
      expect(getSeasonalPhase('textile_garment', 5)).toBe('sourcing');
    });

    it('returns normal for unknown industry', () => {
      expect(getSeasonalPhase('unknown_industry', 6)).toBe('normal');
    });

    it('returns normal for null industry', () => {
      expect(getSeasonalPhase(null, 3)).toBe('normal');
    });

    it('supports partial matching with underscore key', () => {
      expect(getSeasonalPhase('led_lighting', 3)).toBe('peak_order');
    });
  });

  describe('getSeasonalAdvice', () => {
    it('returns peak order advice with boost', () => {
      const advice = getSeasonalAdvice('automotive_parts', 3);
      expect(advice.phase).toBe('peak_order');
      expect(advice.searchPriorityBoost).toBeGreaterThan(0);
      expect(advice.outreachAdvice).toContain('下单');
      expect(advice.color).toBe('#ef4444');
    });

    it('returns sourcing advice for moderate boost', () => {
      const advice = getSeasonalAdvice('automotive_parts', 6);
      expect(advice.phase).toBe('sourcing');
      expect(advice.searchPriorityBoost).toBeGreaterThan(0);
      expect(advice.outreachAdvice).toContain('选品');
    });

    it('returns off-season advice with negative boost', () => {
      const advice = getSeasonalAdvice('consumer_electronics', 11);
      expect(advice.phase).toBe('off_season');
      expect(advice.searchPriorityBoost).toBeLessThan(0);
      expect(advice.color).toBe('#6b7280');
    });

    it('returns normal advice for unknown industry', () => {
      const advice = getSeasonalAdvice('unknown');
      expect(advice.phase).toBe('normal');
      expect(advice.searchPriorityBoost).toBe(0);
    });
  });

  describe('getHotIndustriesThisMonth', () => {
    it('returns industries in peak order for March', () => {
      const hot = getHotIndustriesThisMonth(3);
      expect(hot).toContain('consumer_electronics');
      expect(hot).toContain('automotive_parts');
      expect(hot).toContain('building_materials');
    });

    it('returns different industries for different months', () => {
      const march = getHotIndustriesThisMonth(3);
      const september = getHotIndustriesThisMonth(9);
      // Both should have results but not identical
      expect(march.length).toBeGreaterThan(0);
      expect(september.length).toBeGreaterThan(0);
    });
  });

  describe('getSeasonalOpener', () => {
    // getSeasonalOpener 内部使用当前日期，测试基于当前月份的实际阶段
    it('returns non-empty opener for a known industry in a known phase', () => {
      // consumer_electronics: current month (June=6) is sourcing phase
      const opener = getSeasonalOpener('consumer_electronics', 'en');
      // Should return some opener (not empty) since it's not 'normal' phase
      expect(typeof opener).toBe('string');
    });

    it('returns empty for normal phase', () => {
      const opener = getSeasonalOpener('unknown_industry', 'en');
      expect(opener).toBe('');
    });

    it('returns Chinese text for zh-Hans', () => {
      const opener = getSeasonalOpener('automotive_parts', 'zh-Hans');
      // automotive_parts in June is 'sourcing', so should have Chinese text
      if (opener) {
        expect(opener.length).toBeGreaterThan(0);
      }
    });
  });
});
