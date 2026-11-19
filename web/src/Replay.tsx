// /agent/:id: plays a saved agent run back. The code types itself into a read-only editor (the plan
// first, as a comment, then the shader; revisions retype only the lines that changed), the preview
// renders it live, and the steps panel shows compile results and the judge's score and critique.
//
// Each step is animated from a known starting point (the code after the previous step), so pausing,
// resuming and jumping to any step always land in a consistent state.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { EditorView, basicSetup } from 'codemirror';
import { EditorState } from '@codemirror/state';
import { cpp } from '@codemirror/lang-cpp';
import { oneDark } from '@codemirror/theme-one-dark';

import { ShaderRenderer } from './renderer';
import { lineDiff, planComment } from './agentText';
import type { Run, RunStep } from './agentRun';
import { duration, modelName, money } from './Runs';

const TICK_MS = 16;
const PAUSE_MS = { compile: 700, render: 900, judge: 4000, stop: 300 }; // reading time at 1x

class Aborted extends Error {}

export function Replay() {
  const { id = '' } = useParams();
  const [run, setRun] = useState<Run | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cursor, setCursor] = useState(-1); // last step fully shown
  const [active, setActive] = useState<number | null>(null); // step being animated
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [errors, setErrors] = useState<string[]>([]);

  const editorEl = useRef<HTMLDivElement>(null);
  const canvasEl = useRef<HTMLCanvasElement>(null);
  const panelEl = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const cursorRef = useRef(-1);
  const speedRef = useRef(1);
  const abortRef = useRef<AbortController | null>(null);
  speedRef.current = speed;

  useEffect(() => {
    setRun(null);
    setError(null);
    fetch(`/agent-runs/${encodeURIComponent(id)}.json`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.status === 404 ? 'no such run' : `HTTP ${r.status}`))))
      .then((r: Run) => setRun(r))
      .catch((e: Error) => setError(e.message));
  }, [id]);

  // Editor (read-only) and live preview. The preview recompiles 250 ms after the code stops changing;
  // half-typed code that doesn't compile just leaves the last working version on screen.
  useEffect(() => {
    if (!run || !editorEl.current || !canvasEl.current) return;
    const renderer = new ShaderRenderer(canvasEl.current);
    renderer.startLoop();
    let timer = 0;
    const view = new EditorView({
      parent: editorEl.current,
      state: EditorState.create({
        doc: '',
        extensions: [basicSetup, cpp(), oneDark, EditorState.readOnly.of(true), EditorView.lineWrapping,
          EditorView.updateListener.of((u) => {
            if (!u.docChanged) return;
            window.clearTimeout(timer);
            timer = window.setTimeout(() => renderer.setCode(u.state.doc.toString()), 250);
          }),
          EditorView.theme({ '&': { height: '100%' }, '.cm-scroller': { fontFamily: 'ui-monospace, Menlo, monospace' } })],
      }),
    });
    viewRef.current = view;
    const start = window.setTimeout(() => play(), 700); // autoplay
    return () => {
      abortRef.current?.abort();
      window.clearTimeout(start);
      window.clearTimeout(timer);
      viewRef.current = null;
      view.destroy();
      renderer.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run]);

  // Keep the newest step in view.
  useEffect(() => {
    panelEl.current?.scrollTo({ top: panelEl.current.scrollHeight, behavior: 'smooth' });
  }, [cursor, active]);

  /** The code on screen after step k (-1 = before the run starts). */
  const codeAfter = useCallback((k: number) => {
    let code = '';
    for (let i = 0; i <= k && run; i++) { const s = run.steps[i]; if (s.type === 'draft') code = s.code; }
    return code;
  }, [run]);

  /** The compile errors on screen after step k: the last compile result since the last draft. */
  const errorsAfter = useCallback((k: number) => {
    let errs: string[] = [];
    for (let i = 0; i <= k && run; i++) {
      const s = run.steps[i];
      if (s.type === 'draft') errs = [];
      if (s.type === 'compile') errs = s.ok ? [] : s.errors;
    }
    return errs;
  }, [run]);

  const sleep = (ms: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(new Aborted());
    const t = window.setTimeout(resolve, ms / speedRef.current);
    signal.addEventListener('abort', () => { window.clearTimeout(t); reject(new Aborted()); }, { once: true });
  });

  const setDoc = (text: string) => {
    const view = viewRef.current;
    if (view) view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
  };

  const insert = (at: number, text: string) => {
    const view = viewRef.current!;
    view.dispatch({ changes: { from: at, insert: text }, selection: { anchor: at + text.length }, scrollIntoView: true });
  };

  /** Types `next` over the current code as a line diff, the way the agent does in a live room. */
  const typeDiff = async (next: string, signal: AbortSignal) => {
    const view = viewRef.current!;
    const withNl = (s: string) => (s.endsWith('\n') ? s : s + '\n');
    const from = withNl(view.state.doc.toString()).split('\n').slice(0, -1);
    const to = withNl(next).split('\n').slice(0, -1);
    let pos = 0;
    for (const op of lineDiff(from, to)) {
      if (op.kind === 'keep') { pos += op.line.length + 1; continue; }
      if (op.kind === 'del') {
        const end = Math.min(pos + op.line.length + 1, view.state.doc.length);
        view.dispatch({ changes: { from: pos, to: end }, selection: { anchor: pos }, scrollIntoView: true });
        await sleep(TICK_MS, signal);
        continue;
      }
      const line = op.line + '\n';
      for (let i = 0; i < line.length; i += 12) {
        const chunk = line.slice(i, i + 12);
        insert(pos, chunk);
        pos += chunk.length;
        await sleep(TICK_MS, signal);
      }
    }
    if (view.state.doc.toString() !== next) setDoc(next);
  };

  const perform = async (s: RunStep, signal: AbortSignal) => {
    switch (s.type) {
      case 'draft': {
        setErrors([]);
        // The plan appears above the current code as a comment, then the code replaces it.
        // Each comment line gets its own empty line first, so a half-typed line never runs into the code.
        let at = 0;
        for (const line of planComment(s.plan).split('\n').slice(0, -1)) {
          insert(at, '\n');
          for (let i = 0; i < line.length; i += 10) {
            insert(at + i, line.slice(i, i + 10));
            await sleep(TICK_MS, signal);
          }
          at += line.length + 1;
        }
        await sleep(600, signal);
        await typeDiff(s.code, signal);
        return;
      }
      case 'compile':
        setErrors(s.ok ? [] : s.errors);
        return sleep(PAUSE_MS.compile, signal);
      case 'render': return sleep(PAUSE_MS.render, signal);
      case 'judge': return sleep(PAUSE_MS.judge, signal);
      case 'stop': return sleep(PAUSE_MS.stop, signal);
    }
  };

  const play = async () => {
    if (!run) return;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    let i = cursorRef.current + 1;
    if (i >= run.steps.length) i = 0; // finished: play again from the start
    // Start the step from a clean state, even if a pause left it half-typed.
    setDoc(codeAfter(i - 1));
    setErrors(errorsAfter(i - 1));
    cursorRef.current = i - 1;
    setCursor(i - 1);
    setPlaying(true);
    try {
      for (; i < run.steps.length; i++) {
        setActive(i);
        await perform(run.steps[i], ac.signal);
        cursorRef.current = i;
        setCursor(i);
      }
      setActive(null);
      setPlaying(false);
    } catch (e) {
      if (!(e instanceof Aborted)) throw e;
    }
  };

  const pause = () => {
    abortRef.current?.abort();
    setPlaying(false);
    setActive(null);
  };

  const seek = (k: number) => {
    pause();
    cursorRef.current = k;
    setCursor(k);
    setDoc(codeAfter(k));
    setErrors(errorsAfter(k));
  };

  if (error) return <div className="center">Couldn't load this run ({error}). <Link to="/agent">All runs</Link></div>;
  if (!run) return <div className="center">Loading…</div>;

  const shown = active ?? cursor;
  const last = run.steps.length - 1;

  return (
    <div className="page replay">
      <header>
        <Link to="/gallery" className="brand">Second Pass</Link>
        <Link to="/agent" className="header-link">Agent runs</Link>
        <span className="replay-title">{run.title}</span>
        <div className="controls">
          <button onClick={() => (playing ? pause() : play())}>{playing ? 'Pause' : cursor >= last ? 'Replay' : 'Play'}</button>
          <button className="secondary" onClick={() => seek(last)} disabled={cursor >= last}>Skip to end</button>
          <select aria-label="Speed" value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
            {[1, 2, 4].map((s) => <option key={s} value={s}>{s}×</option>)}
          </select>
        </div>
      </header>
      <main>
        <div className="editor" ref={editorEl} />
        <div className="replay-side">
          <div className="preview">
            <canvas ref={canvasEl} />
            {codeAfter(cursor) === '' && <div className="preview-note">The preview starts once the first draft is written.</div>}
            {errors.length > 0 && <pre className="errors">{errors.join('\n')}</pre>}
          </div>
          <div className="steps" ref={panelEl}>
            <div className="run-meta">
              <div>“{run.request.replace(/^Make a shader: /, '')}”</div>
              <div>Writer {modelName(run.models.writer)} · judge {modelName(run.models.judge)} · pass mark {run.passScore}/10</div>
            </div>
            {run.steps.slice(0, shown + 1).map((s, i) => (
              <div key={i} className={`step${i === active ? ' active' : ''}`} onClick={() => seek(i)} title="Jump here">
                <StepView step={s} run={run} />
              </div>
            ))}
            {shown < 0 && <p className="muted">Press Play to watch the agent work.</p>}
          </div>
        </div>
      </main>
    </div>
  );
}

function StepView({ step: s, run }: { step: RunStep; run: Run }) {
  switch (s.type) {
    case 'draft':
      return (<>
        <div className="step-head">Round {s.round}: plan and draft<span className="step-cost">{money(s.costUsd)}</span></div>
        <div className="step-body clamp">{s.plan}</div>
      </>);
    case 'compile':
      return s.ok
        ? <div className="step-head ok-text">Compiles</div>
        : (<>
          <div className="step-head error-text">Doesn't compile: {s.errors.length} {s.errors.length === 1 ? 'error' : 'errors'}</div>
          <div className="step-body mono">{s.errors.slice(0, 4).join('\n')}</div>
        </>);
    case 'render':
      return (<div className="step-head">Rendered frames<span className="step-cost">
        motion {s.motion.toFixed(3)}{s.motion < 0.005 ? ' (barely moving)' : ''}
      </span></div>);
    case 'judge':
      return (<>
        <div className="step-head">
          <span className={`score ${s.score >= run.passScore ? 'ok' : 'low'}`}>{s.score}/10</span> Judge
          <span className="step-cost">{money(s.costUsd)}</span>
        </div>
        <div className="step-body">{s.critique}</div>
        {s.score < run.passScore && s.fixes.length > 0 && (
          <ul className="step-body fixes">{s.fixes.map((f, i) => <li key={i}>{f}</li>)}</ul>
        )}
      </>);
    case 'stop':
      return (<div className="step-head summary">
        {run.passed ? `Passed with ${run.scores.at(-1)}/10` : 'Stopped'} after {run.rounds} {run.rounds === 1 ? 'round' : 'rounds'}
        <span className="step-cost">{money(run.costUsd)} · {duration(run.seconds)}</span>
      </div>);
  }
}
