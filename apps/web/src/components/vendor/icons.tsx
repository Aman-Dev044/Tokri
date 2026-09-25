/**
 * The panel's icons — inline SVG, no library.
 *
 * All on a 24×24 box with a 1.75 stroke: heavier than a marketing icon set on
 * purpose, because this is read at arm's length in a shop under fluorescent
 * light, sometimes by someone whose hands are wet and whose eyes are on a
 * customer. `currentColor` throughout, so an icon inherits whatever the
 * surrounding token decided — which is what keeps them correct in both themes
 * without a single colour declared here.
 *
 * Every one is `aria-hidden`: an icon in this panel always sits beside a word.
 */

import type { CSSProperties } from 'react';

export interface IconProps {
  className?: string;
  style?: CSSProperties;
}

function Glyph({
  className,
  style,
  children,
}: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      className={['ven-icon', className].filter(Boolean).join(' ')}
      style={style}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

/* ── navigation ──────────────────────────────────────────────────── */

export const IconDashboard = (props: IconProps) => (
  <Glyph {...props}>
    <rect x="3" y="3" width="7.5" height="9" rx="2" />
    <rect x="13.5" y="3" width="7.5" height="5.5" rx="2" />
    <rect x="3" y="15" width="7.5" height="6" rx="2" />
    <rect x="13.5" y="11.5" width="7.5" height="9.5" rx="2" />
  </Glyph>
);

export const IconOrders = (props: IconProps) => (
  <Glyph {...props}>
    <path d="M3.5 8h17l-1.4 10.3A2.4 2.4 0 0 1 16.7 20.5H7.3a2.4 2.4 0 0 1-2.4-2.2L3.5 8Z" />
    <path d="M8.5 8V6a3.5 3.5 0 0 1 7 0v2" />
  </Glyph>
);

export const IconProducts = (props: IconProps) => (
  <Glyph {...props}>
    <path d="M12 3 20.5 7.5v9L12 21l-8.5-4.5v-9L12 3Z" />
    <path d="M3.5 7.5 12 12l8.5-4.5M12 12v9" />
  </Glyph>
);

export const IconStock = (props: IconProps) => (
  <Glyph {...props}>
    <rect x="3" y="4" width="18" height="6" rx="1.8" />
    <rect x="3" y="14" width="18" height="6" rx="1.8" />
    <path d="M7.5 7h3M7.5 17h3" />
  </Glyph>
);

export const IconRiders = (props: IconProps) => (
  <Glyph {...props}>
    <circle cx="5.5" cy="17.5" r="3" />
    <circle cx="18.5" cy="17.5" r="3" />
    <path d="M8.5 17.5h6l-2-8h-3M12.5 9.5l5 3.5" />
  </Glyph>
);

export const IconEarnings = (props: IconProps) => (
  <Glyph {...props}>
    <path d="M4 19V9.5M10 19V5M16 19v-6.5M22 19H2" />
  </Glyph>
);

export const IconSettings = (props: IconProps) => (
  <Glyph {...props}>
    <circle cx="12" cy="12" r="3.2" />
    <path d="M12 2.5v2.4M12 19.1v2.4M4.3 4.3l1.7 1.7M18 18l1.7 1.7M2.5 12h2.4M19.1 12h2.4M4.3 19.7 6 18M18 6l1.7-1.7" />
  </Glyph>
);

/* ── chrome ──────────────────────────────────────────────────────── */

export const IconChevronLeft = (props: IconProps) => (
  <Glyph {...props}>
    <path d="M14.5 5.5 8 12l6.5 6.5" />
  </Glyph>
);

export const IconChevronRight = (props: IconProps) => (
  <Glyph {...props}>
    <path d="M9.5 5.5 16 12l-6.5 6.5" />
  </Glyph>
);

export const IconClose = (props: IconProps) => (
  <Glyph {...props}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Glyph>
);

export const IconPlus = (props: IconProps) => (
  <Glyph {...props}>
    <path d="M12 5v14M5 12h14" />
  </Glyph>
);

export const IconAlert = (props: IconProps) => (
  <Glyph {...props}>
    <path d="M12 3.5 21 19H3l9-15.5Z" />
    <path d="M12 9.5v4.5M12 17h.01" />
  </Glyph>
);

export const IconLock = (props: IconProps) => (
  <Glyph {...props}>
    <rect x="4.5" y="10" width="15" height="10.5" rx="2.4" />
    <path d="M8 10V7.5a4 4 0 0 1 8 0V10" />
  </Glyph>
);

export const IconSun = (props: IconProps) => (
  <Glyph {...props}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2.5v2M12 19.5v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M2.5 12h2M19.5 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4" />
  </Glyph>
);

export const IconMoon = (props: IconProps) => (
  <Glyph {...props}>
    <path d="M20 14.2A8.2 8.2 0 0 1 9.8 4 8.4 8.4 0 1 0 20 14.2Z" />
  </Glyph>
);

export const IconSignOut = (props: IconProps) => (
  <Glyph {...props}>
    <path d="M14 20H6.5A2.5 2.5 0 0 1 4 17.5v-11A2.5 2.5 0 0 1 6.5 4H14" />
    <path d="M16.5 8.5 20 12l-3.5 3.5M20 12H9.5" />
  </Glyph>
);

export const IconExternal = (props: IconProps) => (
  <Glyph {...props}>
    <path d="M13.5 4.5H20v6.5M20 4.5 11 13.5" />
    <path d="M18 14.5v3.6A2.4 2.4 0 0 1 15.6 20.5H5.9A2.4 2.4 0 0 1 3.5 18.1V8.4A2.4 2.4 0 0 1 5.9 6h3.6" />
  </Glyph>
);

export const IconUser = (props: IconProps) => (
  <Glyph {...props}>
    <circle cx="12" cy="8" r="3.6" />
    <path d="M4.8 20.2a7.4 7.4 0 0 1 14.4 0" />
  </Glyph>
);

export const IconInbox = (props: IconProps) => (
  <Glyph {...props}>
    <path d="M3.5 13.5h4l1.4 2.6h6.2l1.4-2.6h4" />
    <path d="M6.2 4.5h11.6l2.7 9v4.6a2.4 2.4 0 0 1-2.4 2.4H5.9a2.4 2.4 0 0 1-2.4-2.4v-4.6l2.7-9Z" />
  </Glyph>
);

export const IconSearch = (props: IconProps) => (
  <Glyph {...props}>
    <circle cx="10.5" cy="10.5" r="6" />
    <path d="m15 15 5 5" />
  </Glyph>
);

export const IconRefresh = (props: IconProps) => (
  <Glyph {...props}>
    <path d="M20 11.5A8 8 0 1 0 18.3 17" />
    <path d="M20.5 5v5.5H15" />
  </Glyph>
);

export const IconSoundOn = (props: IconProps) => (
  <Glyph {...props}>
    <path d="M11 5 6.5 9H3v6h3.5L11 19V5Z" />
    <path d="M15.5 9.5a3.5 3.5 0 0 1 0 5M18 7a7 7 0 0 1 0 10" />
  </Glyph>
);

export const IconSoundOff = (props: IconProps) => (
  <Glyph {...props}>
    <path d="M11 5 6.5 9H3v6h3.5L11 19V5Z" />
    <path d="m16 10 4 4m0-4-4 4" />
  </Glyph>
);

export const IconMenu = (props: IconProps) => (
  <Glyph {...props}>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </Glyph>
);
