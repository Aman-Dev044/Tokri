import { Injectable } from '@nestjs/common';

import { HEARTBEAT_GRACE_MS } from './realtime.events';

export interface RiderPresence {
  /** The rider's USER id (`user:{id}` room, JWT `sub`). */
  userId: string;
  /** Socket ids currently open for this rider. */
  sockets: Set<string>;
  /** Last connect, heartbeat or message from this rider. */
  lastSeenAt: Date;
  /** Start of the current online stretch, or `null` when disconnected. */
  onlineSince: Date | null;
  /** Milliseconds online today, excluding the stretch in progress. */
  onlineMsToday: number;
  /** The calendar day `onlineMsToday` accumulates into. */
  day: string;
}

/**
 * ════════════════════════════════════════════════════════════════════════
 *  RIDER PRESENCE
 * ════════════════════════════════════════════════════════════════════════
 *
 * Who is actually on the other end of a socket, and when they were last
 * heard from. Two consumers:
 *
 *   • `RiderHeartbeatService` (delivery module) sweeps for riders who
 *     have missed two consecutive heartbeats and recovers their order.
 *   • `GET /delivery/me` reads today's online minutes from it.
 *
 * It lives in `realtime/` and imports nothing from `delivery/`, which is
 * what keeps the dependency arrow pointing one way: delivery → realtime,
 * never back. The gateway writes, the delivery module reads.
 *
 * Deliberately IN-MEMORY and therefore PER-REPLICA. A socket is a
 * property of one process — the replica holding it is the only one that
 * can observe it going quiet — so replicating this state would be
 * describing something no other replica can act on. The cost is that
 * today's online minutes reset when a process restarts; the fix, when it
 * matters, is a Redis hash keyed by rider, not a second source of truth
 * here.
 */
@Injectable()
export class RiderPresenceRegistry {
  private readonly riders = new Map<string, RiderPresence>();

  /** A rider's socket connected. */
  connect(userId: string, socketId: string, now = new Date()): void {
    const entry = this.ensure(userId, now);
    entry.sockets.add(socketId);
    entry.lastSeenAt = now;
    entry.onlineSince ??= now;
  }

  /** A heartbeat, or any other sign of life. */
  touch(userId: string, now = new Date()): void {
    const entry = this.riders.get(userId);
    if (!entry) return;
    this.rollDay(entry, now);
    entry.lastSeenAt = now;
    entry.onlineSince ??= now;
  }

  /**
   * A socket closed.
   *
   * The entry SURVIVES with its `lastSeenAt` intact rather than being
   * deleted: a rider in a lift loses the socket and comes back in eight
   * seconds, and tearing their order off them for that would be worse
   * than the problem. The sweeper decides, once the grace window is up.
   */
  disconnect(userId: string, socketId: string, now = new Date()): void {
    const entry = this.riders.get(userId);
    if (!entry) return;

    entry.sockets.delete(socketId);
    if (entry.sockets.size === 0 && entry.onlineSince) {
      this.rollDay(entry, now);
      entry.onlineMsToday += now.getTime() - entry.onlineSince.getTime();
      entry.onlineSince = null;
    }
  }

  isConnected(userId: string): boolean {
    return (this.riders.get(userId)?.sockets.size ?? 0) > 0;
  }

  /** Minutes this rider has been socket-connected today. */
  onlineMinutesToday(userId: string, now = new Date()): number {
    const entry = this.riders.get(userId);
    if (!entry) return 0;

    this.rollDay(entry, now);
    const live = entry.onlineSince
      ? now.getTime() - entry.onlineSince.getTime()
      : 0;

    return Math.floor((entry.onlineMsToday + live) / 60_000);
  }

  /**
   * Riders who have missed two consecutive heartbeats.
   *
   * Returns their user ids and FORGETS them, so a stale rider is handled
   * exactly once even though the sweeper runs every few seconds.
   */
  takeStale(now = new Date()): string[] {
    const stale: string[] = [];

    for (const [userId, entry] of this.riders) {
      if (now.getTime() - entry.lastSeenAt.getTime() <= HEARTBEAT_GRACE_MS) {
        continue;
      }
      stale.push(userId);
      this.riders.delete(userId);
    }

    return stale;
  }

  /** Test seam: drops everything. */
  clear(): void {
    this.riders.clear();
  }

  private ensure(userId: string, now: Date): RiderPresence {
    const existing = this.riders.get(userId);
    if (existing) {
      this.rollDay(existing, now);
      return existing;
    }

    const created: RiderPresence = {
      userId,
      sockets: new Set<string>(),
      lastSeenAt: now,
      onlineSince: null,
      onlineMsToday: 0,
      day: dayKey(now),
    };
    this.riders.set(userId, created);
    return created;
  }

  /** Midnight resets the counter; a shift that spans it starts fresh. */
  private rollDay(entry: RiderPresence, now: Date): void {
    const today = dayKey(now);
    if (entry.day === today) return;
    entry.day = today;
    entry.onlineMsToday = 0;
    if (entry.onlineSince) entry.onlineSince = now;
  }
}

const dayKey = (at: Date): string => at.toISOString().slice(0, 10);
