import { describe, it, expect } from 'vitest';
import { evaluateCondition } from './condition-dsl.js';

describe('evaluateCondition', () => {
  const outputs = {
    status: 'approved',
    count: 5,
    active: true,
    nested: { value: 42 },
    score: 3.5,
  };

  describe('== operator', () => {
    it('matches string equality', () => {
      expect(evaluateCondition('status == "approved"', outputs)).toBe(true);
    });
    it('fails string inequality', () => {
      expect(evaluateCondition('status == "rejected"', outputs)).toBe(false);
    });
    it('matches number equality', () => {
      expect(evaluateCondition('count == 5', outputs)).toBe(true);
    });
    it('matches boolean equality', () => {
      expect(evaluateCondition('active == true', outputs)).toBe(true);
    });
    it('matches null', () => {
      expect(evaluateCondition('missing == null', outputs)).toBe(true);
    });
  });

  describe('!= operator', () => {
    it('passes when values differ', () => {
      expect(evaluateCondition('status != "rejected"', outputs)).toBe(true);
    });
    it('fails when values match', () => {
      expect(evaluateCondition('status != "approved"', outputs)).toBe(false);
    });
  });

  describe('> operator', () => {
    it('passes when left > right', () => {
      expect(evaluateCondition('count > 3', outputs)).toBe(true);
    });
    it('fails when left == right', () => {
      expect(evaluateCondition('count > 5', outputs)).toBe(false);
    });
    it('fails when left < right', () => {
      expect(evaluateCondition('count > 10', outputs)).toBe(false);
    });
  });

  describe('< operator', () => {
    it('passes when left < right', () => {
      expect(evaluateCondition('count < 10', outputs)).toBe(true);
    });
    it('fails when left == right', () => {
      expect(evaluateCondition('count < 5', outputs)).toBe(false);
    });
  });

  describe('>= operator', () => {
    it('passes when left == right', () => {
      expect(evaluateCondition('count >= 5', outputs)).toBe(true);
    });
    it('passes when left > right', () => {
      expect(evaluateCondition('count >= 3', outputs)).toBe(true);
    });
    it('fails when left < right', () => {
      expect(evaluateCondition('count >= 10', outputs)).toBe(false);
    });
  });

  describe('<= operator', () => {
    it('passes when left == right', () => {
      expect(evaluateCondition('count <= 5', outputs)).toBe(true);
    });
    it('passes when left < right', () => {
      expect(evaluateCondition('count <= 10', outputs)).toBe(true);
    });
    it('fails when left > right', () => {
      expect(evaluateCondition('count <= 3', outputs)).toBe(false);
    });
  });

  describe('AND operator', () => {
    it('passes when both clauses pass', () => {
      expect(evaluateCondition('count > 3 AND status == "approved"', outputs)).toBe(true);
    });
    it('fails when first clause fails', () => {
      expect(evaluateCondition('count > 10 AND status == "approved"', outputs)).toBe(false);
    });
    it('fails when second clause fails', () => {
      expect(evaluateCondition('count > 3 AND status == "rejected"', outputs)).toBe(false);
    });
  });

  describe('OR operator', () => {
    it('passes when first clause passes', () => {
      expect(evaluateCondition('count > 3 OR status == "rejected"', outputs)).toBe(true);
    });
    it('passes when second clause passes', () => {
      expect(evaluateCondition('count > 100 OR status == "approved"', outputs)).toBe(true);
    });
    it('fails when both clauses fail', () => {
      expect(evaluateCondition('count > 100 OR status == "rejected"', outputs)).toBe(false);
    });
  });

  describe('dotted path', () => {
    it('resolves nested property', () => {
      expect(evaluateCondition('nested.value == 42', outputs)).toBe(true);
    });
    it('returns undefined for missing path', () => {
      expect(evaluateCondition('nested.missing == null', outputs)).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('handles empty outputs', () => {
      expect(evaluateCondition('x == null', {})).toBe(true);
    });
    it('handles float comparison', () => {
      expect(evaluateCondition('score > 3.0', outputs)).toBe(true);
    });
    it('handles case-insensitive AND/OR', () => {
      expect(evaluateCondition('count > 3 and status == "approved"', outputs)).toBe(true);
      expect(evaluateCondition('count > 100 or status == "approved"', outputs)).toBe(true);
    });
  });
});
