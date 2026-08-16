/**
 * The two-stage caption flow.
 *
 * Stage one (instant): while the session is inside its activity window, each
 * automatic generation request is answered with a zero-cost keyword caption
 * built from the latest human message (the title appears immediately). Stage
 * two (refined): once the session has been idle for `idleDelayMs`, a single
 * auxiliary call on the budget route rewrites the caption from the whole
 * conversation (and optionally harvests a one-line summary). A user-pinned
 * title stops both stages; an unchanged caption is skipped, not rewritten.
 *
 * Race windows closed here:
 * - a user rename landing while a refinement call is in flight is never
 *   overwritten (the pin is re-checked after the call returns);
 * - teardown aborts any in-flight refinement instead of letting it complete;
 * - a refinement is never started while another is running (the pacemaker
 *   serializes them, and the harness supersedes stale automatic calls).
 */
import type { LlmService } from '@deepseek-ai/dsh-llm';
import type { Session } from '@deepseek-ai/dsh-session';
import type { SessionTitleProviderResult, SessionTitleService, SessionTitleUserMessage } from '@deepseek-ai/dsh-session-title';
import type { SessionEvent } from '@deepseek-ai/dsh-session/types';
import { BudgetRouter } from './budget.js';
import type { CaptionConfig } from './config.js';
export interface FlowDeps {
    llm: LlmService;
    sessionTitle: SessionTitleService;
    sessions: {
        list(): readonly Session[];
    };
}
export interface FlowLog {
    debug(message: string): void;
    warn(message: string, ...args: unknown[]): void;
}
export interface CaptionFlow {
    /**
     * The registered provider's revision handler.
     * @throws {CaptionSkippedError} when the revision deliberately yields
     *   nothing; other throws are genuine failures.
     */
    generate(request: {
        session: Session;
        messages: readonly SessionTitleUserMessage[];
        route?: {
            provider: string;
            model: string;
        };
        signal: AbortSignal;
    }): Promise<SessionTitleProviderResult>;
    /** Feed one durable session event into the activity probe. */
    onSessionEvent(session: Session, event: SessionEvent): void;
    /** Abort in-flight work and cancel armed timers (plugin teardown). */
    dispose(): void;
    /** The budget router (so adapter-topology changes can invalidate it). */
    readonly router: BudgetRouter;
}
export declare function createCaptionFlow(deps: FlowDeps, config: CaptionConfig, log: FlowLog): CaptionFlow;
