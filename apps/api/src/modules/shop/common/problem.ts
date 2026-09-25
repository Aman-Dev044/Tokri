/**
 * A machine-readable error body that survives the global filter.
 *
 * ── Why this shape and not a flat object ────────────────────────────────
 * `AllExceptionsFilter` renders RFC 7807: it keeps `message` (as `detail`)
 * and `errors`, and DROPS every other key. So
 * `new ConflictException({ code: 'OUT_OF_STOCK', productId })` reaches the
 * client as a bare sentence with the code stripped off, and the app is
 * left string-matching English prose to decide whether to grey out one
 * line or the whole basket.
 *
 * Nesting the machine-readable part under `errors` keeps both halves: a
 * sentence for the customer, a stable code for the client.
 *
 *     throw new ConflictException(
 *       problem('OUT_OF_STOCK', 'Tomatoes just sold out', { productId }),
 *     );
 *
 *     → 409 {
 *         type, title, status,
 *         detail: 'Tomatoes just sold out',
 *         errors: { code: 'OUT_OF_STOCK', productId: '…' },
 *         instance, timestamp
 *       }
 *
 * The filter also scrubs `errors` for secret-looking keys, so nothing put
 * in here can leak a token or an OTP even by accident.
 */
export interface ProblemBody {
  message: string;
  errors: { code: string } & Record<string, unknown>;
}

export const problem = (
  code: string,
  message: string,
  extra: Record<string, unknown> = {},
): ProblemBody => ({
  message,
  errors: { code, ...extra },
});
