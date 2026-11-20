// The home page: what Second Pass is, shown with real runs. Everything on it is static (runs and
// pictures are files on the CDN), so it opens instantly even while the server is asleep.
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { briefText, keptCode, type Run, type RunSummary } from './agentRun';
import { FadeImg } from './FadeImg';
import { LiveShader } from './LiveShader';
import { duration, money } from './Runs';
import { plain } from './prose';
import { QUOTES } from './quotes';
import { SiteFooter, TopBar, usePageTitle } from './theme';

// The runs the page features. If one is missing from the list, the page falls back to others.
const HERO_RUN = 'black-hole';
const LOOP_RUN = 'synthwave';
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
// "Under the hood": the numbers behind it, each linking to its part of /how.
const HOOD = [
  { k: 'Live sync', big: '42 ms', text: 'for an edit to reach everyone else in the room, measured on the live site', to: 'measured' },
  { k: 'Load test', big: '1,000', text: 'people editing at once on one CPU and 512 MB, each typing five keys a second', to: 'measured' },
  { k: 'Renderer', big: 'WebGL2', text: 'written by hand, with no graphics library; compile errors land on the right line', to: 'built' },
  { k: 'Agent', big: '4 frames', text: 'rendered on every pass and scored against the brief by a vision model', to: 'agent' },
];
const SNIPPET_CURSORS: Record<number, [string, string]> = { 3: ['Quiet Fox', '#f97316'], 6: ['Neon Koi', '#3b82f6'] };

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
  const [sketchRun, setSketchRun] = useState<Run | null>(null);
  usePageTitle();

  useEffect(() => {
    const get = <T,>(url: string) => fetch(url).then((r) => (r.ok ? (r.json() as Promise<T>) : Promise.reject(new Error(url))));
    get<RunSummary[]>('/agent-runs/index.json')
      .then((list) => {
        setRuns(list);
        const heroId = list.some((r) => r.id === HERO_RUN) ? HERO_RUN : list[0]?.id;
        const loopId = list.some((r) => r.id === LOOP_RUN) ? LOOP_RUN : list.find((r) => r.rounds > 1)?.id;
        if (heroId) get<Run>(`/agent-runs/${heroId}.json`).then(setHero).catch(() => {});
        if (loopId) get<Run>(`/agent-runs/${loopId}.json`).then(setLoop).catch(() => {});
        // The newest run that started from a sketch, for "From a sketch".
        const sketchId = list.find((r) => r.sketch)?.id;
        if (sketchId) get<Run>(`/agent-runs/${sketchId}.json`).then(setSketchRun).catch(() => {});
      })
      .catch(() => setRuns([]));
  }, []);

  const final = hero ? hero.scores[hero.scores.length - 1] : null;
  const judged = loop
    ? loop.steps.flatMap((s) => (s.type === 'judge' ? [s] : []))
    : [];
  const shown = judged.length > 2 ? [judged[0], judged[judged.length - 1]] : judged;

  return (
    <div className="page doc home">
      <TopBar />
      <main className="wrap">
        <section className="hero">
          <div className="hero-text">
            <div className="kick">A shader playground with an AI that checks its own work</div>
            <h1>It draws, looks at what it drew, and takes a <em>second pass.</em></h1>
            <p>
              Write GLSL shaders with friends in one shared editor, live. Or give the agent a brief, or a sketch,
              and watch it render its own frames, have them judged, and revise until they pass.
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
                <div className="hero-brief"><span className="lab">The brief</span><span className="q">“{briefText(hero.request)}”</span></div>
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
            <p className="sec-lede">“{briefText(loop.request)}”</p>
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

        {sketchRun?.sketch && (
          <section className="home-sec">
            <div className="sec-head">
              <h2>From a sketch</h2>
              <Link to={`/agent/${sketchRun.id}`}>Watch it happen →</Link>
            </div>
            <p className="sec-lede">A watercolour from my art portfolio, given to the agent with a two-line note.</p>
            <div className="sketch-pair">
              <figure className="sketch-paper">
                <img src={`/agent-runs/${sketchRun.sketch}`} alt="The watercolour the agent was given: an apple and cut kiwis on a white cloth" loading="lazy" />
                <figcaption>The painting</figcaption>
              </figure>
              <div className="sketch-arrow" aria-hidden="true">
                <span>→</span>
                {sketchRun.rounds} {sketchRun.rounds === 1 ? 'pass' : 'passes'} · {sketchRun.scores[sketchRun.scores.length - 1]}/10 · {money(sketchRun.costUsd)}
              </div>
              <figure className="sketch-live">
                <div className="film">
                  <LiveShader code={keptCode(sketchRun)} still={`/agent-runs/${sketchRun.thumb}`} label={`${sketchRun.title}, the agent's shader`} />
                </div>
                <figcaption>Its shader, running live in your browser</figcaption>
              </figure>
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
                <div className="thumb-wrap">
                  <Link to={`/s/${p.id}`}><FadeImg src={p.img} alt="" loading="lazy" /></Link>
                  {p.run && <Link to={`/agent/${p.run}`} className="agent-badge" title="Written by the agent: watch the run">By the agent</Link>}
                </div>
                <div className="pick-title"><Link to={`/s/${p.id}`}>{p.title}</Link></div>
              </div>
            ))}
          </div>
        </section>

        <section className="home-sec">
          <div className="sec-head"><h2>Under the hood</h2><Link to="/how">How it's built →</Link></div>
          <p className="sec-lede">Built from the ground up, and measured on the live site and in load tests.</p>
          <div className="hood">
            {HOOD.map((h) => (
              <Link key={h.k} to={`/how#${h.to}`} className="hood-tile">
                <span className="k">{h.k}</span>
                <b>{h.big}</b>
                <span className="d">{h.text}</span>
              </Link>
            ))}
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
