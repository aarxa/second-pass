// /agent: saved runs of the shader agent, each one replayable. The list is a static file
// (web/public/agent-runs/index.json, written by `npm run export-run` in agent/), so it costs nothing.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { briefText, type RunSummary } from './agentRun';
import { FadeImg } from './FadeImg';
import { SiteFooter, TopBar, usePageTitle } from './theme';

export const money = (usd: number) => (usd < 0.01 ? '<$0.01' : `$${usd.toFixed(2)}`);
export const duration = (s: number) => (s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`);
export const modelName = (id: string) => id.replace(/^claude-/, '').replace(/-(\d+)-(\d+)$/, ' $1.$2').replace(/^./, (c) => c.toUpperCase());

export function Runs() {
  const [runs, setRuns] = useState<RunSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  usePageTitle('Runs');

  useEffect(() => {
    fetch('/agent-runs/index.json')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setRuns)
      .catch((e: Error) => setError(e.message));
  }, []);

  return (
    <div className="page doc runs-page">
      <TopBar active="runs" />
      <main className="wrap">
      <section className="runs-hero">
        <div className="kick">Agent runs</div>
        <h1>Every run, replayed step by step.</h1>
        <p>
          Real runs of the agent: the plan, each draft, the frames it rendered and what the judge said. It writes a
          GLSL shader, renders frames from 0 to 8 seconds, and a vision model scores them against the brief. Below
          7 out of 10, it revises using the judge's notes and its own frames.
        </p>
        <div className="how" aria-label="How a run works">
          <span>Plan</span><i>→</i><span>Draft</span><i>→</i><span>Compile</span><i>→</i><span>Render</span><i>→</i>
          <span className="judge">Judge</span><i>→</i><span>7+ keep</span><span className="loop">under 7 → another pass ↺</span>
        </div>
      </section>
      {error && <p className="error-text">Couldn't load the runs ({error}).</p>}
      <div className="run-list">
        {runs === null && !error && Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="run-card skeleton" aria-hidden="true"><div className="pic" /><div className="bar t" /><div className="bar" /><div className="bar short" /></div>
        ))}
        {runs?.map((r) => <RunCard key={r.id} r={r} />)}
      </div>
      </main>
      <SiteFooter />
    </div>
  );
}

/** One run on the list: its picture (with the sketch, for a sketch run), the brief and the scores. The frames are in the replay. */
function RunCard({ r }: { r: RunSummary }) {
  return (
    <Link to={`/agent/${r.id}`} className="run-card">
      <div className="pic">
        <FadeImg src={`/agent-runs/${r.thumb}`} alt="" loading="lazy" />
        {r.sketch && <FadeImg className="sketch-inset" src={`/agent-runs/${r.sketch}`} alt="The sketch it was given" loading="lazy" />}
      </div>
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
