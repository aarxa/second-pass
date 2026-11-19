// When the database misbehaves the server must stay up and lose nothing; and creating shaders is
// rate-limited. The store here fails on purpose a set number of times.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';

import { buildApp } from '../src/app.js';
import { MemoryStore } from '../src/store.js';
import { DEFAULT_SHADER } from '../src/collab.js';
import { RateLimit } from '../src/limits.js';

/** A MemoryStore that throws "database unreachable" for the next N saves / loads / existence checks. */
class FlakyStore extends MemoryStore {
  failSaves = 0;
  failLoads = 0;
  failExists = 0;
  override async saveState(id: string, state: Uint8Array, title: string) {
    if (this.failSaves > 0 && this.failSaves--) throw new Error('database unreachable (test)');
    return super.saveState(id, state, title);
  }
  override async loadState(id: string) {
    if (this.failLoads > 0 && this.failLoads--) throw new Error('database unreachable (test)');
    return super.loadState(id);
  }
  override async exists(id: string) {
    if (this.failExists > 0 && this.failExists--) throw new Error('database unreachable (test)');
    return super.exists(id);
  }
}

let store: FlakyStore;
let app: Awaited<ReturnType<typeof buildApp>>['app'];
let rooms: Awaited<ReturnType<typeof buildApp>>['rooms'];
let base: string;
const providers: WebsocketProvider[] = [];
const quiet = console.error;

beforeEach(async () => {
  console.error = () => {}; // the failures below are logged on purpose
  store = new FlakyStore();
  ({ app, rooms } = await buildApp({ store, persistDebounceMs: 30, persistRetryMs: 60, createLimits: { perClient: 3, total: 5 } }));
  await app.listen({ port: 0, host: '127.0.0.1' });
  const addr = app.server.address();
  if (!addr || typeof addr === 'string') throw new Error('no address');
  base = `127.0.0.1:${addr.port}`;
});
afterEach(async () => {
  for (const p of providers.splice(0)) p.destroy();
  await app.close();
  console.error = quiet;
});

const api = (path: string, init?: RequestInit) => fetch(`http://${base}${path}`, init);
const create = async (headers: Record<string, string> = {}) => api('/api/shaders', { method: 'POST', headers });
async function until(cond: () => boolean | Promise<boolean>, ms = 4000) {
  const end = Date.now() + ms;
  while (!(await cond())) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 20));
  }
}
function connect(id: string) {
  const doc = new Y.Doc();
  const provider = new WebsocketProvider(`ws://${base}/collab`, id, doc, {
    WebSocketPolyfill: WebSocket as unknown as typeof globalThis.WebSocket,
    disableBc: true,
  });
  providers.push(provider);
  return { doc, provider, text: doc.getText('code') };
}
const savedText = async (id: string) => {
  const state = await MemoryStore.prototype.loadState.call(store, id);
  const doc = new Y.Doc();
  if (state) Y.applyUpdate(doc, state);
  return doc.getText('code').toString();
};

describe('database failures', () => {
  it('keeps edits through failed saves and saves them once the database answers again', async () => {
    const { id } = (await (await create()).json()) as { id: string };
    const a = connect(id);
    await until(() => a.provider.synced);
    store.failSaves = 3;
    a.text.insert(0, '// survived\n');
    await until(async () => (await savedText(id)).startsWith('// survived'));
    expect(store.failSaves).toBe(0);
  });

  it("doesn't drop a room's unsaved edits when the save on leaving fails", async () => {
    const { id } = (await (await create()).json()) as { id: string };
    const a = connect(id);
    await until(() => a.provider.synced);
    store.failSaves = 2;
    a.text.insert(0, '// written just before leaving\n');
    a.provider.destroy();
    await until(async () => (await savedText(id)).startsWith('// written just before leaving'));
    await until(() => rooms.liveRooms === 0); // then the room is let go
  });

  it('a room that fails to load is not stuck: the client reconnects and gets it', async () => {
    const { id } = (await (await create()).json()) as { id: string };
    store.failLoads = 1;
    const a = connect(id);
    await until(() => a.provider.synced);
    expect(a.text.toString()).toBe(DEFAULT_SHADER);
  });

  it('answers 503 when the database is unreachable at connect time, and keeps serving', async () => {
    const { id } = (await (await create()).json()) as { id: string };
    store.failExists = 1;
    const status = await new Promise<number>((resolve) => {
      const ws = new WebSocket(`ws://${base}/collab/${id}`);
      ws.on('unexpected-response', (_req, res) => resolve(res.statusCode ?? 0));
      ws.on('open', () => resolve(101));
    });
    expect(status).toBe(503);
    const a = connect(id);
    await until(() => a.provider.synced);
  });
});

describe('creation limits', () => {
  it('limits new shaders and forks per client per hour, with Retry-After', async () => {
    const me = { 'X-Forwarded-For': '203.0.113.7' };
    const first = (await (await create(me)).json()) as { id: string };
    expect((await create(me)).status).toBe(201);
    expect((await api(`/api/shaders/${first.id}/fork`, { method: 'POST', headers: me })).status).toBe(201); // 3rd: a fork counts
    const res = await create(me);
    expect(res.status).toBe(429);
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0);
    expect((await create({ 'X-Forwarded-For': '198.51.100.2' })).status).toBe(201); // someone else
  });

  it('has a ceiling for everyone together, whatever address a client claims', async () => {
    for (let i = 0; i < 5; i++) expect((await create({ 'X-Forwarded-For': `192.0.2.${i}` })).status).toBe(201);
    expect((await create({ 'X-Forwarded-For': '192.0.2.99' })).status).toBe(429);
  });

  it('RateLimit counts within a sliding window', () => {
    const limit = new RateLimit(2, 1000);
    expect(limit.take('a', 0)).toBe(0);
    expect(limit.take('a', 100)).toBe(0);
    expect(limit.take('a', 200)).toBe(800); // the first one expires at 1000
    expect(limit.take('b', 200)).toBe(0);
    expect(limit.take('a', 1001)).toBe(0);
  });
});
