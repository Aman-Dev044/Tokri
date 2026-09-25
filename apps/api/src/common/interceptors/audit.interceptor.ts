import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Request } from 'express';
import { Observable, from } from 'rxjs';
import { concatMap, map } from 'rxjs/operators';

import { JwtUser } from '../decorators/current-user.decorator';
import { scrub } from '../filters/all-exceptions.filter';
import { AuditContext } from '../../modules/admin/audit/audit-context';
import { AuditService } from '../../modules/admin/audit/audit.service';

/** Verbs that change state. GETs are not audited - they are the log. */
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * The audit safety net for admin mutations.
 *
 * ── Two layers, deliberately ────────────────────────────────────────────
 * Services that know the real before/after of a document call
 * `AuditService.record()` themselves, and produce a precise diff. That is
 * the good entry, and it is what an investigator wants to read.
 *
 * This interceptor covers the other case: a mutation that completed and
 * recorded NOTHING. Rather than leave a hole in the trail, it writes a
 * coarse entry from the request itself. The distinction is visible in the
 * data - a fallback entry has `before: null` and an action derived from
 * the route.
 *
 * ── Scrubbing ───────────────────────────────────────────────────────────
 * The request body is run through the same scrubber the exception filter
 * uses before it is stored. Without it, `POST /admin/team` would archive
 * the new admin's password in a collection that exists precisely to be
 * read by people investigating an incident.
 *
 * A failed handler writes nothing: a 403 or a validation error is not a
 * state change, and recording attempts would drown the real entries.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    private readonly context: AuditContext,
    private readonly audit: AuditService,
  ) {}

  intercept(
    execution: ExecutionContext,
    next: CallHandler,
  ): Observable<unknown> {
    const req = execution
      .switchToHttp()
      .getRequest<Request & { user?: JwtUser }>();

    const method = req.method.toUpperCase();

    const store = {
      actor: req.user ?? null,
      ip: req.ip ?? null,
      method,
      path: req.originalUrl ?? req.url,
      recorded: false,
    };

    // The handler is invoked INSIDE the AsyncLocalStorage run, so every
    // await it performs inherits the store and AuditService.record() can
    // find the actor without threading it through every signature.
    return this.context.run(store, () => {
      const source = next.handle();
      if (!MUTATING.has(method)) return source;

      return source.pipe(
        concatMap((body: unknown) => {
          if (store.recorded) return from([body]);

          return from(
            this.audit.record({
              action: `${method.toLowerCase()}.${routeLabel(execution)}`,
              entity: entityFor(execution),
              entityId: entityIdFrom(req),
              before: null,
              after: scrub(req.body ?? null),
              actor: store.actor,
            }),
          ).pipe(map(() => body));
        }),
      );
    });
  }
}

/** `AdminVendorsController.updateStatus` -> `vendors.updatestatus`. */
function routeLabel(execution: ExecutionContext): string {
  return `${entityFor(execution)}.${execution.getHandler().name}`.toLowerCase();
}

/**
 * `AdminVendorsController` -> `Vendors`.
 *
 * A fallback entry names the CONTROLLER, not a document — it is written
 * precisely because no service told us which document changed. The
 * `before: null` on these rows is the marker that distinguishes them
 * from a precise, service-written diff.
 */
function entityFor(execution: ExecutionContext): string {
  return execution
    .getClass()
    .name.replace(/Controller$/, '')
    .replace(/^Admin/, '');
}

function entityIdFrom(req: Request): string | null {
  const id = req.params?.id;
  return typeof id === 'string' ? id : null;
}
