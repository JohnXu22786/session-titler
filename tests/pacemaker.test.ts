import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IdlePacemaker } from '../src/pacemaker.js'

const timing = { idleDelayMs: 5000, activityWindowMs: 1500, modelCacheMs: 0 }
const silentLog = { warn: () => undefined }

describe('IdlePacemaker', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('marks a session busy inside its activity window', () => {
    const pace = new IdlePacemaker(timing, silentLog)
    vi.setSystemTime(1_000_000)
    pace.poke('s1')
    expect(pace.isBusy('s1', 1_001_000)).toBe(true)
    expect(pace.isBusy('s1', 1_003_000)).toBe(false)
  })

  it('fires the refinement callback exactly once after the idle delay', async () => {
    const pace = new IdlePacemaker(timing, silentLog)
    const refresh = vi.fn(async () => undefined)
    pace.scheduleRefine('s1', refresh)
    expect(refresh).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(5000)
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('skips the fire while the session stays busy', async () => {
    const pace = new IdlePacemaker(timing, silentLog)
    const refresh = vi.fn(async () => undefined)
    vi.setSystemTime(0)
    pace.poke('s1')
    pace.scheduleRefine('s1', refresh)
    await vi.advanceTimersByTimeAsync(4000)
    pace.poke('s1') // activity renews the window
    await vi.advanceTimersByTimeAsync(4000)
    expect(refresh).not.toHaveBeenCalled()
  })

  it('never arms a second timer while one is pending', async () => {
    const pace = new IdlePacemaker(timing, silentLog)
    const refresh = vi.fn(async () => undefined)
    pace.scheduleRefine('s1', refresh)
    pace.scheduleRefine('s1', refresh)
    await vi.advanceTimersByTimeAsync(5000)
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('does not fire for a stable caption', async () => {
    const pace = new IdlePacemaker(timing, silentLog)
    const refresh = vi.fn(async () => undefined)
    pace.markStable('s1')
    pace.scheduleRefine('s1', refresh)
    await vi.advanceTimersByTimeAsync(5000)
    expect(refresh).not.toHaveBeenCalled()
    pace.markDirty('s1')
    pace.scheduleRefine('s1', refresh)
    await vi.advanceTimersByTimeAsync(5000)
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('honors the onFired gate (user pin)', async () => {
    const pace = new IdlePacemaker(timing, silentLog)
    const refresh = vi.fn(async () => undefined)
    pace.scheduleRefine('s1', refresh, () => false)
    await vi.advanceTimersByTimeAsync(5000)
    expect(refresh).not.toHaveBeenCalled()
  })

  it('skips the fire while a refinement is in flight', async () => {
    const pace = new IdlePacemaker(timing, silentLog)
    let resolveRefresh: () => void = () => undefined
    const refresh = vi.fn(() => new Promise<void>((resolve) => { resolveRefresh = resolve }))
    pace.scheduleRefine('s1', refresh)
    await vi.advanceTimersByTimeAsync(5000)
    expect(refresh).toHaveBeenCalledTimes(1)
    pace.scheduleRefine('s1', refresh)
    await vi.advanceTimersByTimeAsync(5000)
    expect(refresh).toHaveBeenCalledTimes(1)
    resolveRefresh()
    await vi.advanceTimersByTimeAsync(0)
  })

  it('re-arms the timer when the fire finds the session still busy', async () => {
    const pace = new IdlePacemaker(timing, silentLog)
    const refresh = vi.fn(async () => undefined)
    vi.setSystemTime(0)
    pace.poke('s1') // busy until 1500
    pace.scheduleRefine('s1', refresh)
    await vi.advanceTimersByTimeAsync(4000) // t4000: timer not yet fired
    pace.poke('s1') // activity renews the window to 5500
    await vi.advanceTimersByTimeAsync(1000) // t5000: fire, still busy -> re-arm
    expect(refresh).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(5000) // t10000: idle now -> fire
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('re-arms after an in-flight refinement settles when a schedule arrived', async () => {
    const pace = new IdlePacemaker(timing, silentLog)
    let resolveRefresh: () => void = () => undefined
    const refresh = vi.fn(() => new Promise<void>((resolve) => { resolveRefresh = resolve }))
    pace.scheduleRefine('s1', refresh)
    await vi.advanceTimersByTimeAsync(5000)
    expect(refresh).toHaveBeenCalledTimes(1)
    // A schedule lands while the first refinement is still running.
    pace.scheduleRefine('s1', refresh)
    resolveRefresh()
    await vi.advanceTimersByTimeAsync(0)
    // The pending intent re-arms and fires after the next delay.
    await vi.advanceTimersByTimeAsync(5000)
    expect(refresh).toHaveBeenCalledTimes(2)
  })

  it('logs and recovers from a failing refresh', async () => {
    const warn = vi.fn()
    const pace = new IdlePacemaker(timing, { warn })
    const refresh = vi.fn(async () => {
      throw new Error('boom')
    })
    pace.scheduleRefine('s1', refresh)
    await vi.advanceTimersByTimeAsync(5000)
    expect(warn).toHaveBeenCalledTimes(1)
    // The in-flight slot is released: a new schedule can run again.
    pace.scheduleRefine('s1', refresh)
    await vi.advanceTimersByTimeAsync(5000)
    expect(refresh).toHaveBeenCalledTimes(2)
  })

  it('cancel and dispose drop pending timers', async () => {
    const pace = new IdlePacemaker(timing, silentLog)
    const refresh = vi.fn(async () => undefined)
    pace.scheduleRefine('s1', refresh)
    pace.cancel('s1')
    await vi.advanceTimersByTimeAsync(5000)
    expect(refresh).not.toHaveBeenCalled()

    pace.scheduleRefine('s2', refresh)
    pace.dispose()
    await vi.advanceTimersByTimeAsync(5000)
    expect(refresh).not.toHaveBeenCalled()
  })
})
