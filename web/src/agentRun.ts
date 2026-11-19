// The saved-run format the replay page plays back. agent/src/export.ts writes these files into
// web/public/agent-runs/ (index.json lists them; <id>.json holds one run; <id>.jpg is its picture, and
// <id>-p<pass>-<seconds>.jpg are the frames of each judged pass, shown as the film reel).
// They are static files on purpose: replays cost nothing to serve and never need an API key.

export interface RunSummary {
  id: string;
  title: string;
  request: string;
  models: { writer: string; judge: string };
  date: string; // ISO
  rounds: number;
  scores: number[]; // the judge's score each round
  passed: boolean;
  costUsd: number;
  seconds: number;
  thumb: string; // file name next to the run, e.g. "lava-lamp.jpg"
  finalFrames: string[]; // the last judged pass's frames, for the mini reel on the list
  galleryId?: string; // the editable copy of its shader in the gallery, if there is one
  sketch?: string; // file name of the sketch the agent was given, if the brief included one
}

/** The brief in the user's words: the prefix the agent adds ("Make a shader…") removed. */
export function briefText(request: string): string {
  return request.replace(/^Make a shader of the attached sketch\. Notes: /, '').replace(/^Make a shader: /, '');
}

/** One judged pass on the reel: the shader that was judged, rendered at a few moments. */
export interface ReelPass {
  round: number;
  frames: { t: number; src: string }[];
}

export type RunStep =
  | { type: 'draft'; round: number; plan: string; code: string; costUsd: number }
  | { type: 'compile'; round: number; ok: boolean; errors: string[] }
  | { type: 'render'; round: number; contrast: number; motion: number }
  | { type: 'judge'; round: number; score: number; critique: string; fixes: string[]; costUsd: number }
  | { type: 'stop'; reason: string };

export interface Run extends RunSummary {
  passScore: number;
  steps: RunStep[];
  reel: ReelPass[];
}

/** The shader a run kept: the code of its best-scoring judged pass (the agent keeps the best). */
export function keptCode(run: Run): string | null {
  let draft: string | null = null;
  let best: { score: number; code: string } | null = null;
  for (const s of run.steps) {
    if (s.type === 'draft') draft = s.code;
    if (s.type === 'judge' && draft !== null && (!best || s.score > best.score)) best = { score: s.score, code: draft };
  }
  return best?.code ?? draft;
}
