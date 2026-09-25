'use client';

/**
 * PILLAR 3 — THE BASKET IS A PHYSICAL OBJECT.
 *
 * This holds the state; `BasketDock` draws it. Together they are a basket, not
 * a badge with a number: contents render as a rising mass, an Add arcs the
 * product into the dock and the dock squashes as it catches.
 *
 * ── ONE VENDOR PER BASKET (plan decision #1) ────────────────────────────────
 * One vendor per cart, one vendor per order — that single decision is what
 * makes an order equal one pickup and one rider. Adding from a different store
 * therefore cannot silently merge. It also must not silently destroy: the old
 * basket is PARKED (saved, restorable, `POST /cart/park`), the customer is told
 * so in words, and a restore link stays available. Nobody loses a basket
 * because they tapped the wrong shop.
 *
 * ── OPTIMISTIC LOCALLY, MIRRORED TO THE API ─────────────────────────────────
 * Every mutation lands in local state first and is then mirrored to `/cart`.
 * `isLocalOnly` goes true ONLY when the API could not be reached at all — a
 * network failure — which the dock and the cart page state plainly. A basket
 * that silently stops saving is worse than one that says it is only on this
 * device.
 *
 * A 4xx is NOT a reason to go local-only: it means the server considered the
 * request and refused it (409 `INSUFFICIENT_STOCK`, for instance). That is
 * surfaced as a toast and the server stays the authority. Treating a refusal as
 * "the API is missing" is how a genuine stock conflict turned into a banner
 * claiming the cart service was down.
 *
 * ── THE VENDOR COMES FROM THE SHELF, NOT THE PRODUCT ────────────────────────
 * `ProductRow` (`GET /stores/:id/products`) carries no `vendorId`; only
 * `ProductDetail` carries a `store`. So `add()` takes the store explicitly and
 * every caller passes the one it fetched from.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useToast } from '@mandi/design-system';
import { api, ApiError } from '@/lib/api-client';
import { invalidateShop } from '@/hooks/useShopQuery';
import type { Product } from '@/lib/shop/types';

/**
 * The server's per-line ceiling (`MAX_QTY_PER_LINE` in the cart DTO). Asking
 * for more is a 400, so the stepper stops here rather than letting the
 * customer type their way into a rejected request.
 */
export const MAX_QTY_PER_LINE = 20;

/* ───────────────────────────────── model ───────────────────────────────── */

export interface BasketLine {
  productId: string;
  name: string;
  image: string | null;
  unit: string | null;
  pricePaise: number;
  qty: number;
  maxQty: number | null;
}

export interface BasketStore {
  vendorId: string;
  storeName: string;
  storeSlug: string | null;
}

export interface ParkedBasket extends BasketStore {
  lines: BasketLine[];
  parkedAt: number;
}

interface PendingSwitch {
  from: BasketStore;
  to: BasketStore;
  product: Product;
  qty: number;
}

interface BasketValue {
  store: BasketStore | null;
  lines: BasketLine[];
  /** total units, not distinct lines — the dock shows weight, not variety */
  count: number;
  subtotalPaise: number;
  /** 0…1, how full the basket looks. Drives the rising mass. */
  fullness: number;
  isLocalOnly: boolean;
  hydrated: boolean;

  add: (product: Product, store: BasketStore, qty: number, origin?: HTMLElement | null) => void;
  setQty: (productId: string, qty: number) => void;
  remove: (productId: string) => void;
  clear: () => void;
  qtyOf: (productId: string) => number;

  parked: ParkedBasket | null;
  restoreParked: () => void;
  discardParked: () => void;

  pendingSwitch: PendingSwitch | null;
  confirmSwitch: () => void;
  cancelSwitch: () => void;

  /** BasketDock hands its element over so Add knows where to fly to */
  registerDock: (element: HTMLElement | null) => void;
}

const BasketContext = createContext<BasketValue | null>(null);

/* ────────────────────────────── persistence ────────────────────────────── */

const KEY_ACTIVE = 'mandi.basket';
const KEY_PARKED = 'mandi.basket.parked';

/** A basket is a shopping list, not a credential. localStorage is right here. */
interface Persisted {
  store: BasketStore | null;
  lines: BasketLine[];
}

function readJson<T>(key: string): T | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? null : (JSON.parse(raw) as T);
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode / quota — a basket we cannot cache still works this session */
  }
}

/* ───────────────────────────── the flight ──────────────────────────────── */

/** How many units read as "full". Beyond it the mass simply stays at the brim. */
const FULL_AT = 18;

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Arc the product into the basket.
 *
 * A straight line reads as a UI transition. An arc reads as something being
 * tossed into a basket, which is the whole point of Pillar 3. The path is a
 * quadratic Bézier with its control point lifted above both ends, sampled into
 * keyframes because the Web Animations API cannot interpolate a curve on its
 * own without `offset-path`, which Safari only partly supports.
 *
 * Under `prefers-reduced-motion` nothing flies. The dock still updates.
 */
function flyToBasket(origin: HTMLElement, dock: HTMLElement, image: string | null): void {
  if (prefersReducedMotion()) {
    dock.setAttribute('data-catch', 'true');
    window.setTimeout(() => {
      dock.removeAttribute('data-catch');
    }, 60);
    return;
  }

  const from = origin.getBoundingClientRect();
  const to = dock.getBoundingClientRect();
  if (from.width === 0 || to.width === 0) return;

  const size = 56;
  const startX = from.left + from.width / 2 - size / 2;
  const startY = from.top + from.height / 2 - size / 2;
  const endX = to.left + to.width / 2 - size / 2;
  const endY = to.top + to.height / 2 - size / 2;

  const node = document.createElement('div');
  node.className = 'shop-fly';
  node.setAttribute('aria-hidden', 'true');
  if (image !== null) node.style.backgroundImage = `url(${JSON.stringify(image)})`;
  node.style.left = `${startX}px`;
  node.style.top = `${startY}px`;
  node.style.width = `${size}px`;
  node.style.height = `${size}px`;
  document.body.appendChild(node);

  // Control point: above the higher of the two ends, biased towards the start,
  // so the item is lobbed rather than swept sideways.
  const peak = Math.min(startY, endY) - Math.max(90, Math.abs(endX - startX) * 0.28);
  const controlX = startX + (endX - startX) * 0.35;

  const STEPS = 24;
  const frames: Keyframe[] = [];
  for (let i = 0; i <= STEPS; i += 1) {
    const t = i / STEPS;
    const inv = 1 - t;
    const x = inv * inv * startX + 2 * inv * t * controlX + t * t * endX;
    const y = inv * inv * startY + 2 * inv * t * peak + t * t * endY;
    frames.push({
      offset: t,
      transform: `translate(${(x - startX).toFixed(1)}px, ${(y - startY).toFixed(1)}px) scale(${(1 - t * 0.55).toFixed(3)}) rotate(${(t * 38).toFixed(1)}deg)`,
      opacity: t > 0.88 ? 0 : 1,
    });
  }

  const animation = node.animate(frames, {
    duration: 620,
    easing: 'cubic-bezier(.4,0,.2,1)',
    fill: 'forwards',
  });

  animation.addEventListener('finish', () => {
    node.remove();
    // The catch. The squash itself is CSS, on the spring curve the brief names
    // — one signature spring in the product, spent here.
    dock.setAttribute('data-catch', 'true');
    window.setTimeout(() => {
      dock.removeAttribute('data-catch');
    }, 420);
  });
}

/* ──────────────────────────────── provider ─────────────────────────────── */

export function BasketProvider({ children }: { children: ReactNode }) {
  const { toast } = useToast();
  const [store, setStore] = useState<BasketStore | null>(null);
  const [lines, setLines] = useState<BasketLine[]>([]);
  const [parked, setParked] = useState<ParkedBasket | null>(null);
  const [pendingSwitch, setPendingSwitch] = useState<PendingSwitch | null>(null);
  const [isLocalOnly, setIsLocalOnly] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const dockRef = useRef<HTMLElement | null>(null);

  /* ---- restore after mount (never during render: hydration) ---- */
  useEffect(() => {
    const saved = readJson<Persisted>(KEY_ACTIVE);
    if (saved !== null && Array.isArray(saved.lines)) {
      setStore(saved.store ?? null);
      setLines(saved.lines);
    }
    setParked(readJson<ParkedBasket>(KEY_PARKED));
    setHydrated(true);
  }, []);

  /* ---- mirror to storage ---- */
  useEffect(() => {
    if (!hydrated) return;
    writeJson(KEY_ACTIVE, { store, lines } satisfies Persisted);
  }, [store, lines, hydrated]);

  /* ---- the API mirror ---- */
  const mirror = useCallback(
    (run: () => Promise<unknown>) => {
      void run()
        .then(() => {
          setIsLocalOnly(false);
          invalidateShop('/cart');
        })
        .catch((cause: unknown) => {
          if (!(cause instanceof ApiError)) {
            setIsLocalOnly(true);
            return;
          }
          // 401 is not a cart problem — it is a sign-in problem, and the cart
          // route is behind middleware anyway.
          if (cause.status === 401) return;

          // Unreachable API ⇒ the basket is genuinely only on this device.
          if (cause.isNetworkError) {
            setIsLocalOnly(true);
            return;
          }

          // The server considered it and refused: a stock conflict, a closed
          // store, a line at the per-line ceiling. It is still the authority,
          // so say what it said and re-read the real cart.
          toast({
            tone: 'warn',
            title: 'The store could not take that change',
            description: cause.friendlyMessage,
          });
          invalidateShop('/cart');
        });
    },
    [toast],
  );

  const applyAdd = useCallback(
    (nextStore: BasketStore, product: Product, qty: number, origin?: HTMLElement | null) => {
      const ceiling = Math.min(product.availableQty, MAX_QTY_PER_LINE);
      setStore(nextStore);
      setLines((prev) => {
        const existing = prev.find((line) => line.productId === product.id);
        if (existing) {
          return prev.map((line) =>
            line.productId === product.id
              ? { ...line, qty: Math.min(line.qty + qty, line.maxQty ?? MAX_QTY_PER_LINE) }
              : line,
          );
        }
        return [
          ...prev,
          {
            productId: product.id,
            name: product.name,
            image: product.images[0] ?? null,
            unit: product.unit,
            pricePaise: product.price,
            qty: Math.min(qty, ceiling),
            maxQty: ceiling,
          },
        ];
      });

      if (origin && dockRef.current) {
        flyToBasket(origin, dockRef.current, product.images[0] ?? null);
      }

      mirror(() =>
        api.post('/cart/items', { vendorId: nextStore.vendorId, productId: product.id, qty }),
      );
    },
    [mirror],
  );

  const add = useCallback(
    (product: Product, target: BasketStore, qty: number, origin?: HTMLElement | null) => {
      if (store !== null && lines.length > 0 && store.vendorId !== target.vendorId) {
        // Do not merge, do not destroy. Ask.
        setPendingSwitch({ from: store, to: target, product, qty });
        return;
      }
      applyAdd(store !== null && lines.length > 0 ? store : target, product, qty, origin);
    },
    [store, lines.length, applyAdd],
  );

  const setQty = useCallback(
    (productId: string, qty: number) => {
      if (qty <= 0) {
        setLines((prev) => prev.filter((line) => line.productId !== productId));
        mirror(() => api.delete(`/cart/items/${encodeURIComponent(productId)}`));
        return;
      }
      setLines((prev) =>
        prev.map((line) => (line.productId === productId ? { ...line, qty } : line)),
      );
      mirror(() => api.patch(`/cart/items/${encodeURIComponent(productId)}`, { qty }));
    },
    [mirror],
  );

  const remove = useCallback(
    (productId: string) => {
      setQty(productId, 0);
    },
    [setQty],
  );

  const clear = useCallback(() => {
    setLines([]);
    setStore(null);
  }, []);

  const confirmSwitch = useCallback(() => {
    if (pendingSwitch === null) return;
    const { from, to, product, qty } = pendingSwitch;

    const nextParked: ParkedBasket = { ...from, lines, parkedAt: Date.now() };
    setParked(nextParked);
    writeJson(KEY_PARKED, nextParked);
    mirror(() => api.post('/cart/park', { vendorId: from.vendorId }));

    setLines([]);
    setPendingSwitch(null);
    applyAdd(to, product, qty, null);

    toast({
      tone: 'info',
      title: `${from.storeName} basket parked`,
      description: 'Nothing was thrown away — restore it from the basket at any time.',
    });
  }, [pendingSwitch, lines, mirror, applyAdd, toast]);

  const cancelSwitch = useCallback(() => {
    setPendingSwitch(null);
  }, []);

  const restoreParked = useCallback(() => {
    if (parked === null) return;
    // Symmetry: restoring parks whatever is in the basket now, so this is never
    // the action that loses something either.
    if (lines.length > 0 && store !== null) {
      const swap: ParkedBasket = { ...store, lines, parkedAt: Date.now() };
      setParked(swap);
      writeJson(KEY_PARKED, swap);
    } else {
      setParked(null);
      writeJson(KEY_PARKED, null);
    }
    setStore({ vendorId: parked.vendorId, storeName: parked.storeName, storeSlug: parked.storeSlug });
    setLines(parked.lines);
  }, [parked, lines, store]);

  const discardParked = useCallback(() => {
    setParked(null);
    writeJson(KEY_PARKED, null);
  }, []);

  const registerDock = useCallback((element: HTMLElement | null) => {
    dockRef.current = element;
  }, []);

  const qtyOf = useCallback(
    (productId: string) => lines.find((line) => line.productId === productId)?.qty ?? 0,
    [lines],
  );

  const count = lines.reduce((sum, line) => sum + line.qty, 0);
  const subtotalPaise = lines.reduce((sum, line) => sum + line.pricePaise * line.qty, 0);

  const value = useMemo<BasketValue>(
    () => ({
      store,
      lines,
      count,
      subtotalPaise,
      fullness: Math.min(1, count / FULL_AT),
      isLocalOnly,
      hydrated,
      add,
      setQty,
      remove,
      clear,
      qtyOf,
      parked,
      restoreParked,
      discardParked,
      pendingSwitch,
      confirmSwitch,
      cancelSwitch,
      registerDock,
    }),
    [
      store,
      lines,
      count,
      subtotalPaise,
      isLocalOnly,
      hydrated,
      add,
      setQty,
      remove,
      clear,
      qtyOf,
      parked,
      restoreParked,
      discardParked,
      pendingSwitch,
      confirmSwitch,
      cancelSwitch,
      registerDock,
    ],
  );

  return <BasketContext.Provider value={value}>{children}</BasketContext.Provider>;
}

export function useBasket(): BasketValue {
  const ctx = useContext(BasketContext);
  if (!ctx) throw new Error('useBasket must be used inside <BasketProvider>');
  return ctx;
}
