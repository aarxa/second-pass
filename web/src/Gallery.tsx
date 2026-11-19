// Gallery: the shaders someone added (new ones are drafts until then), most recently added first,
// loaded a page at a time with the server's cursor. Hovering a card runs the real shader in it; the
// ones the agent wrote are tagged and link to their replay.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { RunSummary } from './agentRun';
import { LiveShader } from './LiveShader';
import { TopBar } from './theme';

interface Item {
  id: string;
  title: string;
  forkedFrom: string | null;
  createdAt: string;
  updatedAt: string;
  thumbnailAt: string | null;
  publishedAt: string; // always set for gallery items
}

type Filter = 'all' | 'agent' | 'people';

/** A stable two-color gradient per shader for cards that don't have a thumbnail yet. */
function placeholder(id: string): string {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const a = h % 360, b = (a + 60 + (h >> 9) % 120) % 360;
  return `linear-gradient(135deg, hsl(${a} 55% 30%), hsl(${b} 55% 18%))`;
}

const PAGE = 24;

function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  const units: [number, string][] = [[86400 * 30, 'mo'], [86400, 'd'], [3600, 'h'], [60, 'm']];
  for (const [n, u] of units) if (s >= n) return `${Math.floor(s / n)}${u} ago`;
  return 'just now';
}

// Each shader's code, fetched once, for the live preview on hover.
const codeCache = new Map<string, Promise<string | null>>();
function codeFor(id: string): Promise<string | null> {
  if (!codeCache.has(id)) {
    codeCache.set(
      id,
      fetch(`/api/shaders/${id}/code`)
        .then((r) => (r.ok ? (r.json() as Promise<{ code: string }>) : null))
        .then((j) => j?.code ?? null)
        .catch(() => null),
    );
  }
  return codeCache.get(id)!;
}
// Only devices with a real pointer get hover previews, and only if motion is welcome.
const hoverPreviews = () =>
  window.matchMedia('(hover: hover) and (pointer: fine)').matches && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function Card({ it, run, forkedTitle }: { it: Item; run?: string; forkedTitle?: string }) {
  const navigate = useNavigate();
  const [hover, setHover] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  const [forking, setForking] = useState(false);
  const [forkFailed, setForkFailed] = useState(false);

  useEffect(() => {
    if (!hover) return;
    let live = true;
    const t = window.setTimeout(() => codeFor(it.id).then((c) => live && setCode(c)), 150);
    return () => {
      live = false;
      window.clearTimeout(t);
    };
  }, [hover, it.id]);

  const fork = async () => {
    setForking(true);
    setForkFailed(false);
    const res = await fetch(`/api/shaders/${it.id}/fork`, { method: 'POST' }).catch(() => null);
    if (res?.ok) navigate(`/s/${((await res.json()) as { id: string }).id}`);
    else {
      setForking(false);
      setForkFailed(true);
    }
  };

  const enter = () => hoverPreviews() && setHover(true);
  const leave = () => setHover(false);
  return (
    <article className="card">
      <Link to={`/s/${it.id}`} className="thumb" style={{ background: placeholder(it.id) }} onPointerEnter={enter} onPointerLeave={leave} onFocus={enter} onBlur={leave}>
        {it.thumbnailAt && (
          // ?v= is the thumbnail's version: the URL changes when the image does, so the server
          // can let the browser cache each version forever.
          <img
            src={`/api/shaders/${it.id}/thumbnail?v=${new Date(it.thumbnailAt).getTime()}`}
            alt=""
            loading="lazy"
            decoding="async"
            width={320}
            height={180}
            onError={(e) => (e.currentTarget.style.display = 'none')}
          />
        )}
        {hover && code && <LiveShader code={code} label={it.title} />}
      </Link>
      <div className="card-body">
        <Link to={`/s/${it.id}`} className="card-title">{it.title}</Link>
        <div className="card-meta">
          added {ago(it.publishedAt)}
          {it.forkedFrom && <> · forked from {forkedTitle ?? it.forkedFrom}</>}
        </div>
      </div>
      <div className="card-actions">
        {run ? <Link to={`/agent/${run}`} className="tag" title="Written by the agent: watch the run">Agent run</Link> : <span />}
        {forkFailed && <span className="error-text small">Couldn't fork</span>}
        <button className="secondary small" onClick={fork} disabled={forking}>{forking ? 'Forking…' : 'Fork'}</button>
      </div>
    </article>
  );
}

export function Gallery() {
  const navigate = useNavigate();
  const [items, setItems] = useState<Item[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);
  const [slow, setSlow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [runOf, setRunOf] = useState<Map<string, string>>(new Map()); // gallery id -> agent run id
  const started = useRef(false);

  const loadMore = useCallback(async (after: string | null) => {
    setLoading(true);
    setError(null);
    const slowTimer = window.setTimeout(() => setSlow(true), 3000);
    try {
      const qs = new URLSearchParams({ limit: String(PAGE) });
      if (after) qs.set('cursor', after);
      const res = await fetch(`/api/shaders?${qs}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const page = (await res.json()) as { items: Item[]; nextCursor: string | null };
      setItems((prev) => [...prev, ...page.items]);
      setCursor(page.nextCursor);
      setDone(page.nextCursor === null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      window.clearTimeout(slowTimer);
      setSlow(false);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (started.current) return; // StrictMode runs effects twice in development
    started.current = true;
    void loadMore(null);
    // Which gallery shaders the agent wrote: the runs list (a static file) links each run to its copy.
    fetch('/agent-runs/index.json')
      .then((r) => (r.ok ? (r.json() as Promise<RunSummary[]>) : []))
      .then((runs) => setRunOf(new Map(runs.flatMap((r) => (r.galleryId ? [[r.galleryId, r.id] as const] : [])))))
      .catch(() => {});
  }, [loadMore]);

  const titles = new Map(items.map((i) => [i.id, i.title]));
  const shown = items.filter((i) => filter === 'all' || (filter === 'agent') === runOf.has(i.id));
  const count = (f: Filter) => items.filter((i) => f === 'all' || (f === 'agent') === runOf.has(i.id)).length;
  const firstLoad = loading && items.length === 0;

  return (
    <div className="page gallery-page">
      <TopBar active="gallery">
        <button className="push" onClick={() => navigate('/new')}>New shader</button>
      </TopBar>
      <div className="gallery-bar">
        <h1>Gallery</h1>
        <div className="filters" role="group" aria-label="Show">
          {([['all', 'All'], ['agent', 'Made by the agent'], ['people', 'Made by people']] as [Filter, string][]).map(([f, label]) => (
            <button key={f} className={`chip${filter === f ? ' on' : ''}`} aria-pressed={filter === f} onClick={() => setFilter(f)}>
              {label}{items.length > 0 && <span>{count(f)}</span>}
            </button>
          ))}
        </div>
        <p className="gallery-hint">Hover a card to run it. Open one to see the code, or fork it to make your own.</p>
      </div>
      {slow && (
        <p className="waking-line" role="status"><i className="spinner" aria-hidden="true" /> Waking the server… the free server sleeps when nobody has used it for a while. This takes up to a minute.</p>
      )}
      <div className="gallery">
        {firstLoad && Array.from({ length: 6 }, (_, i) => <div key={i} className="card skeleton" aria-hidden="true"><div className="thumb" /><div className="bar" /><div className="bar short" /></div>)}
        {shown.map((it) => <Card key={it.id} it={it} run={runOf.get(it.id)} forkedTitle={it.forkedFrom ? titles.get(it.forkedFrom) : undefined} />)}
        {!loading && !error && items.length > 0 && shown.length === 0 && (
          <div className="muted">Nothing here yet for this filter.</div>
        )}
        {items.length === 0 && !loading && !error && (
          <div className="muted">Nothing here yet. Open a shader, give it a name, and choose Add to gallery.</div>
        )}
      </div>
      <div className="gallery-footer">
        {error && <span className="error-text">Couldn't load shaders ({error}). </span>}
        {!done && !firstLoad && (
          <button className="secondary" disabled={loading} onClick={() => loadMore(cursor)}>
            {loading ? 'Loading…' : error ? 'Try again' : 'Load more'}
          </button>
        )}
      </div>
    </div>
  );
}
