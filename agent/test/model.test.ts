import { describe, expect, it } from 'vitest';
import { isTransient, partialPlan } from '../src/model.ts';
import { planComment } from '../src/room.ts';

describe('partialPlan', () => {
  it('reads the plan out of JSON that is still streaming', () => {
    expect(partialPlan('{"plan": "A pond at ni')).toBe('A pond at ni');
    expect(partialPlan('{"plan":"Line one.\\nLine "two"')).toBe('Line one.\nLine ');
    expect(partialPlan('{"plan": "done", "code": "void')).toBe('done');
  });
  it('waits until the plan has started, and survives an escape cut in half', () => {
    expect(partialPlan('{"pl')).toBeNull();
    expect(partialPlan('{"plan": "caf\\u00')).toBe('caf');
  });
});

describe('planComment', () => {
  it('wraps the plan into // lines no wider than the limit', () => {
    const c = planComment('word '.repeat(60).trim(), 40);
    for (const line of c.trimEnd().split('\n')) {
      expect(line.startsWith('//')).toBe(true);
      expect(line.length).toBeLessThanOrEqual(40);
    }
  });
});

describe('isTransient', () => {
  it('retries a stream cut off partway and a dropped connection, not a refusal', () => {
    expect(isTransient(new Error('terminated'))).toBe(true);
    expect(isTransient(new Error('read ECONNRESET'))).toBe(true);
    expect(isTransient(new Error('the model declined (cyber)'))).toBe(false);
    expect(isTransient(new Error('the reply hit max_tokens before finishing'))).toBe(false);
  });
});
