// The agent in a live room, against the real shaderlab server (in-memory storage) and a second,
// human-like y-websocket client watching and editing.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { buildApp } from '../../server/src/app.js';
import { MemoryStore } from '../../server/src/store.js';
import { LiveRoom, lineDiff } from '../src/room.ts';
import { Renderer } from '../src/render.ts';
import { runAgent } from '../src/agent.ts';
import type { Model, WriterTurn } from '../src/model.ts';

let app: Awaited<ReturnType<typeof buildApp>>['app'];
let base: string;
let renderer: Renderer;
const cleanup: (() => unknown)[] = [];

beforeAll(async () => { renderer = await Renderer.open(); }, 30_000);
afterAll(async () => { await renderer?.close(); });
beforeEach(async () => {
  ({ app } = await buildApp({ store: new MemoryStore(), persistDebounceMs: 20 }));
  await app.listen({ port: 0, host: '127.0.0.1' });
  const addr = app.server.address();
  if (!addr || typeof addr === 'string') throw new Error('no address');
  base = `127.0.0.1:${addr.port}`;
});
afterEach(async () => {
  for (const f of cleanup.splice(0)) await f();
  await app.close();
});

async function newShader() {
  const res = await fetch(`http://${base}/api/shaders`, { method: 'POST' });
  const { id } = (await res.json()) as { id: string };
  return { id, url: `http://${base}/s/${id}` };
}

/** A person in the room: a plain y-websocket client. */
async function person(id: string) {
  const doc = new Y.Doc();
  const provider = new WebsocketProvider(`ws://${base}/collab`, id, doc, { WebSocketPolyfill: WebSocket as unknown as typeof globalThis.WebSocket });
  cleanup.push(() => provider.destroy());
  await new Promise<void>((r) => provider.on('sync', (s: boolean) => s && r()));
  return { text: doc.getText('code'), awareness: provider.awareness };
}

const until = async (cond: () => boolean, ms = 3000) => {
  const end = Date.now() + ms;
  while (!cond()) { if (Date.now() > end) throw new Error('timed out'); await new Promise((r) => setTimeout(r, 20)); }
};

const A = 'void mainImage(out vec4 c, in vec2 p) {\n  c = vec4(0.1, 0.1, 0.1, 1.0);\n}\n';
const B = 'void mainImage(out vec4 c, in vec2 p) {\n  vec2 uv = p / iResolution.xy;\n  c = vec4(uv, 0.5 + 0.5 * sin(iTime), 1.0);\n}\n';

describe('live room', () => {
  it('types drafts that the other people in the room receive, with its name and status shown', async () => {
    const { id, url } = await newShader();
    const watcher = await person(id);
    const room = await LiveRoom.join(url, { tickMs: 0 });
    cleanup.push(() => room.leave());

    await room.type(A);
    await until(() => watcher.text.toString() === A);
    room.status('round 1: judging');
    await until(() => [...watcher.awareness.getStates().values()].some((s) => s.user?.name === 'Shader agent' && s.user?.status === 'round 1: judging'));
  }, 20_000);

  it('only retypes the lines that changed', async () => {
    const { id, url } = await newShader();
    const watcher = await person(id);
    const room = await LiveRoom.join(url, { tickMs: 0 });
    cleanup.push(() => room.leave());
    await room.type(A);
    let edits = 0;
    watcher.text.observe(() => edits++);
    await room.type(B);
    await until(() => watcher.text.toString() === B);
    // A full retype would be ~100 chunks of 8 characters; the diff touches two lines.
    expect(edits).toBeLessThan(20);
  }, 20_000);

  it('notices a hand edit, and the agent builds on it', async () => {
    const { id, url } = await newShader();
    const human = await person(id);
    const room = await LiveRoom.join(url, { tickMs: 0 });
    cleanup.push(() => room.leave());

    const seen: WriterTurn[][] = [];
    let n = 0;
    const model: Model = {
      async write(history) { seen.push([...history]); return { draft: { plan: '', code: n++ ? B : A }, usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 } }; },
      async judge() {
        if (n === 1) {
          // While the judge "thinks" about the first draft, a person changes a colour by hand.
          human.text.insert(human.text.toString().indexOf('0.1'), '0.9, ');
          await until(() => room.peekEdits() !== null);
        }
        return { verdict: { score: n > 1 ? 9 : 3, critique: 'too dark', fixes: ['add colour'] }, usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 } };
      },
    };
    const trace = await runAgent({ id: 'room', prompt: 'p' }, { mode: 'full' }, {
      model, renderer, onDraft: (code) => room.type(code), peekEdits: () => room.peekEdits(),
    });
    expect(trace.stop).toBe('passed');
    const feedback = seen[1].at(-1)!;
    expect(feedback.role === 'feedback' && feedback.text).toMatch(/edited the shader by hand[\s\S]*0\.9, /);
    await until(() => human.text.toString() === B); // the revision was typed into the room
  }, 30_000);
});

describe('lineDiff', () => {
  it('keeps shared lines and swaps only the changed one', () => {
    expect(lineDiff(['a', 'b', 'c'], ['a', 'x', 'c']).map((o) => `${o.kind}:${o.line}`)).toEqual(['keep:a', 'ins:x', 'del:b', 'keep:c']);
  });
  it('handles empty sides', () => {
    expect(lineDiff([], ['a']).map((o) => o.kind)).toEqual(['ins']);
    expect(lineDiff(['a'], []).map((o) => o.kind)).toEqual(['del']);
  });
});

describe('plan narration', () => {
  it('shows the plan as a growing comment, then replaces it with the code', async () => {
    const { id, url } = await newShader();
    const watcher = await person(id);
    const room = await LiveRoom.join(url, { tickMs: 0 });
    cleanup.push(() => room.leave());
    room.narrate('A pond at night.');
    room.narrate('A pond at night. A lotus opens slowly in the middle.');
    await until(() => watcher.text.toString().startsWith('// Shader agent is planning:\n// A pond at night. A lotus opens'));
    expect(room.peekEdits()).toBeNull(); // the comment is the agent's own edit, not a person's
    await room.type(A);
    await until(() => watcher.text.toString() === A);
  }, 20_000);
});
