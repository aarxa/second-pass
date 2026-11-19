// Milestone 2 tests: titles, forking, gallery (walkthrough: docs/M2_EXPLAINED.md). They only use the
// public HTTP + WebSocket API, so they don't depend on how the Store and RoomManager are built.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';

import { buildApp } from '../src/app.js';
import { MemoryStore } from '../src/store.js';

let app: Awaited<ReturnType<typeof buildApp>>['app'];
let rooms: Awaited<ReturnType<typeof buildApp>>['rooms'];
let base: string;
const providers: WebsocketProvider[] = [];

beforeEach(async () => {
  ({ app, rooms } = await buildApp({ store: new MemoryStore(), persistDebounceMs: 1000 }));
  await app.listen({ port: 0, host: '127.0.0.1' });
  const addr = app.server.address();
  if (!addr || typeof addr === 'string') throw new Error('no address');
  base = `127.0.0.1:${addr.port}`;
});

afterEach(async () => {
  for (const p of providers.splice(0)) p.destroy();
  await app.close();
});

const api = (path: string, init?: RequestInit) => fetch(`http://${base}${path}`, init);

async function create(): Promise<string> {
  const res = await api('/api/shaders', { method: 'POST' });
  return ((await res.json()) as { id: string }).id;
}

function connect(id: string) {
  const doc = new Y.Doc();
  const provider = new WebsocketProvider(`ws://${base}/collab`, id, doc, {
    WebSocketPolyfill: WebSocket as unknown as typeof globalThis.WebSocket,
    disableBc: true, // force every update through the server
  });
  providers.push(provider);
  const synced = new Promise<void>((resolve) => {
    if (provider.synced) resolve();
    provider.on('sync', (s: boolean) => s && resolve());
  });
  return { doc, provider, synced, text: doc.getText('code'), meta: doc.getMap('meta') };
}

async function until(cond: () => boolean | Promise<boolean>, ms = 3000) {
  const end = Date.now() + ms;
  while (!(await cond())) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 20));
  }
}

interface Item { id: string; title: string; forkedFrom: string | null; publishedAt: string | null }
interface Page { items: Item[]; nextCursor: string | null }

describe('M2: titles', () => {
  it('new shaders are titled "Untitled"', async () => {
    const id = await create();
    const meta = (await (await api(`/api/shaders/${id}`)).json()) as { title?: string };
    expect(meta.title).toBe('Untitled');
  });

  it('a title set in the document is saved and returned by the API', async () => {
    const id = await create();
    const a = connect(id);
    await a.synced;
    a.meta.set('title', 'Sunset Waves');
    a.provider.destroy();
    await until(() => rooms.liveRooms === 0); // room persisted and unloaded
    const meta = (await (await api(`/api/shaders/${id}`)).json()) as { title?: string };
    expect(meta.title).toBe('Sunset Waves');
  });

  it('caps very long titles at 80 characters on the server', async () => {
    const id = await create();
    const a = connect(id);
    await a.synced;
    a.meta.set('title', 'x'.repeat(500));
    a.provider.destroy();
    await until(() => rooms.liveRooms === 0);
    const meta = (await (await api(`/api/shaders/${id}`)).json()) as { title: string };
    expect(meta.title.length).toBeLessThanOrEqual(80);
  });
});

describe('M2: forking', () => {
  it('copies edits that are still only in the live room (not yet saved)', async () => {
    const id = await create();
    const a = connect(id);
    await a.synced;
    a.text.insert(0, '// unsaved edit\n');
    await new Promise((r) => setTimeout(r, 100)); // reached the server, but the 1 s save hasn't run
    const res = await api(`/api/shaders/${id}/fork`, { method: 'POST' });
    expect(res.status).toBe(201);
    const fork = ((await res.json()) as { id: string }).id;
    expect(fork).not.toBe(id);
    const b = connect(fork);
    await b.synced;
    expect(b.text.toString().startsWith('// unsaved edit\n')).toBe(true);
  });

  it('records where it was forked from and names it after the original', async () => {
    const id = await create();
    const a = connect(id);
    await a.synced;
    a.meta.set('title', 'Plasma');
    await new Promise((r) => setTimeout(r, 100));
    const fork = ((await (await api(`/api/shaders/${id}/fork`, { method: 'POST' })).json()) as { id: string }).id;
    const meta = (await (await api(`/api/shaders/${fork}`)).json()) as { forkedFrom: string; title: string };
    expect(meta.forkedFrom).toBe(id);
    expect(meta.title).toBe('Fork of Plasma');
  });

  it('editing the fork does not change the original', async () => {
    const id = await create();
    const fork = ((await (await api(`/api/shaders/${id}/fork`, { method: 'POST' })).json()) as { id: string }).id;
    const f = connect(fork);
    const o = connect(id);
    await Promise.all([f.synced, o.synced]);
    f.text.insert(0, '// only in the fork\n');
    await new Promise((r) => setTimeout(r, 200));
    expect(o.text.toString().includes('only in the fork')).toBe(false);
  });

  it('404s for unknown shaders and 400s for malformed ids', async () => {
    expect((await api('/api/shaders/ZZZZZZZZZZ/fork', { method: 'POST' })).status).toBe(404);
    expect((await api('/api/shaders/nope/fork', { method: 'POST' })).status).toBe(400);
  });
});

describe('starting code', () => {
  it('starts from code sent with the request, and serves the code read-only', async () => {
    const code = 'void mainImage(out vec4 c, in vec2 p) { c = vec4(1.0); }\n';
    const res = await api('/api/shaders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };
    const read = (await (await api(`/api/shaders/${id}/code`)).json()) as { code: string; title: string };
    expect(read.code).toBe(code);
    expect(read.title).toBe('Untitled');
    expect((await api('/api/shaders/zzzzzzzzzz/code')).status).toBe(404);
  });

  it('rejects starter code that is not a short string', async () => {
    const post = (body: unknown) => api('/api/shaders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    expect((await post({ code: 42 })).status).toBe(400);
    expect((await post({ code: 'x'.repeat(20_001) })).status).toBe(400);
    expect((await api('/api/shaders', { method: 'POST' })).status).toBe(201); // no body: the default code
  });
});

describe('M2: gallery', () => {
  async function page(qs: string): Promise<Page> {
    const res = await api(`/api/shaders${qs}`);
    expect(res.status).toBe(200);
    return (await res.json()) as Page;
  }

  /** Names a shader in its live document (as the title box does), adds it to the gallery, returns its owner key. */
  async function add(id: string, title = 'Rings'): Promise<string> {
    const c = connect(id);
    await c.synced;
    c.meta.set('title', title);
    // The title reaches the server over the WebSocket; retry until the server's room has it.
    let key = '';
    await until(async () => {
      const res = await api(`/api/shaders/${id}/gallery`, { method: 'PUT' });
      if (res.status === 200) key = ((await res.json()) as { ownerKey: string }).ownerKey;
      return res.status === 200;
    });
    c.provider.destroy();
    return key;
  }
  const gallery = (method: 'PUT' | 'DELETE', id: string, key?: string) =>
    api(`/api/shaders/${id}/gallery`, { method, headers: key ? { Authorization: `Bearer ${key}` } : {} });

  it('lists only shaders someone added, not every draft', async () => {
    const draft = await create();
    const added = await create();
    await add(added, 'Lotus');
    const ids = (await page('')).items.map((x) => x.id);
    expect(ids).toEqual([added]);
    expect(ids).not.toContain(draft);
    const meta = (await (await api(`/api/shaders/${draft}`)).json()) as Item;
    expect(meta.publishedAt).toBeNull(); // still reachable by its link
  });

  it('needs a real title before a shader can be added', async () => {
    const id = await create();
    const res = await gallery('PUT', id);
    expect(res.status).toBe(422);
    expect((await page('')).items).toHaveLength(0);
    expect((await gallery('PUT', 'zzzzzzzzzz')).status).toBe(404);
    expect((await gallery('PUT', 'bad id!')).status).toBe(400);
  });

  it('takes a shader out again, and adding it twice keeps its place', async () => {
    const a = await create();
    const b = await create();
    await add(a, 'First');
    const keyB = await add(b, 'Second');
    expect((await gallery('PUT', a)).status).toBe(200); // already in: stays where it was
    expect((await page('')).items.map((x) => x.id)).toEqual([b, a]);
    const res = await gallery('DELETE', b, keyB);
    expect(res.status).toBe(200);
    expect(((await res.json()) as Item).publishedAt).toBeNull();
    expect((await page('')).items.map((x) => x.id)).toEqual([a]);
    expect((await gallery('DELETE', 'zzzzzzzzzz')).status).toBe(404);
  });

  it('a fork starts as a draft, even when its original is in the gallery', async () => {
    const id = await create();
    await add(id, 'Original');
    const res = await api(`/api/shaders/${id}/fork`, { method: 'POST' });
    const fork = ((await res.json()) as { id: string }).id;
    expect((await page('')).items.map((x) => x.id)).toEqual([id]);
    expect((await gallery('PUT', fork)).status).toBe(200); // "Fork of Original" is a real title
  });

  it('lists shaders most recently added first with cursor pagination', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const id = await create();
      await add(id, `Shader ${i}`);
      ids.push(id);
    }
    const p1 = await page('?limit=2');
    expect(p1.items.map((x) => x.id)).toEqual([ids[4], ids[3]]);
    expect(p1.nextCursor).toBeTruthy();
    const p2 = await page(`?limit=2&cursor=${encodeURIComponent(p1.nextCursor!)}`);
    expect(p2.items.map((x) => x.id)).toEqual([ids[2], ids[1]]);
    const p3 = await page(`?limit=2&cursor=${encodeURIComponent(p2.nextCursor!)}`);
    expect(p3.items.map((x) => x.id)).toEqual([ids[0]]);
    expect(p3.nextCursor).toBeNull();
  });

  it('does not repeat items when a shader is added between page loads (why OFFSET fails)', async () => {
    for (let i = 0; i < 4; i++) await add(await create(), `Shader ${i}`);
    const p1 = await page('?limit=2');
    await add(await create(), 'Newer'); // a new shader appears at the top while the user is reading page 1
    const p2 = await page(`?limit=2&cursor=${encodeURIComponent(p1.nextCursor!)}`);
    const seen = new Set(p1.items.map((x) => x.id));
    for (const item of p2.items) expect(seen.has(item.id)).toBe(false);
    expect(p2.items).toHaveLength(2);
  });

  it('caps the page size and rejects a garbage cursor', async () => {
    for (let i = 0; i < 3; i++) await add(await create(), `Shader ${i}`);
    expect((await page('?limit=1000')).items.length).toBeLessThanOrEqual(50);
    expect((await api('/api/shaders?cursor=not-a-real-cursor')).status).toBe(400);
  });
});
