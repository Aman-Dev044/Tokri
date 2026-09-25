import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { RiderPresenceRegistry } from '../../realtime/rider-presence.registry';
import { AssignmentService } from './assignment.service';
import { SWEEP_INTERVAL_MS } from './delivery.constants';

/**
 * ════════════════════════════════════════════════════════════════════════
 *  THE RIDER HEARTBEAT (§8.5)
 * ════════════════════════════════════════════════════════════════════════
 *
 * The rider app emits `rider:heartbeat` every 30 seconds. The gateway
 * records it in `RiderPresenceRegistry`. This service checks, every few
 * seconds, who has missed TWO consecutive beats and hands them to
 * `AssignmentService.recoverFromOfflineRider`.
 *
 * ── Why two misses and not one ──────────────────────────────────────────
 * One missed beat is a lift, a tunnel, or a phone deciding to switch from
 * Wi-Fi to mobile data. Tearing an order off a rider for that would
 * create more failures than it prevents — and the rider, who is standing
 * outside the shop, would watch their job vanish. Two misses plus five
 * seconds of slack is 65 seconds of silence, which is no longer a tunnel.
 *
 * ── Why this loop lives on every replica ────────────────────────────────
 * Presence is a per-process fact: only the replica holding a rider's
 * socket can observe it going quiet. Each replica therefore sweeps its
 * OWN sockets, and the recovery it triggers is transactional in the
 * database, so two replicas acting on the same rider cannot both return
 * the same order to the pool.
 */
@Injectable()
export class RiderHeartbeatService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RiderHeartbeatService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly presence: RiderPresenceRegistry,
    private readonly assignments: AssignmentService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    // See AssignmentSweeperService: no live intervals under Jest.
    if (this.config.getOrThrow<string>('env') === 'test') return;

    this.timer = setInterval(() => {
      void this.tick();
    }, SWEEP_INTERVAL_MS);
    this.timer.unref();

    this.logger.log('Rider heartbeat monitor started');
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** One pass. Public so a test can drive it without waiting on a clock. */
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;

    try {
      // `takeStale` FORGETS what it returns, so a rider who has gone
      // quiet is recovered exactly once however often this runs.
      const stale = this.presence.takeStale();

      for (const riderUserId of stale) {
        await this.assignments.recoverFromOfflineRider(riderUserId);
      }
    } catch (error) {
      this.logger.error(
        `Heartbeat sweep failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.running = false;
    }
  }
}
