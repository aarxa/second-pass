// The look shared by every page: the header with the wordmark and the light/dark toggle, and the
// code editor's colours. Colours are CSS variables (styles.css), so one CodeMirror theme serves both
// the light "lightbox" and the dark "projection booth" modes and switches without rebuilding the editor.
import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { EditorView } from 'codemirror';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';

type Mode = 'light' | 'dark';
const KEY = 'secondpass.theme';
const media = () => window.matchMedia('(prefers-color-scheme: dark)');

/** The theme on screen: the visitor's saved choice, else their system setting. */
function currentMode(): Mode {
  const set = document.documentElement.dataset.theme;
  if (set === 'light' || set === 'dark') return set;
  return media().matches ? 'dark' : 'light';
}

export function ThemeToggle() {
  const [mode, setMode] = useState<Mode>(currentMode);
  useEffect(() => {
    const m = media();
    const follow = () => setMode(currentMode());
    m.addEventListener('change', follow);
    return () => m.removeEventListener('change', follow);
  }, []);
  const flip = () => {
    const next: Mode = mode === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem(KEY, next); } catch { /* private mode: the choice lasts for this page */ }
    setMode(next);
  };
  return (
    <button className="icon-btn" onClick={flip} aria-label={`Switch to ${mode === 'dark' ? 'light' : 'dark'} mode`} title={mode === 'dark' ? 'Lightbox (light)' : 'Projection booth (dark)'}>
      {mode === 'dark'
        ? <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="4.5" /><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8" /></svg>
        : <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 14.5A8 8 0 019.5 4a8 8 0 1010.5 10.5z" /></svg>}
    </button>
  );
}

/** The top bar on every page. `children` go between the navigation and the theme toggle. */
export function TopBar({ active, children }: { active?: 'runs' | 'gallery'; children?: ReactNode }) {
  return (
    <header className="top">
      <Link to="/agent" className="mark" aria-label="Second Pass, home">Second<span>/</span>Pass</Link>
      <nav className="nav">
        <Link to="/agent" className={active === 'runs' ? 'on' : ''}>Runs</Link>
        <Link to="/gallery" className={active === 'gallery' ? 'on' : ''}>Gallery</Link>
      </nav>
      {children}
      <ThemeToggle />
    </header>
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
