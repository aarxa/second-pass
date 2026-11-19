// /agent: saved runs of the shader agent, each one replayable. The list is a static file
// (web/public/agent-runs/index.json, written by `npm run export-run` in agent/), so it costs nothing.
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { briefText, type RunSummary } from './agentRun';
import { TopBar } from './theme';

export const money = (usd: number) => (usd < 0.01 ? '<$0.01' : `$${usd.toFixed(2)}`);
export const duration = (s: number) => (s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`);
export const modelName = (id: string) => id.replace(/^claude-/, '').replace(/-(\d+)-(\d+)$/, ' $1.$2').replace(/^./, (c) => c.toUpperCase());

export function Runs() {
  const navigate = useNavigate();
  const [runs, setRuns] = useState<RunSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/agent-runs/index.json')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setRuns)
      .catch((e: Error) => setError(e.message));
  }, []);

  return (
    <div className="page runs-page">
      <TopBar active="runs">
        <button className="push" onClick={() => navigate('/new')}>New shader</button>
      </TopBar>
      <section className="runs-hero">
        <div className="kick">A shader agent that checks its own work</div>
        <h1>It draws, looks at what it drew, <span>and takes a second pass.</span></h1>
        <p>
          Give it a brief in plain words. It writes a GLSL shader, renders frames from 0 to 8 seconds, and has a
          vision model score them against the brief. Below 7 out of 10, it revises using the judge's notes and its
          own frames. These are real runs, replayed step by step.
        </p>
        <div className="how" aria-label="How a run works">
          <span>Plan</span><i>→</i><span>Draft</span><i>→</i><span>Compile</span><i>→</i><span>Render</span><i>→</i>
          <span className="judge">Judge</span><i>→</i><span>7+ keep</span><span className="loop">under 7 → another pass ↺</span>
        </div>
      </section>
      {error && <p className="error-text" style={{ padding: '0 24px' }}>Couldn't load the runs ({error}).</p>}
      <div className="run-list">
        {runs?.map((r) => <RunCard key={r.id} r={r} />)}
      </div>
    </div>
  );
}

/** One run on the list: its picture (with the sketch, for a sketch run), the final pass's frames, the scores. */
function RunCard({ r }: { r: RunSummary }) {
  const frames = r.finalFrames ?? [];
  return (
    <Link to={`/agent/${r.id}`} className="run-card">
      <div className="pic">
        <img src={`/agent-runs/${r.thumb}`} alt="" loading="lazy" />
        {r.sketch && <img className="sketch-inset" src={`/agent-runs/${r.sketch}`} alt="The sketch it was given" loading="lazy" />}
      </div>
      {frames.length > 0 && (
        <div className="film"><div className="mini-reel">{frames.map((f) => <img key={f} src={`/agent-runs/${f}`} alt="" loading="lazy" />)}</div></div>
      )}
      <div className="t">{r.title}</div>
      <div className="q">{r.sketch && <span className="from-sketch">From a sketch · </span>}“{briefText(r.request)}”</div>
      <div className="row">
        {r.scores.map((s, i) => (
          <span key={i} className={`score-chip${i === r.scores.length - 1 && r.passed ? ' ok' : ''}`}>{s}</span>
        ))}
        <span>{r.rounds} {r.rounds === 1 ? 'pass' : 'passes'} · {money(r.costUsd)} · {duration(r.seconds)} · {modelName(r.models.writer)}</span>
      </div>
    </Link>
  );
}
