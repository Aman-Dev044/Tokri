'use client';

/**
 * The frame every store screen sits in.
 *
 * One header shape across seven screens is what makes them feel like one tool
 * rather than seven pages that happen to share a sidebar: an eyebrow, a display
 * title, one sentence of what this screen is FOR, and the controls that belong
 * to the screen as a whole on the right.
 *
 * ── THE SAMPLE-DATA BANNER IS NOT OPTIONAL CHROME ───────────────────────────
 * `useVendorQuery` substitutes a labelled fixture for exactly one failure —
 * the API process not being reachable at all. When that happens this banner
 * appears and names the endpoints that are faked. A sample number that can be
 * mistaken for a real one is the worst thing this panel could put on a screen,
 * so the banner is loud, it is at the top, and it lists paths.
 */

import type { ReactNode } from 'react';
import Link from 'next/link';
import { IconChevronRight } from './icons';

export interface Crumb {
  label: string;
  href?: string;
}

export interface VenPageProps {
  title: ReactNode;
  /** small uppercase category — a real one, never decoration */
  eyebrow?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  breadcrumbs?: readonly Crumb[];
  isFixture?: boolean;
  fixturePaths?: readonly string[];
  children: ReactNode;
}

export function VenPage({
  title,
  eyebrow,
  description,
  actions,
  breadcrumbs,
  isFixture = false,
  fixturePaths,
  children,
}: VenPageProps) {
  return (
    <div className="ven-page">
      {breadcrumbs && breadcrumbs.length > 0 ? (
        <nav className="ven-crumbs" aria-label="Breadcrumb">
          {breadcrumbs.map((crumb, index) => (
            <span className="ven-crumbs__item" key={`${crumb.label}-${index}`}>
              {crumb.href ? (
                <Link href={crumb.href}>{crumb.label}</Link>
              ) : (
                <span aria-current="page">{crumb.label}</span>
              )}
              {index < breadcrumbs.length - 1 ? (
                <IconChevronRight className="ven-crumbs__sep" />
              ) : null}
            </span>
          ))}
        </nav>
      ) : null}

      <header className="ven-page__head">
        <div className="ven-page__headtext">
          {eyebrow ? <span className="ven-label">{eyebrow}</span> : null}
          <h1 className="ven-page__title">{title}</h1>
          {description ? <p className="ven-page__desc">{description}</p> : null}
        </div>
        {actions ? <div className="ven-page__actions">{actions}</div> : null}
      </header>

      {isFixture ? (
        <div className="ven-sample" role="status">
          <span className="ven-sample__mark" aria-hidden="true">
            !
          </span>
          <div>
            <p className="ven-sample__title">These are sample figures, not your shop</p>
            <p className="ven-sample__body">
              The API could not be reached, so this screen is drawing labelled placeholder data.
              Nothing here is real and no control on it will save.
              {fixturePaths && fixturePaths.length > 0 ? (
                <>
                  {' Faked: '}
                  {fixturePaths.map((path, index) => (
                    <span key={path}>
                      {index > 0 ? ', ' : null}
                      <code>{path}</code>
                    </span>
                  ))}
                </>
              ) : null}
            </p>
          </div>
        </div>
      ) : null}

      <div className="ven-page__body">{children}</div>
    </div>
  );
}

export interface VenSectionProps {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  /** put the contents on a card surface rather than bare on the ground */
  panel?: boolean;
  className?: string;
}

export function VenSection({
  title,
  description,
  actions,
  children,
  panel = false,
  className,
}: VenSectionProps) {
  return (
    <section className={['ven-section', className].filter(Boolean).join(' ')}>
      {title || description || actions ? (
        <header className="ven-section__head">
          <div>
            {title ? <h2 className="ven-section__title">{title}</h2> : null}
            {description ? <p className="ven-section__desc">{description}</p> : null}
          </div>
          {actions ? <div className="ven-section__act">{actions}</div> : null}
        </header>
      ) : null}
      <div className={panel ? 'ven-panel' : undefined}>{children}</div>
    </section>
  );
}
