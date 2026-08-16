/**
 * Plugin configuration: loader schema plus validated runtime defaults.
 *
 * The schema is exported as `Config` (the loader contract name) and doubles
 * as the user-facing shape documented in the README. `resolveCaptionConfig`
 * turns untrusted loader input into a detached, validated policy.
 */
import z from '@deepseek-ai/schemastery'
import { deepFreeze } from '@deepseek-ai/dsh-llm'

/** How long a provider idle read may stay outstanding (framework cap). */
export const MAX_TIMER_DELAY_MS = 2 ** 31 - 1

/** Default cheap-model name patterns, most economical first. */
export const DEFAULT_CHEAP_PATTERNS = Object.freeze([
  'flash',
  'haiku',
  'lite',
  'mini',
  'nano',
  'fast',
  'compact',
  'small',
  'light',
  'speed',
  'quick',
  'turbo',
  'economy',
  'budget',
  '1.5',
  '3.5',
])

export const Config = z.object({
  /** Stage one: instant keyword captions while the session is busy. */
  instant: z.object({
    enabled: z.boolean().default(true),
    prefix: z.string().default(''),
    maxWords: z.number().step(1).min(1).max(24).default(6),
    maxCjkChars: z.number().step(1).min(1).max(48).default(14),
  }),
  /** Stage two: model refinement when the session goes idle. */
  refine: z.object({
    enabled: z.boolean().default(true),
    maxWords: z.number().step(1).min(1).max(24).default(5),
    maxCjkChars: z.number().step(1).min(1).max(48).default(10),
    maxInputBytes: z.number().step(1).min(512).max(65536).default(4096),
    maxOutputTokens: z.number().step(1).min(16).max(1024).default(64),
    timeoutMs: z.number().step(1).min(1000).max(MAX_TIMER_DELAY_MS).default(60000),
  }),
  /** Cost control: which model the refinement stage may use. */
  budget: z.object({
    preferCheap: z.boolean().default(true),
    patterns: z.array(z.string()).default([...DEFAULT_CHEAP_PATTERNS]),
  }),
  /** Optional one-line conversation summary produced with each refinement. */
  summary: z.object({
    enabled: z.boolean().default(true),
    maxChars: z.number().step(1).min(0).max(500).default(120),
  }),
  /** Cadence of the idle probe and budget-cache freshness. */
  timing: z.object({
    idleDelayMs: z.number().step(1).min(250).max(600000).default(5000),
    activityWindowMs: z.number().step(1).min(250).max(600000).default(1500),
    modelCacheMs: z.number().step(1).min(0).max(3600000).default(120000),
  }),
  /** Explicit model route; must be supplied as a provider/model pair. */
  model: z.object({
    provider: z.string().default(''),
    model: z.string().default(''),
  }),
  /** Avoid identical captions across concurrent sessions. */
  dedup: z.object({
    enabled: z.boolean().default(true),
    suffix: z.string().default('({n})'),
  }),
  debug: z.boolean().default(false),
})

export interface InstantCaptionConfig {
  enabled: boolean
  prefix: string
  maxWords: number
  maxCjkChars: number
}

export interface RefineCaptionConfig {
  enabled: boolean
  maxWords: number
  maxCjkChars: number
  maxInputBytes: number
  maxOutputTokens: number
  timeoutMs: number
}

export interface BudgetConfig {
  preferCheap: boolean
  patterns: readonly string[]
}

export interface SummaryConfig {
  enabled: boolean
  maxChars: number
}

export interface TimingConfig {
  idleDelayMs: number
  activityWindowMs: number
  modelCacheMs: number
}

export interface DedupConfig {
  enabled: boolean
  suffix: string
}

export interface CaptionConfig {
  instant: InstantCaptionConfig
  refine: RefineCaptionConfig
  budget: BudgetConfig
  summary: SummaryConfig
  timing: TimingConfig
  model: { provider: string; model: string }
  dedup: DedupConfig
  debug: boolean
}

/**
 * Validate untrusted loader input against the schema and detach it.
 * @param config - raw loader configuration (may be undefined or partial).
 * @returns a deep-frozen policy with every default applied.
 * @throws when the provider/model override is not a non-empty pair, or the
 *   dedup suffix template has no `{n}` placeholder.
 */
export function resolveCaptionConfig(config: unknown): CaptionConfig {
  const value = Config(config ?? {}) as unknown as CaptionConfig
  const { provider, model } = value.model
  const trimmedProvider = provider.trim()
  const trimmedModel = model.trim()
  const hasProvider = trimmedProvider.length > 0
  const hasModel = trimmedModel.length > 0
  if (hasProvider !== hasModel) {
    throw new Error('session-caption: provider and model must be configured together')
  }
  if (!value.dedup.suffix.includes('{n}')) {
    throw new Error('session-caption: dedup.suffix must contain the "{n}" placeholder')
  }
  return deepFreeze({
    ...value,
    model: { provider: trimmedProvider, model: trimmedModel },
  })
}
