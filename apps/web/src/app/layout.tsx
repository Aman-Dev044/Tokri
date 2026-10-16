import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import { Space_Mono } from 'next/font/google';
import { THEME_INIT_SCRIPT } from '@mandi/design-system';

import '@mandi/design-system/tokens.css';
import '@mandi/design-system/styles.css';
import '@/styles/globals.css';

import { Providers } from '@/components/shared/Providers';
import { SITE_URL } from '@/config/env';
import {
  APP_NAME,
  APP_NAME_LOWER,
  APP_TITLE,
  APP_TITLE_TEMPLATE,
  APP_DESCRIPTION,
} from '@/config/brand';

/* ---------------------------------------------------------------------------
   Type — "Bento Pop"

     display   Cabinet Grotesk   chunky, wide, high-impact headings
     body      General Sans      warm, legible running text
     data      Space Mono        every number, with tabular figures

   Cabinet Grotesk and General Sans are Fontshare faces, not Google ones, so
   they cannot come from next/font/google. They are VENDORED as woff2 under
   src/fonts and loaded with next/font/local: self-hosted, zero layout shift,
   no runtime request to a third party, and the CSP stays `font-src 'self'`.
   Linking Fontshare's CDN instead would have meant a render-blocking request
   to a host the CSP would then have to admit.

   Every face declares a real fallback stack, so the page stays legible in the
   moment before the woff2 lands, and on a network that never delivers it.
--------------------------------------------------------------------------- */

const display = localFont({
  src: [
    { path: '../fonts/CabinetGrotesk-Bold.woff2', weight: '700', style: 'normal' },
    { path: '../fonts/CabinetGrotesk-Extrabold.woff2', weight: '800', style: 'normal' },
  ],
  display: 'swap',
  variable: '--font-display',
  fallback: ['Arial Black', 'Trebuchet MS', 'Segoe UI', 'sans-serif'],
  // Cabinet Grotesk is far wider than the fallback; letting Next synthesise
  // metric overrides from Arial makes the swap jump badly.
  adjustFontFallback: false,
});

const body = localFont({
  src: [
    { path: '../fonts/GeneralSans-Regular.woff2', weight: '400', style: 'normal' },
    { path: '../fonts/GeneralSans-Medium.woff2', weight: '500', style: 'normal' },
    { path: '../fonts/GeneralSans-Semibold.woff2', weight: '600', style: 'normal' },
  ],
  display: 'swap',
  variable: '--font-body',
  fallback: ['system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
});

const data = Space_Mono({
  subsets: ['latin'],
  weight: ['400', '700'],
  display: 'swap',
  variable: '--font-data',
  fallback: ['ui-monospace', 'SFMono-Regular', 'Consolas', 'monospace'],
});

/* ------------------------------------------------------------------------- */

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: APP_TITLE,
    template: APP_TITLE_TEMPLATE,
  },
  description: APP_DESCRIPTION,
  applicationName: APP_NAME,
  keywords: [
    'grocery delivery',
    'online kirana',
    'fresh vegetables delivery',
    'multi vendor grocery',
    APP_NAME_LOWER,
  ],
  authors: [{ name: APP_NAME }],
  formatDetection: { telephone: false, address: false, email: false },
  icons: {
    // TODO(design): add a raster apple-touch-icon.png and a maskable PWA icon
    // set when the delivery panel's manifest lands (plan section 3.2).
    icon: '/icons/favicon.svg',
  },
  openGraph: {
    type: 'website',
    siteName: APP_NAME,
    locale: 'en_IN',
    url: SITE_URL,
    title: APP_TITLE,
    description: APP_DESCRIPTION,
  },
  twitter: {
    card: 'summary_large_image',
    title: APP_TITLE,
    description: APP_DESCRIPTION,
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  // Both grounds are fully designed, so the browser chrome follows the
  // ground. These are `--ground` from tokens.css, and they are the ONLY
  // place in the app allowed to restate it: a <meta> tag is evaluated
  // outside any CSS cascade, so it cannot read a custom property and has
  // to be kept in step by hand. If `--ground` changes, change these —
  // otherwise the phone's status bar sits in one colour directly above a
  // page in another.
  // These two must track `--ground` in tokens.css: the browser paints the
  // address bar and the area behind an overscroll with them, so a stale
  // value shows as a band of the PREVIOUS design system above the page.
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#fbf8f1' },
    { media: '(prefers-color-scheme: dark)', color: '#0d130c' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN" className={`${display.variable} ${body.variable} ${data.variable}`}>
      <head>
        {/*
          Runs before first paint, on the user's own machine, reading the user's
          own clock and their stored theme. Without it a dark-mode user gets one
          light frame and the circadian ground snaps in after hydration.

          Safe: the string is a build-time constant from the design system.
          Nothing user-supplied can reach it.
        */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        {/* Pillar 6 — ink & paper. A grain plate over everything, never
            interactive, opacity driven by the circadian tokens. */}
        <div className="mnd-grain" aria-hidden="true" />

        <a className="skip-link" href="#main">
          Skip to content
        </a>

        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
