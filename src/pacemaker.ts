/**
 * Idle pacemaker: the heartbeat that joins the two caption stages.
 *
 * Every observed session event pushes the session's "busy until" horizon
 * forward by `activityWindowMs`. A session is idle once that horizon has
 * passed. When the flow dispatches an instant caption (or a new user message
 * arrives), the pacemaker arms an `idleDelayMs` timer; when the timer fires
 * and the session is still idle (and no refinement is in flight, and the
 * caption has not been marked stable), it calls the provided refresh
 * callback exactly once: the hook that starts stage two.
 *
 * Two failure windows are closed explicitly:
 * - a timer that fires against a still-busy session re-arms itself instead
 *   of dropping the pending refinement;
 * - a schedule request that lands while a refinement is in flight is
 *   remembered and re-armed once the in-flight call settles.
 */
import type { TimingConfig } from './config.js'

export interface PacemakerLog {
  warn(message: string, ...args: unknown[]): void
}

export class IdlePacemaker {
  private readonly busyUntil = new Map<string, number>()
  private readonly timers = new Map<string, () => void>()
  private readonly inflight = new Set<string>()
  private readonly pending = new Set<string>()
  private readonly stable = new Set<string>()

  constructor(
    private readonly timing: TimingConfig,
    private readonly log: PacemakerLog,
  ) {}

  /** Record observed activity for a session. */
  poke(sessionId: string, at: number = Date.now()): void {
    this.busyUntil.set(sessionId, at + this.timing.activityWindowMs)
  }

  /** Whether the session is inside its activity window. */
  isBusy(sessionId: string, now: number = Date.now()): boolean {
    return (this.busyUntil.get(sessionId) ?? 0) > now
  }

  /** Whether a refinement call is currently running for the session. */
  isInflight(sessionId: string): boolean {
    return this.inflight.has(sessionId)
  }

  /** Mark a session's caption as stable: no further automatic refinement. */
  markStable(sessionId: string): void {
    this.stable.add(sessionId)
  }

  /** New user input makes a previously stable caption eligible again. */
  markDirty(sessionId: string): void {
    this.stable.delete(sessionId)
  }

  /** Whether refinement is currently disabled for this session. */
  isStable(sessionId: string): boolean {
    return this.stable.has(sessionId)
  }

  /**
   * Arm the idle-refinement timer for one session. At most one timer exists
   * per session. Firing requires the session to be idle, unmarked stable,
   * and without an in-flight refinement; a busy fire re-arms the timer and
   * a schedule during an in-flight call re-arms after it settles.
   * @param sessionId - target session.
   * @param refresh - starts stage two; must reject rather than throw.
   * @param onFired - optional gate checked at fire time (e.g. user pin).
   */
  scheduleRefine(sessionId: string, refresh: () => Promise<unknown>, onFired?: () => boolean): void {
    if (this.timers.has(sessionId)) return
    if (this.inflight.has(sessionId)) {
      this.pending.add(sessionId)
      return
    }
    let timer: ReturnType<typeof setTimeout>
    const cancel = (): void => clearTimeout(timer)
    this.timers.set(sessionId, cancel)
    timer = setTimeout(() => {
      this.timers.delete(sessionId)
      if (this.isBusy(sessionId)) {
        // Still working: hold the intent and check again after the delay.
        this.scheduleRefine(sessionId, refresh, onFired)
        return
      }
      if (this.stable.has(sessionId)) return
      if (this.inflight.has(sessionId)) return
      if (onFired !== undefined && !onFired()) return
      this.inflight.add(sessionId)
      void refresh()
        .catch((error: unknown) => {
          this.log.warn(`caption refinement failed: ${String(error)}`)
        })
        .finally(() => {
          this.inflight.delete(sessionId)
          if (this.pending.delete(sessionId)) {
            this.scheduleRefine(sessionId, refresh, onFired)
          }
        })
    }, this.timing.idleDelayMs)
  }

  /** Cancel the armed timer of one session, if any. */
  cancel(sessionId: string): void {
    const cancel = this.timers.get(sessionId)
    if (cancel !== undefined) {
      cancel()
      this.timers.delete(sessionId)
    }
  }

  /** Cancel every armed timer and drop pending intents (plugin teardown). */
  dispose(): void {
    for (const cancel of this.timers.values()) cancel()
    this.timers.clear()
    this.pending.clear()
  }
}
