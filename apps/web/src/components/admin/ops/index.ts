/**
 * ★ THE OPERATIONS COMPONENT SET
 *
 * The pieces that only exist because the ADMIN role has a different job from
 * the SUPER_ADMIN role: queues instead of totals, lanes instead of trends, and
 * an SLA that has to be readable across a warehouse.
 *
 * They live under `components/admin/ops/` rather than in the top-level admin
 * barrel for one reason: everything in `@/components/admin` is shared by all
 * eighteen screens, and adding board-specific components there would make the
 * contract harder to hold still. Import from `@/components/admin/ops`.
 *
 * The house rules still apply in full — integer paise into `<Money/>`, colour
 * never alone, every animation off under `prefers-reduced-motion`, and nothing
 * parked at `opacity: 0`.
 */

export { SlaIndicator, slaPhrase } from './SlaIndicator';
export type { SlaIndicatorProps } from './SlaIndicator';

export { QueueTile } from './QueueTile';
export type { QueueTileProps, QueueTone } from './QueueTile';

export { LiveMeta } from './LiveMeta';
export type { LiveMetaProps } from './LiveMeta';

export { BoardCardView } from './BoardCard';
export type { BoardCardProps } from './BoardCard';

export { BoardLaneView } from './BoardLane';
export type { BoardLaneProps } from './BoardLane';

export { OpsDashboard } from './OpsDashboard';
