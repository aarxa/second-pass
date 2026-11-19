// The reference panel beside the picture: what a shader is given, small recipes (each running live),
// and the handy functions drawn as tiny graphs. "Insert" puts a snippet into the code at the cursor.
import { useState } from 'react';
import { LiveShader } from './LiveShader';

type Tab = 'inputs' | 'recipes' | 'functions';

interface Input {
  name: string;
  type: string;
  what: string;
  example: string;
}

const INPUTS: Input[] = [
  {
    name: 'mainImage',
    type: 'function',
    what: 'Runs once for every pixel, many times a second. Read the pixel’s position from fragCoord; write its colour to fragColor (red, green, blue, alpha, each 0 to 1).',
    example: 'fragColor = vec4(1.0, 0.5, 0.0, 1.0);   // orange',
  },
  {
    name: 'iResolution',
    type: 'vec3',
    what: 'The picture’s size in pixels: x is the width, y the height. Divide by it to get coordinates from 0 to 1.',
    example: 'vec2 uv = fragCoord / iResolution.xy;',
  },
  {
    name: 'iTime',
    type: 'float',
    what: 'Seconds since the shader started. Anything that moves uses it.',
    example: 'float wave = 0.5 + 0.5 * sin(iTime * 2.0);',
  },
  {
    name: 'iMouse',
    type: 'vec4',
    what: 'xy is the mouse position in pixels while you drag on the picture; zw is where the drag started (0 until you click).',
    example: 'vec2 m = iMouse.xy / iResolution.xy;',
  },
];

interface Recipe {
  name: string;
  what: string;
  snippet: string;
  preview: string; // a whole shader showing the recipe, for the little live picture
}

const wrap = (body: string) =>
  `void mainImage(out vec4 fragColor, in vec2 fragCoord) {\n    vec2 uv = (fragCoord - 0.5 * iResolution.xy) / iResolution.y;\n${body}\n}`;

const RECIPES: Recipe[] = [
  {
    name: 'Centred coordinates',
    what: 'Puts (0, 0) in the middle and keeps circles round on any screen shape. Most shaders start here.',
    snippet: 'vec2 uv = (fragCoord - 0.5 * iResolution.xy) / iResolution.y;',
    preview: wrap('    float axes = smoothstep(0.006, 0.0, min(abs(uv.x), abs(uv.y)));\n    vec2 g = abs(fract(uv * 4.0) - 0.5);\n    float grid = smoothstep(0.03, 0.0, min(g.x, g.y) / 4.0);\n    fragColor = vec4(mix(vec3(uv + 0.5, 0.75) * 0.7 + grid * 0.12, vec3(1.0), axes), 1.0);'),
  },
  {
    name: 'A soft circle',
    what: 'length() is the distance from the centre; smoothstep() turns it into a soft edge.',
    snippet: 'float d = length(uv) - 0.3;\nvec3 col = mix(vec3(1.0, 0.7, 0.2), vec3(0.05), smoothstep(0.0, 0.01, d));',
    preview: wrap('    float d = length(uv) - 0.3 - 0.03 * sin(iTime * 2.0);\n    vec3 col = mix(vec3(1.0, 0.7, 0.2), vec3(0.05), smoothstep(0.0, 0.01, d));\n    fragColor = vec4(col, 1.0);'),
  },
  {
    name: 'Moving stripes',
    what: 'fract() keeps only the part after the decimal point, so it repeats: the basis of every pattern.',
    snippet: 'float stripes = step(0.5, fract(uv.x * 8.0 - iTime));\nvec3 col = vec3(stripes);',
    preview: wrap('    float stripes = step(0.5, fract(uv.x * 8.0 - iTime));\n    fragColor = vec4(mix(vec3(0.08), vec3(1.0, 0.75, 0.12), stripes), 1.0);'),
  },
  {
    name: 'A colour palette',
    what: 'Three cosines with shifted phases turn any number into a smooth, rainbow-like colour.',
    snippet: 'vec3 col = 0.5 + 0.5 * cos(6.2831 * (uv.x + iTime * 0.1 + vec3(0.0, 0.33, 0.67)));',
    preview: wrap('    vec3 col = 0.5 + 0.5 * cos(6.2831 * (uv.x + iTime * 0.1 + vec3(0.0, 0.33, 0.67)));\n    fragColor = vec4(col, 1.0);'),
  },
];

// The handy functions, each with a tiny graph of its shape over x from 0 to 1.
const FUNCTIONS: { name: string; what: string; f: (x: number) => number }[] = [
  { name: 'smoothstep(0.2, 0.8, x)', what: '0 below the first edge, 1 above the second, a smooth curve between.', f: (x) => { const t = Math.min(1, Math.max(0, (x - 0.2) / 0.6)); return t * t * (3 - 2 * t); } },
  { name: 'step(0.5, x)', what: '0 below the edge, 1 at or above it.', f: (x) => (x >= 0.5 ? 1 : 0) },
  { name: 'mix(a, b, x)', what: 'Blends from a to b as x goes from 0 to 1.', f: (x) => 0.15 + 0.7 * x },
  { name: 'fract(x * 3.0)', what: 'The part after the decimal point: repeats every 1.', f: (x) => (x * 3) % 1 },
  { name: 'sin(x * 6.2831)', what: 'A wave between −1 and 1 (drawn here from 0 to 1).', f: (x) => 0.5 + 0.5 * Math.sin(x * Math.PI * 2) },
  { name: 'abs(x - 0.5) * 2.0', what: 'Folds negative values up: a V shape. length() does this in 2D.', f: (x) => Math.abs(x - 0.5) * 2 },
  { name: 'clamp(x * 2.0 - 0.5, 0.0, 1.0)', what: 'Keeps a value between a low and a high limit.', f: (x) => Math.min(1, Math.max(0, x * 2 - 0.5)) },
];

function Graph({ f }: { f: (x: number) => number }) {
  const pts = Array.from({ length: 61 }, (_, i) => {
    const x = i / 60;
    return `${(4 + x * 72).toFixed(1)},${(30 - f(x) * 24).toFixed(1)}`;
  }).join(' ');
  return (
    <svg className="fn-graph" viewBox="0 0 80 34" width="80" height="34" aria-hidden="true">
      <line x1="4" y1="30" x2="76" y2="30" />
      <line x1="4" y1="6" x2="4" y2="30" />
      <polyline points={pts} />
    </svg>
  );
}

function Actions({ code, onInsert }: { code: string; onInsert?: (code: string) => void }) {
  const [done, setDone] = useState<'' | 'inserted' | 'copied'>('');
  const flash = (what: 'inserted' | 'copied') => {
    setDone(what);
    window.setTimeout(() => setDone(''), 1400);
  };
  return (
    <div className="snip-actions">
      {onInsert && (
        <button className="secondary small" onClick={() => { onInsert(code); flash('inserted'); }}>
          {done === 'inserted' ? 'Inserted ✓' : 'Insert'}
        </button>
      )}
      <button
        className="secondary small"
        onClick={() => navigator.clipboard.writeText(code).then(() => flash('copied'), () => {})}
      >
        {done === 'copied' ? 'Copied ✓' : 'Copy'}
      </button>
    </div>
  );
}

/** `onInsert` is left out when the shader can't be edited (a gallery piece): then only Copy is offered. */
export function Reference({ onClose, onInsert }: { onClose: () => void; onInsert?: (code: string) => void }) {
  const [tab, setTab] = useState<Tab>('inputs');
  return (
    <aside className="ref-panel" aria-label="Shader reference">
      <header className="ref-top">
        <span className="ref-kick">Reference</span>
        <button className="icon-btn ref-close" onClick={onClose} aria-label="Close the reference">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
      </header>
      <div className="ref-tabs" role="tablist">
        {(['inputs', 'recipes', 'functions'] as Tab[]).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
            {t === 'inputs' ? 'Inputs' : t === 'recipes' ? 'Recipes' : 'Functions'}
          </button>
        ))}
      </div>
      <div className="ref-body">
        {tab === 'inputs' && (
          <>
            <p className="ref-lede">You write <code>mainImage</code>; these are handed to it every frame.</p>
            {INPUTS.map((e) => (
              <article key={e.name} className="ref-card">
                <div className="ref-name"><b>{e.name}</b><span>{e.type}</span></div>
                <p>{e.what}</p>
                <pre className="snip">{e.example}</pre>
                <Actions code={e.example} onInsert={onInsert} />
              </article>
            ))}
          </>
        )}
        {tab === 'recipes' && RECIPES.map((r) => (
          <article key={r.name} className="ref-card recipe">
            <div className="film recipe-film"><LiveShader code={r.preview} label={r.name} /></div>
            <div className="ref-name"><b>{r.name}</b></div>
            <p>{r.what}</p>
            <pre className="snip">{r.snippet}</pre>
            <Actions code={r.snippet} onInsert={onInsert} />
          </article>
        ))}
        {tab === 'functions' && (
          <>
            <p className="ref-lede">Each graph shows the result for x from 0 (left) to 1 (right).</p>
            <ul className="fn-list">
              {FUNCTIONS.map((fn) => (
                <li key={fn.name}>
                  <Graph f={fn.f} />
                  <div><code>{fn.name}</code><span>{fn.what}</span></div>
                </li>
              ))}
            </ul>
            <p className="ref-tip">Write decimals with a point: <code>1.0</code>, not <code>1</code>. GLSL won’t mix whole numbers and decimals on its own.</p>
          </>
        )}
      </div>
    </aside>
  );
}
