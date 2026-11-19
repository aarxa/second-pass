// The reference drawer in the editor: what a shader is given, and a few small recipes to copy.
import { useState } from 'react';

interface Entry {
  name: string;
  what: string;
  code: string;
}

const INPUTS: Entry[] = [
  {
    name: 'mainImage(out vec4 fragColor, in vec2 fragCoord)',
    what: 'Runs once for every pixel, many times a second. fragCoord is the pixel’s position in pixels; set fragColor to its colour: red, green, blue, alpha, each 0 to 1.',
    code: 'void mainImage(out vec4 fragColor, in vec2 fragCoord) {\n    fragColor = vec4(1.0, 0.5, 0.0, 1.0); // orange everywhere\n}',
  },
  {
    name: 'iResolution (vec3)',
    what: 'The picture’s size in pixels (x = width, y = height). Divide by it to get 0–1 coordinates.',
    code: 'vec2 uv = fragCoord / iResolution.xy;   // 0 to 1 across the picture',
  },
  {
    name: 'iTime (float)',
    what: 'Seconds since the shader started. Anything that moves uses it.',
    code: 'float wave = 0.5 + 0.5 * sin(iTime * 2.0);   // 0 to 1 and back, about 3 times a second',
  },
  {
    name: 'iMouse (vec4)',
    what: 'xy is the mouse position in pixels while you drag on the picture; zw is where the last click started (0 until you click).',
    code: 'vec2 m = iMouse.xy / iResolution.xy;   // 0 to 1, follows your drag',
  },
];

const RECIPES: Entry[] = [
  {
    name: 'Centred, square coordinates',
    what: 'The middle of the picture is (0, 0) and circles stay round on any screen shape.',
    code: 'vec2 uv = (fragCoord - 0.5 * iResolution.xy) / iResolution.y;',
  },
  {
    name: 'A soft circle',
    what: 'length() is the distance from the centre; smoothstep() turns it into a soft edge.',
    code: 'float d = length(uv) - 0.3;\nvec3 col = mix(vec3(1.0, 0.7, 0.2), vec3(0.05), smoothstep(0.0, 0.01, d));',
  },
  {
    name: 'Moving stripes',
    what: 'fract() repeats a value between 0 and 1, so it makes repeating patterns.',
    code: 'float stripes = step(0.5, fract(uv.x * 10.0 - iTime));\nvec3 col = vec3(stripes);',
  },
  {
    name: 'A colour palette',
    what: 'Cosines with shifted phases give smooth rainbow-like colours from any number t.',
    code: 'vec3 palette(float t) {\n    return 0.5 + 0.5 * cos(6.2831 * (t + vec3(0.0, 0.33, 0.67)));\n}',
  },
];

const FUNCTIONS: [string, string][] = [
  ['mix(a, b, t)', 'Blends from a to b as t goes 0 → 1.'],
  ['smoothstep(e0, e1, x)', '0 below e0, 1 above e1, a smooth curve between.'],
  ['step(edge, x)', '0 below the edge, 1 at or above it.'],
  ['length(v)', 'How long a vector is: the distance from (0, 0).'],
  ['fract(x)', 'The part after the decimal point: repeats every 1.'],
  ['clamp(x, lo, hi)', 'Keeps x between lo and hi.'],
  ['sin(x), cos(x)', 'Waves between −1 and 1.'],
];

function Snippet({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="ref-code">
      <pre>{code}</pre>
      <button
        className="secondary"
        onClick={() => {
          navigator.clipboard.writeText(code).then(
            () => { setCopied(true); window.setTimeout(() => setCopied(false), 1500); },
            () => {},
          );
        }}
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}

export function Reference({ onClose }: { onClose: () => void }) {
  return (
    <aside className="reference" aria-label="Shader reference">
      <div className="ref-head">
        <h2>Reference</h2>
        <button className="icon-btn" onClick={onClose} aria-label="Close the reference">×</button>
      </div>
      <p className="ref-intro">Shaders here use the Shadertoy convention: you write <code>mainImage</code>, and these inputs are provided.</p>
      <h3>What a shader gets</h3>
      {INPUTS.map((e) => (
        <section key={e.name} className="ref-entry">
          <h4>{e.name}</h4>
          <p>{e.what}</p>
          <Snippet code={e.code} />
        </section>
      ))}
      <h3>Small recipes</h3>
      {RECIPES.map((e) => (
        <section key={e.name} className="ref-entry">
          <h4>{e.name}</h4>
          <p>{e.what}</p>
          <Snippet code={e.code} />
        </section>
      ))}
      <h3>Handy functions</h3>
      <dl className="ref-fns">
        {FUNCTIONS.map(([f, d]) => (
          <div key={f}><dt>{f}</dt><dd>{d}</dd></div>
        ))}
      </dl>
      <p className="ref-tip">Write decimals with a point: <code>1.0</code>, not <code>1</code>. GLSL doesn’t mix whole numbers and decimals on its own, and that is the most common error.</p>
    </aside>
  );
}
