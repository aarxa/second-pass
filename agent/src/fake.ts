// A stand-in model for dry runs (`--dry`): it costs nothing and needs no API key, so the whole
// benchmark pipeline (rendering, saving, the summary, the rating page) can be tried end to end.
// Its shaders and scores are made up; never report numbers from a dry run.
import type { Model } from './model.ts';

const SHADERS = [
  // compiles, animated gradient
  'void mainImage(out vec4 c, in vec2 p) { vec2 uv = p / iResolution.xy; c = vec4(uv, 0.5 + 0.5 * sin(iTime), 1.0); }',
  // a deliberate compile error, to exercise the fix loop
  'void mainImage(out vec4 c, in vec2 p) { c = vec4(missing, 1.0); }',
  // compiles, rings
  'void mainImage(out vec4 c, in vec2 p) { vec2 uv = (p - 0.5 * iResolution.xy) / iResolution.y; float r = length(uv); c = vec4(vec3(0.5 + 0.5 * cos(20.0 * r - 3.0 * iTime)), 1.0); }',
];

export function fakeModel(): Model {
  let n = 0;
  return {
    async write(history) {
      const fixing = history.at(-1)?.role === 'feedback';
      const code = fixing ? SHADERS[(n++ % 2) * 2] : SHADERS[n++ % SHADERS.length];
      return { draft: { plan: 'dry run', code }, usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 } };
    },
    async judge(input) {
      const score = Math.round((input.stats.length * 7 + n * 3) % 11);
      return { verdict: { score, critique: 'dry run: made-up score', fixes: ['dry run'] }, usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 } };
    },
  };
}
