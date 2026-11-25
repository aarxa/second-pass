// The look shared by every page: the header with the wordmark and the light/dark toggle, and the
// code editor's colours. Colours are CSS variables (styles.css), so one CodeMirror theme serves both
// modes and switches without rebuilding the editor. Dark is the default; light is the visitor's choice.
import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { EditorView } from 'codemirror';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';

type Mode = 'light' | 'dark';
const KEY = 'secondpass.theme';
/** The theme on screen: light only if the visitor picked it, else dark. */
const currentMode = (): Mode => (document.documentElement.dataset.theme === 'light' ? 'light' : 'dark');

export function ThemeToggle() {
  const [mode, setMode] = useState<Mode>(currentMode);
  const flip = () => {
    const next: Mode = mode === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem(KEY, next); } catch { /* private mode: the choice lasts for this page */ }
    setMode(next);
  };
  return (
    <button className="icon-btn" onClick={flip} aria-label={`Switch to ${mode === 'dark' ? 'light' : 'dark'} mode`} title={mode === 'dark' ? 'Light mode' : 'Dark mode'}>
      {mode === 'dark'
        ? <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="4.5" /><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8" /></svg>
        : <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 14.5A8 8 0 019.5 4a8 8 0 1010.5 10.5z" /></svg>}
    </button>
  );
}

/** Names the browser tab (and the history entry): "Black hole · Second Pass". With no name, just "Second Pass". */
export function usePageTitle(name?: string | null) {
  useEffect(() => {
    document.title = name ? `${name} · Second Pass` : 'Second Pass';
  }, [name]);
}

type Section = 'runs' | 'gallery' | 'how';
const NAV: [Section, string, string][] = [['gallery', '/gallery', 'Gallery'], ['runs', '/agent', 'Agent runs'], ['how', '/how', 'How it works']];

/**
 * The top bar: the same on every page, pinned to the top. A page's own tools (the editor's title and
 * Share, the replay's run) go in a <Toolbar> under it, never in here, so nothing in it moves between pages.
 */
export function TopBar({ active }: { active?: Section }) {
  return (
    <header className="top">
      <div className="top-in">
        <Link to="/" className="mark" aria-label="Second Pass, home">Second<span>/</span>Pass</Link>
        <nav className="nav" aria-label="Main">
          {NAV.map(([key, to, label]) => (
            <Link key={key} to={to} className={active === key ? 'on' : ''} aria-current={active === key ? 'page' : undefined}>{label}</Link>
          ))}
        </nav>
        <div className="top-end">
          <ThemeToggle />
          <Link className="btn" to="/new">New shader</Link>
        </div>
      </div>
    </header>
  );
}

/** A page's own row of tools under the top bar (the editor, a replay). */
export function Toolbar({ children }: { children: ReactNode }) {
  return <div className="toolbar">{children}</div>;
}

/** The footer on every page that scrolls (not the editor or a replay, which fill the window). */
export function SiteFooter() {
  return (
    <footer className="site-foot">
      <div className="wrap">
        <span>Second Pass · made by Aarya Rajgor</span>
        {NAV.map(([key, to, label]) => <Link key={key} to={to}>{label}</Link>)}
      </div>
    </footer>
  );
}

/** CodeMirror in the app's colours; every colour is a CSS variable from styles.css. */
export const editorTheme = [
  EditorView.theme({
    '&': { height: '100%', color: 'var(--codefg)', backgroundColor: 'var(--codebg)' },
    '.cm-scroller': { fontFamily: "'DM Mono', ui-monospace, Menlo, monospace", lineHeight: '1.62' },
    '.cm-content': { caretColor: 'var(--acc)' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--acc)', borderLeftWidth: '2px' },
    '.cm-gutters': { backgroundColor: 'var(--codebg)', color: 'var(--soft)', border: 'none' },
    '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--ink)' },
    '.cm-activeLine': { backgroundColor: 'var(--active-line)' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': { backgroundColor: 'var(--selection)' },
    '.cm-matchingBracket': { backgroundColor: 'var(--selection)', outline: 'none' },
    '.cm-foldPlaceholder': { backgroundColor: 'var(--raise)', border: 'none', color: 'var(--soft)' },
    '.cm-tooltip': { backgroundColor: 'var(--panel)', color: 'var(--ink)', border: '1px solid var(--line2)', borderRadius: '6px' },
    '.cm-lintRange-error': { backgroundImage: 'none', textDecoration: 'underline wavy var(--danger)' },
    '.cm-panels': { backgroundColor: 'var(--panel)', color: 'var(--ink)' },
  }),
  syntaxHighlighting(HighlightStyle.define([
    { tag: [t.keyword, t.controlKeyword, t.modifier, t.typeName, t.processingInstruction], color: 'var(--ck)' },
    { tag: [t.number, t.bool], color: 'var(--cn)' },
    { tag: [t.function(t.variableName), t.function(t.propertyName), t.macroName], color: 'var(--cf)' },
    { tag: [t.comment, t.lineComment, t.blockComment], color: 'var(--cc)', fontStyle: 'italic' },
    { tag: [t.operator, t.punctuation, t.bracket], color: 'var(--ink2)' },
  ])),
];
