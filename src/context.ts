/**
 * Structural context shape this plugin consumes.
 *
 * The plugin deliberately types its entry against a local, structural
 * interface instead of the harness `Context` type: the harness context is a
 * proxy whose service surface is described through cross-file module
 * augmentation, and combining that augmented type with this package's own
 * standalone type layer is not reliably supported by the TypeScript compiler
 * (the augmentation can shadow the framework's built-in event/effect
 * methods). At runtime the two shapes are identical — the loader passes the
 * real context, which structurally satisfies every member here.
 */
import type { LlmService } from '@deepseek-ai/dsh-llm'
import type { SessionStore } from '@deepseek-ai/dsh-session'
import type { SessionTitleService } from '@deepseek-ai/dsh-session-title'

/** Logger facade as produced by `ctx.logger(name)`. */
export interface CaptionLogger {
  debug(message: string, ...args: unknown[]): void
  info(message: string, ...args: unknown[]): void
  warn(message: string, ...args: unknown[]): void
  error(message: string, ...args: unknown[]): void
}

/**
 * The harness context surface this plugin uses.
 */
export interface CaptionContext {
  /** Event bus listener registration (cleaned up with the plugin fiber). */
  on(name: string, listener: (...args: never[]) => void): () => boolean
  /** Lifecycle effect registration (cleaned up with the plugin fiber). */
  effect(execute: () => unknown): unknown
  /** Named logger. */
  logger(name: string): CaptionLogger
  /** Model seam: adapter registry and streaming calls. */
  llm: LlmService
  /** Session log store. */
  sessions: SessionStore
  /** Session-title service (provider registration point). */
  sessionTitle: SessionTitleService
}
