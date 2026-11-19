// The shader agent: write -> compile -> (fix) -> render -> judge -> revise, until the judge passes it
// or a limit is hit. The loop is plain code, not a model deciding what to do next: every run takes
// the same steps, which keeps runs comparable and lets the benchmark switch steps off (the modes).
import type { Image, Model, Usage, Verdict, WriterTurn } from './model.ts';
import type { FrameStats, Renderer } from './render.ts';
import { taskText } from './prompts.ts';

export interface Task {
  id: string;
  prompt?: string;
  sketch?: Image;
}

/**
 * oneshot: write once, no feedback (the baseline).
 * compile: feed compiler errors back until it compiles.
 * full:    compile fixing, plus rendering and the vision judge's critique.
 */
export type Mode = 'oneshot' | 'compile' | 'full';

export interface AgentOptions {
  mode?: Mode;
  maxCompileFixes?: number; // per draft
  maxRounds?: number; // judged rounds in full mode
  passScore?: number;
  budgetUsd?: number; // stop before spending more than this on one task
}

export type Step =
  | { type: 'draft'; round: number; plan: string; code: string; usage: Usage }
  | { type: 'compile'; round: number; ok: boolean; errors: string[] }
  | { type: 'render'; round: number; stats: FrameStats; ms: number }
  | { type: 'judge'; round: number; verdict: Verdict; usage: Usage }
  | { type: 'stop'; reason: StopReason };

export type StopReason = 'passed' | 'oneshot' | 'compiled' | 'out_of_rounds' | 'compile_failed' | 'over_budget' | 'error';

export interface Trace {
  taskId: string;
  request: string; // what the writer was asked, in words
  mode: Mode;
  code: string | null; // the best shader found (highest judge score, or the last one that compiled)
  compiled: boolean;
  bestScore: number | null; // only in full mode; the benchmark scores every mode separately
  rounds: number;
  compileFixes: number;
  stop: StopReason;
  error?: string;
  steps: Step[];
  usage: Usage;
  ms: number;
}

export interface Deps {
  model: Model;
  renderer: Renderer;
  onStep?: (s: Step) => void; // for live output (CLI, or a live room)
  /** Called with every draft before it is compiled; awaited, so a live room can type it in first. */
  onDraft?: (code: string, round: number) => Promise<void>;
  /** Called as each draft's plan streams in, before its code is ready (live rooms show it). */
  onPlan?: (planSoFar: string, round: number) => void;
  /** Returns the code if a person edited it since the last draft (live rooms), otherwise null. */
  peekEdits?: () => string | null;
}

export function describeStats(s: FrameStats): string {
  return `average brightness ${s.meanLuma.toFixed(2)}, contrast ${s.spread.toFixed(3)} (near 0 = one flat colour), ` +
    `change between frames ${s.motion.toFixed(3)} (near 0 = not moving)`;
}

const png = (data: string): Image => ({ mediaType: 'image/png', data });

export async function runAgent(task: Task, o: AgentOptions, deps: Deps): Promise<Trace> {
  const mode = o.mode ?? 'full';
  const maxCompileFixes = mode === 'oneshot' ? 0 : (o.maxCompileFixes ?? 3);
  const maxRounds = mode === 'full' ? (o.maxRounds ?? 4) : 1;
  const passScore = o.passScore ?? 7;
  const budget = o.budgetUsd ?? 1;
  const started = Date.now();

  const request = taskText(task.prompt, !!task.sketch);
  const history: WriterTurn[] = [{ role: 'task', text: request, sketch: task.sketch }];
  const steps: Step[] = [];
  const total: Usage = { inputTokens: 0, outputTokens: 0, costUsd: 0 };
  const log = (s: Step) => { steps.push(s); deps.onStep?.(s); };
  const spend = (u: Usage) => { total.inputTokens += u.inputTokens; total.outputTokens += u.outputTokens; total.costUsd += u.costUsd; };

  // Every piece of feedback goes through here, so hand edits made in a live room are never lost:
  // the writer gets the person's version and is told to build on it.
  const feedback = (turn: Extract<WriterTurn, { role: 'feedback' }>) => {
    const edited = deps.peekEdits?.();
    if (edited) {
      turn = { ...turn, text: `${turn.text}\n\nSomeone in the room edited the shader by hand since your last version. ` +
        `Their version is below. Build on it and keep their changes unless they break the request.\n${edited}` };
    }
    history.push(turn);
  };

  let best: { code: string; score: number } | null = null;
  let lastCompiled: string | null = null;
  let compileFixes = 0;
  let round = 0;

  const finish = (stop: StopReason, error?: string): Trace => {
    log({ type: 'stop', reason: stop });
    const code = best?.code ?? lastCompiled;
    return {
      taskId: task.id, request, mode, code, compiled: code !== null, bestScore: best?.score ?? null,
      rounds: round, compileFixes, stop, error, steps, usage: total, ms: Date.now() - started,
    };
  };

  try {
    for (round = 1; round <= maxRounds; round++) {
      // 1. Write (or rewrite) the shader, then get it compiling.
      let { draft, usage } = await deps.model.write(history, { onPlan: deps.onPlan && ((p) => deps.onPlan!(p, round)) });
      spend(usage);
      history.push({ role: 'draft', draft });
      log({ type: 'draft', round, plan: draft.plan, code: draft.code, usage });
      await deps.onDraft?.(draft.code, round);

      let errors = await deps.renderer.compile(draft.code);
      log({ type: 'compile', round, ok: errors.length === 0, errors: errors.map((e) => `line ${e.line}: ${e.message}`) });
      for (let fix = 0; errors.length && fix < maxCompileFixes; fix++) {
        if (total.costUsd >= budget) return finish('over_budget');
        feedback({ role: 'feedback', text: compilerFeedback(draft.code, errors) });
        ({ draft, usage } = await deps.model.write(history, { onPlan: deps.onPlan && ((p) => deps.onPlan!(p, round)) }));
        spend(usage);
        compileFixes++;
        history.push({ role: 'draft', draft });
        log({ type: 'draft', round, plan: draft.plan, code: draft.code, usage });
        await deps.onDraft?.(draft.code, round);
        errors = await deps.renderer.compile(draft.code);
        log({ type: 'compile', round, ok: errors.length === 0, errors: errors.map((e) => `line ${e.line}: ${e.message}`) });
      }
      if (errors.length) return finish(mode === 'oneshot' ? 'oneshot' : 'compile_failed');
      lastCompiled = draft.code;
      if (mode === 'oneshot') return finish('oneshot');
      if (mode === 'compile') return finish('compiled');

      // 2. Look at it: render frames over time, then ask the judge.
      const shot = await deps.renderer.render(draft.code);
      if (!shot.ok) {
        // Compiled but failed to draw (usually a hang). Treat it like a compile error next round.
        feedback({ role: 'feedback', text: `It compiled but did not render: ${shot.errors.map((e) => e.message).join('; ')}. Make it cheaper.` });
        continue;
      }
      log({ type: 'render', round, stats: shot.stats, ms: shot.ms });
      if (total.costUsd >= budget) return finish('over_budget');

      const frames = shot.frames.map((f) => ({ t: f.t, image: png(f.png) }));
      const judged = await deps.model.judge({ request, sketch: task.sketch, frames, stats: describeStats(shot.stats) });
      spend(judged.usage);
      log({ type: 'judge', round, verdict: judged.verdict, usage: judged.usage });
      const score = judged.verdict.score;
      if (!best || score > best.score) best = { code: draft.code, score };
      if (score >= passScore) return finish('passed');

      // 3. Not there yet: show the writer what it made and what to change.
      if (round < maxRounds) {
        feedback({
          role: 'feedback',
          frames: frames.map((f) => f.image),
          text: `These are frames of your shader at iTime ${frames.map((f) => f.t).join(', ')}s. ` +
            `A reviewer scored it ${score}/10 (pass is ${passScore}).\nReview: ${judged.verdict.critique}\n` +
            `Fixes to make:\n${judged.verdict.fixes.map((f) => `- ${f}`).join('\n')}\n` +
            `Measurements: ${describeStats(shot.stats)}.\nRevise the shader.`,
        });
      }
    }
    round = maxRounds;
    return finish('out_of_rounds');
  } catch (e) {
    return finish('error', e instanceof Error ? e.message : String(e));
  }
}

/** Compiler errors with the offending lines quoted, so the model doesn't have to count lines. */
export function compilerFeedback(code: string, errors: { line: number; message: string }[]): string {
  const lines = code.split('\n');
  const shown = errors.slice(0, 8).map((e) => `line ${e.line}: ${e.message}\n    > ${(lines[e.line - 1] ?? '').trim()}`);
  return `It does not compile. Errors:\n${shown.join('\n')}\nFix these and return the whole shader.`;
}
