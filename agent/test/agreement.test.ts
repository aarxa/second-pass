import { describe, expect, it } from 'vitest';
import { agreement } from '../src/bench.ts';

describe('judge vs. human agreement', () => {
  it('is perfect when the scores match', () => {
    const a = agreement([2, 4, 6, 8, 9].map((s) => ({ judge: s, human: s })));
    expect(a.spearman).toBeCloseTo(1);
    expect(a.meanAbsDiff).toBe(0);
    expect(a.passAgreement).toBe(1);
    expect(a.kappa).toBeCloseTo(1);
  });

  it('only cares about ranking for Spearman, not the exact numbers', () => {
    const a = agreement([[1, 3], [2, 5], [3, 6], [4, 8], [5, 10]].map(([judge, human]) => ({ judge, human })));
    expect(a.spearman).toBeCloseTo(1);
    expect(a.meanAbsDiff).toBeCloseTo(3.4);
  });

  it('is negative when the judge ranks things backwards', () => {
    const a = agreement([[1, 9], [3, 7], [5, 5], [7, 3], [9, 1]].map(([judge, human]) => ({ judge, human })));
    expect(a.spearman).toBeCloseTo(-1);
  });

  it('gives tied scores the same rank', () => {
    const a = agreement([[5, 5], [5, 5], [5, 5], [8, 8], [2, 2]].map(([judge, human]) => ({ judge, human })));
    expect(a.spearman).toBeCloseTo(1);
  });
});
