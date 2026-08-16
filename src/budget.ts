/**
 * Budget routing: pick the cheapest available model for caption refinement.
 *
 * Resolution order: an explicit `model.provider`/`model.model` override from
 * configuration wins; otherwise the registered model catalog is scanned for
 * names matching the cheap-pattern list (most economical patterns first) with
 * the result cached for `modelCacheMs`; otherwise the conversation's own
 * route is reused; otherwise refinement is skipped entirely.
 *
 * All catalog access is defensive: an adapter that cannot enumerate models
 * must never take captioning down with it.
 */
import type { LlmModelInfo, LlmService } from '@deepseek-ai/dsh-llm'
import type { BudgetConfig } from './config.js'

export interface ModelRoute {
  provider: string
  model: string
}

export interface RouterLog {
  debug(message: string): void
}

export class BudgetRouter {
  private cache: { at: number; route: ModelRoute | undefined } | undefined
  private scanning: Promise<ModelRoute | undefined> | undefined
  private generation = 0

  constructor(
    private readonly llm: LlmService,
    private readonly config: BudgetConfig,
    private readonly cacheMs: number,
    private readonly explicit: ModelRoute | undefined,
    private readonly log: RouterLog,
  ) {}

  /** Drop the cached catalog pick (adapter topology changed). */
  invalidate(): void {
    this.cache = undefined
    this.generation++
  }

  /**
   * Resolve the model route for one refinement call.
   * @param conversationRoute - the session's own logged main-request route.
   * @returns the route to use, or `undefined` when none is available.
   */
  async resolve(conversationRoute: ModelRoute | undefined): Promise<ModelRoute | undefined> {
    if (this.explicit !== undefined) return this.explicit
    if (this.config.preferCheap) {
      const cheap = await this.scan()
      if (cheap !== undefined) return cheap
    }
    return conversationRoute
  }

  private scan(): Promise<ModelRoute | undefined> {
    const now = Date.now()
    if (this.cache !== undefined && now - this.cache.at < this.cacheMs) {
      return Promise.resolve(this.cache.route)
    }
    // Concurrent callers share one catalog scan instead of each re-reading
    // every adapter's model list.
    this.scanning ??= this.performScan(now, this.generation).finally(() => {
      this.scanning = undefined
    })
    return this.scanning
  }

  private async performScan(at: number, startedAt: number): Promise<ModelRoute | undefined> {
    let best: { route: ModelRoute; rank: number } | undefined
    for (const entry of this.providers()) {
      const models = await this.modelsOf(entry.provider)
      for (const model of models) {
        const rank = this.matchRank(model.id)
        if (rank < 0) continue
        if (
          best === undefined ||
          rank < best.rank ||
          (rank === best.rank && model.id.length < best.route.model.length)
        ) {
          best = { route: { provider: entry.provider, model: model.id }, rank }
        }
      }
    }
    const route = best?.route
    // The topology may have changed mid-scan (invalidate bumped the
    // generation): never cache a route from a stale snapshot.
    if (this.generation === startedAt) {
      this.cache = { at, route }
    }
    this.log.debug(`budget route: ${route ? `${route.provider}/${route.model}` : 'none'}`)
    return route
  }

  private providers(): readonly { provider: string }[] {
    try {
      const entries = this.llm.listConfigurableProviders()
      if (!Array.isArray(entries)) return []
      return entries.filter((entry) => entry !== null && typeof entry?.provider === 'string')
    } catch (error) {
      this.log.debug(`provider directory unavailable: ${String(error)}`)
      return []
    }
  }

  private async modelsOf(provider: string): Promise<readonly LlmModelInfo[]> {
    try {
      const models = await this.llm.listModels(provider)
      if (!Array.isArray(models)) return []
      return models.filter((model) => model !== null && typeof model?.id === 'string')
    } catch (error) {
      this.log.debug(`model catalog for "${provider}" unavailable: ${String(error)}`)
      return []
    }
  }

  /** Pattern priority: lower index wins; -1 means no match. */
  private matchRank(modelId: string): number {
    const lower = modelId.toLowerCase()
    const patterns = this.config.patterns
    for (let i = 0; i < patterns.length; i++) {
      const pattern = patterns[i]
      if (pattern !== undefined && lower.includes(pattern.toLowerCase())) return i
    }
    return -1
  }
}
