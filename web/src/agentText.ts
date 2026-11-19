// Text helpers shared by the shader agent (agent/src/room.ts, typing into a live room) and the
// replay page (Replay.tsx, playing a saved run back), so both animate a revision the same way.
// Keep this file free of DOM and Node code: both sides import it.

/** The plan as a // comment block, wrapped to fit the editor. */
export function planComment(plan: string, width = 92): string {
  const out = ['// Shader agent is planning:'];
  for (const para of plan.split(/\n+/)) {
    let line = '//';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      if (line.length + 1 + word.length > width && line !== '//') { out.push(line); line = '//'; }
      line += ' ' + word;
    }
    if (line !== '//') out.push(line);
  }
  return out.join('\n') + '\n//\n';
}

export type Op = { kind: 'keep' | 'del' | 'ins'; line: string };

/** A line diff in document order (longest common subsequence). Shaders are short, so O(n·m) is fine. */
export function lineDiff(a: string[], b: string[]): Op[] {
  const n = a.length, m = b.length;
  const lcs = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  const ops: Op[] = [];
  let i = 0, j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) { ops.push({ kind: 'keep', line: a[i] }); i++; j++; }
    else if (j < m && (i === n || lcs[i][j + 1] >= lcs[i + 1][j])) { ops.push({ kind: 'ins', line: b[j] }); j++; }
    else { ops.push({ kind: 'del', line: a[i] }); i++; }
  }
  return ops;
}
