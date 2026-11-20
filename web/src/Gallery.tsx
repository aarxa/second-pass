// Gallery: the shaders someone added (new ones are drafts until then), most recently added first,
// loaded a page at a time with the server's cursor. Hovering a card runs the real shader in it; the
// ones the agent wrote carry a "By the agent" badge that links to their replay, and show its score.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { RunSummary } from './agentRun';
import { FadeImg } from './FadeImg';
import { LiveShader } from './LiveShader';
import { SiteFooter, TopBar, usePageTitle } from './theme';

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

/** "Added Nov 19" (with the year once it isn't this year's). */
function added(iso: string): string {
  const d = new Date(iso);
  const thisYear = d.getFullYear() === new Date().getFullYear();
  return `Added ${d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', ...(thisYear ? {} : { year: 'numeric' }) })}`;
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

function Card({ it, run, forkedTitle }: { it: Item; run?: RunSummary; forkedTitle?: string }) {
  const navigate = useNavigate();
  const [hover, setHover] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  const [forking, setForking] = useState(false);
  const [forkFailed, setForkFailed] = useState('');

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
    setForkFailed('');
    const res = await fetch(`/api/shaders/${it.id}/fork`, { method: 'POST' }).catch(() => null);
    if (res?.ok) navigate(`/s/${((await res.json()) as { id: string }).id}`);
    else {
      setForking(false);
      setForkFailed(res?.status === 429 ? 'Too many forks; try later' : "Couldn't fork");
    }
  };

  const enter = () => hoverPreviews() && setHover(true);
  const leave = () => setHover(false);
  const score = run?.scores[run.scores.length - 1];
  return (
    <article className="card">
      <div className="thumb-wrap">
        <Link to={`/s/${it.id}`} className="thumb" style={{ background: placeholder(it.id) }} onPointerEnter={enter} onPointerLeave={leave} onFocus={enter} onBlur={leave}>
          {it.thumbnailAt && (
            // ?v= is the thumbnail's version: the URL changes when the image does, so the server
            // can let the browser cache each version forever.
            <FadeImg
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
        {run && <Link to={`/agent/${run.id}`} className="agent-badge" title="Written by the agent: watch the run">By the agent</Link>}
      </div>
      <div className="card-row">
        <div className="card-body">
          <Link to={`/s/${it.id}`} className="card-title">{it.title}</Link>
          <div className="card-meta">
            {run ? `Judge ${score}/10 · ${run.rounds} ${run.rounds === 1 ? 'pass' : 'passes'}` : added(it.publishedAt)}
            {it.forkedFrom && <> · forked from {forkedTitle ?? it.forkedFrom}</>}
          </div>
        </div>
        <button className="secondary small" onClick={fork} disabled={forking}>{forking ? 'Forking…' : 'Fork'}</button>
      </div>
      {forkFailed && <span className="error-text small card-error">{forkFailed}</span>}
    </article>
  );
}

export function Gallery() {
  const [items, setItems] = useState<Item[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);
  const [slow, setSlow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [runOf, setRunOf] = useState<Map<string, RunSummary>>(new Map()); // gallery id -> the agent run that wrote it
  const started = useRef(false);
  usePageTitle('Gallery');

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
      .then((runs) => setRunOf(new Map(runs.flatMap((r) => (r.galleryId ? [[r.galleryId, r] as const] : [])))))
      .catch(() => {});
  }, [loadMore]);

  const titles = new Map(items.map((i) => [i.id, i.title]));
  const shown = items.filter((i) => filter === 'all' || (filter === 'agent') === runOf.has(i.id));
  const count = (f: Filter) => items.filter((i) => f === 'all' || (f === 'agent') === runOf.has(i.id)).length;
  const firstLoad = loading && items.length === 0;

  return (
    <div className="page doc gallery-page">
      <TopBar active="gallery" />
      <main className="wrap">
      <div className="gallery-bar">
        <h1>Gallery</h1>
        <div className="filters" role="group" aria-label="Show">
          {([['all', 'All'], ['agent', 'By the agent'], ['people', 'By people']] as [Filter, string][]).map(([f, label]) => (
            <button key={f} className={`chip${filter === f ? ' on' : ''}`} aria-pressed={filter === f} onClick={() => setFilter(f)}>
              {label}{items.length > 0 && <span>{count(f)}</span>}
            </button>
          ))}
        </div>
        <p className="gallery-hint"><span className="hover-only">Hover a card to run it. </span>Open one to see the code, or fork it to make your own.</p>
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
      </main>
      <SiteFooter />
    </div>
  );
}
