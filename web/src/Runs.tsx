// /agent: saved runs of the shader agent, each one replayable. The list is a static file
// (web/public/agent-runs/index.json, written by `npm run export-run` in agent/), so it costs nothing.
// The list itself (RunLog) is shared with the home page.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { briefText, type RunSummary } from './agentRun';
import { FadeImg } from './FadeImg';
import { SiteFooter, TopBar, usePageTitle } from './theme';

export const money = (usd: number) => (usd < 0.01 ? '<$0.01' : `$${usd.toFixed(2)}`);
export const duration = (s: number) => (s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`);
export const modelName = (id: string) => id.replace(/^claude-/, '').replace(/-(\d+)-(\d+)$/, ' $1.$2').replace(/^./, (c) => c.toUpperCase());
const passes = (n: number) => `${n} ${n === 1 ? 'pass' : 'passes'}`;
const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

/** The judge's scores pass by pass, "6 → 8/10", the last one (the kept pass) in bold. */
export function Scores({ scores }: { scores: number[] }) {
  return (
    <span className="scores" aria-label={`Judge's score${scores.length > 1 ? 's by pass' : ''}: ${scores.join(', then ')} out of 10`}>
      {scores.map((s, i) => (
        <span key={i}>{i > 0 && <i aria-hidden="true">→</i>}{i === scores.length - 1 ? <><b>{s}</b>/10</> : s}</span>
      ))}
    </span>
  );
}

/**
 * The agent's runs as a list, like a log: the picture (and the sketch, for a sketch run), the title and
 * brief, the scores pass by pass, then passes, cost and time. `detailed` (the Runs page) shows the whole
 * brief, the models and the date; the home page keeps each row to two lines.
 */
export function RunLog({ runs, detailed = false }: { runs: RunSummary[] | null; detailed?: boolean }) {
  return (
    <ol className={`runlog${detailed ? ' detailed' : ''}`} aria-busy={runs === null}>
      {runs === null && Array.from({ length: 6 }, (_, i) => (
        <li key={i} className="runlog-line skeleton" aria-hidden="true"><span className="rl-pics"><i /></span><span className="rl-main"><i /><i /></span></li>
      ))}
      {runs?.map((r) => (
        <li key={r.id}>
          <Link to={`/agent/${r.id}`} className="runlog-line">
            <span className="rl-pics">
              <FadeImg src={`/agent-runs/${r.thumb}`} alt="" loading="lazy" />
              {r.sketch && <FadeImg className="rl-sketch" src={`/agent-runs/${r.sketch}`} alt="" loading="lazy" title="The sketch it was given" />}
            </span>
            <span className="rl-main">
              <span className="rl-title">{r.title}</span>
              <span className="rl-brief">{r.sketch ? 'From a watercolour sketch: ' : ''}“{briefText(r.request)}”</span>
              {detailed && <span className="rl-sub">{modelName(r.models.writer)} wrote it, {modelName(r.models.judge)} judged it · {day(r.date)}</span>}
            </span>
            <Scores scores={r.scores} />
            <span className="rl-meta">{passes(r.rounds)} · {money(r.costUsd)} · {duration(r.seconds)}</span>
          </Link>
        </li>
      ))}
    </ol>
  );
}

export function Runs() {
  const [runs, setRuns] = useState<RunSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  usePageTitle('Agent runs');

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
        <header className="page-head">
          <h1>Agent runs</h1>
          <p>
            Each run starts from a brief. The agent writes a GLSL shader, renders frames at 0, 2, 5 and 8 seconds, and
            a vision model scores them out of 10 against the brief. Under 7, it revises using the judge's notes and its
            own frames. Open a run to replay it step by step.
          </p>
        </header>
        {error ? <p className="error-text">Couldn't load the runs ({error}).</p> : <RunLog runs={runs} detailed />}
      </main>
      <SiteFooter />
    </div>
  );
}
