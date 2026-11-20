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
import { Link, useNavigate, useParams } from 'react-router-dom';
import { EditorView, basicSetup } from 'codemirror';
import { EditorState } from '@codemirror/state';
import { cpp } from '@codemirror/lang-cpp';

import { ShaderRenderer } from './renderer';
import { lineDiff, planComment } from './agentText';
import { Inline, Prose, plain } from './prose';
import { QUOTES } from './quotes';
import { briefText, type Run, type RunStep } from './agentRun';
import { Missing } from './Missing';
import { duration, modelName, money } from './Runs';
import { TopBar, editorTheme, usePageTitle } from './theme';

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

const shorten = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);

/**
 * The judge's main point about a pass: a hand-picked quote if there is one; else its first bold
 * heading; else, for a pass that didn't make the mark, its first sentence that names a problem;
 * else its first sentence. Long sentences are shortened.
 */
function mainPoint(runId: string, round: number, critique: string, passed: boolean): string {
  const picked = QUOTES[runId]?.[round];
  if (picked) return picked;
  const bold = /\*\*([^*\n]+)\*\*/.exec(critique)?.[1];
  if (bold) return bold.trim();
  const sentences = plain(critique).match(/[^.!?]+[.!?]+/g)?.map((s) => s.trim()) ?? [plain(critique)];
  const critical = !passed && sentences.find((s) => s.length > 30 && /\b(not|no|isn't|doesn't|missing|frozen|barely|lacks?|too|weak|but|however)\b/i.test(s));
  const pick = critical || sentences[0] || '';
  return pick.length > 200 ? pick.slice(0, 197).trimEnd() + '…' : pick;
}

/**
 * Keeps the typing in view by scrolling the code panel only. CodeMirror's own scrollIntoView also
 * scrolls the page, which on a phone (where the code sits below the picture) kept dragging the whole
 * page down to the code while a replay played.
 */
function keepInView(view: EditorView, pos: number) {
  const line = view.lineBlockAt(Math.min(pos, view.state.doc.length));
  const sd = view.scrollDOM;
  const top = line.top, bottom = line.bottom;
  if (top < sd.scrollTop + 24 || bottom > sd.scrollTop + sd.clientHeight - 24) {
    sd.scrollTop = Math.max(0, bottom - sd.clientHeight * 0.6);
  }
}

export function Replay() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [run, setRun] = useState<Run | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cursor, setCursor] = useState(-1); // last step fully shown
  const [active, setActive] = useState<number | null>(null); // step being animated
  const [stage, setStage] = useState<Stage>('idle');
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [scrubbing, setScrubbing] = useState(false); // dragging the playhead along the reel
  const [errors, setErrors] = useState<string[]>([]);
  usePageTitle(error ? 'Not found' : run ? `Run: ${run.title}` : null);

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
    const from = Math.min(at, view.state.doc.length); // never past the end (an edge seen once on a last line)
    view.dispatch({ changes: { from, insert: text }, selection: { anchor: from + text.length } });
    keepInView(view, from + text.length);
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
        view.dispatch({ changes: { from: pos, to: end }, selection: { anchor: pos } });
        keepInView(view, pos);
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
      view.dispatch({ changes: { from: 0, to: keepTop }, selection: { anchor: 0 } });
      keepInView(view, 0);
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

  if (error) return <Missing title="Couldn't load this run" text={`It may have been removed, or the connection dropped (${error}).`}><button onClick={() => navigate('/agent')}>All runs</button></Missing>;
  if (!run) return <div className="center">Loading…</div>;

  const shown = active ?? cursor; // the furthest step on screen, finished or in progress
  const last = run.steps.length - 1;
  const finished = cursor >= last;
  const stopShown = run.steps[last]?.type === 'stop' && shown >= last;
  const current = passes.find((p) => shown >= p.first && shown <= p.last) ?? (stopShown ? passes.at(-1) : undefined);
  const best = run.scores.length ? Math.max(...run.scores) : null;
  const brief = briefText(run.request);

  // The reel: a pass's frames light up once that pass has been rendered.
  const reelPasses = run.reel.map((rp) => ({ rp, pass: passes.find((p) => p.round === rp.round) }));
  const revealed = (p?: Pass) => !!p && p.renderIdx !== null && shown >= p.renderIdx;

  // The playhead's place on the reel. Each judged pass owns an equal stretch of the reel, and the
  // steps of that pass (draft, compile, render, judge) are spread across it, so dragging the playhead
  // moves through the run step by step. The end of the reel is the end of the run.
  const P = Math.max(1, reelPasses.length);
  const posOf = (k: number): number => {
    if (k < 0) return 0;
    const i = reelPasses.findIndex(({ pass }) => pass && k <= pass.last);
    if (i < 0) return 1;
    const pass = reelPasses[i].pass!;
    const f = Math.min(1, Math.max(0, (k - pass.first + 1) / (pass.last - pass.first + 1)));
    return (i + f) / P;
  };
  const stepAt = (x: number): number => {
    if (x >= 0.995) return last;
    const i = Math.min(P - 1, Math.max(0, Math.floor(x * P)));
    const pass = reelPasses[i]?.pass;
    if (!pass) return last;
    const count = pass.last - pass.first + 1;
    return Math.min(pass.last, pass.first - 1 + Math.round((x * P - i) * count));
  };
  const headAt = posOf(shown);
  const scrubTo = (e: { clientX: number }, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (e.clientX - r.left - 12) / Math.max(1, r.width - 24)));
    const k = stepAt(x);
    if (k !== cursorRef.current || playing) seek(k);
  };

  const stageIndex = stage === 'done' ? STAGES.length : STAGES.indexOf(stage as (typeof STAGES)[number]);

  return (
    <div className="page replay">
      <TopBar active="runs">
        <div className="controls">
          <button onClick={() => (playing ? pause() : play())}>{playing ? '❚❚ Pause' : finished ? '↺ Replay' : '▶ Play'}</button>
          <div className="speed" role="radiogroup" aria-label="Speed">
            {[0.5, 1, 2, 4].map((s) => (
              <button key={s} role="radio" aria-checked={speed === s} className={speed === s ? 'on' : ''} onClick={() => setSpeed(s)}>{s}×</button>
            ))}
          </div>
          <button className="secondary" onClick={() => seek(last)} disabled={finished}>Skip to end</button>
          {run.galleryId && <button className="secondary" onClick={() => navigate(`/s/${run.galleryId}`)} title="Open the shader it kept in the editor, to play with or fork">Open in editor</button>}
        </div>
      </TopBar>
      <main>
        <div className="code" ref={editorEl} />
        <div className="side">
          <div className="brief-row">
            {run.sketch && (
              <a className="brief-sketch" href={`/agent-runs/${run.sketch}`} target="_blank" rel="noreferrer" title="The sketch it was given (opens full size)">
                <img src={`/agent-runs/${run.sketch}`} alt="The sketch the agent was given" />
                <span>Sketch</span>
              </a>
            )}
            <span className="lab">{run.sketch ? 'Notes' : 'Brief'}</span>
            <span className={brief.length > 90 ? 'q long' : 'q'}>“{brief}”</span>
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
              <div
                className={`film${scrubbing ? ' scrubbing' : ''}`}
                onPointerDown={(e) => { try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* keeps working without capture */ } setScrubbing(true); scrubTo(e, e.currentTarget); }}
                onPointerMove={(e) => { if (scrubbing) scrubTo(e, e.currentTarget); }}
                onPointerUp={() => setScrubbing(false)}
                onPointerCancel={() => setScrubbing(false)}
                title="Drag along the reel to move through the run"
              >
                <div className="row">
                  {reelPasses.map(({ rp, pass }) => (
                    <div key={rp.round} className="pass-frames">
                      {rp.frames.map((f) => (
                        <figure key={f.t} className={revealed(pass) ? '' : 'dim'}>
                          <img src={`/agent-runs/${f.src}`} alt={`Pass ${rp.round} at ${f.t} seconds`} loading="lazy" />
                          <figcaption>{f.t}s</figcaption>
                        </figure>
                      ))}
                    </div>
                  ))}
                </div>
                <span
                  className="head"
                  role="slider"
                  tabIndex={0}
                  aria-label="Position in the run"
                  aria-valuemin={-1}
                  aria-valuemax={last}
                  aria-valuenow={shown}
                  aria-valuetext={current ? `Pass ${current.round}, ${stage}` : 'Start'}
                  onKeyDown={(e) => {
                    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                      e.preventDefault();
                      seek(Math.min(last, Math.max(-1, cursorRef.current + (e.key === 'ArrowRight' ? 1 : -1))));
                    }
                  }}
                  style={{ left: `calc(12px + (100% - 24px) * ${headAt})` }}
                />
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
          {finished && (() => {
            // Once the replay has finished: the first and the last judged pass side by side.
            const judgedPasses = passes.filter((p) => p.judge);
            const a = judgedPasses[0], b = judgedPasses[judgedPasses.length - 1];
            if (!a || !b || a === b) return null;
            const col = (p: Pass) => (
              <div className="compare-col">
                <div className="compare-top"><span>Pass {p.round}</span><b>{p.judge!.score}<small>/10</small></b></div>
                <div className="film strip4">
                  {(run.reel.find((r) => r.round === p.round)?.frames ?? []).map((f) => (
                    <figure key={f.t}><img src={`/agent-runs/${f.src}`} alt={`Pass ${p.round} at ${f.t} s`} /><figcaption>{f.t} s</figcaption></figure>
                  ))}
                </div>
                <p className="compare-note"><b>Judge:</b> {mainPoint(run.id, p.round, p.judge!.critique, p.judge!.score >= run.passScore)}</p>
              </div>
            );
            return (
              <section className="compare" aria-label="First and last pass compared">
                <h3>Pass {a.round} → pass {b.round}</h3>
                <div className="compare-grid">
                  {col(a)}
                  <div className="compare-mid">
                    <span aria-hidden="true">→</span>
                    {a.judge!.fixes.length > 0 && <><b>It asked for</b><ul>{a.judge!.fixes.slice(0, 2).map((f, i) => <li key={i}>{shorten(plain(f), 110)}</li>)}</ul></>}
                  </div>
                  {col(b)}
                </div>
              </section>
            );
          })()}
        </div>
      </main>
    </div>
  );
}
