// The home page: the work first. A shader the agent wrote runs large at the top, then a short intro,
// the gallery and the agent's recorded runs. Everything on it is static (runs and pictures are files on
// the CDN), so it opens instantly even while the server is asleep.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { briefText, keptCode, type Run, type RunSummary } from './agentRun';
import { FadeImg } from './FadeImg';
import { LiveShader } from './LiveShader';
import { duration, money, RunLog } from './Runs';
import { SiteFooter, TopBar, usePageTitle } from './theme';

// The run shown at the top, and its editable copy in the gallery.
const FEATURE_RUN = 'black-hole';
const FEATURE_SHADER = 'AnQ9yXDA7Q';

// Picks from the gallery, listed here rather than fetched so the home page never waits for the server.
// The featured black hole isn't repeated here.
const PICKS: { id: string; title: string; img: string; run?: string }[] = [
  { id: '7EDz2LxXxw', title: 'Mandelbrot dive', img: '/home/mandelbrot.jpg' },
  { id: 'r2Fc3fmZQL', title: 'Aurora over a lake', img: '/home/aurora.jpg' },
  { id: '4NK9EgiFu5', title: 'Jellyfish in the deep', img: '/agent-runs/jellyfish.jpg', run: 'jellyfish' },
  { id: 'ggberyTHEo', title: 'Synthwave sunset', img: '/agent-runs/synthwave.jpg', run: 'synthwave' },
  { id: 'C4GerRLGai', title: 'Liquid metal', img: '/home/liquid-metal.jpg' },
  { id: 'i8BZVGu2Tp', title: 'Mandala bloom', img: '/home/mandala-bloom.jpg' },
];

export function Home() {
  const [runs, setRuns] = useState<RunSummary[] | null>(null);
  const [feature, setFeature] = useState<Run | null>(null);
  usePageTitle();

  useEffect(() => {
    const get = <T,>(url: string) => fetch(url).then((r) => (r.ok ? (r.json() as Promise<T>) : Promise.reject(new Error(url))));
    get<RunSummary[]>('/agent-runs/index.json').then(setRuns).catch(() => setRuns([]));
    get<Run>(`/agent-runs/${FEATURE_RUN}.json`).then(setFeature).catch(() => {});
  }, []);

  const byRun = new Map((runs ?? []).map((r) => [r.id, r]));
  const summary = byRun.get(FEATURE_RUN);

  return (
    <div className="page doc home">
      <TopBar />
      <main className="wrap">
        <h1 className="visually-hidden">Second Pass</h1>

        <section className="feature" aria-label="Featured shader">
          <LiveShader code={feature ? keptCode(feature) : null} still={`/agent-runs/${FEATURE_RUN}.jpg`} label="Black hole, a shader written by the agent, running live" />
          <div className="feature-info">
            <div className="feature-text">
              <h2>{feature?.title ?? 'Black hole'}</h2>
              <p>
                By the agent, from the brief “{feature ? briefText(feature.request) : 'a black hole with a blazing accretion disk'}”
                {summary && <span className="feature-meta"> · Judged {summary.scores[summary.scores.length - 1]}/10 · {money(summary.costUsd)} · {duration(summary.seconds)}</span>}
              </p>
            </div>
            <div className="feature-actions">
              <Link className="btn" to={`/agent/${FEATURE_RUN}`}>Watch the run</Link>
              <Link className="btn ghost" to={`/s/${FEATURE_SHADER}`}>Open in editor</Link>
            </div>
          </div>
        </section>

        <section className="intro">
          <p>
            <b>Second Pass</b> is a GLSL editor you share with a link. Everyone edits the same code at once, and the
            picture updates as you type. You can also give the agent a brief: it renders what it wrote, has a vision
            model judge the frames, and revises until they pass.
          </p>
          <div className="intro-actions">
            <Link className="btn" to="/new">New shader</Link>
            <Link className="btn secondary" to="/how">How it works</Link>
          </div>
        </section>

        <section className="shelf" aria-labelledby="h-gallery">
          <div className="shelf-head">
            <h2 id="h-gallery">Gallery</h2>
            <Link to="/gallery">View all</Link>
          </div>
          <div className="tiles">
            {PICKS.map((p) => {
              const run = p.run ? byRun.get(p.run) : undefined;
              return (
                <Link key={p.id} to={`/s/${p.id}`} className="tile">
                  <FadeImg src={p.img} alt="" loading="lazy" />
                  <span className="tile-row">
                    <span className="tile-title">{p.title}</span>
                    {p.run && <span className="tile-by">Agent{run ? ` · ${run.scores[run.scores.length - 1]}/10` : ''}</span>}
                  </span>
                </Link>
              );
            })}
          </div>
        </section>

        <section className="shelf" aria-labelledby="h-runs">
          <div className="shelf-head">
            <h2 id="h-runs">Agent runs</h2>
            <Link to="/agent">View all</Link>
          </div>
          <p className="shelf-note">Every run is recorded: the plan, each draft, the frames it rendered and what the judge said. Under 7 out of 10, it takes another pass.</p>
          <RunLog runs={runs} />
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
