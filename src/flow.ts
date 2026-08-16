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
import type { LlmService } from '@deepseek-ai/dsh-llm'
import type { Session } from '@deepseek-ai/dsh-session'
import type {
  SessionTitleProviderResult,
  SessionTitleService,
  SessionTitleUserMessage,
} from '@deepseek-ai/dsh-session-title'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import { BudgetRouter } from './budget.js'
import type { CaptionConfig } from './config.js'
import { CaptionSkippedError } from './errors.js'
import { KeywordCaptioner } from './keywords.js'
import { CaptionNormalizer, truncateUtf8, SERVICE_MAX_TITLE_BYTES } from './normalizer.js'
import { IdlePacemaker } from './pacemaker.js'
import { Refiner, type RefinedCaption } from './refine.js'

export interface FlowDeps {
  llm: LlmService
  sessionTitle: SessionTitleService
  sessions: { list(): readonly Session[] }
}

export interface FlowLog {
  debug(message: string): void
  warn(message: string, ...args: unknown[]): void
}

export interface CaptionFlow {
  /**
   * The registered provider's revision handler.
   * @throws {CaptionSkippedError} when the revision deliberately yields
   *   nothing; other throws are genuine failures.
   */
  generate(request: {
    session: Session
    messages: readonly SessionTitleUserMessage[]
    route?: { provider: string; model: string }
    signal: AbortSignal
  }): Promise<SessionTitleProviderResult>

  /** Feed one durable session event into the activity probe. */
  onSessionEvent(session: Session, event: SessionEvent): void

  /** Abort in-flight work and cancel armed timers (plugin teardown). */
  dispose(): void

  /** The budget router (so adapter-topology changes can invalidate it). */
  readonly router: BudgetRouter
}

export function createCaptionFlow(deps: FlowDeps, config: CaptionConfig, log: FlowLog): CaptionFlow {
  const pacemaker = new IdlePacemaker(config.timing, log)
  const normalizer = new CaptionNormalizer()
  const keywords = new KeywordCaptioner(config.instant, normalizer)
  const router = new BudgetRouter(
    deps.llm,
    config.budget,
    config.timing.modelCacheMs,
    explicitRoute(config),
    log,
  )
  const refiner = new Refiner(deps.llm, config.refine, config.summary, router, normalizer, log)

  /** Abort handles for in-flight refinements, keyed by session id. */
  const refinementSignals = new Map<string, AbortController>()

  const startRefinement = (session: Session): void => {
    if (!config.refine.enabled) return
    pacemaker.scheduleRefine(session.id, () => {
      const controller = new AbortController()
      refinementSignals.set(session.id, controller)
      return deps.sessionTitle.refresh(session, controller.signal).finally(() => {
        // The call has settled (or was aborted); drop the handle so a long
        // harness lifetime does not accumulate one controller per session.
        refinementSignals.delete(session.id)
      })
    }, () => {
      const current = deps.sessionTitle.get(session)
      return current === undefined || current.source.kind !== 'user'
    })
  }

  const dedupeTitle = (session: Session, title: string): string => {
    if (!config.dedup.enabled) return title
    const taken = new Set<string>()
    for (const other of deps.sessions.list()) {
      if (other.id === session.id) continue
      const theirs = deps.sessionTitle.get(other)?.title
      if (theirs !== undefined && theirs.length > 0) taken.add(theirs)
    }
    if (!taken.has(title)) return title
    for (let n = 2; n <= 99; n++) {
      const suffix = ` ${config.dedup.suffix.replace('{n}', String(n))}`
      const room = SERVICE_MAX_TITLE_BYTES - Buffer.byteLength(suffix, 'utf8')
      if (room < 1) break // an oversized suffix cannot produce a valid title
      const candidate = `${truncateUtf8(title, room)}${suffix}`
      if (Buffer.byteLength(candidate, 'utf8') > SERVICE_MAX_TITLE_BYTES) break
      if (!taken.has(candidate)) return candidate
    }
    return title
  }

  const recordNote = (session: Session, refined: RefinedCaption, title: string): void => {
    if (!config.summary.enabled || refined.note.length === 0) return
    try {
      session.append('session/caption-note', {
        title,
        note: refined.note,
        messageSeqs: [...refined.messageSeqs],
      })
    } catch (error) {
      log.debug(`caption-note append failed: ${String(error)}`)
    }
  }

  const generate = async (request: {
    session: Session
    messages: readonly SessionTitleUserMessage[]
    route?: { provider: string; model: string }
    signal: AbortSignal
  }): Promise<SessionTitleProviderResult> => {
    request.signal.throwIfAborted()
    const { session, messages } = request
    const current = deps.sessionTitle.get(session)
    if (current?.source.kind === 'user') {
      // The user pinned a title; never compete with it.
      throw new CaptionSkippedError('user title pinned; automatic captions stopped')
    }

    if (config.instant.enabled && pacemaker.isBusy(session.id)) {
      const caption = keywords.make(messages)
      if (caption === null) throw new CaptionSkippedError('no caption material in the latest message')
      const title = dedupeTitle(session, caption)
      if (config.dedup.enabled && current !== undefined && normalizer.isSame(title, current.title)) {
        throw new CaptionSkippedError('caption unchanged; keeping the current title')
      }
      startRefinement(session)
      const latest = messages[messages.length - 1]
      return { title, messageSeqs: latest === undefined ? [] : [latest.seq] }
    }

    if (config.refine.enabled && !pacemaker.isBusy(session.id)) {
      const refined = await refiner.refine(request)
      // Re-read the fold: a user rename that landed during the call wins.
      const latest = deps.sessionTitle.get(session)
      if (latest?.source.kind === 'user') {
        throw new CaptionSkippedError('user title pinned during refinement')
      }
      // New input that arrived while the model was working supersedes this
      // revision: the pending timer re-arm will refine the newer snapshot.
      const newestInput = latestUserMessageSeq(session)
      if (newestInput !== undefined && !refined.messageSeqs.includes(newestInput)) {
        throw new CaptionSkippedError('refinement superseded by newer input')
      }
      const title = dedupeTitle(session, refined.title)
      if (config.dedup.enabled && latest !== undefined && normalizer.isSame(title, latest.title)) {
        pacemaker.markStable(session.id)
        throw new CaptionSkippedError('caption unchanged; marking stable')
      }
      recordNote(session, refined, title)
      return { title, messageSeqs: refined.messageSeqs, model: refined.model }
    }

    throw new CaptionSkippedError('no caption stage eligible (refine disabled or session busy)')
  }

  const onSessionEvent = (session: Session, event: SessionEvent): void => {
    pacemaker.poke(session.id)
    if (event.type === 'user/message') {
      pacemaker.markDirty(session.id)
      startRefinement(session)
    }
  }

  return {
    generate,
    onSessionEvent,
    dispose: () => {
      for (const controller of refinementSignals.values()) controller.abort()
      refinementSignals.clear()
      pacemaker.dispose()
    },
    router,
  }
}

function explicitRoute(config: CaptionConfig): { provider: string; model: string } | undefined {
  const { provider, model } = config.model
  return provider.length > 0 && model.length > 0 ? { provider, model } : undefined
}

/** The log seq of the newest `user/message` event, if any. */
function latestUserMessageSeq(session: Session): number | undefined {
  const events = session.events
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i]?.type === 'user/message') return events[i]?.seq
  }
  return undefined
}
