// /agent: saved runs of the shader agent, each one replayable. The list is a static file
// (web/public/agent-runs/index.json, written by `npm run export-run` in agent/), so it costs nothing.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { RunSummary } from './agentRun';

export const money = (usd: number) => (usd < 0.01 ? '<$0.01' : `$${usd.toFixed(2)}`);
export const duration = (s: number) => (s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`);
export const modelName = (id: string) => id.replace(/^claude-/, '').replace(/-(\d+)-(\d+)$/, ' $1.$2').replace(/^./, (c) => c.toUpperCase());

export function Runs() {
  const [runs, setRuns] = useState<RunSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/agent-runs/index.json')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setRuns)
      .catch((e: Error) => setError(e.message));
  }, []);

  return (
    <div className="page">
      <header>
        <Link to="/gallery" className="brand">ShaderLab</Link>
        <span className="muted">Agent runs</span>
        <Link to="/gallery" className="header-link" style={{ marginLeft: 'auto' }}>Gallery</Link>
      </header>
      <div className="runs-page">
        <section className="runs-intro">
          <h1>A shader agent that checks its own work</h1>
          <p>
            Give it a request and it writes a shader, compiles it, renders frames, and has a vision model judge
            them against the request. Below the pass mark, it revises using its own frames and the judge's
            critique. These are real runs, replayed step by step.
          </p>
        </section>
        {error && <p className="error-text">Couldn't load the runs ({error}).</p>}
        <div className="gallery runs">
          {runs?.map((r) => (
            <Link key={r.id} to={`/agent/${r.id}`} className="card">
              <div className="thumb"><img src={`/agent-runs/${r.thumb}`} alt="" loading="lazy" /></div>
              <div className="card-title">{r.title}</div>
              <div className="card-meta">“{r.request.replace(/^Make a shader: /, '')}”</div>
              <div className="card-meta run-scores">
                <span className={r.passed ? 'pass' : 'fail'}>{r.scores.join(' → ')}</span>
                {' · '}{r.rounds} {r.rounds === 1 ? 'round' : 'rounds'} · {money(r.costUsd)} · {duration(r.seconds)}
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
