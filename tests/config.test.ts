import { describe, expect, it } from 'vitest'
import { resolveCaptionConfig, Config, DEFAULT_CHEAP_PATTERNS } from '../src/config.js'
import z from '@deepseek-ai/schemastery'

describe('resolveCaptionConfig', () => {
  it('applies defaults for an empty configuration', () => {
    const config = resolveCaptionConfig({})
    expect(config.instant.enabled).toBe(true)
    expect(config.instant.maxWords).toBe(6)
    expect(config.instant.maxCjkChars).toBe(14)
    expect(config.refine.enabled).toBe(true)
    expect(config.refine.maxInputBytes).toBe(4096)
    expect(config.refine.timeoutMs).toBe(60000)
    expect(config.budget.preferCheap).toBe(true)
    expect(config.budget.patterns).toEqual(DEFAULT_CHEAP_PATTERNS)
    expect(config.summary.enabled).toBe(true)
    expect(config.summary.maxChars).toBe(120)
    expect(config.timing.idleDelayMs).toBe(5000)
    expect(config.timing.activityWindowMs).toBe(1500)
    expect(config.model.provider).toBe('')
    expect(config.dedup.suffix).toBe('({n})')
    expect(config.debug).toBe(false)
  })

  it('merges partial overrides with defaults', () => {
    const config = resolveCaptionConfig({
      instant: { maxWords: 3, prefix: '⚡ ' },
      timing: { idleDelayMs: 2000 },
      model: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
    })
    expect(config.instant.maxWords).toBe(3)
    expect(config.instant.prefix).toBe('⚡ ')
    expect(config.instant.maxCjkChars).toBe(14) // untouched default
    expect(config.timing.idleDelayMs).toBe(2000)
    expect(config.model).toEqual({ provider: 'deepseek-official', model: 'deepseek-v4-flash' })
  })

  it('rejects a provider without a model', () => {
    expect(() => resolveCaptionConfig({ model: { provider: 'deepseek-official' } })).toThrow(
      'provider and model must be configured together',
    )
  })

  it('rejects a model without a provider', () => {
    expect(() => resolveCaptionConfig({ model: { model: 'deepseek-chat' } })).toThrow(
      'provider and model must be configured together',
    )
  })

  it('accepts an undefined configuration', () => {
    expect(() => resolveCaptionConfig(undefined)).not.toThrow()
  })

  it('deep-freezes the resolved policy', () => {
    const config = resolveCaptionConfig({})
    expect(() => {
      ;(config.instant as { enabled: boolean }).enabled = false
    }).toThrow(TypeError)
    expect(() => {
      ;(config.budget as { patterns: string[] }).patterns.push('x')
    }).toThrow(TypeError)
  })
})

describe('Config schema', () => {
  it('validates field bounds', () => {
    expect(() => Config({ instant: { maxWords: 0 } })).toThrow()
    expect(() => Config({ instant: { maxWords: 100 } })).toThrow()
    expect(() => Config({ refine: { timeoutMs: 10 } })).toThrow()
  })

  it('is a schemastery schema instance', () => {
    const value = Config({})
    expect(typeof value).toBe('object')
    expect(value).toHaveProperty('instant')
  })

  it('round-trips custom patterns', () => {
    const value = Config({ budget: { patterns: ['cheap-1'] } }) as { budget: { patterns: string[] } }
    expect(value.budget.patterns).toEqual(['cheap-1'])
  })

  it('exposes the default cheap patterns as a frozen list', () => {
    expect(DEFAULT_CHEAP_PATTERNS).toContain('flash')
    expect(DEFAULT_CHEAP_PATTERNS).toContain('mini')
    expect(Object.isFrozen(DEFAULT_CHEAP_PATTERNS)).toBe(true)
  })
})
