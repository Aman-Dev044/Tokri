/**
 * The one way this app talks to the Mandi API.
 *
 * Everything goes through here so that four things are true in exactly one
 * place: the base URL comes from the environment with no fallback, the refresh
 * cookie always rides along, errors arrive typed, and the access token is read
 * from memory rather than from storage.
 *
 * ── TOKEN HANDLING (plan section 4.3) ───────────────────────────────────────
 * The access token lives in a module-scoped variable that AuthProvider owns.
 * It is NEVER written to localStorage or sessionStorage: both are readable by
 * any XSS on the origin, and an exfiltrated bearer token is an account
 * takeover. Memory dies with the tab, which is the point.
 *
 * The refresh token is an httpOnly + Secure + SameSite cookie set by the API
 * (`mandi_rt`). JavaScript cannot read it; `credentials: 'include'` is what
 * makes the browser send it.
 */

import { API_URL } from '@/config/env';

/* ------------------------------------------------------------------ */
/* In-memory access token                                              */
/* ------------------------------------------------------------------ */

let accessToken: string | null = null;

/** Called by AuthProvider on login / refresh. Do not call from components. */
export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

/* ------------------------------------------------------------------ */
/* Errors                                                              */
/* ------------------------------------------------------------------ */

/** The API speaks RFC 7807 problem+json (plan section 6.1). */
export interface ProblemDetails {
  type?: string;
  title?: string;
  status?: number;
  detail?: string;
  instance?: string;
  /** field-level validation failures, keyed by field name */
  errors?: Record<string, string[]>;
}

export class ApiError extends Error {
  readonly status: number;
  readonly problem: ProblemDetails;
  /** true for a network failure / CORS block / the API being down */
  readonly isNetworkError: boolean;

  constructor(
    message: string,
    status: number,
    problem: ProblemDetails = {},
    isNetworkError = false,
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.problem = problem;
    this.isNetworkError = isNetworkError;
  }

  /** Copy safe to show a user. Never leaks a stack or an internal detail. */
  get friendlyMessage(): string {
    if (this.isNetworkError) {
      return "We couldn't reach Mandi. Check your connection and try again.";
    }
    switch (this.status) {
      case 400:
      case 422:
        return this.problem.detail ?? 'Please check the details you entered.';
      case 401:
        return 'Those details did not match an account. Try again.';
      case 403:
        return 'You do not have access to this.';
      case 404:
        return 'We could not find that.';
      case 409:
        return this.problem.detail ?? 'That action conflicts with the current state.';
      case 429:
        return 'Too many attempts. Wait a minute and try again.';
      default:
        return this.status >= 500
          ? 'Something broke on our side. We are on it - try again shortly.'
          : (this.problem.detail ?? 'Something went wrong.');
    }
  }

  /** Field errors for a form, flattened to one message per field. */
  get fieldErrors(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [field, messages] of Object.entries(this.problem.errors ?? {})) {
      const first = messages[0];
      if (first) out[field] = first;
    }
    return out;
  }
}

/* ------------------------------------------------------------------ */
/* Request                                                             */
/* ------------------------------------------------------------------ */

export interface RequestOptions extends Omit<RequestInit, 'body'> {
  /** serialised to JSON unless it is already a FormData / string */
  body?: unknown;
  /** appended as a query string; undefined and null entries are dropped */
  query?: Record<string, string | number | boolean | undefined | null>;
  /** required on checkout and payment (plan section 6.1) */
  idempotencyKey?: string;
  /** skip the Authorization header even when a token is in memory */
  anonymous?: boolean;
  /** abort after N ms; defaults to 20s so a hung API cannot hang the UI */
  timeoutMs?: number;
}

function buildUrl(path: string, query?: RequestOptions['query']): string {
  const base = API_URL.endsWith('/') ? API_URL.slice(0, -1) : API_URL;
  const suffix = path.startsWith('/') ? path : `/${path}`;
  const url = new URL(`${base}${suffix}`);

  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null) continue;
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

async function parseProblem(res: Response): Promise<ProblemDetails> {
  try {
    const text = await res.text();
    if (!text) return {};
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as ProblemDetails)
      : {};
  } catch {
    return {};
  }
}

export async function apiFetch<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const {
    body,
    query,
    idempotencyKey,
    anonymous = false,
    timeoutMs = 20_000,
    headers,
    signal,
    ...init
  } = options;

  const isFormData = typeof FormData !== 'undefined' && body instanceof FormData;

  const finalHeaders = new Headers(headers);
  finalHeaders.set('Accept', 'application/json');
  if (body !== undefined && !isFormData) {
    finalHeaders.set('Content-Type', 'application/json');
  }
  if (idempotencyKey) finalHeaders.set('Idempotency-Key', idempotencyKey);
  if (!anonymous && accessToken) {
    finalHeaders.set('Authorization', `Bearer ${accessToken}`);
  }

  // Our own timeout, merged with any caller-supplied signal.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  let res: Response;
  try {
    res = await fetch(buildUrl(path, query), {
      ...init,
      headers: finalHeaders,
      // Sends the httpOnly mandi_rt refresh cookie. Required for /auth/refresh
      // and for any endpoint that rotates it.
      credentials: 'include',
      signal: controller.signal,
      ...(body === undefined
        ? {}
        : { body: isFormData ? (body as FormData) : JSON.stringify(body) }),
    });
  } catch (cause) {
    clearTimeout(timer);
    const aborted = cause instanceof DOMException && cause.name === 'AbortError';
    throw new ApiError(
      aborted ? 'Request timed out' : 'Network request failed',
      0,
      { title: aborted ? 'Timeout' : 'Network error' },
      true,
    );
  }
  clearTimeout(timer);

  if (!res.ok) {
    const problem = await parseProblem(res);
    throw new ApiError(
      problem.title ?? `${res.status} ${res.statusText}`,
      res.status,
      problem,
    );
  }

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

export const api = {
  get: <T>(path: string, options?: Omit<RequestOptions, 'body' | 'method'>) =>
    apiFetch<T>(path, { ...options, method: 'GET' }),

  post: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method'>) =>
    apiFetch<T>(path, { ...options, method: 'POST', body }),

  patch: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method'>) =>
    apiFetch<T>(path, { ...options, method: 'PATCH', body }),

  put: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method'>) =>
    apiFetch<T>(path, { ...options, method: 'PUT', body }),

  delete: <T>(path: string, options?: Omit<RequestOptions, 'body' | 'method'>) =>
    apiFetch<T>(path, { ...options, method: 'DELETE' }),
} as const;
