/**
 * Budget routing: pick the cheapest available model for caption refinement.
 *
 * Resolution order: an explicit `model.provider`/`model.model` override from
 * configuration wins; otherwise the registered model catalog is scanned for
 * names matching the cheap-pattern list (most economical patterns first) with
 * the result cached for `modelCacheMs`; otherwise the conversation's own
 * route is reused; otherwise refinement is skipped entirely.
 *
 * All catalog access is defensive: an adapter that cannot enumerate models
 * must never take captioning down with it.
 */
import type { LlmService } from '@deepseek-ai/dsh-llm';
import type { BudgetConfig } from './config.js';
export interface ModelRoute {
    provider: string;
    model: string;
}
export interface RouterLog {
    debug(message: string): void;
}
export declare class BudgetRouter {
    private readonly llm;
    private readonly config;
    private readonly cacheMs;
    private readonly explicit;
    private readonly log;
    private cache;
    private scanning;
    private generation;
    constructor(llm: LlmService, config: BudgetConfig, cacheMs: number, explicit: ModelRoute | undefined, log: RouterLog);
    /** Drop the cached catalog pick (adapter topology changed). */
    invalidate(): void;
    /**
     * Resolve the model route for one refinement call.
     * @param conversationRoute - the session's own logged main-request route.
     * @returns the route to use, or `undefined` when none is available.
     */
    resolve(conversationRoute: ModelRoute | undefined): Promise<ModelRoute | undefined>;
    private scan;
    private performScan;
    private providers;
    private modelsOf;
    /** Pattern priority: lower index wins; -1 means no match. */
    private matchRank;
}
