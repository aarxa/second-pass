// /how: how Second Pass is built, for anyone curious (and anyone hiring). The editor, the renderer and the
// agent, then the measurements and the hosting. Everything on it is static apart from the runs list,
// which is the same static file the Runs page reads.
import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import type { RunSummary } from './agentRun';
import { duration, money } from './Runs';
import { GITHUB_URL, TopBar, usePageTitle } from './theme';

const SECTIONS: [string, string][] = [
  ['editor', 'The shared editor'],
  ['renderer', 'The renderer'],
  ['agent', 'The agent'],
  ['measured', 'Measured and tested'],
  ['hosting', 'Hosting'],
];

const LOAD: [string, string, string][] = [
  ['250', 'p99 31 ms, CPU 70%', 'p99 2.3 ms, CPU 24%'],
  ['500', 'p99 3,294 ms, event loop 2.4 s behind', 'p99 20 ms, CPU 50%'],
  ['1,000', 'p99 3,746 ms, 178 connections failed', 'p99 168 ms, CPU 88%'],
  ['2,000 offered', 'out of memory, crashed', '1,000 admitted at p99 142 ms; the rest told to retry'],
];

/** A box in a diagram: a title and what it holds. */
function Box({ title, sub, items }: { title: string; sub: string; items: string[] }) {
  return (
    <div className="arch-box">
      <div className="ab-t">{title}</div>
      <div className="ab-s">{sub}</div>
      <ul>{items.map((i) => <li key={i}>{i}</li>)}</ul>
    </div>
  );
}
function Wire({ label }: { label: string }) {
  return <div className="arch-wire" aria-hidden="true"><span>⇄</span>{label}</div>;
}

export function HowItWorks() {
  usePageTitle('How it works');
  const { hash } = useLocation();
  const [runs, setRuns] = useState<RunSummary[] | null>(null);

  useEffect(() => {
    fetch('/agent-runs/index.json')
      .then((r) => (r.ok ? (r.json() as Promise<RunSummary[]>) : []))
      .then(setRuns)
      .catch(() => setRuns([]));
  }, []);

  // Links like /how#agent: the router doesn't scroll to the section by itself.
  useEffect(() => {
    if (hash) document.getElementById(hash.slice(1))?.scrollIntoView();
    else window.scrollTo(0, 0);
  }, [hash]);

  const costs = (runs ?? []).map((r) => r.costUsd);

  return (
    <div className="page how-page">
      <TopBar active="how">
        <a className="gh" href={GITHUB_URL} target="_blank" rel="noreferrer">GitHub</a>
      </TopBar>
      <main className="how-main">
        <header className="how-head">
          <div className="kick">How it works</div>
          <h1>How Second Pass is built</h1>
          <p>
            Three pieces: an editor that many people type into at once, a renderer that draws the shader in your
            browser, and an agent that writes shaders and checks its own work. All of it is open source.
          </p>
          <nav className="how-toc" aria-label="On this page">
            {SECTIONS.map(([id, name]) => <a key={id} href={`#${id}`}>{name}</a>)}
          </nav>
        </header>

        <section id="editor" className="how-sec">
          <h2>The shared editor</h2>
          <p className="how-lede">Open a link and you are in the same code as everyone else who has it, live, like a shared doc.</p>
          <div className="arch">
            <Box title="Each browser" sub="React" items={['CodeMirror editor', 'A copy of the document (Yjs)', 'WebGL2 renderer']} />
            <Wire label="WebSocket: edits and cursors" />
            <Box title="Server" sub="Node, Fastify" items={['One room per shader', 'Passes edits to everyone', 'Saves at most once a second']} />
            <Wire label="snapshots" />
            <Box title="Database" sub="Postgres" items={['One row per shader', 'Compact snapshots', 'Gallery and owner keys']} />
          </div>
          <ul className="how-points">
            <li><b>No locks, no conflicts.</b> Edits merge through a CRDT (Yjs): two people typing on the same line both keep their changes, in the same order on every screen.</li>
            <li><b>The sync server is written by hand.</b> It speaks the Yjs wire protocol directly, holds back messages that arrive while a room is still loading, and lets a room go once everyone has left.</li>
            <li><b>Presence.</b> Everyone gets an anonymous name and a colour. Cursors show the name for a few seconds after someone types.</li>
            <li><b>Gallery pieces are locked on the server,</b> not just in the page: edits to them are dropped. There are no accounts; the browser that added a piece keeps a random key, and the server keeps only its hash.</li>
            <li><b>When the database fails,</b> edits stay in memory and the save is retried. A room that can't load asks the browser to reconnect, and creating shaders is rate-limited.</li>
          </ul>
        </section>

        <section id="renderer" className="how-sec">
          <h2>The renderer</h2>
          <p className="how-lede">The picture is drawn on your own graphics card, with plain WebGL2 and no graphics library.</p>
          <ul className="how-points">
            <li><b>Shadertoy-style shaders.</b> You write <code>mainImage</code>, which runs once for every pixel, and get <code>iTime</code>, <code>iResolution</code> and <code>iMouse</code>.</li>
            <li><b>It recompiles 250 ms after you stop typing.</b> If the new code doesn't compile, the last working version keeps running.</li>
            <li><b>Errors land on the right line.</b> The graphics driver's error log is read and turned into red underlines on the lines it means. Click an error to jump to it.</li>
            <li><b>Thumbnails come from the live picture.</b> A few seconds after a successful compile, the editor photographs the preview and uploads it. The server checks the real file type, size and an upload rate.</li>
          </ul>
        </section>

        <section id="agent" className="how-sec">
          <h2>The agent</h2>
          <p className="how-lede">Give it a brief in plain words, or a sketch. It doesn't stop at code that compiles: it looks at what it drew.</p>
          <div className="how" aria-label="How a run works">
            <span>Plan</span><i>→</i><span>Draft</span><i>→</i><span>Compile</span><i>→</i><span>Render</span><i>→</i>
            <span className="judge">Judge</span><i>→</i><span>7+ keep</span><span className="loop">under 7 → another pass ↺</span>
          </div>
          <ol className="how-steps">
            <li><b>Plan and draft.</b> Opus 5.5 reads the brief (and the sketch, if there is one), picks a technique, and writes a complete shader.</li>
            <li><b>Compile.</b> In headless Chrome, with the same wrapper the editor uses. Compile errors go straight back to it to fix.</li>
            <li><b>Render.</b> Frames at 0, 2, 5 and 8 seconds, so it can see the motion as well as the picture.</li>
            <li><b>Judge.</b> A vision model compares the frames with the brief and scores them out of 10, with notes.</li>
            <li><b>Keep or revise.</b> 7 or more keeps it. Under 7, it revises, seeing its own frames and the judge's notes, for up to four passes.</li>
          </ol>
          <div className="how-runs">
            <div className="hr-row hr-head"><span>Run</span><span>Scores</span><span>Cost</span><span>Time</span></div>
            {(runs ?? []).map((r) => (
              <Link key={r.id} to={`/agent/${r.id}`} className="hr-row">
                <span className="hr-t"><img src={`/agent-runs/${r.thumb}`} alt="" loading="lazy" />{r.title}</span>
                <span className="chips">{r.scores.map((s, i) => <span key={i} className={`score-chip${i === r.scores.length - 1 && r.passed ? ' ok' : ''}`}>{s}</span>)}</span>
                <span>{money(r.costUsd)}</span>
                <span>{duration(r.seconds)}</span>
              </Link>
            ))}
          </div>
          <p className="how-note">Each run is recorded and replayed step by step on the <Link to="/agent">Runs</Link> page. The replays are static files, so watching costs nothing.</p>
        </section>

        <section id="measured" className="how-sec">
          <h2>Measured and tested</h2>
          <div className="how-stats">
            <div><b>42 ms</b><span>for an edit to reach everyone else on the live site (median; 114 ms at the 95th percentile)</span></div>
            <div><b>1,000</b><span>people editing at once in a load test, on one CPU and 512 MB, at p99 168 ms</span></div>
          </div>
          <p className="how-lede">The load test: simulated editors in rooms of 10, each typing five keys a second and moving the cursor. Latency is from an edit on one screen to the others.</p>
          <div className="how-table" role="table" aria-label="Load test, before and after">
            <div role="row" className="ht-head"><span role="columnheader">Editors at once</span><span role="columnheader">Before</span><span role="columnheader">After</span></div>
            {LOAD.map(([n, before, after]) => (
              <div role="row" key={n}><span role="cell">{n}</span><span role="cell">{before}</span><span role="cell"><b>{after}</b></span></div>
            ))}
          </div>
          <ul className="how-points">
            <li><b>Cursor echo.</b> The stock client re-sent every cursor update it received: 11 messages per keystroke in a room of 10. Now it sends only its own: 2.</li>
            <li><b>Batched writes.</b> A CPU profile showed 80% of the time spent in system calls. Each socket now gets one write per batch instead of one per message.</li>
            <li><b>Saying no early.</b> Past capacity, the server turns new connections away straight away instead of slowing everyone down until it runs out of memory.</li>
            <li><b>Tests with real clients.</b> The tests run real collaboration clients against a real server, including slow database loads and people leaving mid-load. Every pull request runs the type checker, the tests against Postgres, the agent's tests in headless Chrome, and the production build.</li>
          </ul>
        </section>

        <section id="hosting" className="how-sec">
          <h2>Hosting</h2>
          <p className="how-lede">
            It costs nothing a month to keep online.
            {costs.length > 0 && <> The agent's runs so far cost {money(Math.min(...costs))} to {money(Math.max(...costs))} each.</>}
          </p>
          <div className="arch">
            <Box title="Netlify" sub="static files" items={['Every page', 'Runs and replays', 'Pictures']} />
            <Wire label="/api and live edits" />
            <Box title="Render" sub="the server" items={['Free plan', 'Sleeps when quiet', 'Wakes in under a minute']} />
            <Wire label="SQL" />
            <Box title="Neon" sub="Postgres" items={['Every shader', 'The gallery']} />
          </div>
          <p className="how-note">That's why pages, runs and replays open instantly while the editor sometimes says it is waking the server.</p>
        </section>

        <footer className="how-end">
          <a className="btn" href={GITHUB_URL} target="_blank" rel="noreferrer">Read the code on GitHub</a>
          <Link className="btn secondary" to="/new">Try the editor</Link>
          <span>MIT licence · made by Aarya Rajgor</span>
        </footer>
      </main>
    </div>
  );
}
