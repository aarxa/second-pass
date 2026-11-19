// Gallery pieces are locked: the server drops edits to them, every open editor is told, and only the
// key handed to whoever added it (or the site owner's admin key) takes it out of the gallery again.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';

import { buildApp } from '../src/app.js';
import { MemoryStore } from '../src/store.js';
import { DEFAULT_SHADER } from '../src/collab.js';

const ADMIN = 'admin-secret-for-tests';
let app: Awaited<ReturnType<typeof buildApp>>['app'];
let base: string;
const providers: WebsocketProvider[] = [];

beforeEach(async () => {
  ({ app } = await buildApp({ store: new MemoryStore(), persistDebounceMs: 50, adminToken: ADMIN }));
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
const auth = (key?: string) => (key ? { Authorization: `Bearer ${key}` } : undefined);
const create = async () => ((await (await api('/api/shaders', { method: 'POST' })).json()) as { id: string }).id;

async function until(cond: () => boolean | Promise<boolean>, ms = 3000) {
  const end = Date.now() + ms;
  while (!(await cond())) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 20));
  }
}

async function connect(id: string) {
  const doc = new Y.Doc();
  const provider = new WebsocketProvider(`ws://${base}/collab`, id, doc, {
    WebSocketPolyfill: WebSocket as unknown as typeof globalThis.WebSocket,
    disableBc: true,
  });
  providers.push(provider);
  await new Promise<void>((resolve) => (provider.synced ? resolve() : provider.on('sync', (s: boolean) => s && resolve())));
  return { doc, provider, text: doc.getText('code'), meta: doc.getMap('meta') };
}

/** Names the shader through a live client and adds it to the gallery; returns that client and the owner key. */
async function addToGallery(id: string) {
  const c = await connect(id);
  c.meta.set('title', 'Locked rings');
  let key = '';
  await until(async () => {
    const res = await api(`/api/shaders/${id}/gallery`, { method: 'PUT' });
    if (res.status === 200) key = ((await res.json()) as { ownerKey: string }).ownerKey;
    return res.status === 200;
  });
  return { client: c, key };
}

describe('gallery lock', () => {
  it('drops edits to a gallery piece and tells every open editor it is locked', async () => {
    const id = await create();
    const { client: a } = await addToGallery(id);
    await until(() => a.meta.get('locked') === true);
    a.text.insert(0, 'VANDALISM ');
    a.meta.set('title', 'Renamed');
    await new Promise((r) => setTimeout(r, 300));
    const b = await connect(id);
    expect(b.text.toString()).toBe(DEFAULT_SHADER);
    expect(b.meta.get('title')).toBe('Locked rings');
    expect(b.meta.get('locked')).toBe(true);
  });

  it('locks a gallery piece whose room loads later', async () => {
    const id = await create();
    const { client: a } = await addToGallery(id);
    a.provider.destroy(); // everyone leaves; the room unloads
    await new Promise((r) => setTimeout(r, 200));
    const b = await connect(id);
    expect(b.meta.get('locked')).toBe(true);
    b.text.insert(0, 'X');
    await new Promise((r) => setTimeout(r, 300));
    const c = await connect(id);
    expect(c.text.toString()).toBe(DEFAULT_SHADER);
  });

  it('only the owner key or the admin key takes it out, and that unlocks it', async () => {
    const id = await create();
    const { client: a, key } = await addToGallery(id);
    const del = (k?: string) => api(`/api/shaders/${id}/gallery`, { method: 'DELETE', headers: auth(k) });
    expect((await del()).status).toBe(403);
    expect((await del('not-the-key')).status).toBe(403);
    const res = await del(key);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { publishedAt: string | null }).publishedAt).toBeNull();
    await until(() => a.meta.get('locked') === false);
    const c = await connect(id);
    c.text.insert(0, '// edited again\n');
    await until(() => a.text.toString().startsWith('// edited again'));

    // Adding it again issues a new key; the old one no longer works, the admin key always does.
    const again = await api(`/api/shaders/${id}/gallery`, { method: 'PUT' });
    const newKey = ((await again.json()) as { ownerKey: string }).ownerKey;
    expect(newKey).toBeTruthy();
    expect(newKey).not.toBe(key);
    expect((await del(key)).status).toBe(403);
    expect((await del(ADMIN)).status).toBe(200);
  });

  it('adding a gallery piece again keeps its key and returns none', async () => {
    const id = await create();
    const { key } = await addToGallery(id);
    const res = await api(`/api/shaders/${id}/gallery`, { method: 'PUT' });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { ownerKey?: string }).ownerKey).toBeUndefined();
    expect((await api(`/api/shaders/${id}/gallery`, { method: 'DELETE', headers: auth(key) })).status).toBe(200);
  });

  it("locks a gallery piece's thumbnail once it has one", async () => {
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAEUlEQVR4nGP4z8DwHwQZGBgYGBgADfIB/f5rpjgAAAAASUVORK5CYII=',
      'base64',
    );
    const put = (id: string) => api(`/api/shaders/${id}/thumbnail`, { method: 'PUT', headers: { 'Content-Type': 'image/png' }, body: png });
    const first = await create();
    await addToGallery(first);
    expect((await put(first)).status).toBe(204); // its first picture is still allowed
    const second = await create();
    expect((await put(second)).status).toBe(204);
    await addToGallery(second);
    expect((await put(second)).status).toBe(403);
  });
});
