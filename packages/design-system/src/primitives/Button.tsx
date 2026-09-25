'use client';

import { forwardRef } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { GroceryLoaderInline } from '../components/GroceryLoader';

export type ButtonVariant = 'solid' | 'outline' | 'ghost';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /**
   * Swaps the label for the inline grocery loader and blocks the click.
   * The button keeps its width so the layout does not jump.
   */
  loading?: boolean;
  /** what the screen reader hears while `loading` is true */
  loadingLabel?: string;
  /** stretch to the width of the container */
  block?: boolean;
  iconLeft?: ReactNode;
  iconRight?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'solid',
    size = 'md',
    loading = false,
    loadingLabel = 'Working',
    block = false,
    iconLeft,
    iconRight,
    disabled,
    className,
    children,
    type = 'button',
    ...rest
  },
  ref,
) {
  const isDisabled = disabled || loading;

  return (
    <button
      {...rest}
      ref={ref}
      type={type}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      data-loading={loading ? 'true' : undefined}
      className={[
        'mnd-btn',
        `mnd-btn--${variant}`,
        `mnd-btn--${size}`,
        block ? 'mnd-btn--block' : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {/* The label stays in the DOM while loading so the button keeps its
          intrinsic width - swapping it for a spinner would make every form
          jump on submit. It is hidden from AT, and the loader announces. */}
      <span className="mnd-btn__content" aria-hidden={loading || undefined}>
        {iconLeft ? <span className="mnd-btn__icon">{iconLeft}</span> : null}
        <span className="mnd-btn__label">{children}</span>
        {iconRight ? <span className="mnd-btn__icon">{iconRight}</span> : null}
      </span>

      {loading ? (
        <span className="mnd-btn__loader">
          <GroceryLoaderInline
            size={size === 'lg' ? 24 : size === 'sm' ? 16 : 20}
            label={loadingLabel}
          />
        </span>
      ) : null}
    </button>
  );
});
