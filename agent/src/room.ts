// The agent as a collaborator: it joins a shaderlab room like any other user (a y-websocket client
// with its own name and cursor) and types each draft into the shared document. Everyone in the room
// watches it work, and every browser's live preview recompiles as it types.
//
// It types a line diff, not the whole file: on a revision only the lines that changed are deleted
// and retyped, so people can see exactly what each critique made it fix. If someone edits the code
// by hand, peekEdits() notices and the agent builds on their version instead of reverting it.
import WebSocket from 'ws';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';

const COLOR = '#b9a4ff';

export interface TypingOptions {
  charsPerTick?: number;
  tickMs?: number;
}

export class LiveRoom {
  private lastWritten: string;

  private constructor(
    private provider: WebsocketProvider,
    private text: Y.Text,
    private name: string,
    private typing: Required<TypingOptions>,
  ) {
    this.lastWritten = text.toString();
  }

  /** Joins the room for a shaderlab page URL like https://host/s/<id>. */
  static async join(pageUrl: string, o: { name?: string; timeoutMs?: number } & TypingOptions = {}): Promise<LiveRoom> {
    const url = new URL(pageUrl);
    const id = /^\/s\/([^/]+)/.exec(url.pathname)?.[1];
    if (!id) throw new Error(`not a shaderlab editor URL (expected …/s/<id>): ${pageUrl}`);
    const ws = `${url.protocol === 'https:' ? 'wss' : 'ws'}://${url.host}/collab`;
    const doc = new Y.Doc();
    const provider = new WebsocketProvider(ws, id, doc, { WebSocketPolyfill: WebSocket as unknown as typeof globalThis.WebSocket });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { provider.destroy(); reject(new Error(`could not join ${pageUrl} (no sync within ${o.timeoutMs ?? 15000} ms)`)); }, o.timeoutMs ?? 15000);
      const onSync = (synced: boolean) => { if (synced) { clearTimeout(timer); provider.off('sync', onSync); resolve(); } };
      provider.on('sync', onSync);
    });
    const name = o.name ?? 'Shader agent';
    const room = new LiveRoom(provider, doc.getText('code'), name, { charsPerTick: o.charsPerTick ?? 8, tickMs: o.tickMs ?? 15 });
    room.status('joined');
    return room;
  }

  get code(): string {
    return this.text.toString();
  }

  /** Shows what the agent is doing next to its name in everyone's list of people in the room. */
  status(s: string) {
    this.provider.awareness.setLocalStateField('user', { name: this.name, status: s, color: COLOR, colorLight: `${COLOR}33` });
  }

  /** The room's code, if someone changed it since the agent last typed; otherwise null. */
  peekEdits(): string | null {
    const now = this.code;
    return now === this.lastWritten ? null : now;
  }

  /** Types `next` into the room as a line diff, moving the agent's cursor as it goes. */
  async type(next: string) {
    const from = withNewline(this.code).split('\n').slice(0, -1);
    const to = withNewline(next).split('\n').slice(0, -1);
    let pos = 0; // character index in the shared text
    for (const op of lineDiff(from, to)) {
      if (op.kind === 'keep') {
        pos += op.line.length + 1;
      } else if (op.kind === 'del') {
        this.text.delete(pos, Math.min(op.line.length + 1, this.text.length - pos));
        this.cursor(pos);
        await sleep(this.typing.tickMs);
      } else {
        const line = op.line + '\n';
        for (let i = 0; i < line.length; i += this.typing.charsPerTick) {
          const chunk = line.slice(i, i + this.typing.charsPerTick);
          this.text.insert(pos, chunk);
          pos += chunk.length;
          this.cursor(pos);
          await sleep(this.typing.tickMs);
        }
      }
    }
    // The diff works on whole lines; make the result exactly `next` (e.g. its final newline).
    if (this.code !== next) {
      this.text.doc!.transact(() => { this.text.delete(0, this.text.length); this.text.insert(0, next); });
    }
    this.lastWritten = this.code;
  }

  async leave() {
    this.status('done');
    await sleep(300); // let the last presence update reach the others
    this.provider.destroy();
  }

  private cursor(index: number) {
    const at = Y.createRelativePositionFromTypeIndex(this.text, Math.min(index, this.text.length));
    this.provider.awareness.setLocalStateField('cursor', { anchor: at, head: at });
  }
}

type Op = { kind: 'keep' | 'del' | 'ins'; line: string };

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

const withNewline = (s: string) => (s.endsWith('\n') ? s : s + '\n');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
