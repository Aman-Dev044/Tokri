/**
 * The shared frame for /help, /privacy and /terms: a heading block, the three
 * sibling links, an optional "template" warning, a contents list and the
 * prose. A Server Component — nothing here ships JavaScript.
 *
 * Headings run h1 (page) → h2 (section) → h3 (sub-section), never skipping a
 * level, so a screen-reader's heading list is the table of contents.
 */

import Link from 'next/link';
import type { ReactNode } from 'react';

import '@/styles/help.css';

export type InfoPageKey = 'help' | 'privacy' | 'terms';

const SIBLINGS: readonly { key: InfoPageKey; href: string; label: string }[] = [
  { key: 'help', href: '/help', label: 'Help & FAQ' },
  { key: 'privacy', href: '/privacy', label: 'Privacy policy' },
  { key: 'terms', href: '/terms', label: 'Terms of service' },
];

export interface TocEntry {
  id: string;
  label: string;
}

export { LEGAL_LAST_UPDATED } from '@/lib/legal';

export function formatUpdated(iso: string): string {
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Asia/Kolkata',
  }).format(new Date(`${iso}T00:00:00+05:30`));
}

export function InfoPage({
  current,
  eyebrow,
  title,
  lede,
  updated,
  notice,
  toc,
  children,
}: {
  current: InfoPageKey;
  eyebrow: string;
  title: string;
  lede: ReactNode;
  updated?: string;
  notice?: ReactNode;
  toc: readonly TocEntry[];
  children: ReactNode;
}) {
  return (
    <div className="shell hlp">
      <header className="hlp__head">
        <p className="eyebrow">{eyebrow}</p>
        <h1 className="shop-page__title">{title}</h1>
        <p className="hlp__lede">{lede}</p>
        {updated ? (
          <p className="hlp__updated">
            Last updated: <time dateTime={updated}>{formatUpdated(updated)}</time>
          </p>
        ) : null}
      </header>

      <nav aria-label="Help and policies">
        <ul className="hlp__tabs">
          {SIBLINGS.map((page) => (
            <li key={page.key}>
              <Link
                href={page.href}
                aria-current={page.key === current ? 'page' : undefined}
              >
                {page.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {notice ? (
        <p className="hlp__notice" role="note">
          {notice}
        </p>
      ) : null}

      <div className="hlp__body">
        <nav className="hlp__toc" aria-labelledby={`${current}-toc`}>
          <h2 id={`${current}-toc`} className="hlp__toc-title">
            On this page
          </h2>
          <ol>
            {toc.map((entry) => (
              <li key={entry.id}>
                <a href={`#${entry.id}`}>{entry.label}</a>
              </li>
            ))}
          </ol>
        </nav>

        <div className="hlp__prose">{children}</div>
      </div>
    </div>
  );
}

/** One titled section of the prose, anchored for the contents list. */
export function InfoSection({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="hlp__section" id={id} aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`}>{title}</h2>
      {children}
    </section>
  );
}

/** A blank the operator must fill in before publishing. */
export function Placeholder({ children }: { children: ReactNode }) {
  return <span className="hlp__ph">[{children}]</span>;
}
