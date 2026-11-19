// A shader running live on a page (home, the new-shader picker, gallery hovers), over a still picture
// of it that shows until it compiles, or stays if WebGL2 is missing. Pauses while off screen.
import { useEffect, useRef, useState } from 'react';
import { ShaderRenderer } from './renderer';

/** A shader running live on the page, over a still picture of it (shown until it compiles, or if it can't). */
export function LiveShader({ code, still, label, startAt }: { code: string | null; still?: string; label: string; startAt?: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [running, setRunning] = useState(false);
  useEffect(() => {
    const el = canvas.current;
    if (!code || !el) return;
    let r: ShaderRenderer;
    try {
      r = new ShaderRenderer(el, { maxDpr: 1.5, startAt });
    } catch {
      return; // no WebGL2: the still picture stays
    }
    if (r.setCode(code).length) {
      r.dispose();
      return;
    }
    setRunning(true);
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    r.startLoop();
    if (reduce) r.pause();
    // Animate only while it is on screen, so a long page doesn't keep the graphics card busy.
    const io = new IntersectionObserver(([e]) => {
      if (reduce) return;
      if (e.isIntersecting) r.resume();
      else r.pause();
    });
    io.observe(el);
    return () => {
      io.disconnect();
      r.dispose();
    };
  }, [code]);
  return (
    <div className="live-shader" style={still ? { backgroundImage: `url(${still})` } : undefined}>
      <canvas ref={canvas} role="img" aria-label={label} style={{ opacity: running ? 1 : 0 }} />
    </div>
  );
}

