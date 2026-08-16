import { describe, expect, it, vi } from 'vitest'
import { Refiner, selectWithinBudget, splitLines, frameMessages } from '../src/refine.js'
import { BudgetRouter, type ModelRoute } from '../src/budget.js'
import { CaptionNormalizer } from '../src/normalizer.js'
import type { LlmService, StreamChunk } from '@deepseek-ai/dsh-llm'
import type { SessionTitleUserMessage } from '@deepseek-ai/dsh-session-title'
import { Session } from '@deepseek-ai/dsh-session'

const refineConfig = {
  enabled: true,
  maxWords: 5,
  maxCjkChars: 10,
  maxInputBytes: 4096,
  maxOutputTokens: 64,
  timeoutMs: 5000,
}

function streamChunks(text: string): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text },
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

function makeRefiner(llm: Partial<LlmService> = {}, explicitRoute: ModelRoute | null = { provider: 'deepseek-official', model: 'deepseek-v4-flash' }): Refiner {
  const stream = vi.fn(async function* () {}) as unknown as LlmService['stream']
  const service = {
    stream,
    listModels: vi.fn(async () => []),
    listConfigurableProviders: vi.fn(() => []),
    listProviders: vi.fn(() => []),
    ...llm,
  } as unknown as LlmService
  const router = new BudgetRouter(service, { preferCheap: false, patterns: [] }, 0, explicitRoute ?? undefined, { debug: () => undefined })
  return new Refiner(service, refineConfig, { enabled: true, maxChars: 120 }, router, new CaptionNormalizer(), {
    warn: () => undefined,
    debug: () => undefined,
  })
}

function request(session: Session, messages: SessionTitleUserMessage[]) {
  return {
    session,
    messages,
    signal: new AbortController().signal,
  }
}

/** Request whose signal is already aborted. */
function abortedRequest(session: Session, messages: SessionTitleUserMessage[]) {
  const controller = new AbortController()
  controller.abort()
  return { session, messages, signal: controller.signal }
}

describe('Refiner.refine', () => {
  it('streams to the budget route and returns the parsed caption', async () => {
    const chunks = streamChunks('Setup JWT auth in Express')
    const llm = { stream: vi.fn(async function* () { yield* chunks }) } as unknown as LlmService
    const refiner = makeRefiner(llm)
    const session = new Session('s1' as never)
    const result = await refiner.refine(request(session, [{ seq: 1, text: 'Help me set up JWT auth in my Express app' }]))
    expect(result.title).toBe('Setup JWT auth in Express')
    expect(result.messageSeqs).toEqual([1])
    expect(result.model).toEqual({ provider: 'deepseek-official', model: 'deepseek-v4-flash' })
    const options = (llm.stream as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]
    expect(options.provider).toBe('deepseek-official')
    expect(options.model).toBe('deepseek-v4-flash')
    expect(options.purpose).toBe('session-title')
    expect(options.maxTokens).toBe(64)
  })

  it('splits the note off the second line when summaries are enabled', async () => {
    const chunks = streamChunks('Setup JWT auth in Express\nThe user wants a JWT login flow.')
    const llm = { stream: vi.fn(async function* () { yield* chunks }) } as unknown as LlmService
    const refiner = makeRefiner(llm)
    const session = new Session('s1' as never)
    const result = await refiner.refine(request(session, [{ seq: 1, text: 'help me with JWT' }]))
    expect(result.title).toBe('Setup JWT auth in Express')
    expect(result.note).toBe('The user wants a JWT login flow')
  })

  it('throws CaptionSkippedError when no model route is available', async () => {
    const refiner = makeRefiner({}, null)
    const session = new Session('s1' as never)
    await expect(refiner.refine(request(session, [{ seq: 1, text: 'hello' }]))).rejects.toThrow('no model route available')
  })

  it('rejects a max-tokens finish as untrustworthy', async () => {
    const chunks = [
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'text-delta', index: 0, text: 'partial' },
      { type: 'finish', reason: { kind: 'max-tokens' } },
    ]
    const llm = { stream: vi.fn(async function* () { yield* chunks }) } as unknown as LlmService
    const refiner = makeRefiner(llm)
    const session = new Session('s1' as never)
    await expect(refiner.refine(request(session, [{ seq: 1, text: 'hello' }]))).rejects.toThrow('maxOutputTokens')
  })

  it('honors abort signals before streaming', async () => {
    const llm = { stream: vi.fn() } as unknown as LlmService
    const refiner = makeRefiner(llm)
    const session = new Session('s1' as never)
    await expect(refiner.refine(abortedRequest(session, [{ seq: 1, text: 'hello' }]))).rejects.toThrow('aborted')
  })
})

describe('selectWithinBudget', () => {
  it('keeps the newest messages that fit the budget', () => {
    const messages: SessionTitleUserMessage[] = [
      { seq: 1, text: 'first message '.repeat(50) },
      { seq: 2, text: 'second' },
      { seq: 3, text: 'third' },
    ]
    const selected = selectWithinBudget(messages, 512)
    expect(selected.map((m) => m.seq)).toEqual([2, 3])
  })

  it('keeps the newest message even when it overflows alone', () => {
    const messages: SessionTitleUserMessage[] = [{ seq: 1, text: 'x'.repeat(10_000) }]
    const selected = selectWithinBudget(messages, 512)
    expect(selected).toHaveLength(1)
    expect(selected[0]?.text.length).toBeLessThan(10_000)
    expect(selected[0]?.text.length).toBeGreaterThan(100)
  })
})

describe('splitLines', () => {
  it('takes the first non-empty line as title and joins the rest as note', () => {
    expect(splitLines('\n\nCaption here\nnote line one\nnote line two\n')).toEqual({
      title: 'Caption here',
      note: 'note line one note line two',
    })
  })

  it('returns empty title for empty input', () => {
    expect(splitLines('  \n\t\n')).toEqual({ title: '', note: '' })
  })
})

describe('frameMessages', () => {
  it('frames messages as a JSON array', () => {
    const framed = frameMessages([{ seq: 2, text: 'a "quoted" text' }])
    expect(framed).toContain('"text":"a \\"quoted\\" text"')
    expect(framed).toContain('"seq":2')
  })
})
