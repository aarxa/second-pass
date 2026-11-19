// The benchmark: every case in every mode, each final shader scored the same way, plus a page for
// rating the results yourself and a check of how well the judge agrees with you.
//
//   npm run bench -- --dry                          free end-to-end trial with a fake model
//   npm run bench -- --limit 5 --yes                5 cases x 3 modes with the real model (costs money)
//   npm run bench -- --modes full --ids t11-lava-lamp --yes
//   npm run bench -- agree runs/<run> ratings.json  judge vs. your ratings
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Renderer, DEFAULT_TIMES } from './render.ts';
import { runAgent, describeStats, type Mode, type Task, type Trace } from './agent.ts';
import { ClaudeModel, type Image, type Model } from './model.ts';
import { fakeModel } from './fake.ts';
import { PROMPT_VERSION, taskText } from './prompts.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BENCH = path.join(HERE, '..', 'bench');
const PASS = 7;

interface Case extends Task { level: string }

interface Result {
  id: string; level: string; mode: Mode;
  compiled: boolean; score: number; passed: boolean; // the final, mode-independent score
  rounds: number; compileFixes: number; stop: string; costUsd: number; ms: number; error?: string;
}

function args(argv: string[]) {
  const get = (k: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };
  return {
    dry: argv.includes('--dry'),
    yes: argv.includes('--yes'),
    modes: (get('modes') ?? 'oneshot,compile,full').split(',') as Mode[],
    ids: get('ids')?.split(','),
    limit: get('limit') ? Number(get('limit')) : undefined,
    concurrency: Number(get('concurrency') ?? 2),
    budget: Number(get('budget') ?? 1),
  };
}

async function loadCases(): Promise<Case[]> {
  const text: Case[] = JSON.parse(await readFile(path.join(BENCH, 'cases.json'), 'utf8'));
  const dir = path.join(BENCH, 'sketches');
  const sketches: Case[] = [];
  if (existsSync(dir)) {
    for (const f of (await readdir(dir)).sort()) {
      const m = /^(.+)\.(png|jpe?g)$/i.exec(f);
      if (!m) continue;
      const notes = path.join(dir, `${m[1]}.txt`);
      sketches.push({
        id: `s-${m[1]}`, level: 'sketch',
        prompt: existsSync(notes) ? (await readFile(notes, 'utf8')).trim() : undefined,
        sketch: { mediaType: m[2].toLowerCase() === 'png' ? 'image/png' : 'image/jpeg', data: (await readFile(path.join(dir, f))).toString('base64') },
      });
    }
  }
  return [...text, ...sketches];
}

/** Scores a final shader the same way for every mode: a fresh render and a fresh judge call. */
async function score(model: Model, renderer: Renderer, c: Case, code: string | null, outDir: string) {
  if (!code) return { score: 0, costUsd: 0 };
  const shot = await renderer.render(code);
  if (!shot.ok) return { score: 0, costUsd: 0 };
  for (const f of shot.frames) await writeFile(path.join(outDir, `frame-${f.t}.png`), Buffer.from(f.png, 'base64'));
  const { verdict, usage } = await model.judge({
    request: taskText(c.prompt, !!c.sketch), sketch: c.sketch,
    frames: shot.frames.map((f) => ({ t: f.t, image: { mediaType: 'image/png', data: f.png } as Image })),
    stats: describeStats(shot.stats),
  });
  await writeFile(path.join(outDir, 'score.json'), JSON.stringify(verdict, null, 2));
  return { score: verdict.score, costUsd: usage.costUsd };
}

async function pool<T>(items: T[], n: number, fn: (t: T) => Promise<void>) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) await fn(items[i++]); }));
}

async function run() {
  const a = args(process.argv.slice(2));
  let cases = await loadCases();
  if (a.ids) cases = cases.filter((c) => a.ids!.includes(c.id));
  if (a.limit) cases = cases.slice(0, a.limit);
  const jobs = cases.flatMap((c) => a.modes.map((mode) => ({ c, mode })));
  if (!jobs.length) throw new Error('no cases matched');

  const model: Model = a.dry ? fakeModel() : new ClaudeModel();
  if (!a.dry && !a.yes) {
    console.log(`${jobs.length} runs (${cases.length} cases x ${a.modes.join('/')}), each capped at $${a.budget} plus one scoring call.`);
    console.log(`Worst case about $${(jobs.length * (a.budget + 0.1)).toFixed(0)}; typical runs cost far less. Add --yes to start.`);
    return;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const runDir = path.join(BENCH, 'runs', `${stamp}${a.dry ? '-dry' : ''}`);
  await mkdir(runDir, { recursive: true });
  await writeFile(path.join(runDir, 'config.json'), JSON.stringify({
    dry: a.dry, modes: a.modes, cases: cases.map((c) => c.id), budgetUsd: a.budget, passScore: PASS, promptVersion: PROMPT_VERSION,
    models: model instanceof ClaudeModel ? model.models : 'fake',
  }, null, 2));

  const renderer = await Renderer.open();
  const results: Result[] = [];
  try {
    await pool(jobs, a.concurrency, async ({ c, mode }) => {
      const outDir = path.join(runDir, c.id, mode);
      await mkdir(outDir, { recursive: true });
      const trace: Trace = await runAgent(c, { mode, budgetUsd: a.budget, passScore: PASS }, { model, renderer });
      await writeFile(path.join(outDir, 'trace.json'), JSON.stringify(trace, null, 2));
      if (trace.code) await writeFile(path.join(outDir, 'final.glsl'), trace.code);
      const s = await score(model, renderer, c, trace.code, outDir);
      const r: Result = {
        id: c.id, level: c.level, mode, compiled: trace.compiled, score: s.score, passed: s.score >= PASS,
        rounds: trace.rounds, compileFixes: trace.compileFixes, stop: trace.stop,
        costUsd: trace.usage.costUsd + s.costUsd, ms: trace.ms, error: trace.error,
      };
      results.push(r);
      console.log(`${c.id.padEnd(24)} ${mode.padEnd(8)} ${r.compiled ? 'compiles' : 'BROKEN  '} score ${String(r.score).padStart(2)}  ${r.stop.padEnd(13)} $${r.costUsd.toFixed(3)} ${(r.ms / 1000).toFixed(1)}s`);
    });
  } finally {
    await renderer.close();
  }
  results.sort((x, y) => x.id.localeCompare(y.id) || a.modes.indexOf(x.mode) - a.modes.indexOf(y.mode));
  await writeFile(path.join(runDir, 'results.jsonl'), results.map((r) => JSON.stringify(r)).join('\n') + '\n');
  await writeFile(path.join(runDir, 'summary.md'), summary(results, a.modes, a.dry));
  await writeFile(path.join(runDir, 'rate.html'), ratePage(results, cases));
  console.log(`\n${summary(results, a.modes, a.dry)}\nSaved to ${path.relative(process.cwd(), runDir)} (open rate.html to rate the results yourself).`);
}

function summary(results: Result[], modes: Mode[], dry: boolean): string {
  const row = (rs: Result[]) => {
    const n = rs.length || 1;
    const pct = (k: number) => `${Math.round((100 * k) / n)}%`;
    return [
      pct(rs.filter((r) => r.compiled).length), pct(rs.filter((r) => r.passed).length),
      (rs.reduce((s, r) => s + r.score, 0) / n).toFixed(1),
      (rs.reduce((s, r) => s + r.rounds, 0) / n).toFixed(1), (rs.reduce((s, r) => s + r.compileFixes, 0) / n).toFixed(1),
      `$${(rs.reduce((s, r) => s + r.costUsd, 0) / n).toFixed(3)}`, `${(rs.reduce((s, r) => s + r.ms, 0) / n / 1000).toFixed(0)} s`,
    ];
  };
  const lines = [
    dry ? '> **Dry run with a fake model: these numbers mean nothing.**\n' : '',
    `Pass = final score >= ${PASS}/10. Every mode's final shader is scored by the same judge call.\n`,
    '| Mode | Compiles | Passes | Mean score | Rounds | Compile fixes | Cost / task | Time / task |',
    '|---|---:|---:|---:|---:|---:|---:|---:|',
    ...modes.map((m) => `| ${m} | ${row(results.filter((r) => r.mode === m)).join(' | ')} |`),
    '',
    '| Level | ' + modes.join(' passes | ') + ' passes |',
    '|---|' + modes.map(() => '---:').join('|') + '|',
    ...[...new Set(results.map((r) => r.level))].map((lv) => `| ${lv} | ${modes.map((m) => row(results.filter((r) => r.mode === m && r.level === lv))[1]).join(' | ')} |`),
  ];
  return lines.join('\n') + '\n';
}

/** A page for rating results blind: modes hidden, order shuffled, ratings downloaded as JSON. */
function ratePage(results: Result[], cases: Case[]): string {
  const req = new Map(cases.map((c) => [c.id, c.sketch ? `[sketch] ${c.prompt ?? ''}` : c.prompt ?? '']));
  const items = results.filter((r) => r.compiled && r.score >= 0).map((r) => ({ key: `${r.id}/${r.mode}`, request: req.get(r.id), dir: `${r.id}/${r.mode}`, sketch: r.id.startsWith('s-') }));
  return `<!doctype html><meta charset="utf-8"><title>Rate shaders</title>
<style>body{font:15px system-ui;margin:24px;max-width:1100px}img{width:24%;border:1px solid #ccc}.b button{width:44px;height:36px;margin:2px}.b button.on{background:#111;color:#fff}</style>
<h1>Rate the shaders</h1><p>Score each against its request, 0 to 10 (7+ = matches). You don't see which mode made it. Ratings are kept in this browser; press Download when done.</p>
<p><span id="n"></span> <button id="dl">Download ratings.json</button></p><div id="list"></div>
<script>
const items=${JSON.stringify(items)};const times=${JSON.stringify(DEFAULT_TIMES)};
const key='shaderlab-ratings-'+location.pathname;let r={};try{r=JSON.parse(localStorage.getItem(key)||'{}')}catch{}
let seed=42;const rnd=()=>{seed=(seed+0x6d2b79f5)|0;let t=Math.imul(seed^(seed>>>15),1|seed);t=(t+Math.imul(t^(t>>>7),61|t))^t;return((t^(t>>>14))>>>0)/4294967296};
for(let i=items.length-1;i>0;i--){const j=Math.floor(rnd()*(i+1));[items[i],items[j]]=[items[j],items[i]]}
const list=document.getElementById('list');
items.forEach((it,i)=>{const d=document.createElement('div');d.innerHTML='<h3>#'+(i+1)+' '+(it.request||'')+'</h3>'+times.map(t=>'<img loading="lazy" src="'+it.dir+'/frame-'+t+'.png">').join(' ')+'<div class="b">'+[...Array(11).keys()].map(s=>'<button data-s="'+s+'">'+s+'</button>').join('')+'</div>';
d.querySelectorAll('button').forEach(b=>{if(r[it.key]==b.dataset.s)b.classList.add('on');b.onclick=()=>{r[it.key]=+b.dataset.s;try{localStorage.setItem(key,JSON.stringify(r))}catch{};d.querySelectorAll('button').forEach(x=>x.classList.toggle('on',x===b));count()}});list.append(d)});
function count(){document.getElementById('n').textContent=Object.keys(r).length+' of '+items.length+' rated'}count();
document.getElementById('dl').onclick=()=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(r,null,2)]));a.download='ratings.json';a.click()};
</script>`;
}

/** How well the judge's scores agree with a person's ratings of the same shaders. */
export function agreement(pairs: { judge: number; human: number }[]) {
  const n = pairs.length;
  const rank = (xs: number[]) => {
    const order = xs.map((v, i) => [v, i] as const).sort((p, q) => p[0] - q[0]);
    const ranks = new Array<number>(n);
    for (let i = 0; i < n;) {
      let j = i;
      while (j + 1 < n && order[j + 1][0] === order[i][0]) j++;
      for (let k = i; k <= j; k++) ranks[order[k][1]] = (i + j) / 2 + 1; // ties share the average rank
      i = j + 1;
    }
    return ranks;
  };
  const pearson = (x: number[], y: number[]) => {
    const mx = x.reduce((s, v) => s + v, 0) / n, my = y.reduce((s, v) => s + v, 0) / n;
    let sxy = 0, sxx = 0, syy = 0;
    for (let i = 0; i < n; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; syy += (y[i] - my) ** 2; }
    return sxx && syy ? sxy / Math.sqrt(sxx * syy) : 0;
  };
  const j = pairs.map((p) => p.judge), h = pairs.map((p) => p.human);
  const jp = j.map((v) => v >= PASS), hp = h.map((v) => v >= PASS);
  const agreeRate = jp.filter((v, i) => v === hp[i]).length / n;
  // Cohen's kappa: pass/fail agreement corrected for the agreement you'd get by chance.
  const pj = jp.filter(Boolean).length / n, ph = hp.filter(Boolean).length / n;
  const chance = pj * ph + (1 - pj) * (1 - ph);
  return {
    n,
    spearman: pearson(rank(j), rank(h)),
    meanAbsDiff: pairs.reduce((s, p) => s + Math.abs(p.judge - p.human), 0) / n,
    passAgreement: agreeRate,
    kappa: chance < 1 ? (agreeRate - chance) / (1 - chance) : 1,
  };
}

async function agree(runDir: string, ratingsFile: string) {
  const results: Result[] = (await readFile(path.join(runDir, 'results.jsonl'), 'utf8')).trim().split('\n').map((l) => JSON.parse(l));
  const ratings: Record<string, number> = JSON.parse(await readFile(ratingsFile, 'utf8'));
  const pairs = results.filter((r) => `${r.id}/${r.mode}` in ratings).map((r) => ({ judge: r.score, human: ratings[`${r.id}/${r.mode}`] }));
  if (pairs.length < 5) throw new Error(`only ${pairs.length} rated results; rate at least a few dozen for a meaningful number`);
  const a = agreement(pairs);
  console.log(`Judge vs. you on ${a.n} shaders:
  Spearman correlation  ${a.spearman.toFixed(2)}   (1 = same ranking, 0 = unrelated)
  Mean score difference ${a.meanAbsDiff.toFixed(1)} points
  Pass/fail agreement   ${(a.passAgreement * 100).toFixed(0)}%  (Cohen's kappa ${a.kappa.toFixed(2)}: 0 = chance, 1 = perfect)`);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const [cmd, ...rest] = process.argv.slice(2);
  (cmd === 'agree' ? agree(rest[0], rest[1]) : run()).catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
}
