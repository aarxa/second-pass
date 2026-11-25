// /how: how Second Pass is built, as a plain write-up for anyone deciding whether the engineering is any
// good: what was built by hand and what was borrowed, the problems found by measuring, how the agent checks
// itself and how it is evaluated, and the tests. The runs table reads the static file the Runs page reads.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { RunSummary } from './agentRun';
import { duration, money, Scores } from './Runs';
import { SiteFooter, TopBar, usePageTitle } from './theme';

const SECTIONS: [string, string][] = [
  ['built', 'Built by hand'],
  ['measured', 'Found by measuring'],
  ['agent', 'The agent'],
  ['evaluating', 'Evaluating the agent'],
  ['tested', 'Tested'],
];

const BUILT: [string, string][] = [
  ['The sync server', 'Speaks the Yjs wire protocol directly: rooms, presence, saving, heartbeats, admission control and rate limits.'],
  ['The renderer', 'Plain WebGL2, no graphics library. Turns the graphics driver\'s error log into underlines on the right lines.'],
  ['The agent loop', 'No agent framework. Writing, compile fixes, rendering in headless Chrome, a vision judge, and keeping the best pass.'],
  ['The replay player', 'Every run is recorded as steps and played back with a timeline you can scrub.'],
  ['The evaluation tools', 'A benchmark, a blind rating page and the statistics that check the judge against a person.'],
  ['Gallery locking without accounts', 'A random owner key stays in the browser; the server keeps only its hash and drops edits to locked pieces.'],
  ['The load-test harness', 'Simulated editors that type and move cursors, plus Prometheus metrics to see where the time goes.'],
];

const BORROWED: [string, string][] = [
  ['Yjs', 'the CRDT that merges edits; the server around it is custom'],
  ['CodeMirror 6', 'the text editor'],
  ['React, Fastify, Postgres', 'the page, the HTTP server and the database'],
  ['Opus 5.5', 'writes the shaders and judges the frames'],
  ['Playwright', 'drives headless Chrome for the agent and the tests'],
];

/** Problems found by measuring: what was wrong, how it showed up, the fix, and what it changed. */
const FIXES: { title: string; found: string; fix: string; result: string }[] = [
  {
    title: 'Every keystroke sent 11 messages',
    found: 'Counting messages per keystroke in a room of 10.',
    fix: 'The stock client re-sent every cursor update it received, so traffic grew with the square of the room. Each client now sends only its own.',
    result: '2 messages per keystroke; p99 at 250 editors 31 → 5.5 ms',
  },
  {
    title: '80% of the CPU went on system calls',
    found: 'A CPU profile: 80% in socket writes, 1% in merging edits.',
    fix: 'Writes are batched per turn of the event loop: one system call per socket per batch, not one per message.',
    result: 'p99 at 500 editors: 2,048 → 20 ms',
  },
  {
    title: 'Out of memory at 2,000 editors',
    found: 'The load test crashed the server.',
    fix: 'Admission control: past capacity, new connections are turned away at once with Retry-After, instead of everyone slowing down.',
    result: '1,000 served at p99 142 ms; the rest retry',
  },
  {
    title: 'The last second of edits lost on redeploy',
    found: 'Every deploy while anyone was connected ended with the process killed (exit code 137).',
    fix: 'A silent connection kept shutdown waiting forever. A ping/pong heartbeat now drops dead connections, and every open room is saved before the server exits.',
    result: 'Clean shutdowns, every room saved',
  },
  {
    title: 'A database blip could break a room',
    found: 'Tests with a database that fails on purpose.',
    fix: 'Failed saves keep the edits and retry; a room that fails to load asks the browser to reconnect; an outage at connect time is a 503.',
    result: 'The server stays up and loses nothing',
  },
];

const LOAD: [string, string, string][] = [
  ['250', 'p99 31 ms, CPU 70%', 'p99 2.3 ms, CPU 24%'],
  ['500', 'p99 3,294 ms', 'p99 20 ms, CPU 50%'],
  ['1,000', 'p99 3,746 ms, 178 failed', 'p99 168 ms, CPU 88%'],
  ['2,000', 'out of memory', '1,000 let in at p99 142 ms'],
];

const TESTS: [string, string, number][] = [
  ['Collaboration', 'Two-client sync, simultaneous edits merging, saving after everyone leaves, presence cleanup, messages that arrive while a room loads', 10],
  ['Connections', 'Heartbeat, slow readers, the connection limit, saving on shutdown', 6],
  ['Titles, forks, gallery', 'Title rules, forking unsaved edits, drafts versus the gallery, pagination without repeats', 16],
  ['Gallery locks', 'Locked pieces drop edits; only the owner key or the admin key takes one out', 5],
  ['Failures and limits', 'Saves and loads that fail, an unreachable database, creation rate limits', 7],
  ['Postgres', 'Saving and loading, migrations, gallery order with tied timestamps, index use', 7],
  ['Thumbnails', 'Real file-type checks, caching, upload rate', 10],
  ['The agent', 'The loop and its stop rules, judge-agreement maths, retries, rendering in real Chrome, joining a live room', 25],
];

export function HowItWorks() {
  usePageTitle('How it works');
  const [runs, setRuns] = useState<RunSummary[] | null>(null);

  useEffect(() => {
    fetch('/agent-runs/index.json')
      .then((r) => (r.ok ? (r.json() as Promise<RunSummary[]>) : []))
      .then(setRuns)
      .catch(() => setRuns([]));
  }, []);

  return (
    <div className="page doc how-page">
      <TopBar active="how" />
      <main className="wrap doc-layout">
        <nav className="doc-toc" aria-label="On this page">
          <span>On this page</span>
          {SECTIONS.map(([id, name]) => <a key={id} href={`#${id}`}>{name}</a>)}
        </nav>

        <article className="doc-body">
          <header className="page-head">
            <h1>How it works</h1>
            <p>
              Second Pass is three problems in one app: a code editor many people type into at once, a graphics
              renderer, and an AI agent that grades its own work. This page covers what was built by hand and what was
              borrowed, the problems found by measuring, how the agent checks itself, and the tests.
            </p>
            <p>
              On the live site an edit reaches everyone else in 42 ms (the median). In a load test, 1,000 people edited at
              once on one CPU and 512 MB. All 86 automated tests run against a real Postgres on every pull request, and an
              agent run costs 15 to 53 cents, from the brief to a shader that passes its judge.
            </p>
          </header>

          <section id="built">
            <h2>Built by hand, and borrowed</h2>
            <p>The parts that make it work are written from scratch. Libraries do the jobs where a proven one beats a new one.</p>
            <h3>Written from scratch</h3>
            <ul>{BUILT.map(([name, what]) => <li key={name}><b>{name}.</b> {what}</li>)}</ul>
            <h3>Borrowed</h3>
            <ul>{BORROWED.map(([name, what]) => <li key={name}><b>{name}:</b> {what}</li>)}</ul>
          </section>

          <section id="measured">
            <h2>Problems found by measuring</h2>
            <p>
              Each of these showed up in a load test, a profile or a failing test, not by guessing. The load test runs
              simulated editors in rooms of 10, each typing five keys a second, against the server limited to one CPU and 512 MB.
            </p>
            {FIXES.map((f) => (
              <div key={f.title} className="fix">
                <h3>{f.title}</h3>
                <dl>
                  <dt>Found by</dt><dd>{f.found}</dd>
                  <dt>Fix</dt><dd>{f.fix}</dd>
                  <dt>Result</dt><dd>{f.result}</dd>
                </dl>
              </div>
            ))}
            <table className="doc-table">
              <caption>Load test, before and after</caption>
              <thead><tr><th scope="col">Editors at once</th><th scope="col">Before</th><th scope="col">After</th></tr></thead>
              <tbody>{LOAD.map(([n, before, after]) => <tr key={n}><td>{n}</td><td>{before}</td><td>{after}</td></tr>)}</tbody>
            </table>
            <p className="doc-note">Latency is from a keystroke on one screen to the others. On the live site it is 42 ms for half of all edits and under 114 ms for 95% of them.</p>
          </section>

          <section id="agent">
            <h2>An agent that checks its own work</h2>
            <p>
              Code that compiles isn't the goal; a picture that matches the brief is. So the agent looks at what it drew.
              Each pass it plans, drafts, compiles, renders and is judged. A score of 7 or more keeps the pass; under 7, it
              takes another.
            </p>
            <ul>
              <li><b>It sees its output.</b> Frames at 0, 2, 5 and 8 seconds, plus measurements: brightness, contrast, and a motion number that catches a picture that doesn't move. The frames reach 8 seconds because a judge that only saw 3 called a slow-opening flower "nothing happens".</li>
              <li><b>A separate judge.</b> A second call to a vision model scores the frames against the brief out of 10, with a critique and a list of fixes. Under 7, the writer revises with its own frames and the critique.</li>
              <li><b>Guard rails.</b> Up to 3 compile fixes per draft, 4 passes, and a $1 spending cap per run. It always keeps its best-scoring pass, even if a later one scores lower.</li>
              <li><b>It can work beside people.</b> Given an editor link, it joins as a collaborator, types each draft with a visible cursor, and builds on any edits people make while it works.</li>
            </ul>
            <table className="doc-table runs-table">
              <caption>The recorded runs</caption>
              <thead><tr><th scope="col">Run</th><th scope="col">Scores</th><th scope="col">Cost</th><th scope="col">Time</th></tr></thead>
              <tbody>
                {(runs ?? []).map((r) => (
                  <tr key={r.id}>
                    <td><Link to={`/agent/${r.id}`}>{r.title}</Link></td>
                    <td><Scores scores={r.scores} /></td>
                    <td>{money(r.costUsd)}</td>
                    <td>{duration(r.seconds)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="doc-note">Every run can be replayed step by step on the <Link to="/agent">Agent runs</Link> page: the plan, each draft, the frames and the judge's notes.</p>
          </section>

          <section id="evaluating">
            <h2>Evaluating the agent</h2>
            <p>An agent that grades itself is only as good as its grader. So the judge gets checked too.</p>
            <h3>A benchmark</h3>
            <p>30 briefs (10 easy, 10 medium, 10 hard), each run three ways: one shot, compile fixes only, and the full judge loop. It reports how often each compiles and passes, the mean score, passes used, cost and time, and shows the worst-case cost before spending anything.</p>
            <h3>Can the judge be trusted?</h3>
            <p>A blind rating page shows the results shuffled, without saying which mode made them, so a person can score them. Then rank correlation (Spearman), the average gap, and agreement on pass or fail (Cohen's kappa) say how far the judge matches a person.</p>
            <h3>What runs have shown so far</h3>
            <p>A smaller, cheaper model (Haiku) wrote a lava lamp that also reached 7, for $0.05 instead of $0.30. And a fireworks shader passed at exactly 7 while the judge called it dim: the pass mark can let "fine but flat" through.</p>
          </section>

          <section id="tested">
            <h2>Tested</h2>
            <p>
              The tests run real collaboration clients against a real server, and the agent's tests render in real Chrome.
              Every pull request runs all 86, a type check and the production build.
            </p>
            <table className="doc-table">
              <caption>Automated tests by area</caption>
              <thead><tr><th scope="col">Area</th><th scope="col">What is tested</th><th scope="col" className="num">Tests</th></tr></thead>
              <tbody>{TESTS.map(([area, what, n]) => <tr key={area}><td><b>{area}</b></td><td>{what}</td><td className="num">{n}</td></tr>)}</tbody>
            </table>
          </section>

          <footer className="doc-end">
            <Link className="btn" to="/agent">Watch a run</Link>
            <Link className="btn secondary" to="/new">New shader</Link>
          </footer>
        </article>
      </main>
      <SiteFooter />
    </div>
  );
}
