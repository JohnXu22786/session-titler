/**
 * Type + runtime stub of `@deepseek-ai/dsh-session` for standalone
 * development and tests. The `Session` class and `SessionStore` implement the
 * append-only log semantics the plugin relies on; the real package is
 * provided by the harness at load time (peer dependency).
 */
import type { Message } from './dsh-llm.js'
import {
  type SessionEvent,
  type SessionEventMap,
  type SessionEventType,
  type SessionId,
} from './dsh-session-types.js'
export * from './dsh-session-types.js'

let storeCounter = 0

function jsonSafe(data: unknown): void {
  // The real append rejects non-lossless-JSON payloads; keep that contract.
  JSON.stringify(data)
}

/**
 * An append-only log of typed session events (minimal stub).
 */
export class Session {
  private log: SessionEvent[]
  readonly header: unknown
  readonly id: SessionId

  constructor(id: SessionId, seed: readonly SessionEvent[] = []) {
    this.id = id
    this.log = [...seed]
    this.header = { id, version: 1, createdAt: Date.now() }
  }

  get events(): readonly SessionEvent[] {
    return this.log
  }

  get seq(): number {
    return this.log.length
  }

  append<T extends SessionEventType>(type: T, data: SessionEventMap[T]): SessionEvent<T> {
    jsonSafe(data)
    const event: SessionEvent<T> = {
      type,
      seq: this.log.length,
      time: Date.now(),
      data,
    }
    this.log.push(event)
    return event
  }

  deriveMessages(): Message[] {
    return []
  }
}

/**
 * In-memory session store (minimal stub): create/get/list with live-entry
 * semantics close enough for flow-level tests.
 */
export class SessionStore {
  private store = new Map<SessionId, Session>()

  create(id?: SessionId): Session {
    const resolved = id ?? (`session-${++storeCounter}` as SessionId)
    if (this.store.has(resolved)) throw new Error(`session "${resolved}" already exists`)
    const session = new Session(resolved)
    this.store.set(resolved, session)
    return session
  }

  get(id: SessionId): Session | undefined {
    return this.store.get(id)
  }

  list(): Session[] {
    return [...this.store.values()]
  }

  flush(): Promise<boolean> {
    return Promise.resolve(true)
  }
}

