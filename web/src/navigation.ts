// Two things every page change needs, kept out of the pages themselves.
//
// ScrollOnNavigate: a new page opens at its top (or at the section a #link names). Back and forward
// are left alone, so the browser returns you to where you were.
//
// DeployWatch: a tab left open keeps running the code it loaded, so after a deploy it would never see
// new pages. When the tab comes back into view or changes page (at most every five minutes) it checks
// the site's index.html; if the app's script has changed, the next page change loads the page fresh.
import { useEffect, useLayoutEffect, useRef } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';

export function ScrollOnNavigate() {
  const { pathname, hash } = useLocation();
  const type = useNavigationType();
  useLayoutEffect(() => {
    if (type === 'POP') return;
    const target = hash ? document.getElementById(decodeURIComponent(hash.slice(1))) : null;
    if (target) target.scrollIntoView();
    else window.scrollTo(0, 0);
  }, [pathname, hash, type]);
  return null;
}

const CHECK_EVERY_MS = 5 * 60 * 1000;
/** The built app's entry script, e.g. /assets/index-DSDH74bH.js (null in development). */
const scriptIn = (html: string) => html.match(/<script[^>]+src="(\/assets\/index-[^"]+\.js)"/)?.[1] ?? null;
const running = () => document.querySelector<HTMLScriptElement>('script[type="module"][src*="/assets/index-"]')?.getAttribute('src') ?? null;

export function DeployWatch() {
  const { pathname } = useLocation();
  const stale = useRef(false);
  const first = useRef(true);
  const check = useRef<() => void>(() => {});

  useEffect(() => {
    const mine = running();
    if (!mine) return; // development: Vite reloads by itself
    let last = Date.now();
    check.current = () => {
      if (document.visibilityState !== 'visible' || stale.current || Date.now() - last < CHECK_EVERY_MS) return;
      last = Date.now();
      fetch('/', { cache: 'no-store' })
        .then((r) => (r.ok ? r.text() : ''))
        .then((html) => { const live = scriptIn(html); if (live && live !== mine) stale.current = true; })
        .catch(() => { /* offline: try again next time */ });
    };
    const check_ = () => check.current();
    document.addEventListener('visibilitychange', check_);
    window.addEventListener('focus', check_);
    return () => {
      document.removeEventListener('visibilitychange', check_);
      window.removeEventListener('focus', check_);
    };
  }, []);

  // The address has already changed to the new page, so reloading lands right there, on the new code.
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    if (stale.current) window.location.reload();
    else check.current();
  }, [pathname]);
  return null;
}
