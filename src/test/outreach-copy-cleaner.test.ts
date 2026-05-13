import { describe, it, expect } from 'vitest';
import { cleanOutreachSubject, cleanOutreachBody } from '../lib/email/outreach-copy-cleaner';

const SIGNATURE = 'Best regards,\nTD Painting Engineering Team\nengineering@tdpaint.com';

describe('outreach-copy-cleaner', () => {
  describe('cleanOutreachSubject', () => {
    it('should remove evidence labels from subject', () => {
      expect(cleanOutreachSubject('Partnering with Acme[D1] for Growth')).toBe(
        'Partnering with Acme for Growth'
      );
    });

    it('should handle multiple evidence labels', () => {
      expect(cleanOutreachSubject('Hello [E1] World [D3]')).toBe('Hello World');
    });

    it('should remove {{SENDER_SIGNATURE}} from subject', () => {
      expect(cleanOutreachSubject('Hi {{SENDER_SIGNATURE}}')).toBe('Hi');
    });

    it('should remove legacy signature placeholders from subject', () => {
      expect(cleanOutreachSubject('Intro from [Your Name] [Your Position]')).toBe('Intro from');
      expect(cleanOutreachSubject('[Your Contact Information] Partnership')).toBe('Partnership');
    });

    it('should fix punctuation spacing after label removal', () => {
      expect(cleanOutreachSubject('Coating[D1].Premium quality')).toBe(
        'Coating. Premium quality'
      );
    });

    it('should return clean subjects unchanged', () => {
      expect(cleanOutreachSubject('Exploring Partnership Opportunities')).toBe(
        'Exploring Partnership Opportunities'
      );
    });
  });

  describe('cleanOutreachBody', () => {
    it('should replace full 3-line signature block', () => {
      const body = `Hi John,

I wanted to reach out regarding a partnership.

Best regards,
[Your Name]
[Your Position]
[Your Contact Information]`;

      const result = cleanOutreachBody(body, SIGNATURE);
      expect(result).toContain('Best regards,\nTD Painting Engineering Team\nengineering@tdpaint.com');
      expect(result).not.toContain('[Your Name]');
      expect(result).not.toContain('[Your Position]');
      expect(result).not.toContain('[Your Contact Information]');
    });

    it('should handle signature block without "Best regards" prefix', () => {
      const body = `Hi John,

Looking forward to hearing from you.

[Your Name]
[Your Position]
[Your Contact Information]`;

      const result = cleanOutreachBody(body, SIGNATURE);
      expect(result).toContain('TD Painting Engineering Team');
      expect(result).not.toContain('[Your Name]');
    });

    it('should fallback to single token replacement when block is partial', () => {
      const body = `Hi John,

Please reach out to [Your Name] for details.
Contact: [Your Contact Information]`;

      const result = cleanOutreachBody(body, SIGNATURE);
      expect(result).toContain('TD Painting Engineering Team');
      expect(result).toContain('engineering@tdpaint.com');
      expect(result).not.toContain('[Your Name]');
      expect(result).not.toContain('[Your Contact Information]');
    });

    it('should remove [Your Position] with surrounding whitespace', () => {
      const body = `Best regards,
[Your Name]
[Your Position]`;

      // This matches the full block pattern
      const result = cleanOutreachBody(body, SIGNATURE);
      expect(result).not.toContain('[Your Position]');
    });

    it('should replace {{SENDER_SIGNATURE}}', () => {
      const body = `Hi John,

Looking forward to connecting.

{{SENDER_SIGNATURE}}`;

      const result = cleanOutreachBody(body, SIGNATURE);
      expect(result).toContain('TD Painting Engineering Team');
      expect(result).toContain('engineering@tdpaint.com');
      expect(result).not.toContain('{{SENDER_SIGNATURE}}');
    });

    it('should remove evidence labels [D1], [E1], [C1] etc', () => {
      const body = 'Your company[D1] has shown growth[E3] in the coating[C1] sector.';
      const result = cleanOutreachBody(body, SIGNATURE);
      expect(result).toBe('Your company has shown growth in the coating sector.');
    });

    it('should handle [E10] and other multi-digit labels', () => {
      const body = 'Based on our research[E10], your operations[D7] are expanding.';
      const result = cleanOutreachBody(body, SIGNATURE);
      expect(result).toBe('Based on our research, your operations are expanding.');
    });

    it('should fix punctuation spacing after label removal', () => {
      const body = 'Based in City[D1].Your company is growing.';
      const result = cleanOutreachBody(body, SIGNATURE);
      expect(result).toBe('Based in City. Your company is growing.');
    });

    it('should fix comma spacing after label removal', () => {
      const body = 'In Shanghai[D2],Acme Corp leads.';
      const result = cleanOutreachBody(body, SIGNATURE);
      expect(result).toBe('In Shanghai, Acme Corp leads.');
    });

    it('should handle body with no placeholders', () => {
      const body = 'Hi John,\n\nJust a clean email.\n\nBest regards,\nTeam';
      const result = cleanOutreachBody(body, SIGNATURE);
      expect(result).toBe(body);
    });

    it('should collapse excessive blank lines', () => {
      const body = 'Line 1\n\n\n\n\nLine 2';
      const result = cleanOutreachBody(body, SIGNATURE);
      expect(result).toBe('Line 1\n\nLine 2');
    });
  });
});
