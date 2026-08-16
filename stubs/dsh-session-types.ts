/**
 * Type-only stub of `@deepseek-ai/dsh-session/types`. Mirrors the published
 * 0.0.1-rc.1 event vocabulary for the event types this plugin observes and
 * declares. The interface is merge-extensible: the title packages augment it
 * with their own log-only events.
 */
import type { AssistantMessage, CallId, StreamChunk, TokenUsage, ToolResultMessage, UserMessage } from './dsh-llm.js'

export type SessionId = string & { readonly __brand: 'SessionId' }

export interface SessionEventMap {
  'turn/start': { turn: number }
  'turn/end': { turn: number; reason: string }
  'step/start': { turn: number; step: number }
  'step/end': { turn: number; step: number }
  'user/message': UserMessage
  'assistant/chunk': { turn: number; step: number; chunk: StreamChunk }
  'assistant/message': { turn: number; step: number; message: AssistantMessage; usage?: TokenUsage }
  'tool/call': { turn: number; step: number; callId: CallId; name: string; arguments: string }
  'tool/result': { turn: number; step: number; callId: CallId; message: ToolResultMessage; error?: unknown }
  'request/header': { header: unknown; reason: unknown }
  'request/context': unknown
}

export type SessionEventType = keyof SessionEventMap
export type SurfaceEventType = 'user/message' | 'assistant/message' | 'tool/result'

export interface SessionEvent<T extends SessionEventType = SessionEventType> {
  type: T
  seq: number
  time: number
  data: SessionEventMap[T]
}
