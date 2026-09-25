'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { FixtureBanner } from './primitives';

/* ================================================================== */
/* AdminPage                                                           */
/* ================================================================== */

export interface Breadcrumb {
  label: string;
  /** omit on the last crumb — the current page is not a link to itself */
  href?: string;
}

export interface AdminPageProps {
  title: string;
  description: string;
  actions?: ReactNode;
  breadcrumbs?: Breadcrumb[];
  /**
   * True when any query feeding this page fell back to a fixture. Renders the
   * amber sample-data banner. See lib/admin/fixtures.ts — this flag is the
   * contract that makes the fallback safe to ship.
   */
  isFixture?: boolean;
  fixturePaths?: readonly string[];
  children: ReactNode;
}

/**
 * The frame every admin screen sits in: crumbs, title, description, actions,
 * then the content.
 *
 * `description` is required rather than optional on purpose. A console screen
 * with a bare noun for a title ("Settlements") tells a new operator nothing
 * about what it does or what a mistake here would cost. One line of prose under
 * the title is the cheapest documentation in the product.
 */
export function AdminPage({
  title,
  description,
  actions,
  breadcrumbs,
  isFixture = false,
  fixturePaths,
  children,
}: AdminPageProps) {
  return (
    <div className="adm-page">
      <header className="adm-page__head">
        <div style={{ minWidth: 0 }}>
          {breadcrumbs?.length ? (
            <nav className="adm-crumbs" aria-label="Breadcrumb">
              {breadcrumbs.map((crumb, i) => (
                <span key={`${crumb.label}-${i}`} className="adm-row" style={{ gap: 'var(--s-1)' }}>
                  {i > 0 ? (
                    <span className="adm-crumbs__sep" aria-hidden="true">
                      /
                    </span>
                  ) : null}
                  {crumb.href ? (
                    <Link href={crumb.href}>{crumb.label}</Link>
                  ) : (
                    <span aria-current="page">{crumb.label}</span>
                  )}
                </span>
              ))}
            </nav>
          ) : null}

          <h1 className="adm-page__title">{title}</h1>
          <p className="adm-page__desc">{description}</p>
        </div>

        {actions ? <div className="adm-page__actions">{actions}</div> : null}
      </header>

      {isFixture ? <FixtureBanner paths={fixturePaths} /> : null}

      {children}
    </div>
  );
}

/* ================================================================== */
/* AdminSection                                                        */
/* ================================================================== */

export interface AdminSectionProps {
  title?: string;
  description?: string;
  actions?: ReactNode;
  /** wrap the children in the hairline panel. Off for a bare table. */
  panel?: boolean;
  className?: string;
  children: ReactNode;
}

/**
 * A titled block inside a page. Uses `<section>` with an accessible name when
 * it has a title, so the screen has a real document outline and not a pile of
 * anonymous divs a screen-reader user has to read through linearly.
 */
export function AdminSection({
  title,
  description,
  actions,
  panel = false,
  className,
  children,
}: AdminSectionProps) {
  const body = panel ? <div className="adm-panel">{children}</div> : children;

  return (
    <section className={['adm-section', className].filter(Boolean).join(' ')} aria-label={title}>
      {title || description || actions ? (
        <div className="adm-section__head">
          <div style={{ minWidth: 0 }}>
            {title ? <h2 className="adm-section__title">{title}</h2> : null}
            {description ? <p className="adm-section__desc">{description}</p> : null}
          </div>
          {actions ? <div className="adm-section__actions">{actions}</div> : null}
        </div>
      ) : null}
      {body}
    </section>
  );
}
