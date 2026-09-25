/**
 * The admin icon set — 24px grid, 1.5 stroke, `currentColor`, no fills.
 *
 * Hand-drawn rather than pulled from a package for three reasons: the console
 * needs thirteen specific nav glyphs and about ten UI ones, an icon dependency
 * is 40kB for that, and a stroke-only set on a shared grid stays optically
 * consistent in a way a mixed-source set never does.
 *
 * Every icon is `aria-hidden`. Icons in this console never carry meaning alone
 * (plan §2.6) — there is always a label, a title, or `.adm-sr` text beside one.
 */

import type { SVGProps } from 'react';
import type { NavIconKey } from '@/lib/admin/nav';

type IconProps = SVGProps<SVGSVGElement>;

function Icon({ children, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

/* ---- navigation ---------------------------------------------------------- */

export const IconOverview = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 19V10M9.5 19V5M15 19v-6M20.5 19v-9" />
  </Icon>
);

export const IconVendors = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3.5 9.5 5 4.5h14l1.5 5" />
    <path d="M4.5 9.5v10h15v-10" />
    <path d="M3.5 9.5a2.5 2.5 0 0 0 4.25 1.4 2.5 2.5 0 0 0 4.25-1.4 2.5 2.5 0 0 0 4.25 1.4 2.5 2.5 0 0 0 4.25-1.4" />
    <path d="M10 19.5v-5h4v5" />
  </Icon>
);

export const IconOrders = (p: IconProps) => (
  <Icon {...p}>
    <path d="M5 4h11l3 3v13H5z" />
    <path d="M8.5 10h7M8.5 13.5h7M8.5 17h4" />
  </Icon>
);

export const IconCustomers = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="9" cy="8.5" r="3" />
    <path d="M3.5 19.5a5.5 5.5 0 0 1 11 0" />
    <path d="M16 6.2a3 3 0 0 1 0 5.6M17.5 15.2a5.5 5.5 0 0 1 3 4.3" />
  </Icon>
);

export const IconRiders = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="5.5" cy="16.5" r="3" />
    <circle cx="18.5" cy="16.5" r="3" />
    <path d="M8.5 16.5h6l-2-8h-2" />
    <path d="M14.5 8.5h3l1 8" />
  </Icon>
);

export const IconCatalog = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3.5" y="4" width="7" height="7" rx="1" />
    <rect x="13.5" y="4" width="7" height="7" rx="1" />
    <rect x="3.5" y="13.5" width="7" height="7" rx="1" />
    <rect x="13.5" y="13.5" width="7" height="7" rx="1" />
  </Icon>
);

export const IconPayments = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3" y="6" width="18" height="12" rx="2" />
    <path d="M3 10h18M6.5 14.5h3" />
  </Icon>
);

export const IconSettlements = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 3.5v17" />
    <path d="M7.5 6.5h6a2.75 2.75 0 0 1 0 5.5h-6" />
    <path d="M7.5 9.5h9M7.5 16.5c1.5 2.5 4 3.5 8 3.5" />
  </Icon>
);

export const IconCoupons = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3.5 8.5V6.5h17v2a2 2 0 0 0 0 7v2h-17v-2a2 2 0 0 0 0-7Z" />
    <path d="M13.5 6.5v11" strokeDasharray="2 2.5" />
  </Icon>
);

export const IconReports = (p: IconProps) => (
  <Icon {...p}>
    <path d="M6 3.5h8l4 4v13H6z" />
    <path d="M13.5 3.5v4.5H18" />
    <path d="M9.5 16.5v-3M12 16.5v-5M14.5 16.5v-2" />
  </Icon>
);

export const IconAudit = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 3.5 4.5 6.5v5.2c0 4.1 3 7.4 7.5 8.8 4.5-1.4 7.5-4.7 7.5-8.8V6.5Z" />
    <path d="m9 12 2 2 4-4" />
  </Icon>
);

export const IconTeam = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="7.5" r="3.2" />
    <path d="M5.5 20a6.5 6.5 0 0 1 13 0" />
  </Icon>
);

export const IconSettings = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 3v2.2M12 18.8V21M4.2 7.5l1.9 1.1M17.9 15.4l1.9 1.1M4.2 16.5l1.9-1.1M17.9 8.6l1.9-1.1" />
  </Icon>
);

/* ---- operations ---------------------------------------------------------- */

/** Kanban columns — the live order board. */
export const IconBoard = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3.5 4.5h17v15h-17z" />
    <path d="M9 4.5v15M15 4.5v15" />
    <path d="M5.5 8h1.5M11 8h2M16.5 8h2" />
  </Icon>
);

/** A route with a waypoint — assigning work to a rider. */
export const IconDispatch = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="6" cy="6.5" r="2.5" />
    <circle cx="18" cy="17.5" r="2.5" />
    <path d="M8.5 6.5h5a3.5 3.5 0 0 1 0 7h-3a3.5 3.5 0 0 0 0 7h.5" />
  </Icon>
);

/** An inbox with a tick — a queue you clear by saying yes or no. */
export const IconApprovals = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3.5 12.5h4l1.5 2.5h6l1.5-2.5h4" />
    <path d="M3.5 12.5 6 5h12l2.5 7.5v6.5h-17z" />
    <path d="m9.5 9 1.8 1.8L15 7" />
  </Icon>
);

/** A speech bubble with a bang — a customer is unhappy. */
export const IconIssues = (p: IconProps) => (
  <Icon {...p}>
    <path d="M20.5 12.5a7 7 0 0 1-7 7H8l-4 2.5v-4.3a7 7 0 0 1 3.5-13A7 7 0 0 1 20.5 12.5Z" />
    <path d="M12 7.5v4.2" />
    <circle cx="12" cy="15" r="0.6" fill="currentColor" />
  </Icon>
);

/** Boxes with one shelf running empty. */
export const IconStock = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 4.5h7v6H4zM13 4.5h7v6h-7zM4 13.5h7v6H4z" />
    <path d="M13 13.5h7v6h-7z" strokeDasharray="2.5 2.5" />
  </Icon>
);

export const NAV_ICONS: Record<NavIconKey, (p: IconProps) => React.JSX.Element> = {
  overview: IconOverview,
  board: IconBoard,
  dispatch: IconDispatch,
  approvals: IconApprovals,
  issues: IconIssues,
  stock: IconStock,
  vendors: IconVendors,
  orders: IconOrders,
  customers: IconCustomers,
  riders: IconRiders,
  catalog: IconCatalog,
  payments: IconPayments,
  settlements: IconSettlements,
  coupons: IconCoupons,
  reports: IconReports,
  audit: IconAudit,
  team: IconTeam,
  settings: IconSettings,
};

/* ---- UI ------------------------------------------------------------------ */

export const IconSearch = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m16 16 4 4" />
  </Icon>
);

export const IconBell = (p: IconProps) => (
  <Icon {...p}>
    <path d="M6.5 10a5.5 5.5 0 0 1 11 0c0 4 1.5 5.5 1.5 5.5H5S6.5 14 6.5 10Z" />
    <path d="M10 18.5a2.2 2.2 0 0 0 4 0" />
  </Icon>
);

export const IconSun = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.2 5.2l1.4 1.4M17.4 17.4l1.4 1.4M5.2 18.8l1.4-1.4M17.4 6.6l1.4-1.4" />
  </Icon>
);

export const IconMoon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M20 14.2A8.2 8.2 0 0 1 9.8 4a8.5 8.5 0 1 0 10.2 10.2Z" />
  </Icon>
);

export const IconChevronLeft = (p: IconProps) => (
  <Icon {...p}>
    <path d="m14.5 5.5-6 6.5 6 6.5" />
  </Icon>
);

export const IconChevronRight = (p: IconProps) => (
  <Icon {...p}>
    <path d="m9.5 5.5 6 6.5-6 6.5" />
  </Icon>
);

export const IconChevronDown = (p: IconProps) => (
  <Icon {...p}>
    <path d="m6 9.5 6 6 6-6" />
  </Icon>
);

export const IconArrowUp = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 19V5M6 11l6-6 6 6" />
  </Icon>
);

export const IconClose = (p: IconProps) => (
  <Icon {...p}>
    <path d="m6 6 12 12M18 6 6 18" />
  </Icon>
);

export const IconMenu = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </Icon>
);

export const IconAlert = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 4.5 2.8 20h18.4Z" />
    <path d="M12 10v4M12 17h.01" />
  </Icon>
);

export const IconInbox = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3.5 13.5h4l1.5 3h6l1.5-3h4" />
    <path d="M3.5 13.5 6 5h12l2.5 8.5V19h-17Z" />
  </Icon>
);

export const IconRefresh = (p: IconProps) => (
  <Icon {...p}>
    <path d="M20 12a8 8 0 1 1-2.6-5.9" />
    <path d="M20.5 4v4h-4" />
  </Icon>
);

export const IconPlus = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 5v14M5 12h14" />
  </Icon>
);

export const IconExternal = (p: IconProps) => (
  <Icon {...p}>
    <path d="M14 4.5h5.5V10" />
    <path d="M19.5 4.5 11 13" />
    <path d="M18 14v5.5H4.5V6H10" />
  </Icon>
);

export const IconLock = (p: IconProps) => (
  <Icon {...p}>
    <rect x="5" y="10.5" width="14" height="9" rx="2" />
    <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" />
  </Icon>
);

export const IconSignOut = (p: IconProps) => (
  <Icon {...p}>
    <path d="M14 5.5H6.5v13H14" />
    <path d="M11 12h9M17 8.5l3.5 3.5-3.5 3.5" />
  </Icon>
);

export const IconPin = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 21s6.5-6.1 6.5-10.5a6.5 6.5 0 1 0-13 0C5.5 14.9 12 21 12 21Z" />
    <circle cx="12" cy="10.5" r="2.5" />
  </Icon>
);

export const IconClock = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 1.8" />
  </Icon>
);

export const IconCheck = (p: IconProps) => (
  <Icon {...p}>
    <path d="m5 12.5 4.5 4.5L19 7" />
  </Icon>
);

export const IconPause = (p: IconProps) => (
  <Icon {...p}>
    <path d="M9.5 5.5v13M14.5 5.5v13" />
  </Icon>
);

export const IconUser = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="8" r="3.5" />
    <path d="M5 20a7 7 0 0 1 14 0" />
  </Icon>
);
