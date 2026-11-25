// What a missing shader, a run that won't load, or an unknown address shows: a short explanation
// and the ways onward, under the usual top bar.
import type { ReactNode } from 'react';
import { SiteFooter, TopBar, usePageTitle } from './theme';

export function Missing({ title, text, children }: { title: string; text: string; children?: ReactNode }) {
  usePageTitle('Not found');
  return (
    <div className="page doc">
      <TopBar />
      <main className="wrap missing">
        <h1>{title}</h1>
        <p>{text}</p>
        <div className="missing-actions">{children}</div>
      </main>
      <SiteFooter />
    </div>
  );
}
