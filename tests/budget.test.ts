import { describe, expect, it, vi } from 'vitest'
import { BudgetRouter } from '../src/budget.js'
import type { LlmService } from '@deepseek-ai/dsh-llm'
import type { BudgetConfig } from '../src/config.js'

const budgetConfig = (overrides: Partial<BudgetConfig> = {}): BudgetConfig => ({
  preferCheap: true,
  patterns: ['flash', 'haiku', 'lite', 'mini', 'nano', 'fast', 'compact', 'small', 'light', 'speed', 'quick', 'turbo', 'economy', 'budget', '1.5', '3.5'],
  ...overrides,
})

function llmWith(
  providers: Array<{ provider: string; models: string[] }>,
  configurable?: Array<{ provider: string }>,
): LlmService {
  const catalog = new Map(providers.map((p) => [p.provider, p.models.map((id) => ({ provider: p.provider, id, name: id }))]))
  return {
    stream: vi.fn(),
    listModels: vi.fn(async (provider: string) => catalog.get(provider) ?? []),
    listConfigurableProviders: vi.fn(() => (configurable ?? providers.map((p) => ({ provider: p.provider, displayName: p.provider, settingsNs: p.provider, settingsPath: [] })))),
    listProviders: vi.fn(() => []),
  } as unknown as LlmService
}

const silentLog = { debug: () => undefined }

describe('BudgetRouter.resolve', () => {
  it('prefers the explicit provider/model override', async () => {
    const llm = llmWith([{ provider: 'deepseek-official', models: ['deepseek-v4-flash', 'deepseek-chat'] }])
    const router = new BudgetRouter(llm, budgetConfig(), 0, { provider: 'deepseek-official', model: 'deepseek-chat' }, silentLog)
    await expect(router.resolve(undefined)).resolves.toEqual({ provider: 'deepseek-official', model: 'deepseek-chat' })
    expect(llm.listModels).not.toHaveBeenCalled()
  })

  it('picks the cheapest pattern match from the catalog', async () => {
    const llm = llmWith([
      { provider: 'deepseek-official', models: ['deepseek-chat', 'deepseek-v4-flash'] },
      { provider: 'anthropic', models: ['claude-sonnet-4-5', 'claude-haiku-4-5'] },
      { provider: 'openai', models: ['gpt-4o', 'gpt-4o-mini'] },
    ])
    const router = new BudgetRouter(llm, budgetConfig(), 0, undefined, silentLog)
    const route = await router.resolve(undefined)
    expect(route).toEqual({ provider: 'deepseek-official', model: 'deepseek-v4-flash' })
  })

  it('ranks same-tier models by name length', async () => {
    const llm = llmWith([
      { provider: 'p1', models: ['longer-model-name-flash', 'flash'] },
    ])
    const router = new BudgetRouter(llm, budgetConfig(), 0, undefined, silentLog)
    await expect(router.resolve(undefined)).resolves.toEqual({ provider: 'p1', model: 'flash' })
  })

  it('falls back to the conversation route when nothing matches', async () => {
    const llm = llmWith([{ provider: 'deepseek-official', models: ['deepseek-chat'] }])
    const router = new BudgetRouter(llm, budgetConfig(), 0, undefined, silentLog)
    await expect(router.resolve({ provider: 'deepseek-official', model: 'deepseek-chat' })).resolves.toEqual({
      provider: 'deepseek-official',
      model: 'deepseek-chat',
    })
  })

  it('returns undefined when no route exists anywhere', async () => {
    const llm = llmWith([])
    const router = new BudgetRouter(llm, budgetConfig(), 0, undefined, silentLog)
    await expect(router.resolve(undefined)).resolves.toBeUndefined()
  })

  it('skips cheap scanning when preferCheap is false', async () => {
    const llm = llmWith([{ provider: 'deepseek-official', models: ['deepseek-v4-flash'] }])
    const router = new BudgetRouter(llm, budgetConfig({ preferCheap: false }), 0, undefined, silentLog)
    await expect(router.resolve({ provider: 'deepseek-official', model: 'deepseek-chat' })).resolves.toEqual({
      provider: 'deepseek-official',
      model: 'deepseek-chat',
    })
    expect(llm.listModels).not.toHaveBeenCalled()
  })

  it('caches the catalog scan until the cache window expires', async () => {
    const llm = llmWith([{ provider: 'deepseek-official', models: ['deepseek-v4-flash'] }])
    const router = new BudgetRouter(llm, budgetConfig(), 60_000, undefined, silentLog)
    await router.resolve(undefined)
    await router.resolve(undefined)
    expect(llm.listModels).toHaveBeenCalledTimes(1)
  })

  it('re-scans after invalidate', async () => {
    const llm = llmWith([{ provider: 'deepseek-official', models: ['deepseek-v4-flash'] }])
    const router = new BudgetRouter(llm, budgetConfig(), 60_000, undefined, silentLog)
    await router.resolve(undefined)
    router.invalidate()
    await router.resolve(undefined)
    expect(llm.listModels).toHaveBeenCalledTimes(2)
  })

  it('does not cache a route from a scan invalidated mid-flight', async () => {
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => { release = resolve })
    const llm = {
      stream: vi.fn(),
      listModels: vi.fn(async () => {
        await gate
        return [{ provider: 'deepseek-official', id: 'deepseek-v4-flash', name: 'flash' }]
      }),
      listConfigurableProviders: vi.fn(() => [{ provider: 'deepseek-official', displayName: 'DeepSeek', settingsNs: 'x', settingsPath: [] }]),
      listProviders: vi.fn(() => []),
    } as unknown as LlmService
    const router = new BudgetRouter(llm, budgetConfig(), 60_000, undefined, silentLog)
    const pending = router.resolve(undefined)
    router.invalidate() // topology changed while the scan is open
    release()
    await pending
    // The stale scan must not have populated the cache: the next resolve
    // scans the catalog again instead of reusing the old route.
    await router.resolve(undefined)
    expect(llm.listModels).toHaveBeenCalledTimes(2)
  })

  it('survives adapters that fail to enumerate models', async () => {
    const llm = {
      stream: vi.fn(),
      listModels: vi.fn(async () => {
        throw new Error('catalog down')
      }),
      listConfigurableProviders: vi.fn(() => [{ provider: 'broken', displayName: 'x', settingsNs: 'x', settingsPath: [] }]),
      listProviders: vi.fn(() => []),
    } as unknown as LlmService
    const router = new BudgetRouter(llm, budgetConfig(), 0, undefined, silentLog)
    await expect(router.resolve({ provider: 'deepseek-official', model: 'deepseek-chat' })).resolves.toEqual({
      provider: 'deepseek-official',
      model: 'deepseek-chat',
    })
  })

  it('honors custom patterns', async () => {
    const llm = llmWith([{ provider: 'p', models: ['whatever-eco-model', 'regular-model'] }])
    const router = new BudgetRouter(llm, budgetConfig({ patterns: ['eco'] }), 0, undefined, silentLog)
    await expect(router.resolve(undefined)).resolves.toEqual({ provider: 'p', model: 'whatever-eco-model' })
  })
})
