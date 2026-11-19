// The agent as a collaborator: it joins a Second Pass room like any other user (a y-websocket client
// with its own name and cursor) and types each draft into the shared document. Everyone in the room
// watches it work, and every browser's live preview recompiles as it types.
//
// It types a line diff, not the whole file: on a revision only the lines that changed are deleted
// and retyped, so people can see exactly what each critique made it fix. If someone edits the code
// by hand, peekEdits() notices and the agent builds on their version instead of reverting it.
import WebSocket from 'ws';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { lineDiff, planComment } from '../../web/src/agentText.ts';

export { lineDiff, planComment };

const COLOR = '#f4b740'; // the app's amber accent

export interface TypingOptions {
  charsPerTick?: number;
  tickMs?: number;
}

export class LiveRoom {
  private lastWritten: string;
  private header = ''; // the plan comment currently shown at the top of the code
  private pendingPlan: string | null = null;
  private narrateTimer: NodeJS.Timeout | null = null;

  private constructor(
    private provider: WebsocketProvider,
    private text: Y.Text,
    private name: string,
    private typing: Required<TypingOptions>,
  ) {
    this.lastWritten = text.toString();
  }

  /** Joins the room for an editor page URL like https://host/s/<id>. */
  static async join(pageUrl: string, o: { name?: string; timeoutMs?: number } & TypingOptions = {}): Promise<LiveRoom> {
    const url = new URL(pageUrl);
    const id = /^\/s\/([^/]+)/.exec(url.pathname)?.[1];
    if (!id) throw new Error(`not a Second Pass editor URL (expected …/s/<id>): ${pageUrl}`);
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

  /**
   * Shows the plan as it streams in, as a comment at the top of the code, so people in the room see
   * what the agent is about to do instead of a silent wait. Updates are batched every 120 ms.
   */
  narrate(planSoFar: string) {
    this.pendingPlan = planSoFar;
    this.narrateTimer ??= setTimeout(() => { this.narrateTimer = null; this.flushPlan(); }, 120);
  }

  private flushPlan() {
    if (this.pendingPlan === null) return;
    const next = planComment(this.pendingPlan);
    const now = this.code;
    if (!now.startsWith(this.header)) { this.header = ''; return; } // someone edited the comment: stop
    let k = 0; // only touch what changed: usually just new words at the end
    while (k < this.header.length && k < next.length && this.header[k] === next[k]) k++;
    const untouched = now === this.lastWritten;
    this.text.doc!.transact(() => {
      this.text.delete(k, this.header.length - k);
      this.text.insert(k, next.slice(k));
    });
    this.header = next;
    this.cursor(next.length);
    if (untouched) this.lastWritten = this.code; // the comment is the agent's own edit, not a person's
  }

  /**
   * Types `next` into the room as a line diff, moving the agent's cursor as it goes. The plan comment
   * (if one is showing) stays on top while the code is typed beneath it, then is removed. Each new
   * line is opened before it's typed, so a half-typed line never runs into the line after it.
   */
  async type(next: string) {
    if (this.narrateTimer) { clearTimeout(this.narrateTimer); this.narrateTimer = null; }
    this.pendingPlan = null;
    const top = this.code.startsWith(this.header) ? this.header.length : 0;
    this.header = '';
    const from = withNewline(this.code.slice(top)).split('\n').slice(0, -1);
    const to = withNewline(next).split('\n').slice(0, -1);
    let pos = top; // character index in the shared text
    for (const op of lineDiff(from, to)) {
      if (op.kind === 'keep') {
        // (the last line may have no newline of its own, so never step past the end of the text)
        pos = Math.min(pos + op.line.length + 1, this.text.length);
      } else if (op.kind === 'del') {
        this.text.delete(pos, Math.min(op.line.length + 1, this.text.length - pos));
        this.cursor(pos);
        await sleep(this.typing.tickMs);
      } else {
        this.text.insert(pos, '\n');
        for (let i = 0; i < op.line.length; i += this.typing.charsPerTick) {
          const chunk = op.line.slice(i, i + this.typing.charsPerTick);
          this.text.insert(pos + i, chunk);
          this.cursor(pos + i + chunk.length);
          await sleep(this.typing.tickMs);
        }
        pos += op.line.length + 1;
      }
    }
    if (top) {
      await sleep(this.typing.tickMs * 10);
      this.text.delete(0, Math.min(top, this.text.length));
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
    // provider.destroy() leaves the awareness timer running, which keeps Node from exiting.
    this.provider.awareness.destroy();
    this.provider.destroy();
    this.text.doc?.destroy();
  }

  private cursor(index: number) {
    const at = Y.createRelativePositionFromTypeIndex(this.text, Math.min(index, this.text.length));
    this.provider.awareness.setLocalStateField('cursor', { anchor: at, head: at });
  }
}

const withNewline = (s: string) => (s.endsWith('\n') ? s : s + '\n');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
