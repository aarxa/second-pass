# M7 explained: the shader agent

The agent takes a request ("a lava lamp with slow rising blobs", or a sketch) and writes a shader
for it. Unlike text-to-shader tools that write once and hope, it checks its own work: it compiles
the shader, renders frames, has a vision model judge them against the request, and revises.

Prior work this builds on, and what is different:
- **ShaderGPT** (14islands) writes GLSL from text but never looks at the result; its authors noted
  the models couldn't judge how a shader looked and didn't always produce valid code.
- **AI Co-Artist** (2025 paper) evolves shaders with GPT-4, but a *person* picks the winners each
  round; letting a vision model judge is listed as future work. This milestone builds that loop and
  measures how far a model's judgement can be trusted (the agreement numbers below).

## The pieces

```
 request ─► writer ─► compile ─(errors)─► writer ...            agent/src/agent.ts
                         │ ok
                         ▼
                      render 3 frames ─► judge ─(score < 7)─► writer, with frames + critique
                      (headless Chrome)   │ score ≥ 7
                                          ▼
                                        done (keeps the best version seen)
```

| File | What it does |
|---|---|
| `web/src/glsl.ts` | The GLSL wrapper and error parser, moved out of `renderer.ts` so the editor and the agent share one copy. |
| `agent/src/render.ts` | Compiles and renders in headless Chrome. Returns frames as PNGs plus three pixel measurements. |
| `agent/src/model.ts` | The two model calls, writer and judge, behind a small `Model` interface. |
| `agent/src/prompts.ts` | Every prompt, with a version number recorded in each benchmark run. |
| `agent/src/agent.ts` | The loop, its three modes, limits, and the step log (trace). |
| `agent/src/bench.ts` | The benchmark, the blind rating page, and the judge-vs-human agreement maths. |
| `agent/src/fake.ts` | A free fake model for dry runs and tests. |

## Decisions worth being able to explain

**The loop is code, not a model choosing tools.** A "real" agent would let the model decide when to
compile or render. Here the steps are fixed: write, compile, render, judge. Every run is comparable,
and the benchmark can switch steps off to measure what each one is worth (the modes below). The
model still makes all the creative decisions; it just doesn't decide the control flow.

**Rendering in a real browser, with SwiftShader.** The agent compiles with the exact wrapper the
editor uses, in Chrome's WebGL2, so "it compiles in the agent" means "it compiles in shaderlab".
SwiftShader renders on the CPU: slower, but the same pixels on any machine (fair benchmark), and a
broken shader can't hang a GPU driver. Each shader gets a fresh page with a timeout, so an endless
loop costs one page, not the whole run.

**Cheap checks before expensive ones.** Three pixel measurements are computed in the page: average
brightness, contrast (a flat colour scores ~0), and change between frames (a frozen image scores ~0).
They go to the judge as hints, so it notices a blank or frozen result even when it looks plausible.

**Compiler errors are quoted, not just numbered.** Feedback includes the offending line itself, so
the model doesn't have to count lines (a common source of fixing the wrong line). Line numbers are
shifted back to the user's code, since the wrapper adds lines on top.

**The writer sees what it made.** After a low score, the writer gets its own frames as images along
with the critique and fixes, in the same conversation, so it revises instead of starting over.

**Keep the best, not the last.** A revision can make things worse. The agent keeps the
highest-scoring version seen and returns that.

**Structured outputs.** Both calls use the API's JSON-schema output mode, so replies always parse
into `{plan, code}` or `{score, critique, fixes}`. They are validated again with zod.

**Limits.** At most 3 compile fixes per draft, 4 judged rounds, and a per-task dollar budget. A
model error (rate limit, network) ends the task with `stop: "error"` instead of crashing a
benchmark run halfway through.

**Models.** The writer and judge default to Claude Opus 5.5 (`AGENT_WRITER_MODEL` and
`AGENT_JUDGE_MODEL` change them). Requests are streamed (long shaders never hit an HTTP timeout) and
use server-side fallbacks, so a rare safety decline is retried on another model instead of failing.

## The benchmark

`agent/bench/cases.json` has 30 text requests (10 easy, 10 medium, 10 hard, from a gradient to a
black hole). Drawings in `agent/bench/sketches/` become extra cases.

Each case runs in three **modes**, an ablation that shows what each step adds:

| Mode | Steps |
|---|---|
| `oneshot` | write once (the baseline most tools stop at) |
| `compile` | plus compiler-error fixing |
| `full` | plus rendering and the vision judge's critique |

**Fair scoring.** Every mode's final shader is scored the same way: a fresh render and a fresh
judge call. The full mode's in-loop scores are not reused, so it gets no home advantage.

**But can the judge be trusted?** The judge is a model, so its scores need checking against a
person. Each run writes `rate.html`: shaders in random order, modes hidden, a 0–10 button row each.
Rate them, download `ratings.json`, then `npm run bench -- agree <run> ratings.json` reports:
- **Spearman correlation:** does the judge rank shaders in the same order you do (1 = same order)?
- **Mean score difference:** how far apart the numbers are.
- **Pass/fail agreement and Cohen's kappa:** how often you agree on "passes" (7+), and how much
  better that is than chance (0 = chance, 1 = perfect). Kappa matters because if most shaders
  pass, agreeing on "pass" most of the time is easy.

If the judge agrees with you poorly, the "full" mode's gains are suspect. That is the point of
measuring it, and an honest negative result is still a result.

## Running it

```bash
npm install
cd agent
npm test                                  # loop + renderer + maths, no API key needed
npm run agent -- --dry "a lava lamp"      # the whole loop with a fake model
npm run bench -- --dry --limit 3          # the whole benchmark with a fake model

export ANTHROPIC_API_KEY=...              # your key; never commit it
npm run agent -- "a lava lamp with slow rising blobs"
npm run bench -- --limit 5                # prints the run size and worst-case cost first
npm run bench -- --limit 5 --yes          # actually runs (costs money)
```

Results land in `agent/bench/runs/<time>/`: a trace, the final shader and its frames for every case
and mode, `results.jsonl`, `summary.md`, and `rate.html`. Runs are git-ignored; copy the summary
table you want to keep into the README.

## Known limits

- One judge model scoring its own family's shaders may be biased toward them; the human agreement
  numbers are the check on that.
- Three frames can't show everything about motion (smoothness, looping).
- SwiftShader is slower than a GPU, so very heavy shaders can time out here but run fine in a browser.
- `iMouse` is always zero in the benchmark, so interactive shaders aren't tested.

## Next steps (still M7)

1. Run the benchmark for real on all 30 cases and add the table to the README.
2. Draw about 20 sketches and run them.
3. Rate about 100 results and report the agreement numbers.
4. Live demo: the agent joins a shaderlab room as a collaborator with its own cursor and types the
   shader into the shared document (server endpoint + a Yjs client).

## Interview questions this prepares you for

- Why a fixed workflow instead of letting the model choose tools? When would you switch?
- How do you evaluate a generative system with no single right answer? (judge + human agreement)
- What is an ablation, and what did yours show?
- Why Spearman and kappa rather than plain accuracy?
- How do you keep cost bounded in an agent loop? What does one shader cost, and where does it go?
- How do you sandbox untrusted generated code? (separate page, CPU renderer, timeouts)
