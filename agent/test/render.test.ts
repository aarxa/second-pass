// Runs a real headless browser, so these take a few seconds.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Renderer } from '../src/render.ts';

let r: Renderer;
beforeAll(async () => { r = await Renderer.open(); }, 30_000);
afterAll(async () => { await r?.close(); });

const GRADIENT = `void mainImage(out vec4 c, in vec2 p) {
  vec2 uv = p / iResolution.xy;
  c = vec4(uv, 0.5 + 0.5 * sin(iTime), 1.0);
}`;

describe('renderer', () => {
  it('renders an animated shader and measures it', async () => {
    const out = await r.render(GRADIENT, { width: 128, height: 72 });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.frames).toHaveLength(3);
    expect(out.frames[0].png.length).toBeGreaterThan(100);
    expect(out.stats.spread).toBeGreaterThan(0.05); // a gradient, not a flat colour
    expect(out.stats.motion).toBeGreaterThan(0.01); // blue changes with iTime
  }, 30_000);

  it('reports compile errors on the user\'s own line numbers', async () => {
    const code = `void mainImage(out vec4 c, in vec2 p) {\n  c = vec4(nope, 1.0);\n}`;
    const errors = await r.compile(code);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].line).toBe(2);
    expect(errors[0].message).toMatch(/nope/);
  }, 30_000);

  it('sees a still, flat image as still and flat', async () => {
    const out = await r.render(`void mainImage(out vec4 c, in vec2 p) { c = vec4(0.2, 0.2, 0.2, 1.0); }`, { width: 64, height: 36 });
    expect(out.ok && out.stats.spread < 0.01 && out.stats.motion < 0.001).toBe(true);
  }, 30_000);
});
