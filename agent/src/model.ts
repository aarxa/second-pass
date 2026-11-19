// The two model calls the agent makes, behind one small interface so tests (and the benchmark's
// dry runs) can swap in a scripted fake without touching the agent loop.
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { JUDGE_SYSTEM, WRITER_SYSTEM } from './prompts.ts';

export interface Image { mediaType: 'image/png' | 'image/jpeg'; data: string } // base64

export interface Usage { inputTokens: number; outputTokens: number; costUsd: number }

export interface Draft { plan: string; code: string }
export interface Verdict { score: number; critique: string; fixes: string[] }

/** One turn of the writer's conversation, in the agent's own words (not the SDK's message type). */
export type WriterTurn =
  | { role: 'task'; text: string; sketch?: Image }
  | { role: 'draft'; draft: Draft }
  | { role: 'feedback'; text: string; frames?: Image[] };

export interface WriteHooks {
  /** Called as the plan streams in (the whole plan so far), before the code is ready. */
  onPlan?: (planSoFar: string) => void;
}

export interface Model {
  write(history: WriterTurn[], hooks?: WriteHooks): Promise<{ draft: Draft; usage: Usage }>;
  judge(input: { request: string; sketch?: Image; frames: { t: number; image: Image }[]; stats: string }): Promise<{ verdict: Verdict; usage: Usage }>;
}

const DraftSchema = z.object({ plan: z.string(), code: z.string() });
const VerdictSchema = z.object({ score: z.number().min(0).max(10), critique: z.string(), fixes: z.array(z.string()) });

// JSON Schemas for structured outputs: the API guarantees the reply parses into these.
const DRAFT_FORMAT = {
  type: 'json_schema' as const,
  schema: {
    type: 'object',
    properties: { plan: { type: 'string' }, code: { type: 'string', description: 'Only GLSL: helpers plus mainImage. No markdown fences.' } },
    required: ['plan', 'code'],
    additionalProperties: false,
  },
};
const VERDICT_FORMAT = {
  type: 'json_schema' as const,
  schema: {
    type: 'object',
    properties: {
      score: { type: 'number', description: '0 to 10, per the rubric' },
      critique: { type: 'string' },
      fixes: { type: 'array', items: { type: 'string' } },
    },
    required: ['score', 'critique', 'fixes'],
    additionalProperties: false,
  },
};

// USD per million tokens (input, output). Cache reads/writes are ignored here: the agent's prompts
// are short and change every round, so caching barely applies.
const PRICES: Record<string, [number, number]> = {
  'claude-opus-5-5': [4, 20],
  'claude-sonnet-5-5': [2, 10],
  'claude-haiku-5-5': [0.1, 0.5],
};

export interface ClaudeOptions {
  writerModel?: string;
  judgeModel?: string;
  writerEffort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  judgeEffort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
}

export class ClaudeModel implements Model {
  private client = new Anthropic(); // reads ANTHROPIC_API_KEY (or an `ant auth login` profile)
  private o: Required<ClaudeOptions>;

  constructor(o: ClaudeOptions = {}) {
    this.o = {
      writerModel: o.writerModel ?? process.env.AGENT_WRITER_MODEL ?? 'claude-opus-5-5',
      judgeModel: o.judgeModel ?? process.env.AGENT_JUDGE_MODEL ?? 'claude-opus-5-5',
      writerEffort: o.writerEffort ?? 'high',
      judgeEffort: o.judgeEffort ?? 'medium',
    };
  }

  get models() { return { writer: this.o.writerModel, judge: this.o.judgeModel }; }

  async write(history: WriterTurn[], hooks: WriteHooks = {}) {
    const messages: Anthropic.Beta.BetaMessageParam[] = [];
    for (const turn of history) {
      if (turn.role === 'draft') {
        messages.push({ role: 'assistant', content: JSON.stringify(turn.draft) });
        continue;
      }
      const content: Anthropic.Beta.BetaContentBlockParam[] = [];
      const images = turn.role === 'task' ? (turn.sketch ? [turn.sketch] : []) : (turn.frames ?? []);
      for (const im of images) content.push({ type: 'image', source: { type: 'base64', media_type: im.mediaType, data: im.data } });
      content.push({ type: 'text', text: turn.text });
      messages.push({ role: 'user', content });
    }
    const onText = hooks.onPlan ? (snapshot: string) => { const p = partialPlan(snapshot); if (p) hooks.onPlan!(p); } : undefined;
    const msg = await this.call(this.o.writerModel, this.o.writerEffort, WRITER_SYSTEM, messages, DRAFT_FORMAT, onText);
    return { draft: DraftSchema.parse(parseJson(msg)), usage: usage(this.o.writerModel, msg) };
  }

  async judge(input: Parameters<Model['judge']>[0]) {
    const content: Anthropic.Beta.BetaContentBlockParam[] = [];
    if (input.sketch) {
      content.push({ type: 'text', text: 'The sketch the shader should recreate:' });
      content.push({ type: 'image', source: { type: 'base64', media_type: input.sketch.mediaType, data: input.sketch.data } });
    }
    content.push({ type: 'text', text: `Request: ${input.request}\n\nPixel measurements: ${input.stats}` });
    for (const f of input.frames) {
      content.push({ type: 'text', text: `Frame at iTime = ${f.t}s:` });
      content.push({ type: 'image', source: { type: 'base64', media_type: f.image.mediaType, data: f.image.data } });
    }
    const msg = await this.call(this.o.judgeModel, this.o.judgeEffort, JUDGE_SYSTEM, [{ role: 'user', content }], VERDICT_FORMAT);
    return { verdict: VerdictSchema.parse(parseJson(msg)), usage: usage(this.o.judgeModel, msg) };
  }

  private async call(model: string, effort: ClaudeOptions['writerEffort'], system: string, messages: Anthropic.Beta.BetaMessageParam[], format: { type: 'json_schema'; schema: Record<string, unknown> }, onText?: (snapshot: string) => void) {
    // Streamed so long shaders never hit an HTTP timeout. Server-side fallbacks re-run a request on
    // another model if a safety classifier declines it (rare for shader code, but it fails softly).
    const stream = this.client.beta.messages.stream({
      model,
      max_tokens: 32000,
      system,
      messages,
      thinking: { type: 'adaptive' },
      output_config: { effort, format },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
    });
    if (onText) stream.on('text', (_delta, snapshot) => onText(snapshot));
    const msg = await stream.finalMessage();
    if (msg.stop_reason === 'refusal') throw new Error(`the model declined (${msg.stop_details?.category ?? 'no category'})`);
    if (msg.stop_reason === 'max_tokens') throw new Error('the reply hit max_tokens before finishing');
    return msg;
  }
}

/**
 * The plan so far, from a reply that is still streaming. The reply is JSON ({"plan": "...", ...}),
 * so mid-stream it is cut off; this reads the plan string up to wherever the stream has got to.
 */
export function partialPlan(snapshot: string): string | null {
  const m = /"plan"\s*:\s*"((?:[^"\\]|\\.)*)/.exec(snapshot);
  if (!m) return null;
  const raw = m[1].replace(/\\u[0-9a-fA-F]{0,3}$/, ''); // drop a \u escape cut off mid-way
  try { return JSON.parse(`"${raw}"`) as string; } catch { return null; }
}

function parseJson(msg: Anthropic.Beta.BetaMessage): unknown {
  const text = msg.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
  return JSON.parse(text);
}

function usage(model: string, msg: Anthropic.Beta.BetaMessage): Usage {
  const [pin, pout] = PRICES[model] ?? [0, 0];
  const inputTokens = msg.usage.input_tokens + (msg.usage.cache_read_input_tokens ?? 0) + (msg.usage.cache_creation_input_tokens ?? 0);
  const outputTokens = msg.usage.output_tokens;
  return { inputTokens, outputTokens, costUsd: (inputTokens * pin + outputTokens * pout) / 1e6 };
}
