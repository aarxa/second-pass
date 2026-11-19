// The agent's eyes: compile and render a shader in a real headless browser, with the same WebGL2
// wrapper the editor uses (web/src/glsl.ts), so "it compiles here" means "it compiles in shaderlab".
//
// One browser stays open for the whole run; each shader gets a fresh page, so a shader that hangs
// the GPU (an endless loop) can be thrown away without restarting the browser.
import { chromium, type Browser } from 'playwright-core';
import { existsSync } from 'node:fs';
import { HEADER, FOOTER, VERTEX, HEADER_LINES, parseErrors, type CompileError } from '../../web/src/glsl.ts';

export interface Frame {
  t: number; // iTime the frame was drawn at, in seconds
  png: string; // base64 PNG, no data: prefix
}

/** Cheap pixel checks, done before paying for the vision judge. */
export interface FrameStats {
  meanLuma: number; // 0..1 average brightness over all frames
  spread: number; // 0..1 standard deviation of brightness: ~0 means one flat colour
  motion: number; // 0..1 mean pixel change between consecutive frames: ~0 means a still image
}

export type RenderResult =
  | { ok: true; frames: Frame[]; stats: FrameStats; ms: number }
  | { ok: false; errors: CompileError[]; ms: number };

export interface RenderOptions {
  width?: number;
  height?: number;
  times?: number[];
  timeoutMs?: number; // a frame that takes longer than this is treated as a hang
}

const CHROME_PATHS = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter((p): p is string => !!p);

// SwiftShader renders on the CPU: slower, but the same pixels on every machine, which matters for
// a benchmark. It also means a broken shader can't take down a real GPU driver.
const ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];

// Frames span 8 seconds: slow requests (a flower opening, the sun setting) need time to show their
// motion, and a judge that only saw the first 3 seconds marked a slow bloom as "nothing happens".
export const DEFAULT_TIMES = [0, 2, 5, 8];

export class Renderer {
  private constructor(private browser: Browser) {}

  static async open(): Promise<Renderer> {
    const executablePath = CHROME_PATHS.find((p) => existsSync(p));
    // With no system Chrome, fall back to a Playwright-managed Chromium (`npx playwright install chromium`).
    const browser = await chromium.launch({ headless: true, executablePath, args: ARGS });
    return new Renderer(browser);
  }

  async close() {
    await this.browser.close();
  }

  /** Compiles only. Fast: no frames are drawn or read back. */
  async compile(code: string, opts: RenderOptions = {}): Promise<CompileError[]> {
    const r = await this.run(code, { ...opts, times: [] });
    return r.ok ? [] : r.errors;
  }

  async render(code: string, opts: RenderOptions = {}): Promise<RenderResult> {
    return this.run(code, opts);
  }

  private async run(code: string, { width = 512, height = 288, times = DEFAULT_TIMES, timeoutMs = 8000 }: RenderOptions): Promise<RenderResult> {
    const started = Date.now();
    const page = await this.browser.newPage();
    try {
      // tsx (esbuild) wraps named functions in a __name() helper that doesn't exist in the page;
      // define a no-op version so inPage can be sent to the browser as-is.
      await page.evaluate('globalThis.__name = (f) => f');
      const work = page.evaluate(inPage, { src: HEADER + code + FOOTER, vertex: VERTEX, width, height, times });
      const timeout = new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), timeoutMs));
      const out = await Promise.race([work, timeout]);
      const ms = Date.now() - started;
      if (out === 'timeout') {
        return { ok: false, errors: [{ line: 1, message: `rendering took over ${timeoutMs} ms (an endless or very long loop?)` }], ms };
      }
      if (out.log !== null) return { ok: false, errors: parseErrors(out.log), ms };
      return { ok: true, frames: out.frames.map((png, i) => ({ t: times[i], png })), stats: out.stats, ms };
    } finally {
      await page.close().catch(() => {});
    }
  }
}

export { HEADER_LINES };

// Runs inside the browser page. It can't see anything from this module, so it takes everything as
// arguments and returns plain data.
function inPage({ src, vertex, width, height, times }: { src: string; vertex: string; width: number; height: number; times: number[] }) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true, antialias: false });
  if (!gl) return { log: 'WebGL2 is not available in the headless browser', frames: [] as string[], stats: { meanLuma: 0, spread: 0, motion: 0 } };
  const compile = (type: number, s: string) => {
    const sh = gl.createShader(type)!;
    gl.shaderSource(sh, s);
    gl.compileShader(sh);
    return sh;
  };
  const vs = compile(gl.VERTEX_SHADER, vertex);
  const fs = compile(gl.FRAGMENT_SHADER, src);
  if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) {
    return { log: gl.getShaderInfoLog(fs) || 'compile failed', frames: [] as string[], stats: { meanLuma: 0, spread: 0, motion: 0 } };
  }
  const prog = gl.createProgram()!;
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    return { log: gl.getProgramInfoLog(prog) || 'link failed', frames: [] as string[], stats: { meanLuma: 0, spread: 0, motion: 0 } };
  }
  gl.useProgram(prog);
  gl.viewport(0, 0, width, height);
  gl.uniform3f(gl.getUniformLocation(prog, 'iResolution'), width, height, 1);
  gl.uniform4f(gl.getUniformLocation(prog, 'iMouse'), 0, 0, 0, 0);
  const uTime = gl.getUniformLocation(prog, 'iTime');

  const frames: string[] = [];
  const lumas: Float32Array[] = [];
  const px = new Uint8Array(width * height * 4);
  for (const t of times) {
    gl.uniform1f(uTime, t);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const l = new Float32Array(width * height);
    for (let i = 0; i < l.length; i++) l[i] = (0.2126 * px[i * 4] + 0.7152 * px[i * 4 + 1] + 0.0722 * px[i * 4 + 2]) / 255;
    lumas.push(l);
    frames.push(canvas.toDataURL('image/png').slice('data:image/png;base64,'.length));
  }
  let sum = 0, sq = 0, n = 0, motion = 0;
  for (const l of lumas) for (let i = 0; i < l.length; i++) { sum += l[i]; sq += l[i] * l[i]; n++; }
  for (let f = 1; f < lumas.length; f++) {
    let d = 0;
    for (let i = 0; i < lumas[f].length; i++) d += Math.abs(lumas[f][i] - lumas[f - 1][i]);
    motion += d / lumas[f].length;
  }
  const mean = n ? sum / n : 0;
  return {
    log: null as string | null,
    frames,
    stats: { meanLuma: mean, spread: n ? Math.sqrt(Math.max(0, sq / n - mean * mean)) : 0, motion: lumas.length > 1 ? motion / (lumas.length - 1) : 0 },
  };
}
