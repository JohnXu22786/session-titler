/**
 * Type + runtime stub of `@deepseek-ai/dsh-llm` for standalone development
 * and tests. The type surface mirrors the published 0.0.1-rc.1 declarations
 * for exactly the API this plugin consumes; the real package is provided by
 * the harness at load time (peer dependency).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MessageId = string & { readonly __brand: 'MessageId' }
export type CallId = string & { readonly __brand: 'CallId' }

export interface TextBlock {
  type: 'text'
  text: string
}
export interface ReasoningBlock {
  type: 'reasoning'
  text: string
}
export interface ImageBlock {
  type: 'image'
  data: string
  mime: string
}
export interface ToolCallBlock {
  type: 'tool-call'
  id: CallId
  name: string
  arguments: string
}
export interface ToolResultBlock {
  type: 'tool-result'
  callId: CallId
  isError: boolean
  content: ContentBlock[]
}
export interface ContentBlockMap {
  text: TextBlock
  reasoning: ReasoningBlock
  image: ImageBlock
  'tool-call': ToolCallBlock
  'tool-result': ToolResultBlock
}
export type ContentBlockType = keyof ContentBlockMap
export type ContentBlock = ContentBlockMap[ContentBlockType]

export interface LlmFailure {
  message: string
  code?: string
  status?: number
  retryAfterMs?: number
  requestId?: string
  cause?: unknown
}
export interface FinishReasonMap {
  stop: { kind: 'stop' }
  'tool-calls': { kind: 'tool-calls' }
  'max-tokens': { kind: 'max-tokens' }
  aborted: { kind: 'aborted'; failure: LlmFailure }
  error: { kind: 'error'; failure: LlmFailure }
}
export type FinishReason = FinishReasonMap[keyof FinishReasonMap]

export interface TokenUsage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  reasoningTokens?: number
}

export type StreamChunk =
  | { type: 'block-start'; index: number; blockType: ContentBlockType }
  | { type: 'text-delta'; index: number; text: string }
  | { type: 'reasoning-delta'; index: number; text: string }
  | { type: 'tool-call-delta'; index: number; id: CallId; name?: string; argumentsDelta: string }
  | { type: 'block-end'; index: number; block: ContentBlock }
  | { type: 'usage'; usage: TokenUsage }
  | { type: 'finish'; reason: FinishReason; replayState?: unknown }

export interface MessageSourceMap {
  user: { kind: 'user' }
  plugin: { kind: 'plugin'; plugin: string }
  model: { kind: 'model'; provider: string; model: string; replayState?: unknown }
  tool: { kind: 'tool'; callId: CallId }
}
export type MessageSource = MessageSourceMap[keyof MessageSourceMap]

export interface Message {
  readonly id: MessageId
  readonly role: 'system' | 'user' | 'assistant'
  readonly content: ContentBlock[]
  readonly source: MessageSource
}
export interface UserMessage extends Message {
  readonly role: 'user'
}
export interface AssistantMessage extends Message {
  readonly role: 'assistant'
  readonly source: MessageSourceMap['model']
}
export interface ToolResultMessage extends Message {
  readonly role: 'user'
  readonly content: [ToolResultBlock]
  readonly source: MessageSourceMap['tool']
}

export interface LlmProviderInfo {
  id: string
  name: string
}
export interface LlmModelInfo {
  provider: string
  id: string
  name: string
  description?: string
}
export interface LlmConfigurableProvider {
  provider: string
  displayName: string
  settingsNs: string
  settingsPath: readonly string[]
}

export interface GenerateOptions {
  provider: string
  model: string
  reasoningEffort?: unknown
  messages: Message[]
  system?: string
  tools?: unknown[]
  temperature?: number
  maxTokens?: number
  signal?: AbortSignal
  sessionId?: unknown
  purpose?: 'compaction' | 'session-title'
}

export interface LlmService {
  stream(options: GenerateOptions): AsyncIterable<StreamChunk>
  listModels(provider: string): Promise<LlmModelInfo[]>
  listConfigurableProviders(): LlmConfigurableProvider[]
  listProviders(): LlmProviderInfo[]
}

// ---------------------------------------------------------------------------
// Runtime
// ---------------------------------------------------------------------------

let messageCounter = 0

export function createMessage<T extends { role: 'system' | 'user' | 'assistant'; content: ContentBlock[]; source: MessageSource }>(
  input: T & { readonly id?: never },
): T & { id: MessageId } {
  const id = String(++messageCounter) as MessageId
  return freezeMessage({ ...input, id }) as T & { id: MessageId }
}

export function createUserMessage<T extends { content: ContentBlock[]; source: MessageSource }>(
  input: T & { readonly id?: never; readonly role?: never },
): T & Pick<UserMessage, 'id' | 'role'> {
  return createMessage({ ...input, role: 'user' }) as T & Pick<UserMessage, 'id' | 'role'>
}

export function freezeMessage<T extends Message>(message: T): T {
  return deepFreeze(message) as T
}

export function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value
  for (const key of Object.getOwnPropertyNames(value)) {
    deepFreeze((value as Record<string, unknown>)[key])
  }
  return Object.freeze(value)
}

interface PartialBlock {
  blockType: ContentBlockType
  text: string
  arguments: string
  toolId: string
  toolName: string
  closed?: ContentBlock
}

/**
 * Incremental chunk-to-content-block assembler. Tolerant of delta-only
 * streams (no block-start/end): deltas for a closed index are ignored.
 */
export class BlockAssembler {
  private partials = new Map<number, PartialBlock>()
  private order: number[] = []
  private _usage: TokenUsage | undefined
  private _finish: FinishReason | undefined
  private _replayState: unknown

  push(chunk: StreamChunk): void {
    switch (chunk.type) {
      case 'block-start': {
        if (!this.partials.has(chunk.index)) {
          this.partials.set(chunk.index, {
            blockType: chunk.blockType,
            text: '',
            arguments: '',
            toolId: '',
            toolName: '',
          })
          this.order.push(chunk.index)
        }
        break
      }
      case 'text-delta':
      case 'reasoning-delta': {
        const partial = this.partials.get(chunk.index)
        if (partial !== undefined && partial.closed === undefined) partial.text += chunk.text
        break
      }
      case 'tool-call-delta': {
        const partial = this.partials.get(chunk.index)
        if (partial !== undefined && partial.closed === undefined) {
          if (chunk.id) partial.toolId = chunk.id
          if (chunk.name !== undefined) partial.toolName = chunk.name
          partial.arguments += chunk.argumentsDelta
        }
        break
      }
      case 'block-end': {
        const partial = this.partials.get(chunk.index)
        if (partial !== undefined) {
          partial.closed = chunk.block
          if (!this.order.includes(chunk.index)) this.order.push(chunk.index)
        }
        break
      }
      case 'usage':
        this._usage = chunk.usage
        break
      case 'finish':
        this._finish = chunk.reason
        this._replayState = chunk.replayState
        break
    }
  }

  blocks(): ContentBlock[] {
    const out: ContentBlock[] = []
    for (const index of this.order) {
      const partial = this.partials.get(index)
      if (partial === undefined) continue
      if (partial.closed !== undefined) {
        out.push(partial.closed)
        continue
      }
      switch (partial.blockType) {
        case 'text':
          out.push({ type: 'text', text: partial.text })
          break
        case 'reasoning':
          out.push({ type: 'reasoning', text: partial.text })
          break
        case 'tool-call':
          out.push({
            type: 'tool-call',
            id: partial.toolId as CallId,
            name: partial.toolName,
            arguments: partial.arguments,
          })
          break
        default:
          throw new Error(`dsh-llm stub: cannot assemble open block type "${partial.blockType}"`)
      }
    }
    return out
  }

  get usage(): TokenUsage | undefined {
    return this._usage
  }

  get finish(): FinishReason {
    return this._finish ?? { kind: 'stop' }
  }

  get replayState(): unknown {
    return this._replayState
  }

  message(source?: MessageSource): Message {
    const blocks = this.blocks()
    return deepFreeze({
      id: String(++messageCounter),
      role: 'assistant',
      content: blocks,
      source: source ?? { kind: 'plugin', plugin: 'dsh-session-caption' },
    }) as Message
  }
}
