import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable } from '@nestjs/common';
import { JwtUser } from '../../../common/decorators/current-user.decorator';

/** What the interceptor knows about the request currently being served. */
export interface AuditStore {
  actor: JwtUser | null;
  ip: string | null;
  method: string;
  path: string;
  /** Set by AuditService once a service has written a precise entry. */
  recorded: boolean;
}

/**
 * Carries the request's identity down to whichever service ends up
 * writing the audit entry.
 *
 * ── Why AsyncLocalStorage and not a request-scoped provider ─────────────
 * Nest's `Scope.REQUEST` is viral: any provider that injects a
 * request-scoped one becomes request-scoped too, and so does anything
 * injecting THAT. One audit dependency would re-instantiate half the
 * admin module per request and quietly change the performance profile of
 * every endpoint.
 *
 * ── Why not pass the actor as an argument everywhere ────────────────────
 * We do, wherever the service genuinely needs it. This exists for the
 * fallback path: the interceptor's safety-net entry for a mutation whose
 * service did not record one itself. Something must still know WHO did it,
 * and the only trustworthy source is the verified JWT on the request.
 */
@Injectable()
export class AuditContext {
  private readonly storage = new AsyncLocalStorage<AuditStore>();

  run<T>(store: AuditStore, fn: () => T): T {
    return this.storage.run(store, fn);
  }

  get(): AuditStore | undefined {
    return this.storage.getStore();
  }

  /** Marks the request as having produced a precise, hand-written entry. */
  markRecorded(): void {
    const store = this.storage.getStore();
    if (store) store.recorded = true;
  }
}
