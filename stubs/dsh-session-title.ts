/**
 * Type + runtime stub of `@deepseek-ai/dsh-session-title` for standalone
 * development and tests. The `SessionTitleService` implements the durable
 * latest-wins fold, explicit rename pinning, sole-provider registration, and
 * refresh dispatch with the same observable semantics as the published
 * package; the real package is provided by the harness at load time.
 */
import type { Session, SessionEvent } from './dsh-session.js'
import type { SessionEventMap } from './dsh-session-types.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SessionTitleProviderId = string & { readonly __brand: 'SessionTitleProviderId' }

export interface SessionTitleModelProvenance {
  readonly provider: string
  readonly model: string
}

export type SessionTitleSource =
  | { readonly kind: 'fallback' }
  | { readonly kind: 'provider'; readonly provider: SessionTitleProviderId; readonly model?: SessionTitleModelProvenance }
  | { readonly kind: 'user' }

export interface SessionTitleEventData {
  readonly title: string
  readonly messageSeqs: number[]
  readonly source: SessionTitleSource
}

export interface SessionTitleSnapshot extends SessionTitleEventData {
  readonly eventSeq: number
  readonly updatedAt: number
}

export interface SessionTitleUserMessage {
  readonly seq: number
  readonly text: string
}

export type SessionTitleAutomaticMode = 'first-message' | 'all-user-messages'

export interface SessionTitleProviderRequest {
  readonly session: Session
  readonly messages: readonly SessionTitleUserMessage[]
  readonly route?: SessionTitleModelProvenance
  readonly signal: AbortSignal
}

export interface SessionTitleProviderResult {
  readonly title: string
  readonly messageSeqs: readonly number[]
  readonly model?: SessionTitleModelProvenance
}

export interface SessionTitleProvider {
  readonly id: SessionTitleProviderId
  readonly automatic: SessionTitleAutomaticMode
  generate(request: SessionTitleProviderRequest): Promise<SessionTitleProviderResult>
}

export class SessionTitleInvalidError extends Error {
  readonly name = 'SessionTitleInvalidError'
}

export interface SessionTitleService {
  get(session: Session): SessionTitleSnapshot | undefined
  rename(session: Session, title: string): SessionTitleSnapshot
  refresh(session: Session, signal?: AbortSignal): Promise<SessionTitleSnapshot | undefined>
  register(provider: SessionTitleProvider): () => Promise<void>
}

// ---------------------------------------------------------------------------
// Runtime helpers
// ---------------------------------------------------------------------------

export function SessionTitleProviderId(id: string): SessionTitleProviderId {
  return id as SessionTitleProviderId
}

export function normalizeSessionTitle(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .replace(/^[\s.,;:!?。，；：！？、·\-—_'"“”‘’()[\]{}<>/\\|~`#*]+/, '')
    .replace(/[\s.,;:!?。，；：！？、·\-—_'"“”‘’()[\]{}<>/\\|~`#*]+$/, '')
    .trim()
}

export function truncateTitleUtf8(text: string, maxBytes: number): string {
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) return text
  let out = ''
  let bytes = 0
  for (const ch of text) {
    const width = Buffer.byteLength(ch, 'utf8')
    if (bytes + width > maxBytes) break
    out += ch
    bytes += width
  }
  return out
}

export function collectSessionTitleMessages(events: readonly SessionEvent[], throughSeq?: number): SessionTitleUserMessage[] {
  const out: SessionTitleUserMessage[] = []
  for (const event of events) {
    if (throughSeq !== undefined && event.seq > throughSeq) break
    if (event.type !== 'user/message') continue
    const data = event.data as SessionEventMap['user/message']
    const blocks = data.content
    const text = blocks
      .filter((block): block is Extract<typeof block, { type: 'text' }> => block.type === 'text')
      .map((block) => block.text)
      .join(' ')
    if (text.length > 0) out.push({ seq: event.seq, text })
  }
  return out
}

export function foldSessionTitle(events: readonly SessionEvent[]): SessionTitleSnapshot | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i]
    if (event?.type === 'session/title') {
      const data = event.data as SessionEventMap['session/title']
      return {
        title: data.title,
        messageSeqs: data.messageSeqs,
        source: data.source,
        eventSeq: event.seq,
        updatedAt: event.time,
      }
    }
  }
  return undefined
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class SessionTitleService {
  private provider: SessionTitleProvider | undefined

  get(session: Session): SessionTitleSnapshot | undefined {
    return foldSessionTitle(session.events)
  }

  rename(session: Session, title: string): SessionTitleSnapshot {
    const normalized = normalizeSessionTitle(title)
    if (normalized.length === 0) throw new SessionTitleInvalidError('title normalizes to empty')
    const event = session.append('session/title', {
      title: normalized,
      messageSeqs: [],
      source: { kind: 'user' },
    })
    return {
      title: normalized,
      messageSeqs: [],
      source: { kind: 'user' },
      eventSeq: event.seq,
      updatedAt: event.time,
    }
  }

  async refresh(session: Session, signal?: AbortSignal): Promise<SessionTitleSnapshot | undefined> {
    const provider = this.provider
    if (provider === undefined) return undefined
    const messages = collectSessionTitleMessages(session.events)
    if (messages.length === 0) return undefined
    const request: SessionTitleProviderRequest = {
      session,
      messages,
      signal: signal ?? new AbortController().signal,
    }
    const result = await provider.generate(request)
    // The real service enforces its accepted-title byte budget here; mirror
    // it so over-budget provider output never lands in the log.
    const title = normalizeSessionTitle(truncateTitleUtf8(result.title, 80))
    if (title.length === 0) throw new SessionTitleInvalidError('provider produced an empty title')
    const event = session.append('session/title', {
      title,
      messageSeqs: [...result.messageSeqs],
      source: { kind: 'provider', provider: provider.id, model: result.model },
    })
    return {
      title,
      messageSeqs: [...result.messageSeqs],
      source: { kind: 'provider', provider: provider.id, model: result.model },
      eventSeq: event.seq,
      updatedAt: event.time,
    }
  }

  register(provider: SessionTitleProvider): () => Promise<void> {
    if (typeof provider.generate !== 'function' || typeof provider.id !== 'string') {
      throw new Error('session-title: malformed provider registration')
    }
    this.provider = provider
    return async () => {
      if (this.provider === provider) this.provider = undefined
    }
  }
}
