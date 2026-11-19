// Try the agent on one request and watch each step.
//
//   npm run agent -- "a lava lamp with slow rising blobs"
//   npm run agent -- --sketch my-drawing.png "make the sun pulse"
//   npm run agent -- --mode compile --dry "anything"     (fake model, no API key, no cost)
//   npm run agent -- --room https://shaderlab.onrender.com/s/<id> "a lava lamp"
//       joins that room and types each draft in live; edits people make are picked up
//
// The final shader and its frames are saved to agent/out/<time>/.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Renderer } from './render.ts';
import { runAgent, type Mode, type Step } from './agent.ts';
import { ClaudeModel, type Model } from './model.ts';
import { fakeModel } from './fake.ts';
import { LiveRoom } from './room.ts';

async function main() {
  const argv = process.argv.slice(2);
  const take = (flag: string) => { const i = argv.indexOf(flag); if (i < 0) return undefined; const v = argv[i + 1]; argv.splice(i, 2); return v; };
  const dry = argv.includes('--dry'); if (dry) argv.splice(argv.indexOf('--dry'), 1);
  const mode = (take('--mode') ?? 'full') as Mode;
  const sketchPath = take('--sketch');
  const roomUrl = take('--room');
  const prompt = argv.join(' ').trim() || undefined;
  if (!prompt && !sketchPath) throw new Error('give a request, a --sketch, or both');

  const sketch = sketchPath
    ? { mediaType: (sketchPath.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg') as 'image/png' | 'image/jpeg', data: (await readFile(sketchPath)).toString('base64') }
    : undefined;
  const model: Model = dry ? fakeModel() : new ClaudeModel();
  const renderer = await Renderer.open();
  const room = roomUrl ? await LiveRoom.join(roomUrl) : null;
  if (room) console.log(`Joined ${roomUrl}`);
  console.log(dry ? 'Dry run with a fake model.' : 'Writing the first draft (a minute or two: the model plans before it writes)…');
  try {
    const trace = await runAgent({ id: 'cli', prompt, sketch }, { mode }, {
      model, renderer,
      onStep: (s) => { print(s); if (room) room.status(statusFor(s)); },
      onDraft: room ? (code) => room.type(code) : undefined,
      peekEdits: room ? () => room.peekEdits() : undefined,
    });
    // In a room, leave the best version on screen (a later, worse draft may be showing).
    if (room && trace.code && room.code !== trace.code) await room.type(trace.code);
    const out = path.join('out', new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19));
    await mkdir(out, { recursive: true });
    await writeFile(path.join(out, 'trace.json'), JSON.stringify(trace, null, 2));
    if (trace.code) {
      await writeFile(path.join(out, 'final.glsl'), trace.code);
      const shot = await renderer.render(trace.code);
      if (shot.ok) for (const f of shot.frames) await writeFile(path.join(out, `frame-${f.t}.png`), Buffer.from(f.png, 'base64'));
    }
    console.log(`\n${trace.stop}${trace.error ? ` (${trace.error})` : ''} after ${trace.rounds} round(s), ` +
      `${trace.compileFixes} compile fix(es), $${trace.usage.costUsd.toFixed(3)}, ${(trace.ms / 1000).toFixed(1)} s. Saved to agent/${out}/`);
  } finally {
    await room?.leave();
    await renderer.close();
  }
}

function statusFor(s: Step): string {
  switch (s.type) {
    case 'draft': return `round ${s.round}: compiling`;
    case 'compile': return s.ok ? `round ${s.round}: rendering` : `round ${s.round}: fixing errors`;
    case 'render': return `round ${s.round}: judging`;
    case 'judge': return `round ${s.round}: scored ${s.verdict.score}/10`;
    case 'stop': return s.reason.replace('_', ' ');
  }
}

function print(s: Step) {
  switch (s.type) {
    case 'draft': console.log(`\n[round ${s.round}] draft ($${s.usage.costUsd.toFixed(3)})\n  plan: ${s.plan.replace(/\s+/g, ' ').slice(0, 200)}`); break;
    case 'compile': console.log(s.ok ? '  compiles, rendering and judging…' : `  does not compile, fixing:\n    ${s.errors.slice(0, 4).join('\n    ')}`); break;
    case 'render': console.log(`  rendered in ${s.ms} ms (contrast ${s.stats.spread.toFixed(3)}, motion ${s.stats.motion.toFixed(3)})`); break;
    case 'judge': console.log(`  judge: ${s.verdict.score}/10. ${s.verdict.critique}${s.verdict.score < 7 ? '\n  revising…' : ''}`); break;
    case 'stop': break;
  }
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
