// The agent loop against a scripted fake model and the real headless renderer: no API key needed,
// and every branch of the loop (compile fixes, judge rounds, budget, errors) is exercised.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Renderer } from '../src/render.ts';
import { runAgent, compilerFeedback } from '../src/agent.ts';
import type { Draft, Model, Verdict, WriterTurn } from '../src/model.ts';

let renderer: Renderer;
beforeAll(async () => { renderer = await Renderer.open(); }, 30_000);
afterAll(async () => { await renderer?.close(); });

const BROKEN = 'void mainImage(out vec4 c, in vec2 p) { c = vec4(oops); }';
const FLAT = 'void mainImage(out vec4 c, in vec2 p) { c = vec4(0.1, 0.1, 0.1, 1.0); }';
const GOOD = 'void mainImage(out vec4 c, in vec2 p) { vec2 uv = p / iResolution.xy; c = vec4(uv, 0.5 + 0.5 * sin(iTime), 1.0); }';

/** Replays the given drafts and verdicts in order, and records what the agent sent. */
function fake(drafts: string[], verdicts: number[] = [], cost = 0.01) {
  const seen: WriterTurn[][] = [];
  let d = 0, v = 0;
  const model: Model = {
    async write(history) {
      seen.push([...history]);
      const draft: Draft = { plan: 'plan', code: drafts[Math.min(d++, drafts.length - 1)] };
      return { draft, usage: { inputTokens: 100, outputTokens: 50, costUsd: cost } };
    },
    async judge() {
      const verdict: Verdict = { score: verdicts[Math.min(v++, verdicts.length - 1)], critique: 'c', fixes: ['f'] };
      return { verdict, usage: { inputTokens: 100, outputTokens: 20, costUsd: cost } };
    },
  };
  return { model, seen };
}

describe('agent loop', () => {
  it('oneshot: takes the first draft, even when it does not compile', async () => {
    const { model } = fake([BROKEN]);
    const t = await runAgent({ id: 'x', prompt: 'p' }, { mode: 'oneshot' }, { model, renderer });
    expect(t.stop).toBe('oneshot');
    expect(t.compiled).toBe(false);
  }, 30_000);

  it('compile: feeds the errors back with the bad line quoted, then stops once it compiles', async () => {
    const { model, seen } = fake([BROKEN, GOOD]);
    const t = await runAgent({ id: 'x', prompt: 'p' }, { mode: 'compile' }, { model, renderer });
    expect(t.stop).toBe('compiled');
    expect(t.compileFixes).toBe(1);
    const feedback = seen[1].at(-1)!;
    expect(feedback.role === 'feedback' && feedback.text).toMatch(/oops[\s\S]*> void mainImage/);
  }, 30_000);

  it('full: revises after a low score and keeps the best version', async () => {
    const { model, seen } = fake([FLAT, GOOD], [3, 8]);
    const t = await runAgent({ id: 'x', prompt: 'p' }, { mode: 'full' }, { model, renderer });
    expect(t.stop).toBe('passed');
    expect(t.rounds).toBe(2);
    expect(t.bestScore).toBe(8);
    expect(t.code).toBe(GOOD);
    const feedback = seen[1].at(-1)!;
    expect(feedback.role === 'feedback' && feedback.frames?.length).toBe(4); // it saw its own frames
  }, 60_000);

  it('full: returns the best draft when it runs out of rounds, even if a later one is worse', async () => {
    const { model } = fake([GOOD, FLAT, FLAT], [6, 2, 2]);
    const t = await runAgent({ id: 'x', prompt: 'p' }, { mode: 'full', maxRounds: 3 }, { model, renderer });
    expect(t.stop).toBe('out_of_rounds');
    expect(t.code).toBe(GOOD);
    expect(t.bestScore).toBe(6);
  }, 60_000);

  it('stops at the budget', async () => {
    const { model } = fake([BROKEN], [], 0.6);
    const t = await runAgent({ id: 'x', prompt: 'p' }, { mode: 'full', budgetUsd: 1 }, { model, renderer });
    expect(t.stop).toBe('over_budget');
    expect(t.usage.costUsd).toBeCloseTo(1.2);
  }, 30_000);

  it('turns a model error into a finished trace instead of crashing the benchmark', async () => {
    const model: Model = { async write() { throw new Error('rate limited'); }, async judge() { throw new Error('unused'); } };
    const t = await runAgent({ id: 'x', prompt: 'p' }, {}, { model, renderer });
    expect(t.stop).toBe('error');
    expect(t.error).toBe('rate limited');
  });
});

describe('compilerFeedback', () => {
  it('quotes at most eight errors', () => {
    const errs = Array.from({ length: 12 }, (_, i) => ({ line: 1, message: `e${i}` }));
    expect(compilerFeedback('x', errs).match(/line 1:/g)).toHaveLength(8);
  });
});
