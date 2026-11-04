'use client';

/**
 * Which products this customer has saved — the state behind every heart.
 *
 * `GET /wishlist` returns the WHOLE list (the API caps it at 200), so one
 * request on load is enough to draw the heart on every card of every shelf
 * without a per-card lookup. A toggle flips the heart at once and then
 * asks the API; the API's writes are idempotent, so a double tap cannot
 * end in a state the customer did not see. A refusal flips it back and
 * says why.
 *
 * ── SIGNED OUT ──────────────────────────────────────────────────────────────
 * Browsing before login is a feature, so the heart is drawn for everyone.
 * Tapping it without a session goes to `/login?next=<this page>` — the same
 * `next` the middleware uses — rather than failing silently or saving to
 * this device and pretending that is the same thing.
 */

import { usePathname, useRouter } from 'next/navigation';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useToast } from '@mandi/design-system';
import { useAuth } from '@/components/auth/AuthProvider';
import { api, ApiError } from '@/lib/api-client';
import { invalidateShop, useShopQuery } from '@/hooks/useShopQuery';
import { readWishlist, type WishlistRow } from '@/lib/shop/engagement';

interface WishlistValue {
  isSaved: (productId: string) => boolean;
  /** Save or unsave. Signed out, it goes to sign-in instead. */
  toggle: (productId: string, name: string) => void;
  /** A toggle for this product is in flight — the heart disables itself. */
  isPending: (productId: string) => boolean;
  count: number;
}

const WishlistContext = createContext<WishlistValue | null>(null);

export function WishlistProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { toast } = useToast();
  const { user, isAuthenticated } = useAuth();
  const isCustomer = isAuthenticated && user?.role === 'customer';

  const query = useShopQuery<WishlistRow[]>('/wishlist', undefined, {
    read: useCallback((raw: unknown) => readWishlist(raw), []),
    enabled: isCustomer,
  });

  const [saved, setSaved] = useState<Set<string>>(() => new Set());
  const [pending, setPending] = useState<Set<string>>(() => new Set());

  // The server list is the authority whenever it (re)arrives.
  useEffect(() => {
    if (!isCustomer) {
      setSaved(new Set());
      return;
    }
    if (query.data !== null) {
      setSaved(new Set(query.data.map((row) => row.productId)));
    }
  }, [isCustomer, query.data]);

  const toggle = useCallback(
    (productId: string, name: string) => {
      if (!isAuthenticated || user === null) {
        router.push(`/login?next=${encodeURIComponent(pathname || '/shop')}`);
        return;
      }
      if (user.role !== 'customer') {
        toast({
          tone: 'info',
          title: 'Wishlists are for customer accounts',
          description: 'Sign in with a customer account to save products.',
        });
        return;
      }
      if (pending.has(productId)) return;

      const wasSaved = saved.has(productId);
      const flip = (on: boolean) => {
        setSaved((prev) => {
          const next = new Set(prev);
          if (on) next.add(productId);
          else next.delete(productId);
          return next;
        });
      };

      flip(!wasSaved);
      setPending((prev) => new Set(prev).add(productId));

      const path = `/wishlist/${encodeURIComponent(productId)}`;
      const request = wasSaved ? api.delete(path) : api.post(path);

      void request
        .then(() => {
          invalidateShop('/wishlist');
        })
        .catch((cause: unknown) => {
          flip(wasSaved);
          toast({
            tone: 'warn',
            title: wasSaved ? `Could not remove ${name}` : `Could not save ${name}`,
            description:
              cause instanceof ApiError ? cause.friendlyMessage : 'Check your connection and try again.',
          });
        })
        .finally(() => {
          setPending((prev) => {
            const next = new Set(prev);
            next.delete(productId);
            return next;
          });
        });
    },
    [isAuthenticated, user, router, pathname, toast, pending, saved],
  );

  const value = useMemo<WishlistValue>(
    () => ({
      isSaved: (productId) => saved.has(productId),
      toggle,
      isPending: (productId) => pending.has(productId),
      count: saved.size,
    }),
    [saved, pending, toggle],
  );

  return <WishlistContext.Provider value={value}>{children}</WishlistContext.Provider>;
}

/**
 * Null outside the provider — a card rendered somewhere without one simply
 * draws no heart, rather than taking the page down.
 */
export function useWishlist(): WishlistValue | null {
  return useContext(WishlistContext);
}

/* ─────────────────────────────── the heart ─────────────────────────────── */

/**
 * The toggle itself.
 *
 * ★ NO TRANSFORMS, IN ANY STATE. This button sits inside `Tilt3D`. A
 *   transform on an interactive element there — even only while `:active` —
 *   lifts it onto its own 3D layer between press and release, the release
 *   lands on whatever is underneath, and `click` never fires. That exact bug
 *   once disabled the Add button. Feedback here is colour and fill only.
 */
export function WishlistHeart({
  productId,
  name,
  className,
}: {
  productId: string;
  name: string;
  className?: string;
}) {
  const wishlist = useWishlist();
  if (wishlist === null) return null;

  const on = wishlist.isSaved(productId);
  return (
    <button
      type="button"
      className={['shop-heart', className].filter(Boolean).join(' ')}
      data-on={on ? 'true' : 'false'}
      aria-pressed={on}
      aria-label={on ? `Remove ${name} from your wishlist` : `Save ${name} to your wishlist`}
      title={on ? 'Saved — tap to remove' : 'Save for later'}
      disabled={wishlist.isPending(productId)}
      onClick={(event) => {
        // Never let the tap reach a surrounding link.
        event.preventDefault();
        event.stopPropagation();
        wishlist.toggle(productId, name);
      }}
    >
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
        <path
          d="M12 20.5s-7.5-4.6-7.5-10.1A4.3 4.3 0 0 1 12 7.6a4.3 4.3 0 0 1 7.5 2.8c0 5.5-7.5 10.1-7.5 10.1Z"
          fill={on ? 'currentColor' : 'none'}
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}
