import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createCaptionFlow } from '../src/flow.js'
import type { CaptionConfig } from '../src/config.js'
import { resolveCaptionConfig } from '../src/config.js'
import { SessionStore, Session } from '@deepseek-ai/dsh-session'
import { SessionTitleService } from '@deepseek-ai/dsh-session-title'
import type { LlmService, StreamChunk } from '@deepseek-ai/dsh-llm'

const defaultConfig: CaptionConfig = {
  instant: { enabled: true, prefix: '', maxWords: 6, maxCjkChars: 14 },
  refine: { enabled: true, maxWords: 5, maxCjkChars: 10, maxInputBytes: 4096, maxOutputTokens: 64, timeoutMs: 5000 },
  budget: { preferCheap: true, patterns: ['flash', 'mini'] },
  summary: { enabled: true, maxChars: 120 },
  timing: { idleDelayMs: 5000, activityWindowMs: 1500, modelCacheMs: 0 },
  model: { provider: '', model: '' },
  dedup: { enabled: true, suffix: '({n})' },
  debug: false,
}

function textChunks(text: string): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text },
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

function makeLlm(reply = 'Fix the login form validation'): { llm: LlmService; stream: ReturnType<typeof vi.fn> } {
  const stream = vi.fn(async function* () {
    yield* textChunks(reply)
  })
  return {
    llm: {
      stream,
      listModels: vi.fn(async () => [{ provider: 'deepseek-official', id: 'deepseek-v4-flash', name: 'flash' }]),
      listConfigurableProviders: vi.fn(() => [{ provider: 'deepseek-official', displayName: 'DeepSeek', settingsNs: 'llm-deepseek', settingsPath: [] }]),
      listProviders: vi.fn(() => []),
    } as unknown as LlmService,
    stream,
  }
}

function harness(config: CaptionConfig = defaultConfig, reply?: string) {
  const store = new SessionStore()
  const titles = new SessionTitleService()
  const { llm, stream } = makeLlm(reply)
  const resolved = resolveCaptionConfig(config)
  const log = { debug: () => undefined, warn: () => undefined }
  const flow = createCaptionFlow({ llm, sessionTitle: titles, sessions: store }, resolved, log)
  // Register the flow as the service's sole provider, exactly like the entry
  // point does, so `refresh()` drives stage two end to end.
  titles.register({
    id: 'session-caption' as never,
    automatic: 'all-user-messages',
    generate: (request) => flow.generate(request),
  })
  return { store, titles, llm, stream, flow }
}

function userEvent(session: Session, seq: number, text: string) {
  // Append a real durable event: the refresh path collects its source
  // messages from the session log, exactly like the harness service does.
  return session.append('user/message', {
    id: `m${seq}` as never,
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  })
}

function request(session: Session, messages: Array<{ seq: number; text: string }>) {
  return { session, messages, signal: new AbortController().signal }
}

/** Simulate the title service accepting a provider result into the log. */
function acceptTitle(session: Session, result: { title: string; messageSeqs: readonly number[] }) {
  return session.append('session/title', {
    title: result.title,
    messageSeqs: [...result.messageSeqs],
    source: { kind: 'provider', provider: 'session-caption' as never },
  })
}

describe('caption flow — two stages', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('answers with an instant keyword caption while busy, without calling the LLM', async () => {
    const { store, titles, stream, flow } = harness()
    const session = store.create('s1' as never)
    const event = userEvent(session, 1, 'Help me fix the login form email validation')
    flow.onSessionEvent(session, event)
    const result = await flow.generate(request(session, [{ seq: 1, text: event.data.content[0]!.text }]))
    expect(result.title).toBe('Fix Login Form Email Validation')
    expect(result.messageSeqs).toEqual([1])
    expect(stream).not.toHaveBeenCalled()
    expect(titles.get(session)?.title).toBeUndefined() // service appends, not the flow
  })

  it('refines with the model once the session goes idle', async () => {
    const { store, titles, flow } = harness(defaultConfig, 'Fix the login validation flow')
    const session = store.create('s1' as never)
    flow.onSessionEvent(session, userEvent(session, 1, 'Help me fix the login form email validation'))
    await vi.advanceTimersByTimeAsync(5000)
    const snapshot = titles.get(session)
    expect(snapshot?.title).toBe('Fix the login validation flow')
    expect(snapshot?.source.kind).toBe('provider')
    expect(snapshot?.source.model?.provider).toBe('deepseek-official')
  })

  it('keeps refining as new messages arrive and the session idles again', async () => {
    const { store, titles, flow } = harness(defaultConfig, 'Fix the login flow')
    const session = store.create('s1' as never)
    flow.onSessionEvent(session, userEvent(session, 1, 'Help me fix the login form'))
    await vi.advanceTimersByTimeAsync(5000)
    expect(titles.get(session)?.title).toBe('Fix the login flow')
    flow.onSessionEvent(session, userEvent(session, 2, 'Also add password reset'))
    // busy: instant caption keeps the title shape until idle
    await flow.generate(request(session, [
      { seq: 1, text: 'Help me fix the login form' },
      { seq: 2, text: 'Also add password reset' },
    ]))
    await vi.advanceTimersByTimeAsync(5000)
    // The refinement proposes the same text again; the unchanged caption is
    // skipped and the existing title is kept.
    expect(titles.get(session)?.title).toBe('Fix the login flow')
  })

  it('refuses to touch a user-pinned title', async () => {
    const { store, titles, flow } = harness()
    const session = store.create('s1' as never)
    titles.rename(session, 'My manual title')
    await expect(flow.generate(request(session, [{ seq: 1, text: 'fix login' }]))).rejects.toThrow('pinned')
    expect(titles.get(session)?.title).toBe('My manual title')
  })

  it('skips refinement when the user pins the title mid-session', async () => {
    const { store, titles, flow } = harness(defaultConfig, 'Refined title')
    const session = store.create('s1' as never)
    flow.onSessionEvent(session, userEvent(session, 1, 'fix login'))
    titles.rename(session, 'Pinned by user')
    await vi.advanceTimersByTimeAsync(5000)
    expect(titles.get(session)?.title).toBe('Pinned by user')
  })

  it('skips unchanged captions instead of rewriting them', async () => {
    const { store, titles, flow, stream } = harness(defaultConfig, 'Fix Login Bug')
    const session = store.create('s1' as never)
    flow.onSessionEvent(session, userEvent(session, 1, 'fix the login bug'))
    // Stage one produces "Fix Login Bug"; the service accepts it.
    const instant = await flow.generate(request(session, [{ seq: 1, text: 'fix the login bug' }]))
    expect(instant.title).toBe('Fix Login Bug')
    acceptTitle(session, instant)
    // Idle refinement proposes the same text: the LLM is consulted but the
    // title event must not be duplicated and the caption is marked stable.
    await vi.advanceTimersByTimeAsync(5000)
    const titleEvents = session.events.filter((e) => e.type === 'session/title')
    expect(titleEvents).toHaveLength(1)
    expect(stream).toHaveBeenCalledTimes(1)
    expect(titles.get(session)?.title).toBe('Fix Login Bug')
  })

  it('records the caption-note summary event alongside a refinement', async () => {
    const { store, flow } = harness(defaultConfig, 'Fix login flow\nImproves email validation on the login form')
    const session = store.create('s1' as never)
    flow.onSessionEvent(session, userEvent(session, 1, 'help me with login email validation'))
    await vi.advanceTimersByTimeAsync(5000)
    const note = session.events.find((e) => e.type === 'session/caption-note')
    expect(note).toBeDefined()
    const data = note?.data as { title: string; note: string; messageSeqs: number[] }
    expect(data.title).toBe('Fix login flow')
    expect(data.note).toBe('Improves email validation on the login form')
    // seq 0 is the log sequence of the first user/message event.
    expect(data.messageSeqs).toEqual([0])
  })

  it('deduplicates identical captions across concurrent sessions', async () => {
    const { store, flow } = harness()
    const a = store.create('a' as never)
    const b = store.create('b' as never)
    // Feed the activity probe so both sessions are busy (stage one path).
    flow.onSessionEvent(a, userEvent(a, 1, 'fix the login bug'))
    flow.onSessionEvent(b, userEvent(b, 1, 'fix the login bug'))
    const resultA = await flow.generate(request(a, [{ seq: 1, text: 'fix the login bug' }]))
    acceptTitle(a, resultA) // session a now owns "Fix Login Bug"
    const resultB = await flow.generate(request(b, [{ seq: 1, text: 'fix the login bug' }]))
    expect(resultA.title).toBe('Fix Login Bug')
    expect(resultB.title).toBe('Fix Login Bug (2)')
  })

  it('falls back to refinement when the session is already idle', async () => {
    const { store, titles, flow, stream } = harness(defaultConfig, 'Idle refined title')
    const session = store.create('s1' as never)
    // No event was fed: the probe sees an idle session, so the automatic
    // generation goes straight to stage two.
    const result = await flow.generate(request(session, [{ seq: 1, text: 'set up jwt auth' }]))
    expect(result.title).toBe('Idle refined title')
    expect(stream).toHaveBeenCalledTimes(1)
    expect(titles.get(session)?.title).toBeUndefined()
  })

  it('skips when instant captions and refinement are both disabled', async () => {
    const config: CaptionConfig = {
      ...defaultConfig,
      instant: { ...defaultConfig.instant, enabled: false },
      refine: { ...defaultConfig.refine, enabled: false },
    }
    const { store, flow } = harness(config)
    const session = store.create('s1' as never)
    flow.onSessionEvent(session, userEvent(session, 1, 'anything'))
    await expect(flow.generate(request(session, [{ seq: 1, text: 'anything' }]))).rejects.toThrow('no caption stage eligible')
  })

  it('with instant disabled, generation waits for the idle window', async () => {
    const config: CaptionConfig = {
      ...defaultConfig,
      instant: { ...defaultConfig.instant, enabled: false },
    }
    const { store, titles, flow } = harness(config, 'Idle-only refined title')
    const session = store.create('s1' as never)
    flow.onSessionEvent(session, userEvent(session, 1, 'set up jwt auth'))
    // Busy: the automatic generation yields nothing; the title appears only
    // after the idle window, driven by the timer.
    await expect(flow.generate(request(session, [{ seq: 1, text: 'set up jwt auth' }]))).rejects.toThrow(
      'no caption stage eligible',
    )
    await vi.advanceTimersByTimeAsync(5000)
    expect(titles.get(session)?.title).toBe('Idle-only refined title')
  })

  it('drops a refinement that was superseded by newer input mid-call', async () => {
    const store = new SessionStore()
    const titles = new SessionTitleService()
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => { release = resolve })
    const stream = vi.fn(async function* () {
      await gate
      yield* textChunks('Refined from older input')
    })
    const llm = {
      stream,
      listModels: vi.fn(async () => [{ provider: 'deepseek-official', id: 'deepseek-v4-flash', name: 'flash' }]),
      listConfigurableProviders: vi.fn(() => [{ provider: 'deepseek-official', displayName: 'DeepSeek', settingsNs: 'llm-deepseek', settingsPath: [] }]),
      listProviders: vi.fn(() => []),
    } as unknown as LlmService
    const flow = createCaptionFlow(
      { llm, sessionTitle: titles, sessions: store },
      resolveCaptionConfig(defaultConfig),
      { debug: () => undefined, warn: () => undefined },
    )
    const session = store.create('s1' as never)
    // Append the message to the log but do NOT feed the activity probe:
    // the session must look idle so the direct generate takes the refine path.
    const first = userEvent(session, 1, 'fix the login flow')
    const generation = flow.generate(request(session, [{ seq: first.seq, text: 'fix the login flow' }]))
    await vi.advanceTimersByTimeAsync(0)
    // A newer message lands while the refinement call is still open.
    userEvent(session, 2, 'now also add password reset')
    release()
    // The revision covers only the older snapshot; it must not be applied.
    await expect(generation).rejects.toThrow('superseded by newer input')
  })

  it('never overwrites a title the user pinned while refinement was in flight', async () => {
    const store = new SessionStore()
    const titles = new SessionTitleService()
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => { release = resolve })
    const stream = vi.fn(async function* () {
      await gate
      yield* textChunks('Stale refined title')
    })
    const llm = {
      stream,
      listModels: vi.fn(async () => [{ provider: 'deepseek-official', id: 'deepseek-v4-flash', name: 'flash' }]),
      listConfigurableProviders: vi.fn(() => [{ provider: 'deepseek-official', displayName: 'DeepSeek', settingsNs: 'llm-deepseek', settingsPath: [] }]),
      listProviders: vi.fn(() => []),
    } as unknown as LlmService
    const resolved = resolveCaptionConfig(defaultConfig)
    const flow = createCaptionFlow(
      { llm, sessionTitle: titles, sessions: store },
      resolved,
      { debug: () => undefined, warn: () => undefined },
    )
    const session = store.create('s1' as never)
    // No activity was fed, so the session is idle: the direct generate call
    // takes the refinement path, whose LLM stream is held open by the gate.
    const generation = flow.generate(request(session, [{ seq: 1, text: 'fix the login flow' }]))
    await vi.advanceTimersByTimeAsync(0)
    titles.rename(session, 'Pinned mid-flight')
    release()
    // The refined proposal is rejected because the pin landed during the
    // call; the pin itself is untouched.
    await expect(generation).rejects.toThrow('pinned during refinement')
    expect(titles.get(session)?.title).toBe('Pinned mid-flight')
  })
})
