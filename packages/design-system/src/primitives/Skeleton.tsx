'use client';

import type { CSSProperties } from 'react';

export interface SkeletonProps {
  /** any CSS length; defaults to 100% */
  width?: string;
  height?: string;
  /** 'line' for text, 'block' for media, 'circle' for avatars */
  shape?: 'line' | 'block' | 'circle';
  /** stagger the shimmer across a stack of skeletons */
  index?: number;
  className?: string;
  style?: CSSProperties;
}

/**
 * A single placeholder bar. For whole cards use <GroceryLoader.Skeleton/>,
 * which carries the basket watermark and the aisle-tinted sweep.
 */
export function Skeleton({
  width = '100%',
  height,
  shape = 'line',
  index = 0,
  className,
  style,
}: SkeletonProps) {
  return (
    <span
      aria-hidden="true"
      className={['mnd-skel-bar', `mnd-skel-bar--${shape}`, className]
        .filter(Boolean)
        .join(' ')}
      style={{
        ...style,
        width,
        ...(height ? { height } : null),
        ['--mnd-skel-i' as string]: String(index),
      }}
    />
  );
}
