// /agent/:id: plays a saved agent run back.
//
// Left: the code types itself in (the plan first, as a comment, then the shader; a revision retypes
// only the lines that changed). Right: the brief, the live preview with the six stages on it, the
// film reel (every judged pass's frames, with a playhead: the reel is the run's progress bar), and one
// note per pass that reads top to bottom: what it tried, what the judge saw, and the rule it applied.
//
// Each step is animated from a known starting point (the code after the previous step), so pausing,
// resuming and jumping to any step always land in a consistent state.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { EditorView, basicSetup } from 'codemirror';
import { EditorState } from '@codemirror/state';
import { cpp } from '@codemirror/lang-cpp';

import { ShaderRenderer } from './renderer';
import { lineDiff, planComment } from './agentText';
import { Inline, Prose, plain } from './prose';
import type { Run, RunStep } from './agentRun';
import { duration, modelName, money } from './Runs';
import { TopBar, editorTheme } from './theme';

const TICK_MS = 16;
const PAUSE_MS = { compile: 700, render: 1100, judge: 2200, decide: 2400, stop: 300 }; // reading time at 1x
const STAGES = ['plan', 'draft', 'compile', 'render', 'judge', 'decide'] as const;
type Stage = (typeof STAGES)[number] | 'idle' | 'done';
const DOING: Record<Stage, string> = {
  idle: 'Waiting…', plan: 'Planning…', draft: 'Writing the shader…', compile: 'Compiling…',
  render: 'Rendering frames…', judge: 'Judging…', decide: 'Deciding…', done: '',
};

class Aborted extends Error {}

/** Everything that happened in one round, with the step indexes the page needs. */
interface Pass {
  round: number;
  first: number;
  last: number;
  plan: string;
  drafts: number;
  costUsd: number;
  renderIdx: number | null;
  judgeIdx: number | null;
  judge: Extract<RunStep, { type: 'judge' }> | null;
}

function passesOf(run: Run): Pass[] {
  const byRound = new Map<number, Pass>();
  run.steps.forEach((s, i) => {
    if (s.type === 'stop') return;
    let p = byRound.get(s.round);
    if (!p) { p = { round: s.round, first: i, last: i, plan: '', drafts: 0, costUsd: 0, renderIdx: null, judgeIdx: null, judge: null }; byRound.set(s.round, p); }
    p.last = i;
    if (s.type === 'draft') { p.plan = s.plan; p.drafts++; p.costUsd += s.costUsd; }
    if (s.type === 'render') p.renderIdx = i;
    if (s.type === 'judge') { p.judgeIdx = i; p.judge = s; p.costUsd += s.costUsd; }
  });
  return [...byRound.values()];
}

/** The stage a step ends in, for when the page lands on it without animating (seek, pause). */
function stageAt(s: RunStep | undefined): Stage {
  if (!s) return 'idle';
  if (s.type === 'judge') return 'decide';
  if (s.type === 'stop') return 'done';
  return s.type;
}

export function Replay() {
  const { id = '' } = useParams();
  const [run, setRun] = useState<Run | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cursor, setCursor] = useState(-1); // last step fully shown
  const [active, setActive] = useState<number | null>(null); // step being animated
  const [stage, setStage] = useState<Stage>('idle');
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [errors, setErrors] = useState<string[]>([]);

  const editorEl = useRef<HTMLDivElement>(null);
  const canvasEl = useRef<HTMLCanvasElement>(null);
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
      .then((r: Run) => setRun({ ...r, reel: r.reel ?? [] }))
      .catch((e: Error) => setError(e.message));
  }, [id]);

  const passes = useMemo(() => (run ? passesOf(run) : []), [run]);

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
        extensions: [basicSetup, cpp(), editorTheme, EditorState.readOnly.of(true), EditorView.lineWrapping,
          EditorView.updateListener.of((u) => {
            if (!u.docChanged) return;
            window.clearTimeout(timer);
            timer = window.setTimeout(() => renderer.setCode(u.state.doc.toString()), 250);
          })],
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

  /**
   * Types `next` over the current code as a line diff, the way the agent does in a live room. The
   * first `keepTop` characters (the plan comment) stay on top while the code is typed beneath them,
   * and are removed at the end. Each new line is opened before it's typed, so a half-typed line
   * never runs into the line after it.
   */
  const typeDiff = async (next: string, signal: AbortSignal, keepTop = 0) => {
    const view = viewRef.current!;
    const withNl = (s: string) => (s.endsWith('\n') ? s : s + '\n');
    const from = withNl(view.state.doc.sliceString(keepTop)).split('\n').slice(0, -1);
    const to = withNl(next).split('\n').slice(0, -1);
    let pos = keepTop;
    for (const op of lineDiff(from, to)) {
      // (the last line may have no newline of its own, so never step past the end of the document)
      if (op.kind === 'keep') { pos = Math.min(pos + op.line.length + 1, view.state.doc.length); continue; }
      if (op.kind === 'del') {
        const end = Math.min(pos + op.line.length + 1, view.state.doc.length);
        view.dispatch({ changes: { from: pos, to: end }, selection: { anchor: pos }, scrollIntoView: true });
        await sleep(TICK_MS, signal);
        continue;
      }
      insert(pos, '\n');
      for (let i = 0; i < op.line.length; i += 12) {
        const chunk = op.line.slice(i, i + 12);
        insert(pos + i, chunk);
        await sleep(TICK_MS, signal);
      }
      pos += op.line.length + 1;
    }
    if (keepTop) {
      await sleep(300, signal);
      view.dispatch({ changes: { from: 0, to: keepTop }, selection: { anchor: 0 }, scrollIntoView: true });
    }
    if (view.state.doc.toString() !== next) setDoc(next);
  };

  const perform = async (s: RunStep, signal: AbortSignal) => {
    switch (s.type) {
      case 'draft': {
        setErrors([]);
        setStage('plan');
        // Each plan line gets its own empty line first, so a half-typed line never runs into the code.
        let at = 0;
        for (const line of planComment(s.plan).split('\n').slice(0, -1)) {
          insert(at, '\n');
          for (let i = 0; i < line.length; i += 10) {
            insert(at + i, line.slice(i, i + 10));
            await sleep(TICK_MS, signal);
          }
          at += line.length + 1;
        }
        await sleep(500, signal);
        setStage('draft');
        await typeDiff(s.code, signal, at);
        return;
      }
      case 'compile':
        setStage('compile');
        setErrors(s.ok ? [] : s.errors);
        return sleep(PAUSE_MS.compile, signal);
      case 'render':
        setStage('render');
        return sleep(PAUSE_MS.render, signal);
      case 'judge':
        setStage('judge');
        await sleep(PAUSE_MS.judge, signal);
        setStage('decide');
        return sleep(PAUSE_MS.decide, signal);
      case 'stop':
        setStage('done');
        return sleep(PAUSE_MS.stop, signal);
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
      if (e instanceof Aborted) return;
      // Something unexpected: show the finished run rather than a half-typed one.
      console.error('replay failed, jumping to the end', e);
      seek(run.steps.length - 1);
    }
  };

  const pause = () => {
    abortRef.current?.abort();
    setPlaying(false);
    setActive(null);
    setStage(stageAt(run?.steps[cursorRef.current]));
  };

  const seek = (k: number) => {
    abortRef.current?.abort();
    setPlaying(false);
    setActive(null);
    cursorRef.current = k;
    setCursor(k);
    setDoc(codeAfter(k));
    setErrors(errorsAfter(k));
    setStage(stageAt(run?.steps[k]));
  };

  if (error) return <div className="center">Couldn't load this run ({error}). <Link to="/agent">All runs</Link></div>;
  if (!run) return <div className="center">Loading…</div>;

  const shown = active ?? cursor; // the furthest step on screen, finished or in progress
  const last = run.steps.length - 1;
  const finished = cursor >= last;
  const stopShown = run.steps[last]?.type === 'stop' && shown >= last;
  const current = passes.find((p) => shown >= p.first && shown <= p.last) ?? (stopShown ? passes.at(-1) : undefined);
  const best = run.scores.length ? Math.max(...run.scores) : null;
  const brief = run.request.replace(/^Make a shader: /, '');

  // The reel: a pass's frames light up once that pass has been rendered; the playhead sits after them.
  const reelPasses = run.reel.map((rp) => ({ rp, pass: passes.find((p) => p.round === rp.round) }));
  const revealed = (p?: Pass) => !!p && p.renderIdx !== null && shown >= p.renderIdx;
  const totalFrames = run.reel.reduce((n, rp) => n + rp.frames.length, 0) || 1;
  const shownFrames = reelPasses.reduce((n, { rp, pass }) => n + (revealed(pass) ? rp.frames.length : 0), 0);
  const headAt = shownFrames / totalFrames;

  const stageIndex = stage === 'done' ? STAGES.length : STAGES.indexOf(stage as (typeof STAGES)[number]);

  return (
    <div className="page replay">
      <TopBar active="runs">
        <div className="controls">
          <button onClick={() => (playing ? pause() : play())}>{playing ? '❚❚ Pause' : finished ? '↺ Replay' : '▶ Play'}</button>
          <select aria-label="Speed" value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
            {[1, 2, 4].map((s) => <option key={s} value={s}>{s}×</option>)}
          </select>
          <button className="secondary" onClick={() => seek(last)} disabled={finished}>Skip to end</button>
        </div>
      </TopBar>
      <main>
        <div className="code" ref={editorEl} />
        <div className="side">
          <div className="brief-row">
            <span className="lab">Brief</span>
            <span className="q">“{brief}”</span>
            <span className="meta">{modelName(run.models.writer)} writes · {modelName(run.models.judge)} judges · pass mark {run.passScore}</span>
          </div>

          <div className="stage-wrap">
            <canvas ref={canvasEl} />
            {codeAfter(cursor) === '' && active === null && <div className="note">Press Play to watch the agent work.</div>}
            {current && <span className="tag"><i />Pass {current.round} · live preview</span>}
            <div className="stages" aria-label="Where the agent is">
              {STAGES.map((s, i) => <span key={s} className={i === stageIndex ? 'now' : i < stageIndex ? 'done' : ''}>{s}</span>)}
            </div>
            {errors.length > 0 && <pre className="errors">{errors.join('\n')}</pre>}
          </div>

          {run.reel.length > 0 && (
            <div className="reel">
              <div className="film">
                <div className="row">
                  {reelPasses.map(({ rp, pass }) => (
                    <div key={rp.round} className="pass-frames" onClick={() => pass && seek(pass.last)} title={`Jump to pass ${rp.round}`}>
                      {rp.frames.map((f) => (
                        <figure key={f.t} className={revealed(pass) ? '' : 'dim'}>
                          <img src={`/agent-runs/${f.src}`} alt={`Pass ${rp.round} at ${f.t} seconds`} loading="lazy" />
                          <figcaption>{f.t}s</figcaption>
                        </figure>
                      ))}
                    </div>
                  ))}
                </div>
                <span className="head" style={{ left: `calc(12px + (100% - 24px) * ${headAt})` }} />
              </div>
              <div className="labels">
                {reelPasses.map(({ rp, pass }) => {
                  const judged = pass?.judgeIdx != null && shown >= pass.judgeIdx;
                  const ok = judged && pass!.judge!.score >= run.passScore;
                  return (
                    <div key={rp.round}>
                      <span className="lab">Pass {rp.round}</span>
                      {judged ? <span className="score">{pass!.judge!.score}<small>/10</small></span> : <span className="lab">…</span>}
                      {judged && <span className={`verdict ${ok ? 'ok' : 'rev'}`}>{ok ? 'Kept' : 'Another pass'}</span>}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="notes">
            {passes.filter((p) => shown >= p.first).map((p) => {
              const judged = p.judgeIdx !== null && shown >= p.judgeIdx;
              const decided = judged && (shown > p.judgeIdx! || stage !== 'judge');
              const score = p.judge?.score ?? 0;
              const ok = score >= run.passScore;
              const isLast = p === passes.at(-1);
              return (
                <div key={p.round} className={`pnote${current === p ? ' active' : ''}`} onClick={() => seek(p.last)}>
                  <h6><span>Pass {p.round}</span><span>{money(p.costUsd)}</span></h6>
                  <div className="tried"><b>What it tried</b><span>{plain(p.plan)}</span></div>
                  {p.drafts > 1 && <div className="errs">Fixed compiler errors {p.drafts - 1} {p.drafts === 2 ? 'time' : 'times'} first</div>}
                  {judged ? (<>
                    <span className="saw">What the judge saw · frames 0–8 s</span>
                    <Prose text={p.judge!.critique} className="prose" />
                    {!ok && p.judge!.fixes.length > 0 && (
                      <>
                        <span className="saw">What it asked for</span>
                        <ul>{p.judge!.fixes.slice(0, 3).map((f, i) => <li key={i}><Inline text={f} /></li>)}</ul>
                      </>
                    )}
                  </>) : (
                    <span className="waiting">{current === p ? DOING[stage] : 'Not judged'}</span>
                  )}
                  {decided && (
                    <div className="rule">
                      <b>{score} {ok ? '≥' : '<'} {run.passScore}</b> →
                      <span className={`verdict ${ok ? 'ok' : 'rev'}`} style={{ marginLeft: 0 }}>
                        {ok ? (isLast && stopShown ? 'Keep · done' : 'Keep') : isLast && stopShown ? 'Out of passes' : 'Another pass'}
                      </span>
                      {isLast && stopShown && <span className="total">{run.rounds} {run.rounds === 1 ? 'pass' : 'passes'} · {money(run.costUsd)} · {duration(run.seconds)}{!run.passed && best !== null ? ` · best kept: ${best}/10` : ''}</span>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </main>
    </div>
  );
}
