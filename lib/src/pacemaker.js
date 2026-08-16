export class IdlePacemaker {
    timing;
    log;
    busyUntil = new Map();
    timers = new Map();
    inflight = new Set();
    pending = new Set();
    stable = new Set();
    constructor(timing, log) {
        this.timing = timing;
        this.log = log;
    }
    /** Record observed activity for a session. */
    poke(sessionId, at = Date.now()) {
        this.busyUntil.set(sessionId, at + this.timing.activityWindowMs);
    }
    /** Whether the session is inside its activity window. */
    isBusy(sessionId, now = Date.now()) {
        return (this.busyUntil.get(sessionId) ?? 0) > now;
    }
    /** Whether a refinement call is currently running for the session. */
    isInflight(sessionId) {
        return this.inflight.has(sessionId);
    }
    /** Mark a session's caption as stable: no further automatic refinement. */
    markStable(sessionId) {
        this.stable.add(sessionId);
    }
    /** New user input makes a previously stable caption eligible again. */
    markDirty(sessionId) {
        this.stable.delete(sessionId);
    }
    /** Whether refinement is currently disabled for this session. */
    isStable(sessionId) {
        return this.stable.has(sessionId);
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
    scheduleRefine(sessionId, refresh, onFired) {
        if (this.timers.has(sessionId))
            return;
        if (this.inflight.has(sessionId)) {
            this.pending.add(sessionId);
            return;
        }
        let timer;
        const cancel = () => clearTimeout(timer);
        this.timers.set(sessionId, cancel);
        timer = setTimeout(() => {
            this.timers.delete(sessionId);
            if (this.isBusy(sessionId)) {
                // Still working: hold the intent and check again after the delay.
                this.scheduleRefine(sessionId, refresh, onFired);
                return;
            }
            if (this.stable.has(sessionId))
                return;
            if (this.inflight.has(sessionId))
                return;
            if (onFired !== undefined && !onFired())
                return;
            this.inflight.add(sessionId);
            void refresh()
                .catch((error) => {
                this.log.warn(`caption refinement failed: ${String(error)}`);
            })
                .finally(() => {
                this.inflight.delete(sessionId);
                if (this.pending.delete(sessionId)) {
                    this.scheduleRefine(sessionId, refresh, onFired);
                }
            });
        }, this.timing.idleDelayMs);
    }
    /** Cancel the armed timer of one session, if any. */
    cancel(sessionId) {
        const cancel = this.timers.get(sessionId);
        if (cancel !== undefined) {
            cancel();
            this.timers.delete(sessionId);
        }
    }
    /** Cancel every armed timer and drop pending intents (plugin teardown). */
    dispose() {
        for (const cancel of this.timers.values())
            cancel();
        this.timers.clear();
        this.pending.clear();
    }
}
