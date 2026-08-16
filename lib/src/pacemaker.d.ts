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
import type { TimingConfig } from './config.js';
export interface PacemakerLog {
    warn(message: string, ...args: unknown[]): void;
}
export declare class IdlePacemaker {
    private readonly timing;
    private readonly log;
    private readonly busyUntil;
    private readonly timers;
    private readonly inflight;
    private readonly pending;
    private readonly stable;
    constructor(timing: TimingConfig, log: PacemakerLog);
    /** Record observed activity for a session. */
    poke(sessionId: string, at?: number): void;
    /** Whether the session is inside its activity window. */
    isBusy(sessionId: string, now?: number): boolean;
    /** Whether a refinement call is currently running for the session. */
    isInflight(sessionId: string): boolean;
    /** Mark a session's caption as stable: no further automatic refinement. */
    markStable(sessionId: string): void;
    /** New user input makes a previously stable caption eligible again. */
    markDirty(sessionId: string): void;
    /** Whether refinement is currently disabled for this session. */
    isStable(sessionId: string): boolean;
    /**
     * Arm the idle-refinement timer for one session. At most one timer exists
     * per session. Firing requires the session to be idle, unmarked stable,
     * and without an in-flight refinement; a busy fire re-arms the timer and
     * a schedule during an in-flight call re-arms after it settles.
     * @param sessionId - target session.
     * @param refresh - starts stage two; must reject rather than throw.
     * @param onFired - optional gate checked at fire time (e.g. user pin).
     */
    scheduleRefine(sessionId: string, refresh: () => Promise<unknown>, onFired?: () => boolean): void;
    /** Cancel the armed timer of one session, if any. */
    cancel(sessionId: string): void;
    /** Cancel every armed timer and drop pending intents (plugin teardown). */
    dispose(): void;
}
