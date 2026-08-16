/**
 * Plugin configuration: loader schema plus validated runtime defaults.
 *
 * The schema is exported as `Config` (the loader contract name) and doubles
 * as the user-facing shape documented in the README. `resolveCaptionConfig`
 * turns untrusted loader input into a detached, validated policy.
 */
import z from '@deepseek-ai/schemastery';
/** How long a provider idle read may stay outstanding (framework cap). */
export declare const MAX_TIMER_DELAY_MS: number;
/** Default cheap-model name patterns, most economical first. */
export declare const DEFAULT_CHEAP_PATTERNS: readonly string[];
export declare const Config: z<Schemastery.ObjectS<{
    /** Stage one: instant keyword captions while the session is busy. */
    instant: z<Schemastery.ObjectS<{
        enabled: z<boolean, boolean>;
        prefix: z<string, string>;
        maxWords: z<number, number>;
        maxCjkChars: z<number, number>;
    }>, Schemastery.ObjectT<{
        enabled: z<boolean, boolean>;
        prefix: z<string, string>;
        maxWords: z<number, number>;
        maxCjkChars: z<number, number>;
    }>>;
    /** Stage two: model refinement when the session goes idle. */
    refine: z<Schemastery.ObjectS<{
        enabled: z<boolean, boolean>;
        maxWords: z<number, number>;
        maxCjkChars: z<number, number>;
        maxInputBytes: z<number, number>;
        maxOutputTokens: z<number, number>;
        timeoutMs: z<number, number>;
    }>, Schemastery.ObjectT<{
        enabled: z<boolean, boolean>;
        maxWords: z<number, number>;
        maxCjkChars: z<number, number>;
        maxInputBytes: z<number, number>;
        maxOutputTokens: z<number, number>;
        timeoutMs: z<number, number>;
    }>>;
    /** Cost control: which model the refinement stage may use. */
    budget: z<Schemastery.ObjectS<{
        preferCheap: z<boolean, boolean>;
        patterns: z<string[], string[]>;
    }>, Schemastery.ObjectT<{
        preferCheap: z<boolean, boolean>;
        patterns: z<string[], string[]>;
    }>>;
    /** Optional one-line conversation summary produced with each refinement. */
    summary: z<Schemastery.ObjectS<{
        enabled: z<boolean, boolean>;
        maxChars: z<number, number>;
    }>, Schemastery.ObjectT<{
        enabled: z<boolean, boolean>;
        maxChars: z<number, number>;
    }>>;
    /** Cadence of the idle probe and budget-cache freshness. */
    timing: z<Schemastery.ObjectS<{
        idleDelayMs: z<number, number>;
        activityWindowMs: z<number, number>;
        modelCacheMs: z<number, number>;
    }>, Schemastery.ObjectT<{
        idleDelayMs: z<number, number>;
        activityWindowMs: z<number, number>;
        modelCacheMs: z<number, number>;
    }>>;
    /** Explicit model route; must be supplied as a provider/model pair. */
    model: z<Schemastery.ObjectS<{
        provider: z<string, string>;
        model: z<string, string>;
    }>, Schemastery.ObjectT<{
        provider: z<string, string>;
        model: z<string, string>;
    }>>;
    /** Avoid identical captions across concurrent sessions. */
    dedup: z<Schemastery.ObjectS<{
        enabled: z<boolean, boolean>;
        suffix: z<string, string>;
    }>, Schemastery.ObjectT<{
        enabled: z<boolean, boolean>;
        suffix: z<string, string>;
    }>>;
    debug: z<boolean, boolean>;
}>, Schemastery.ObjectT<{
    /** Stage one: instant keyword captions while the session is busy. */
    instant: z<Schemastery.ObjectS<{
        enabled: z<boolean, boolean>;
        prefix: z<string, string>;
        maxWords: z<number, number>;
        maxCjkChars: z<number, number>;
    }>, Schemastery.ObjectT<{
        enabled: z<boolean, boolean>;
        prefix: z<string, string>;
        maxWords: z<number, number>;
        maxCjkChars: z<number, number>;
    }>>;
    /** Stage two: model refinement when the session goes idle. */
    refine: z<Schemastery.ObjectS<{
        enabled: z<boolean, boolean>;
        maxWords: z<number, number>;
        maxCjkChars: z<number, number>;
        maxInputBytes: z<number, number>;
        maxOutputTokens: z<number, number>;
        timeoutMs: z<number, number>;
    }>, Schemastery.ObjectT<{
        enabled: z<boolean, boolean>;
        maxWords: z<number, number>;
        maxCjkChars: z<number, number>;
        maxInputBytes: z<number, number>;
        maxOutputTokens: z<number, number>;
        timeoutMs: z<number, number>;
    }>>;
    /** Cost control: which model the refinement stage may use. */
    budget: z<Schemastery.ObjectS<{
        preferCheap: z<boolean, boolean>;
        patterns: z<string[], string[]>;
    }>, Schemastery.ObjectT<{
        preferCheap: z<boolean, boolean>;
        patterns: z<string[], string[]>;
    }>>;
    /** Optional one-line conversation summary produced with each refinement. */
    summary: z<Schemastery.ObjectS<{
        enabled: z<boolean, boolean>;
        maxChars: z<number, number>;
    }>, Schemastery.ObjectT<{
        enabled: z<boolean, boolean>;
        maxChars: z<number, number>;
    }>>;
    /** Cadence of the idle probe and budget-cache freshness. */
    timing: z<Schemastery.ObjectS<{
        idleDelayMs: z<number, number>;
        activityWindowMs: z<number, number>;
        modelCacheMs: z<number, number>;
    }>, Schemastery.ObjectT<{
        idleDelayMs: z<number, number>;
        activityWindowMs: z<number, number>;
        modelCacheMs: z<number, number>;
    }>>;
    /** Explicit model route; must be supplied as a provider/model pair. */
    model: z<Schemastery.ObjectS<{
        provider: z<string, string>;
        model: z<string, string>;
    }>, Schemastery.ObjectT<{
        provider: z<string, string>;
        model: z<string, string>;
    }>>;
    /** Avoid identical captions across concurrent sessions. */
    dedup: z<Schemastery.ObjectS<{
        enabled: z<boolean, boolean>;
        suffix: z<string, string>;
    }>, Schemastery.ObjectT<{
        enabled: z<boolean, boolean>;
        suffix: z<string, string>;
    }>>;
    debug: z<boolean, boolean>;
}>>;
export interface InstantCaptionConfig {
    enabled: boolean;
    prefix: string;
    maxWords: number;
    maxCjkChars: number;
}
export interface RefineCaptionConfig {
    enabled: boolean;
    maxWords: number;
    maxCjkChars: number;
    maxInputBytes: number;
    maxOutputTokens: number;
    timeoutMs: number;
}
export interface BudgetConfig {
    preferCheap: boolean;
    patterns: readonly string[];
}
export interface SummaryConfig {
    enabled: boolean;
    maxChars: number;
}
export interface TimingConfig {
    idleDelayMs: number;
    activityWindowMs: number;
    modelCacheMs: number;
}
export interface DedupConfig {
    enabled: boolean;
    suffix: string;
}
export interface CaptionConfig {
    instant: InstantCaptionConfig;
    refine: RefineCaptionConfig;
    budget: BudgetConfig;
    summary: SummaryConfig;
    timing: TimingConfig;
    model: {
        provider: string;
        model: string;
    };
    dedup: DedupConfig;
    debug: boolean;
}
/**
 * Validate untrusted loader input against the schema and detach it.
 * @param config - raw loader configuration (may be undefined or partial).
 * @returns a deep-frozen policy with every default applied.
 * @throws when the provider/model override is not a non-empty pair, or the
 *   dedup suffix template has no `{n}` placeholder.
 */
export declare function resolveCaptionConfig(config: unknown): CaptionConfig;
