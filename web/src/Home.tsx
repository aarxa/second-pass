// The home page: what Second Pass is, shown with real runs. Everything on it is static (runs and
// pictures are files on the CDN), so it opens instantly even while the server is asleep.
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { keptCode, type Run, type RunSummary } from './agentRun';
import { ShaderRenderer } from './renderer';
import { duration, money } from './Runs';
import { plain } from './prose';
import { GITHUB_URL, TopBar } from './theme';

// The runs the page features. If one is missing from the list, the page falls back to others.
const HERO_RUN = 'black-hole';
const LOOP_RUN = 'synthwave';
// Short excerpts of the judge's critique for the featured run (the full text is in its replay).
const QUOTES: Record<string, Record<number, string>> = {
  synthwave: {
    1: "The grid's horizontal lines sit at exactly the same screen positions at 0s, 2s, 5s and 8s … from these frames it looks frozen.",
    2: 'This is a clear synthwave sunset. The striped yellow-to-pink sun sinks steadily across the frames.',
  },
};
const firstSentence = (s: string) => { const t = plain(s); return (t.match(/^.*?[.!?](\s|$)/)?.[0] ?? t).trim(); };

// Picks from the gallery, listed here rather than fetched so the home page never waits for the server.
const PICKS: { id: string; title: string; img: string; run?: string }[] = [
  { id: 'AnQ9yXDA7Q', title: 'Black hole', img: '/agent-runs/black-hole.jpg', run: 'black-hole' },
  { id: '7EDz2LxXxw', title: 'Mandelbrot dive', img: '/home/mandelbrot.jpg' },
  { id: 'r2Fc3fmZQL', title: 'Aurora over a lake', img: '/home/aurora.jpg' },
  { id: '4NK9EgiFu5', title: 'Jellyfish in the deep', img: '/agent-runs/jellyfish.jpg', run: 'jellyfish' },
  { id: 'C4GerRLGai', title: 'Liquid metal', img: '/home/liquid-metal.jpg' },
];

// The little shader in "Make one together": a sun that sets and rises over a calm sea.
const SNIPPET = `void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = (fragCoord - 0.5 * iResolution.xy) / iResolution.y;
  float y = 0.06 + 0.13 * sin(iTime * 0.6);   // sets and rises
  float sun = smoothstep(0.17, 0.16, length(uv - vec2(0.0, y)));
  vec3 sky = mix(vec3(1.0, 0.5, 0.35), vec3(0.3, 0.06, 0.45), uv.y + 0.5);
  vec3 col = mix(sky, vec3(1.0, 0.86, 0.35), sun);
  if (uv.y < -0.1) col = sky * (0.3 + 0.1 * sin(uv.y * 90.0 + iTime));
  fragColor = vec4(col, 1.0);
}`;
const SNIPPET_CURSORS: Record<number, [string, string]> = { 3: ['Quiet Fox', '#f97316'], 6: ['Neon Koi', '#3b82f6'] };

/** A shader running live on the page, over a still picture of it (shown until it compiles, or if it can't). */
function LiveShader({ code, still, label }: { code: string | null; still?: string; label: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [running, setRunning] = useState(false);
  useEffect(() => {
    const el = canvas.current;
    if (!code || !el) return;
    let r: ShaderRenderer;
    try {
      r = new ShaderRenderer(el, { maxDpr: 1.5 });
    } catch {
      return; // no WebGL2: the still picture stays
    }
    if (r.setCode(code).length) {
      r.dispose();
      return;
    }
    setRunning(true);
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    r.startLoop();
    if (reduce) r.pause();
    // Animate only while it is on screen, so a long page doesn't keep the graphics card busy.
    const io = new IntersectionObserver(([e]) => {
      if (reduce) return;
      if (e.isIntersecting) r.resume();
      else r.pause();
    });
    io.observe(el);
    return () => {
      io.disconnect();
      r.dispose();
    };
  }, [code]);
  return (
    <div className="live-shader" style={still ? { backgroundImage: `url(${still})` } : undefined}>
      <canvas ref={canvas} role="img" aria-label={label} style={{ opacity: running ? 1 : 0 }} />
    </div>
  );
}

/** GLSL with a little colour, for the static code illustration. */
function Code({ src, cursors }: { src: string; cursors: Record<number, [string, string]> }) {
  const KW = /\b(float|vec2|vec3|vec4|void|if|out|in)\b/g;
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const html = src.split('\n').map((line, i) => {
    const [, code = '', comment = ''] = line.match(/^(.*?)(\/\/.*)?$/) ?? [];
    const body = esc(code)
      .replace(/(\d+\.\d*|\b\d+\b)/g, '<span class="cn">$1</span>')
      .replace(KW, '<span class="ck">$1</span>')
      .replace(/\b([a-zA-Z_]\w*)(?=\()/g, (all, name) => (name === 'span' ? all : `<span class="cf">${name}</span>`));
    const c = cursors[i + 1];
    const caret = c ? `<span class="caret" style="--c:${c[1]}"><i>${c[0]}</i></span>` : '';
    return `<div><b>${i + 1}</b><span>${body}${comment ? `<span class="cc">${esc(comment)}</span>` : ''}${caret}</span></div>`;
  });
  return <pre className="mini-code" aria-hidden="true" dangerouslySetInnerHTML={{ __html: html.join('') }} />;
}

export function Home() {
  const navigate = useNavigate();
  const [runs, setRuns] = useState<RunSummary[] | null>(null);
  const [hero, setHero] = useState<Run | null>(null);
  const [loop, setLoop] = useState<Run | null>(null);

  useEffect(() => {
    const get = <T,>(url: string) => fetch(url).then((r) => (r.ok ? (r.json() as Promise<T>) : Promise.reject(new Error(url))));
    get<RunSummary[]>('/agent-runs/index.json')
      .then((list) => {
        setRuns(list);
        const heroId = list.some((r) => r.id === HERO_RUN) ? HERO_RUN : list[0]?.id;
        const loopId = list.some((r) => r.id === LOOP_RUN) ? LOOP_RUN : list.find((r) => r.rounds > 1)?.id;
        if (heroId) get<Run>(`/agent-runs/${heroId}.json`).then(setHero).catch(() => {});
        if (loopId) get<Run>(`/agent-runs/${loopId}.json`).then(setLoop).catch(() => {});
      })
      .catch(() => setRuns([]));
  }, []);

  const final = hero ? hero.scores[hero.scores.length - 1] : null;
  const judged = loop
    ? loop.steps.flatMap((s) => (s.type === 'judge' ? [s] : []))
    : [];
  const shown = judged.length > 2 ? [judged[0], judged[judged.length - 1]] : judged;

  return (
    <div className="home">
      <TopBar active="home">
        <a className="gh" href={GITHUB_URL} target="_blank" rel="noreferrer">GitHub</a>
        <button onClick={() => navigate('/new')}>New shader</button>
      </TopBar>
      <main>
        <section className="hero">
          <div className="hero-text">
            <div className="kick">A shader playground with an AI that checks its own work</div>
            <h1>It draws, looks at what it drew, and takes a <em>second pass.</em></h1>
            <p>
              Write GLSL shaders with friends in one shared editor, live. Or give the agent a brief and watch it
              render its own frames, have them judged, and revise until they pass.
            </p>
            <div className="cta">
              <button onClick={() => navigate(`/agent/${loop?.id ?? LOOP_RUN}`)}>Watch a run</button>
              <button className="secondary" onClick={() => navigate('/new')}>Open the editor</button>
            </div>
            <div className="proof">
              <span><b>{final !== null ? `${final}/10` : '·'}</b>judge's score</span>
              <span><b>{hero ? money(hero.costUsd) : '·'}</b>for the whole run</span>
              <span><b>42 ms</b>edit to every screen</span>
            </div>
          </div>
          <div className="film hero-film">
            <LiveShader code={hero ? keptCode(hero) : null} still={`/agent-runs/${HERO_RUN}.jpg`} label={hero?.title ?? 'A shader written by the agent'} />
            <span className="onair">Live in your browser</span>
            {hero && (
              <>
                <div className="hero-brief"><span className="lab">The brief</span><span className="q">“{hero.request.replace(/^Make a shader: /, '')}”</span></div>
                <Link to={`/agent/${hero.id}`} className="judge-badge">Judge <b>{final}</b>/10 · {hero.passed ? 'kept' : 'best kept'}</Link>
              </>
            )}
          </div>
        </section>

        {loop && shown.length > 0 && (
          <section className="home-sec" id="how">
            <div className="sec-head">
              <h2>Watch it take a second pass</h2>
              <Link to={`/agent/${loop.id}`}>Play the full replay →</Link>
            </div>
            <p className="sec-lede">“{loop.request.replace(/^Make a shader: /, '')}”</p>
            <div className={`pass-pair${shown.length === 1 ? ' one' : ''}`}>
              {shown.map((j, i) => {
                const keep = j.score >= loop.passScore;
                const frames = loop.reel.find((p) => p.round === j.round)?.frames ?? [];
                return (
                  <div key={j.round} className="pass-card-wrap">
                    {i === 1 && (
                      <div className="pass-arrow" aria-hidden="true">
                        <span>→</span>
                        {judged.length > 2 ? `${judged.length - 2} more passes` : 'critique and frames go back to the writer'}
                      </div>
                    )}
                    <article className="pass-card">
                      <div className="pass-top">
                        <span className="n">Pass {j.round}</span>
                        <span className="sc">{j.score}<small>/10</small></span>
                        <span className={`vd${keep ? ' keep' : ''}`}>{keep ? 'Keep' : 'Another pass'}</span>
                      </div>
                      <div className="film strip4">
                        {frames.map((f) => (
                          <figure key={f.t}><img src={`/agent-runs/${f.src}`} alt={`Pass ${j.round} at ${f.t} s`} loading="lazy" /><figcaption>{f.t} s</figcaption></figure>
                        ))}
                      </div>
                      <p className="quote"><b>Judge:</b> “{QUOTES[loop.id]?.[j.round] ?? firstSentence(j.critique)}”</p>
                    </article>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        <section className="home-sec">
          <div className="sec-head"><h2>Two ways in</h2></div>
          <div className="ways">
            <article className="way">
              <h3>Make one together</h3>
              <p>Open the editor and share the link. Everyone types into the same code at once and sees each other's cursors. The picture updates as you type.</p>
              <div className="mini-editor">
                <LiveShader code={SNIPPET} label="A sun setting and rising over the sea" />
                <Code src={SNIPPET} cursors={SNIPPET_CURSORS} />
              </div>
              <div><button onClick={() => navigate('/new')}>New shader</button></div>
            </article>
            <article className="way">
              <h3>Watch the agent work</h3>
              <p>Every run is recorded and replayed step by step: the plan, each draft, the frames it rendered and what the judge said. Watching costs nothing.</p>
              <div className="run-rows">
                {(runs ?? []).slice(0, 3).map((r) => (
                  <Link key={r.id} to={`/agent/${r.id}`} className="run-row">
                    <img src={`/agent-runs/${r.thumb}`} alt="" loading="lazy" />
                    <div><div className="tt">{r.title}</div><div className="meta">{r.rounds} {r.rounds === 1 ? 'pass' : 'passes'} · {money(r.costUsd)} · {duration(r.seconds)}</div></div>
                    <div className="chips">{r.scores.map((s, i) => <span key={i} className={`score-chip${i === r.scores.length - 1 && r.passed ? ' ok' : ''}`}>{s}</span>)}</div>
                  </Link>
                ))}
              </div>
              <div><button className="secondary" onClick={() => navigate('/agent')}>All runs</button></div>
            </article>
          </div>
        </section>

        <section className="home-sec">
          <div className="sec-head"><h2>From the gallery</h2><Link to="/gallery">See the gallery →</Link></div>
          <div className="picks">
            {PICKS.map((p) => (
              <div key={p.id} className="pick">
                <Link to={`/s/${p.id}`}><img src={p.img} alt="" loading="lazy" /></Link>
                <div className="pick-title">
                  <Link to={`/s/${p.id}`}>{p.title}</Link>
                  {p.run && <Link to={`/agent/${p.run}`} className="tag" title="Written by the agent: watch the run">Agent</Link>}
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>
      <footer className="home-foot">
        <span>Second Pass · made by Aarya Rajgor</span>
        <a href={GITHUB_URL} target="_blank" rel="noreferrer">GitHub</a>
        <Link to="/agent">Runs</Link>
        <Link to="/gallery">Gallery</Link>
      </footer>
    </div>
  );
}
