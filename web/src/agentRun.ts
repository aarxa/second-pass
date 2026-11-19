// The saved-run format the replay page plays back. agent/src/export.ts writes these files into
// web/public/agent-runs/ (index.json lists them; <id>.json holds one run; <id>.png is its picture).
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
  thumb: string; // file name next to the run, e.g. "lava-lamp.png"
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
}
