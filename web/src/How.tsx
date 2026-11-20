// /how: how Second Pass is built, written for anyone deciding whether the engineering is any good:
// what was built by hand and what was borrowed, the problems found by measuring, how the agent checks
// itself and how the agent is evaluated, and the tests. The runs list is the static file the Runs page reads.
import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import type { RunSummary } from './agentRun';
import { duration, money } from './Runs';
import { GITHUB_URL, TopBar, usePageTitle } from './theme';

const SECTIONS: [string, string][] = [
  ['built', 'Built by hand'],
  ['measured', 'Found by measuring'],
  ['agent', 'The agent'],
  ['evaluating', 'Evaluating the agent'],
  ['tested', 'Tested'],
];

const STATS: [string, string][] = [
  ['42 ms', 'for an edit to reach everyone else on the live site (median)'],
  ['1,000', 'people editing at once in a load test, on one CPU and 512 MB'],
  ['86', 'automated tests, run against a real Postgres on every pull request'],
  ['15–53¢', 'per agent run, from the brief to a shader that passes its judge'],
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

  return (
    <div className="page how-page">
      <TopBar active="how">
        <a className="gh" href={GITHUB_URL} target="_blank" rel="noreferrer">GitHub</a>
      </TopBar>
      <main className="how-main">
        <header className="how-head">
          <div className="kick">How it's built</div>
          <h1>Built from scratch, then measured</h1>
          <p>
            Second Pass is three hard problems in one app: a code editor many people type into at once, a graphics
            renderer, and an AI agent that grades its own work. Here is what was built by hand, what was borrowed,
            and the numbers behind it.
          </p>
          <div className="how-stats">
            {STATS.map(([big, text]) => <div key={big}><b>{big}</b><span>{text}</span></div>)}
          </div>
          <nav className="how-toc" aria-label="On this page">
            {SECTIONS.map(([id, name]) => <a key={id} href={`#${id}`}>{name}</a>)}
          </nav>
        </header>

        <section id="built" className="how-sec">
          <h2>Built by hand, and what was borrowed</h2>
          <p className="how-lede">The parts that make it work are written from scratch. Libraries do the jobs where a proven one beats a new one.</p>
          <div className="built">
            <div className="built-col">
              <div className="built-k">Built from scratch</div>
              <ul>
                {BUILT.map(([name, what]) => <li key={name}><b>{name}.</b> {what}</li>)}
              </ul>
            </div>
            <div className="built-col borrowed">
              <div className="built-k">Borrowed</div>
              <ul>
                {BORROWED.map(([name, what]) => <li key={name}><b>{name}:</b> {what}</li>)}
              </ul>
            </div>
          </div>
        </section>

        <section id="measured" className="how-sec">
          <h2>Problems found by measuring</h2>
          <p className="how-lede">
            Each of these showed up in a load test, a profile or a failing test, not by guessing. The load test runs
            simulated editors in rooms of 10, each typing five keys a second, against the server limited to one CPU and 512 MB.
          </p>
          <div className="fixes">
            {FIXES.map((f) => (
              <article key={f.title} className="fix">
                <h3>{f.title}</h3>
                <p className="fix-found"><span>Found by</span>{f.found}</p>
                <p>{f.fix}</p>
                <div className="fix-result">{f.result}</div>
              </article>
            ))}
          </div>
          <div className="how-table" role="table" aria-label="Load test, before and after">
            <div role="row" className="ht-head"><span role="columnheader">Editors at once</span><span role="columnheader">Before</span><span role="columnheader">After</span></div>
            {LOAD.map(([n, before, after]) => (
              <div role="row" key={n}><span role="cell">{n}</span><span role="cell">{before}</span><span role="cell"><b>{after}</b></span></div>
            ))}
          </div>
          <p className="how-note">Latency is from a keystroke on one screen to the others. On the live site it is 42 ms for half of all edits and under 114 ms for 95% of them.</p>
        </section>

        <section id="agent" className="how-sec">
          <h2>An agent that checks its own work</h2>
          <p className="how-lede">Code that compiles isn't the goal; a picture that matches the brief is. So the agent looks at what it drew.</p>
          <div className="how" aria-label="How a run works">
            <span>Plan</span><i>→</i><span>Draft</span><i>→</i><span>Compile</span><i>→</i><span>Render</span><i>→</i>
            <span className="judge">Judge</span><i>→</i><span>7+ keep</span><span className="loop">under 7 → another pass ↺</span>
          </div>
          <ul className="how-points">
            <li><b>It sees its output.</b> Frames at 0, 2, 5 and 8 seconds, plus measurements: brightness, contrast, and a motion number that catches a picture that doesn't move. The frames reach 8 seconds because a judge that only saw 3 called a slow-opening flower "nothing happens".</li>
            <li><b>A separate judge.</b> A second call to a vision model scores the frames against the brief out of 10, with a critique and a list of fixes. Under 7, the writer revises with its own frames and the critique.</li>
            <li><b>Guard rails.</b> Up to 3 compile fixes per draft, 4 passes, and a $1 spending cap per run. It always keeps its best-scoring pass, even if a later one scores lower.</li>
            <li><b>It can work beside people.</b> Given an editor link, it joins as a collaborator, types each draft with a visible cursor, and builds on any edits people make while it works.</li>
          </ul>
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
          <p className="how-note">Every run is replayed step by step on the <Link to="/agent">Runs</Link> page: the plan, each draft, the frames and the judge's notes.</p>
        </section>

        <section id="evaluating" className="how-sec">
          <h2>Evaluating the agent</h2>
          <p className="how-lede">An agent that grades itself is only as good as its grader. So the judge gets checked too.</p>
          <div className="evals">
            <article>
              <h3>A benchmark</h3>
              <p>30 briefs (10 easy, 10 medium, 10 hard), each run three ways: one shot, compile fixes only, and the full judge loop. It reports how often each compiles and passes, the mean score, passes used, cost and time, and shows the worst-case cost before spending anything.</p>
            </article>
            <article>
              <h3>Can the judge be trusted?</h3>
              <p>A blind rating page shows the results shuffled, without saying which mode made them, so a person can score them. Then rank correlation (Spearman), the average gap, and agreement on pass or fail (Cohen's kappa) say how far the judge matches a person.</p>
            </article>
            <article>
              <h3>What runs have shown so far</h3>
              <p>A smaller, cheaper model (Haiku) wrote a lava lamp that also reached 7, for $0.05 instead of $0.30. And a fireworks shader passed at exactly 7 while the judge called it dim: the pass mark can let "fine but flat" through.</p>
            </article>
          </div>
        </section>

        <section id="tested" className="how-sec">
          <h2>Tested</h2>
          <p className="how-lede">
            The tests run real collaboration clients against a real server, and the agent's tests render in real Chrome.
            Every pull request runs all 86, a type check and the production build.
          </p>
          <div className="how-table tests" role="table" aria-label="Automated tests by area">
            <div role="row" className="ht-head"><span role="columnheader">Area</span><span role="columnheader">What is tested</span><span role="columnheader">Tests</span></div>
            {TESTS.map(([area, what, n]) => (
              <div role="row" key={area}><span role="cell"><b>{area}</b></span><span role="cell">{what}</span><span role="cell">{n}</span></div>
            ))}
          </div>
        </section>

        <footer className="how-end">
          <a className="btn" href={GITHUB_URL} target="_blank" rel="noreferrer">Read the code on GitHub</a>
          <Link className="btn secondary" to="/agent">Watch a run</Link>
          <span>MIT licence · made by Aarya Rajgor</span>
        </footer>
      </main>
    </div>
  );
}
