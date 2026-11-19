// Publishes a saved run to the replay page: copies the useful parts of its trace, plus a picture,
// into web/public/agent-runs/, and adds it to the list there. Commit those files to share the run.
//
//   npm run export-run -- out/2026-11-19T02-30-37 --id lava-lamp --title "Lava lamp"
//   add --gallery <shader id> to link the replay to an editable copy in the gallery
//   npm run export-run -- bench/runs/<run>/t11-lava-lamp/full --id lava-lamp-bench --title "Lava lamp (benchmark)"
//
// Older traces don't record the request or the models; pass them with --request, --writer, --judge.
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Renderer } from './render.ts';
import type { Step, Trace } from './agent.ts';
import type { ReelPass, Run, RunStep, RunSummary } from '../../web/src/agentRun.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, '..', '..', 'web', 'public', 'agent-runs');
const PASS = 7;
const REEL_TIMES = [0, 2, 5, 8];

function toRunStep(s: Step): RunStep {
  switch (s.type) {
    case 'draft': return { type: 'draft', round: s.round, plan: s.plan, code: s.code, costUsd: s.usage.costUsd };
    case 'compile': return { type: 'compile', round: s.round, ok: s.ok, errors: s.errors };
    case 'render': return { type: 'render', round: s.round, contrast: s.stats.spread, motion: s.stats.motion };
    case 'judge': return { type: 'judge', round: s.round, score: s.verdict.score, critique: s.verdict.critique, fixes: s.verdict.fixes, costUsd: s.usage.costUsd };
    case 'stop': return { type: 'stop', reason: s.reason };
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const take = (flag: string) => { const i = argv.indexOf(flag); if (i < 0) return undefined; const v = argv[i + 1]; argv.splice(i, 2); return v; };
  const id = take('--id');
  const title = take('--title');
  const requestFlag = take('--request');
  const writer = take('--writer');
  const judge = take('--judge');
  const gallery = take('--gallery'); // id of the shader's copy in the gallery, linked from the replay
  const src = argv[0];
  if (!src || !id || !title) throw new Error('usage: export-run <run folder or trace.json> --id <slug> --title "<title>"');
  if (!/^[a-z0-9-]+$/.test(id)) throw new Error('--id must be lowercase letters, digits and dashes');

  const tracePath = src.endsWith('.json') ? src : path.join(src, 'trace.json');
  const trace = JSON.parse(await readFile(tracePath, 'utf8')) as Trace & { models?: { writer: string; judge: string } | 'fake' };
  if (trace.models === 'fake') throw new Error('that run used the fake model (--dry); only publish real runs');
  if (!trace.code) throw new Error('that run produced no working shader');
  const request = requestFlag ?? trace.request;
  if (!request) throw new Error('this trace does not record its request; pass --request "..."');
  const models = { writer: writer ?? trace.models?.writer ?? 'claude-opus-5-5', judge: judge ?? trace.models?.judge ?? 'claude-opus-5-5' };

  // Pictures, rendered the same way the agent saw its work: the list picture (the final shader at
  // 2 s) and, for the reel, every judged pass at a few moments in time.
  await mkdir(OUT, { recursive: true });
  const renderer = await Renderer.open();
  let picture: string;
  const reel: ReelPass[] = [];
  try {
    const shot = await renderer.render(trace.code, { width: 640, height: 360, times: [2], format: 'jpeg' });
    if (!shot.ok) throw new Error(`the final shader no longer renders: ${shot.errors.map((e) => e.message).join('; ')}`);
    picture = shot.frames[0].png;
    for (const [i, step] of trace.steps.entries()) {
      if (step.type !== 'judge') continue;
      // The shader that was judged: the last draft of that round before the verdict.
      const judged = trace.steps.slice(0, i).reverse().find((s) => s.type === 'draft' && s.round === step.round);
      if (!judged || judged.type !== 'draft') continue;
      const frames = await renderer.render(judged.code, { width: 320, height: 180, times: REEL_TIMES, format: 'jpeg' });
      if (!frames.ok) continue;
      const pass: ReelPass = { round: step.round, frames: [] };
      for (const f of frames.frames) {
        const src = `${id}-p${step.round}-${f.t}.jpg`;
        await writeFile(path.join(OUT, src), Buffer.from(f.png, 'base64'));
        pass.frames.push({ t: f.t, src });
      }
      reel.push(pass);
    }
  } finally {
    await renderer.close();
  }

  const scores = trace.steps.flatMap((s) => (s.type === 'judge' ? [s.verdict.score] : []));
  const summary: RunSummary = {
    id, title, request, models,
    date: (await stat(tracePath)).mtime.toISOString(),
    rounds: trace.rounds, scores, passed: trace.stop === 'passed',
    costUsd: Math.round(trace.usage.costUsd * 1000) / 1000,
    seconds: Math.round(trace.ms / 1000),
    thumb: `${id}.jpg`,
    finalFrames: reel.at(-1)?.frames.map((f) => f.src) ?? [],
  };
  const indexPath = path.join(OUT, 'index.json');
  const index: RunSummary[] = existsSync(indexPath) ? JSON.parse(await readFile(indexPath, 'utf8')) : [];
  const galleryId = gallery ?? index.find((r) => r.id === id)?.galleryId; // keep a link made earlier
  if (galleryId) summary.galleryId = galleryId;
  const run: Run = { ...summary, passScore: PASS, steps: trace.steps.map(toRunStep), reel };

  await writeFile(path.join(OUT, `${id}.json`), JSON.stringify(run));
  await writeFile(path.join(OUT, `${id}.jpg`), Buffer.from(picture, 'base64'));
  const next = [summary, ...index.filter((r) => r.id !== id)].sort((a, b) => b.date.localeCompare(a.date));
  await writeFile(indexPath, JSON.stringify(next, null, 2) + '\n');
  console.log(`Published "${title}" (${scores.join(' → ')}, $${summary.costUsd}) to web/public/agent-runs/${id}.json`);
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
