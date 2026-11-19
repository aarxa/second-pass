// The model writes its notes in a little Markdown: paragraphs, "- " bullet lists, **bold** and `code`.
// This turns that into React elements (never raw HTML), so a run file can't inject markup into the page.
import type { ReactNode } from 'react';

/** **bold** and `code` inside one line of text. */
export function Inline({ text }: { text: string }) {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*\n]+\*\*|`[^`\n]+`)/g;
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0];
    out.push(t.startsWith('**') ? <strong key={m.index}>{t.slice(2, -2)}</strong> : <code key={m.index}>{t.slice(1, -1)}</code>);
    last = m.index + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return <>{out}</>;
}

/** Paragraphs and bullet lists. Blank lines separate paragraphs; "- ", "* ", "• " or "1. " start a bullet. */
export function Prose({ text, className }: { text: string; className?: string }) {
  const blocks: ReactNode[] = [];
  let para: string[] = [];
  let list: string[] = [];
  const endPara = () => {
    if (para.length) blocks.push(<p key={blocks.length}><Inline text={para.join(' ')} /></p>);
    para = [];
  };
  const endList = () => {
    if (list.length) blocks.push(<ul key={blocks.length}>{list.map((l, i) => <li key={i}><Inline text={l} /></li>)}</ul>);
    list = [];
  };
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    const bullet = /^(?:[-*•]|\d+[.)])\s+(.*)$/.exec(line);
    if (!line) {
      endPara();
      endList();
    } else if (bullet) {
      endPara();
      list.push(bullet[1]);
    } else {
      endList();
      para.push(line);
    }
  }
  endPara();
  endList();
  return <div className={className}>{blocks}</div>;
}

/** The same text with the Markdown marks removed, for places that show one plain line. */
export function plain(text: string): string {
  return text
    .replace(/\*\*([^*\n]+)\*\*/g, '$1')
    .replace(/`([^`\n]+)`/g, '$1')
    .replace(/^\s*(?:[-*•]|\d+[.)])\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}
