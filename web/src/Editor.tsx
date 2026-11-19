// The shader page: collaborative CodeMirror editor on the left, live WebGL preview on the right.
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { yCollab } from 'y-codemirror.next';
import { EditorView, basicSetup } from 'codemirror';
import { Compartment, EditorState } from '@codemirror/state';
import { cpp } from '@codemirror/lang-cpp';
import { setDiagnostics, type Diagnostic } from '@codemirror/lint';

import { ShaderRenderer, type CompileError } from './renderer';
import { COLORS, NAME_MAX, getIdentity, initials, setIdentity, type Identity } from './identity';
import { sendOnlyLocalAwareness } from './awareness';
import { TopBar, editorTheme } from './theme';
import { collabUrl } from './server';
import { forgetOwnerKey, removalKey, saveOwnerKey } from './keys';
import { Reference } from './Reference';

type Status = 'connecting' | 'connected' | 'disconnected';
interface Peer {
  clientId: number;
  name: string;
  color: string;
  status?: string; // set by the shader agent: what it is doing right now
}

export const TITLE_MAX = 80;
const SPLIT_KEY = 'secondpass.split';
// Switches the code editor between editable and read-only (a gallery piece is locked).
const lockable = new Compartment();
const lockExtensions = (locked: boolean) => [EditorState.readOnly.of(locked), EditorView.editable.of(!locked)];
const SPLIT_MIN = 20;
const SPLIT_MAX = 80;

// Someone's name shows on their cursor for a few seconds after they type or move it. The cursor
// labels belong to y-codemirror.next and carry only the person's colour, so a small style sheet
// reveals the labels of recently active colours.
const activeColors = new Map<string, number>();
let labelSheet: HTMLStyleElement | null = null;
let labelTimer = 0;
function showName(color: string) {
  activeColors.set(color, Date.now());
  renderLabels();
}
function renderLabels() {
  labelSheet ??= document.head.appendChild(document.createElement('style'));
  const now = Date.now();
  for (const [c, t] of activeColors) if (now - t > 2500) activeColors.delete(c);
  labelSheet.textContent = [...activeColors.keys()]
    .filter((c) => /^#[0-9a-f]{3,8}$/i.test(c))
    .map((c) => `.cm-ySelectionCaret[style*="${c}"] > .cm-ySelectionInfo { opacity: 1; }`)
    .join('\n');
  window.clearTimeout(labelTimer);
  if (activeColors.size) labelTimer = window.setTimeout(renderLabels, 600);
}

export function Editor() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const metaRef = useRef<Y.Map<unknown> | null>(null);
  const [title, setTitle] = useState('');
  const [forkedFrom, setForkedFrom] = useState<string | null>(null);
  const [forking, setForking] = useState(false);
  // Gallery membership: null until the shader's metadata has loaded.
  const [inGallery, setInGallery] = useState<boolean | null>(null);
  const [galleryBusy, setGalleryBusy] = useState(false);
  const [nameFirst, setNameFirst] = useState(false); // asked to add it while it had no name
  const titleEl = useRef<HTMLInputElement>(null);
  const editorEl = useRef<HTMLDivElement>(null);
  const canvasEl = useRef<HTMLCanvasElement>(null);
  const previewEl = useRef<HTMLDivElement>(null);
  const splitEl = useRef<HTMLElement>(null);
  const clockEl = useRef<HTMLSpanElement>(null);
  const rendererRef = useRef<ShaderRenderer | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const providerRef = useRef<WebsocketProvider | null>(null);
  const [me, setMe] = useState<Identity>(() => getIdentity());
  const [youOpen, setYouOpen] = useState(false);
  const [toasts, setToasts] = useState<{ key: number; text: string; color: string }[]>([]);
  const lockedRef = useRef(false);
  const [galleryError, setGalleryError] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [copied, setCopied] = useState<'idle' | 'ok'>('idle');
  // Width of the code side, in percent; remembered per browser.
  const [split, setSplit] = useState(() => {
    try {
      const v = Number(localStorage.getItem(SPLIT_KEY));
      return v >= SPLIT_MIN && v <= SPLIT_MAX ? v : 50;
    } catch {
      return 50;
    }
  });
  const [status, setStatus] = useState<Status>('connecting');
  const [errors, setErrors] = useState<CompileError[]>([]);
  const [peers, setPeers] = useState<Peer[]>([]);
  const [notFound, setNotFound] = useState(false);
  // Set by the main effect; the metadata fetch calls it if this shader has no thumbnail yet.
  const backfillThumbnail = useRef<(() => void) | null>(null);
  const thumbnailMissing = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let retry = 0;
    // Only a 404 means "no such shader". Anything else (the free server still waking, a network
    // blip) is retried, so a slow start never shows "Shader not found".
    const load = () =>
      fetch(`/api/shaders/${id}`)
        .then(async (r) => {
          if (cancelled) return;
          if (r.status === 404 || r.status === 400) return setNotFound(true);
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          const meta = (await r.json()) as { forkedFrom: string | null; thumbnailAt: string | null; publishedAt: string | null };
          setForkedFrom(meta.forkedFrom);
          setInGallery(meta.publishedAt !== null);
          if (meta.thumbnailAt === null) {
            thumbnailMissing.current = true;
            backfillThumbnail.current?.();
          }
        })
        .catch(() => {
          if (!cancelled) retry = window.setTimeout(load, 3000);
        });
    void load();
    return () => {
      cancelled = true;
      window.clearTimeout(retry);
    };
  }, [id]);

  // "Connecting…" for more than a few seconds almost always means the free server is waking up.
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (status === 'connected') { setSlow(false); return; }
    const t = window.setTimeout(() => setSlow(true), 3000);
    return () => window.clearTimeout(t);
  }, [status]);
  const [refOpen, setRefOpen] = useState(false);

  useEffect(() => {
    if (!editorEl.current || !canvasEl.current || notFound) return;
    const doc = new Y.Doc();
    const ytext = doc.getText('code');
    // The title is a key in a shared Y.Map, so it syncs live like the code. Each change replaces the
    // whole value (last writer wins), which is fine for a short title; the code uses Y.Text, which
    // merges character by character.
    const meta = doc.getMap('meta');
    metaRef.current = meta;
    const syncTitle = () => setTitle(String(meta.get('title') ?? ''));
    meta.observe(syncTitle);
    // The server writes "locked" into the document when the shader enters or leaves the gallery,
    // so every open editor switches to read-only (or back) at once.
    const syncLock = () => {
      const v = meta.get('locked');
      if (typeof v === 'boolean') setInGallery(v);
    };
    meta.observe(syncLock);
    const provider = new WebsocketProvider(collabUrl(), id, doc);
    sendOnlyLocalAwareness(provider); // don't echo other people's cursors back to the server
    providerRef.current = provider;
    const self = getIdentity();
    provider.awareness.setLocalStateField('user', { name: self.name, color: self.color, colorLight: self.color + '33' });

    if (import.meta.env.DEV) (window as unknown as { __secondPass: unknown }).__secondPass = { doc, provider };
    provider.on('status', (e: { status: Status }) => setStatus(e.status));
    const updatePeers = () => {
      const list: Peer[] = [];
      provider.awareness.getStates().forEach((s, clientId) => {
        if (clientId !== doc.clientID && s.user) list.push({ clientId, ...(s.user as Omit<Peer, 'clientId'>) });
      });
      setPeers(list);
    };
    provider.awareness.on('change', updatePeers);

    // Who joined, who left, who is typing. Names of people present when you arrive aren't announced:
    // only changes after the first couple of seconds are.
    const known = new Map<number, { name: string; color: string; cursor: string }>();
    let settled = false;
    const settleTimer = window.setTimeout(() => { settled = true; }, 2500);
    const toast = (text: string, color: string) => {
      const key = Date.now() + Math.random();
      setToasts((t) => [...t.slice(-3), { key, text, color }]);
      window.setTimeout(() => setToasts((t) => t.filter((x) => x.key !== key)), 3500);
    };
    const onPresence = ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }) => {
      for (const id of [...added, ...updated]) {
        if (id === doc.clientID) continue;
        const s = provider.awareness.getStates().get(id) as { user?: { name: string; color: string }; cursor?: unknown } | undefined;
        if (!s?.user) continue;
        const cursor = JSON.stringify(s.cursor ?? null);
        const before = known.get(id);
        if (!before) { if (settled) toast(`${s.user.name} joined`, s.user.color); }
        else if (before.name !== s.user.name && settled) toast(`${before.name} is now ${s.user.name}`, s.user.color);
        else if (before.cursor !== cursor) showName(s.user.color);
        known.set(id, { name: s.user.name, color: s.user.color, cursor });
      }
      for (const id of removed) {
        const before = known.get(id);
        known.delete(id);
        if (before && settled) toast(`${before.name} left`, before.color);
      }
    };
    provider.awareness.on('change', onPresence);

    // The server is billed for as long as any connection is open, so a tab left in the background
    // lets go of its connection after a few minutes, and reconnects (catching up on edits) when it
    // is looked at again.
    let idleTimer = 0;
    const onVisibility = () => {
      window.clearTimeout(idleTimer);
      if (document.hidden) idleTimer = window.setTimeout(() => provider.disconnect(), 5 * 60_000);
      else provider.connect(); // no-op while still connected
    };
    document.addEventListener('visibilitychange', onVisibility);

    const renderer = new ShaderRenderer(canvasEl.current);
    renderer.startLoop();
    rendererRef.current = renderer;
    setPaused(false);

    // Thumbnails: whoever is typing takes the picture. Several people may have the shader open; only
    // a client that made a local edit since its last upload captures (plus one backfill for shaders
    // that have no thumbnail yet), so watchers don't all upload the same image.
    let editSeq = 0; // local edits so far
    let capturedSeq = 0; // editSeq at the last successful upload
    let compiledOk = false;
    let captureTimer = 0;
    let lastUpload = 0;
    const THUMB_DELAY_MS = 3000; // let the code settle (and the animation run) before capturing
    const THUMB_MIN_GAP_MS = 15_000; // the server also limits writes per shader
    const markEdit = (e: Y.YTextEvent) => {
      if (e.transaction.local) editSeq++; // remote edits arrive with local = false
    };
    ytext.observe(markEdit);
    const scheduleCapture = (delay = THUMB_DELAY_MS) => {
      window.clearTimeout(captureTimer);
      captureTimer = window.setTimeout(capture, Math.max(delay, lastUpload + THUMB_MIN_GAP_MS - Date.now()));
    };
    const capture = async () => {
      if (!compiledOk || (editSeq === capturedSeq && !thumbnailMissing.current)) return;
      const seq = editSeq;
      const blob = await renderer.capture();
      if (!blob) return;
      const res = await fetch(`/api/shaders/${id}/thumbnail`, {
        method: 'PUT',
        headers: { 'Content-Type': blob.type },
        body: blob,
      }).catch(() => null);
      if (res?.status === 204) {
        capturedSeq = seq;
        thumbnailMissing.current = false;
        lastUpload = Date.now();
      } else if (res?.status === 429) {
        // Someone else just uploaded one; try again once the server's window has passed.
        scheduleCapture(Number(res.headers.get('Retry-After') ?? 10) * 1000);
      }
    };
    backfillThumbnail.current = () => scheduleCapture();

    let compileTimer = 0;
    const recompile = () => {
      window.clearTimeout(compileTimer);
      compileTimer = window.setTimeout(() => {
        const errs = renderer.setCode(ytext.toString());
        setErrors(errs);
        compiledOk = errs.length === 0; // never photograph the previous version during an error
        if (compiledOk && (editSeq !== capturedSeq || thumbnailMissing.current)) scheduleCapture();
        // Compile errors become inline diagnostics (red underline + hover message) on their lines.
        const diagnostics: Diagnostic[] = errs.map((e) => {
          const line = view.state.doc.line(Math.min(e.line, view.state.doc.lines));
          return { from: line.from, to: line.to, severity: 'error', message: e.message };
        });
        view.dispatch(setDiagnostics(view.state, diagnostics));
      }, 250); // debounce: don't recompile on every keystroke
    };
    ytext.observe(recompile);

    const undoManager = new Y.UndoManager(ytext);
    const view = new EditorView({
      parent: editorEl.current,
      state: EditorState.create({
        doc: ytext.toString(),
        extensions: [basicSetup, cpp(), editorTheme, yCollab(ytext, provider.awareness, { undoManager }), lockable.of(lockExtensions(lockedRef.current))],
      }),
    });
    viewRef.current = view;
    provider.once('sync', () => {
      recompile();
      syncTitle();
      syncLock();
    });

    return () => {
      window.clearTimeout(compileTimer);
      window.clearTimeout(captureTimer);
      window.clearTimeout(idleTimer);
      document.removeEventListener('visibilitychange', onVisibility);
      window.clearTimeout(settleTimer);
      provider.awareness.off('change', onPresence);
      providerRef.current = null;
      backfillThumbnail.current = null;
      ytext.unobserve(markEdit);
      ytext.unobserve(recompile);
      meta.unobserve(syncTitle);
      meta.unobserve(syncLock);
      viewRef.current = null;
      metaRef.current = null;
      view.destroy();
      rendererRef.current = null;
      renderer.dispose();
      provider.destroy();
      doc.destroy();
    };
  }, [id, notFound]);

  useEffect(() => {
    lockedRef.current = inGallery === true;
    viewRef.current?.dispatch({ effects: lockable.reconfigure(lockExtensions(lockedRef.current)) });
  }, [inGallery]);

  // The clock under the picture: read from the renderer a few times a second, without re-rendering React.
  useEffect(() => {
    const tick = window.setInterval(() => {
      const r = rendererRef.current;
      if (r && clockEl.current) clockEl.current.textContent = `t = ${r.time.toFixed(1)} s`;
    }, 200);
    return () => window.clearInterval(tick);
  }, []);

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === previewEl.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const togglePause = () => {
    const r = rendererRef.current;
    if (!r) return;
    if (r.paused) r.resume();
    else r.pause();
    setPaused(r.paused);
  };
  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void previewEl.current?.requestFullscreen?.().catch(() => {});
  };

  const saveSplit = (v: number) => {
    try { localStorage.setItem(SPLIT_KEY, String(v)); } catch { /* private mode: it lasts for this page */ }
  };
  const moveSplit = (v: number) => {
    const next = Math.round(Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, v)));
    setSplit(next);
    if (rendererRef.current?.paused) requestAnimationFrame(() => rendererRef.current?.refresh());
    return next;
  };
  const dragSplit = (e: React.PointerEvent<HTMLDivElement>) => {
    const box = splitEl.current?.getBoundingClientRect();
    if (!box) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    let last = split;
    const move = (ev: PointerEvent) => { last = moveSplit(((ev.clientX - box.left) / box.width) * 100); };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      saveSplit(last);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const keySplit = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    saveSplit(moveSplit(split + (e.key === 'ArrowLeft' ? -5 : 5)));
  };

  const share = async () => {
    try {
      await navigator.clipboard.writeText(location.href);
      setCopied('ok');
    } catch {
      // No clipboard access (an older browser, or permission denied): show the link to copy by hand.
      window.prompt('Copy this link to share the shader:', location.href);
      return;
    }
    window.setTimeout(() => setCopied('idle'), 2000);
  };

  const saveMe = (next: Identity) => {
    const saved = setIdentity(next);
    setMe(saved);
    providerRef.current?.awareness.setLocalStateField('user', { name: saved.name, color: saved.color, colorLight: saved.color + '33' });
    setYouOpen(false);
  };

  const fork = async () => {
    setForking(true);
    try {
      const res = await fetch(`/api/shaders/${id}/fork`, { method: 'POST' });
      if (res.ok) navigate(`/s/${((await res.json()) as { id: string }).id}`);
    } finally {
      setForking(false);
    }
  };

  // A shader is a draft that only people with its link see until someone adds it to the gallery.
  // The gallery wants a name, so with none yet, point at the title box instead.
  const askForName = () => {
    setNameFirst(true);
    titleEl.current?.focus();
  };
  const addToGallery = async () => {
    if (!title.trim()) return askForName();
    setGalleryBusy(true);
    setGalleryError(null);
    try {
      const res = await fetch(`/api/shaders/${id}/gallery`, { method: 'PUT' }).catch(() => null);
      if (res?.ok) {
        const meta = (await res.json()) as { publishedAt: string | null; ownerKey?: string };
        if (meta.ownerKey) saveOwnerKey(id, meta.ownerKey); // this browser can take it out again
        setInGallery(meta.publishedAt !== null);
      } else if (res?.status === 422) askForName(); // e.g. the title is literally "Untitled"
      else setGalleryError("Couldn't add it to the gallery. Try again in a moment.");
    } finally {
      setGalleryBusy(false);
    }
  };
  const removeFromGallery = async () => {
    const key = removalKey(id);
    setGalleryBusy(true);
    setGalleryError(null);
    try {
      const res = await fetch(`/api/shaders/${id}/gallery`, {
        method: 'DELETE',
        headers: key ? { Authorization: `Bearer ${key}` } : {},
      }).catch(() => null);
      if (res?.ok) {
        forgetOwnerKey(id);
        setInGallery(false);
      } else if (res?.status === 403) setGalleryError('Only the browser that added it to the gallery (or the site owner) can take it out.');
      else setGalleryError("Couldn't take it out of the gallery. Try again in a moment.");
    } finally {
      setGalleryBusy(false);
    }
  };
  const canRemove = inGallery === true && removalKey(id) !== null;

  if (notFound) return <div className="center">Shader not found. <a href="/new">Make a new one</a></div>;

  return (
    <div className="page editor-page">
      <TopBar>
        <div className="title-block">
          <input
            ref={titleEl}
            className={nameFirst ? 'title need' : 'title'}
            disabled={inGallery === true}
            aria-label="Shader title"
            placeholder={nameFirst ? 'Name it first' : 'Untitled'}
            maxLength={TITLE_MAX}
            size={Math.min(28, Math.max(10, (title || 'Untitled').length + 2))}
            value={title}
            onChange={(e) => {
              setNameFirst(false);
              metaRef.current?.set('title', e.target.value);
            }}
          />
          {nameFirst && <span className="hint">Give it a name to add it to the gallery</span>}
        </div>
        {inGallery !== null && <span className={`state-tag${inGallery ? ' gal' : ''}`}>{inGallery ? '✓ In gallery' : 'Draft'}</span>}
        <span className={`live ${status}`}>{status === 'connected' ? 'Live' : status === 'connecting' ? 'Connecting…' : 'Offline'}</span>
        <div className="peers">
          <span className="peer-wrap you-wrap">
            <button className="peer you" style={{ background: me.color }} onClick={() => setYouOpen((o) => !o)} aria-expanded={youOpen} title={`You: ${me.name}. Click to change your name or colour.`}>
              {initials(me.name)}
            </button>
            <span className="you-tag">You</span>
            {youOpen && <YouMenu me={me} onSave={saveMe} onClose={() => setYouOpen(false)} />}
          </span>
          {peers.map((p) => (
            <span key={p.clientId} className="peer-wrap">
              <span className="peer" style={{ background: p.color }} title={p.status ? `${p.name}: ${p.status}` : p.name}>
                {initials(p.name)}
              </span>
              {/* Only bots set a status (the shader agent shows what it is doing); people don't. */}
              {p.status && <span className="peer-status" style={{ borderColor: p.color }}>{p.status}</span>}
            </span>
          ))}
        </div>
        <div className="actions">
          {inGallery === false && (
            <button
              className="secondary"
              onClick={addToGallery}
              disabled={galleryBusy}
              title="Lists it in the gallery and locks it, so it can only be forked. This browser can take it out again."
            >
              Add to gallery
            </button>
          )}
          <button className="secondary" onClick={fork} disabled={forking}>{forking ? 'Forking…' : 'Fork'}</button>
          <button onClick={share} title="Copy the link. Anyone with it can edit.">
            {copied === 'ok' ? 'Link copied ✓' : 'Share'}
          </button>
        </div>
      </TopBar>
      {inGallery && (
        <div className="lock-banner" role="status">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 018 0v3" /></svg>
          {canRemove ? (
            <span><b>In the gallery, so it's locked.</b> Nobody can edit it here, including you. Take it out of the gallery to change it, or fork it.</span>
          ) : (
            <span><b>A gallery piece.</b> Everyone sees the same version, so it can't be edited here. Fork it to make your own copy.</span>
          )}
          {galleryError && <span className="lock-error">{galleryError}</span>}
          {canRemove
            ? <button className="secondary" onClick={removeFromGallery} disabled={galleryBusy}>Remove from gallery</button>
            : <button onClick={fork} disabled={forking}>{forking ? 'Forking…' : 'Fork to edit'}</button>}
        </div>
      )}
      {!inGallery && galleryError && <div className="lock-banner"><span className="lock-error">{galleryError}</span></div>}
      {slow && status !== 'connected' && (
        <div className="lock-banner waking-banner" role="status">
          <span className="spinner" aria-hidden="true" />
          <span>
            <b>{status === 'disconnected' ? 'Reconnecting…' : 'Waking the server…'}</b>{' '}
            The free server sleeps when nobody has used it for a while. Waking it takes up to a minute; the code appears as soon as it's up.
          </span>
        </div>
      )}
      <main className="split" ref={splitEl} style={{ '--split': `${split}%` } as React.CSSProperties}>
        <div className="code-pane">
          <div className="editor" ref={editorEl} />
          <div className="codebar">
            {errors.length > 0
              ? <span className="bad">{errors.length} {errors.length === 1 ? 'error' : 'errors'}</span>
              : <span className="good">✓ Compiled</span>}
            {inGallery && <span>Read-only</span>}
            <span>{peers.length + 1} {peers.length === 0 ? 'person' : 'people'} here</span>
            {forkedFrom && <Link className="forked" to={`/s/${forkedFrom}`}>forked from {forkedFrom}</Link>}
            <button className="ref-toggle" onClick={() => setRefOpen((o) => !o)} aria-expanded={refOpen}>{refOpen ? 'Close reference' : 'Reference'}</button>
          </div>
        </div>
        <div
          className="grip"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize code and picture"
          aria-valuenow={split}
          aria-valuemin={SPLIT_MIN}
          aria-valuemax={SPLIT_MAX}
          tabIndex={0}
          onPointerDown={dragSplit}
          onKeyDown={keySplit}
          onDoubleClick={() => saveSplit(moveSplit(50))}
          title="Drag to resize; double-click to reset"
        ><i /></div>
        <div className="toasts" aria-live="polite">
          {toasts.map((t) => <div key={t.key} className="toast"><i style={{ background: t.color }} />{t.text}</div>)}
        </div>
        <div className="preview" ref={previewEl}>
          <canvas ref={canvasEl} data-testid="preview" />
          <div className="stage-ctl">
            <button onClick={togglePause} aria-pressed={paused}>{paused ? '▶ Play' : '❚❚ Pause'}</button>
            <span ref={clockEl} className="clock">t = 0.0 s</span>
            <button onClick={toggleFullscreen}>{fullscreen ? 'Exit full screen' : '⤢ Full screen'}</button>
          </div>
          {refOpen && <Reference onClose={() => setRefOpen(false)} />}
          {errors.length > 0 && (
            <pre className="errors">{errors.map((e) => `line ${e.line}: ${e.message}`).join('\n')}</pre>
          )}
        </div>
      </main>
    </div>
  );
}

/** The little menu on your own circle: your name and colour, as others see them. */
function YouMenu({ me, onSave, onClose }: { me: Identity; onSave: (id: Identity) => void; onClose: () => void }) {
  const [name, setName] = useState(me.name);
  const [color, setColor] = useState(me.color);
  return (
    <form
      className="you-menu"
      onSubmit={(e) => { e.preventDefault(); onSave({ name, color }); }}
      onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
    >
      <label htmlFor="you-name">Your name, as others see it</label>
      <input id="you-name" autoFocus value={name} maxLength={NAME_MAX} onChange={(e) => setName(e.target.value)} />
      <div className="swatches" role="radiogroup" aria-label="Your colour">
        {COLORS.map((c) => (
          <button type="button" key={c} role="radio" aria-checked={c === color} aria-label={c} className={c === color ? 'on' : ''} style={{ background: c }} onClick={() => setColor(c)} />
        ))}
      </div>
      <div className="you-actions">
        <button type="button" className="secondary" onClick={onClose}>Cancel</button>
        <button type="submit">Save</button>
      </div>
    </form>
  );
}
