// Limits on how fast new shaders can be created. Every new shader (and every fork) is a database
// row, so without a limit a script or a crawler could fill the database. Each client gets a budget
// per hour, and there is a ceiling for everyone together as a backstop, since a client's address can
// be faked (it comes from proxy headers).
import type { FastifyRequest } from 'fastify';

/** At most `max` events per `windowMs` for each key: a sliding window of timestamps. */
export class RateLimit {
  private hits = new Map<string, number[]>();
  constructor(private max: number, private windowMs: number) {}

  /** Records an event for `key` if it is allowed. Returns 0, or how many ms until one more is. */
  take(key: string, now = Date.now()): number {
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (recent.length >= this.max) {
      this.hits.set(key, recent);
      return this.windowMs - (now - recent[0]);
    }
    recent.push(now);
    this.hits.set(key, recent);
    if (this.hits.size > 10_000) this.prune(now);
    return 0;
  }

  private prune(now: number) {
    for (const [key, times] of this.hits) if (!times.length || now - times[times.length - 1] >= this.windowMs) this.hits.delete(key);
  }
}

/**
 * Who is asking. Requests reach the server through Netlify (which names the visitor in
 * x-nf-client-connection-ip) or directly through Render's proxy (X-Forwarded-For, visitor first).
 */
export function clientKey(req: FastifyRequest): string {
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.split(',')[0]?.trim();
  return first(req.headers['x-nf-client-connection-ip']) || first(req.headers['x-forwarded-for']) || req.socket.remoteAddress || 'unknown';
}
