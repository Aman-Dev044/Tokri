'use client';

/**
 * Loads the Google Maps JS API — but only if a key actually exists.
 *
 * ── THE KEY (read this before touching it) ──────────────────────────────────
 * `NEXT_PUBLIC_MAPS_BROWSER_KEY` is bundled into client JS and is therefore
 * PUBLIC BY NECESSITY. There is no way to load Maps in a browser without
 * shipping the key to the browser. It is protected the only way a browser key
 * can be protected:
 *
 *   · HTTP-referrer restriction  — in the Google Cloud console, locked to the
 *     app's own origins, so the key is useless from anyone else's page;
 *   · API restriction            — limited to "Maps JavaScript API" only;
 *   · a billing quota/alert      — so an abused key costs a notification, not
 *     a month's revenue.
 *
 * It is NOT protected by hiding it, obfuscating it, or proxying it. The
 * unrestricted server key (GOOGLE_MAPS_SERVER_KEY) never leaves the API.
 *
 * ── NO FALLBACK ─────────────────────────────────────────────────────────────
 * `process.env.NEXT_PUBLIC_MAPS_BROWSER_KEY || 'AIza…'` is banned project-wide
 * (plan §4.1) and by ESLint. An empty key is reported as `available: false` and
 * every caller renders its own designed placeholder. The Journey Ribbon, the
 * order tracker and the checkout address flow all work end-to-end with no key.
 *
 * The env var is read as a STATIC member access on its own line, because that
 * is the only form Next's bundler substitutes at build time.
 */

import { useEffect, useState } from 'react';
import type { MapsLoadState } from './types';

/**
 * Module-scoped declaration, not a global one. The design system has no
 * `@types/node` (and should not grow one just to read a build-time constant),
 * and this stays a plain static member access — the only form Next's bundler
 * substitutes with a literal at build time.
 */
declare const process: { env: { NEXT_PUBLIC_MAPS_BROWSER_KEY?: string } };

const RAW_KEY: string | undefined = process.env.NEXT_PUBLIC_MAPS_BROWSER_KEY;

/** Trimmed key, or null when the user has not supplied one yet. */
export const MAPS_BROWSER_KEY: string | null =
  typeof RAW_KEY === 'string' && RAW_KEY.trim() !== '' ? RAW_KEY.trim() : null;

const SCRIPT_ID = 'mandi-google-maps';

type LoaderState = 'idle' | 'loading' | 'ready' | 'error';

interface Loader {
  state: LoaderState;
  error: string | null;
  promise: Promise<void> | null;
  listeners: Set<() => void>;
}

/* Module scope: one loader per document, however many maps are mounted. */
const loader: Loader = {
  state: 'idle',
  error: null,
  promise: null,
  listeners: new Set(),
};

function announce(): void {
  loader.listeners.forEach((fn) => {
    fn();
  });
}

/**
 * Google rejects a bad key ASYNCHRONOUSLY, long after the script's load
 * event has already fired. Billing disabled, a referrer that is not on the
 * allowlist, an API that was never enabled — in every one of those cases the
 * `<script>` still returns 200 and still resolves, and then Google paints its
 * own dark "This page can't load Google Maps correctly" watermark over a grey
 * tile. The only signal it gives us is this global callback.
 *
 * Without it we report `loaded: true` and hand the user Google's broken map
 * instead of our own placeholder, which is strictly worse than showing no map
 * at all: the address, the route summary and the deep link all disappear
 * behind a dead grey square.
 */
function installAuthFailureHook(): void {
  if (typeof window === 'undefined') return;
  const w = window as unknown as { gm_authFailure?: () => void };
  if (w.gm_authFailure) return;

  w.gm_authFailure = () => {
    loader.state = 'error';
    loader.error =
      'Google rejected this Maps key. The usual causes are billing not being ' +
      'enabled on the Cloud project, the Maps JavaScript API not being enabled, ' +
      'or this origin missing from the key’s HTTP-referrer allowlist.';
    announce();
  };
}

function startLoading(key: string): Promise<void> {
  if (loader.promise) return loader.promise;

  installAuthFailureHook();
  loader.state = 'loading';
  loader.promise = new Promise<void>((resolve, reject) => {
    const existing = document.getElementById(SCRIPT_ID);
    if (existing) {
      // Another mount already injected it; wait for its load event.
      existing.addEventListener('load', () => {
        resolve();
      });
      existing.addEventListener('error', () => {
        reject(new Error('maps-script-failed'));
      });
      return;
    }

    const script = document.createElement('script');
    script.id = SCRIPT_ID;
    script.async = true;
    script.defer = true;
    // `loading=async` is what Google asks for when the script is async-loaded;
    // without it the console logs a performance warning on every page.
    script.src =
      'https://maps.googleapis.com/maps/api/js' +
      `?key=${encodeURIComponent(key)}` +
      '&v=weekly&loading=async';
    script.addEventListener('load', () => {
      resolve();
    });
    script.addEventListener('error', () => {
      reject(new Error('maps-script-failed'));
    });
    document.head.appendChild(script);
  })
    .then(() => {
      // Never clobber an auth failure. `gm_authFailure` can fire before this
      // resolves, and reporting `ready` afterwards would put the broken grey
      // map back on screen.
      if (loader.state === 'error') return;
      loader.state = 'ready';
      loader.error = null;
      announce();
    })
    .catch(() => {
      loader.state = 'error';
      loader.error =
        'Google Maps could not load. The browser key may be missing an HTTP-referrer allowance for this origin, or billing may be disabled.';
      announce();
    });

  return loader.promise;
}

export interface UseMapsLoadedOptions {
  /**
   * Defer injection until the map is genuinely wanted. Defaults to true; pass
   * false to keep a collapsed map from pulling ~200KB of script for nothing.
   */
  enabled?: boolean;
  /** override the env key — used only by tests */
  apiKey?: string | null;
}

/**
 * `{ loaded, available, error }`
 *
 *   available === false  → no key configured. Render a placeholder.
 *   available && !loaded → script in flight, or `enabled: false`.
 *   error !== null       → a key exists but the script refused to load.
 */
export function useMapsLoaded(options: UseMapsLoadedOptions = {}): MapsLoadState {
  const { enabled = true, apiKey } = options;
  const key = apiKey === undefined ? MAPS_BROWSER_KEY : apiKey;
  const available = key !== null;

  const [, force] = useState(0);

  useEffect(() => {
    if (!available || !enabled) return;

    const listener = () => {
      force((n) => n + 1);
    };
    loader.listeners.add(listener);

    if (loader.state === 'idle' && key !== null) {
      void startLoading(key);
    } else if (loader.state === 'ready' || loader.state === 'error') {
      // Already settled before this component mounted — publish immediately.
      listener();
    }

    return () => {
      loader.listeners.delete(listener);
    };
  }, [available, enabled, key]);

  return {
    loaded: available && loader.state === 'ready',
    available,
    error: available ? loader.error : null,
  };
}
