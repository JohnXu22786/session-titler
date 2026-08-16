export class BudgetRouter {
    llm;
    config;
    cacheMs;
    explicit;
    log;
    cache;
    scanning;
    generation = 0;
    constructor(llm, config, cacheMs, explicit, log) {
        this.llm = llm;
        this.config = config;
        this.cacheMs = cacheMs;
        this.explicit = explicit;
        this.log = log;
    }
    /** Drop the cached catalog pick (adapter topology changed). */
    invalidate() {
        this.cache = undefined;
        this.generation++;
    }
    /**
     * Resolve the model route for one refinement call.
     * @param conversationRoute - the session's own logged main-request route.
     * @returns the route to use, or `undefined` when none is available.
     */
    async resolve(conversationRoute) {
        if (this.explicit !== undefined)
            return this.explicit;
        if (this.config.preferCheap) {
            const cheap = await this.scan();
            if (cheap !== undefined)
                return cheap;
        }
        return conversationRoute;
    }
    scan() {
        const now = Date.now();
        if (this.cache !== undefined && now - this.cache.at < this.cacheMs) {
            return Promise.resolve(this.cache.route);
        }
        // Concurrent callers share one catalog scan instead of each re-reading
        // every adapter's model list.
        this.scanning ??= this.performScan(now, this.generation).finally(() => {
            this.scanning = undefined;
        });
        return this.scanning;
    }
    async performScan(at, startedAt) {
        let best;
        for (const entry of this.providers()) {
            const models = await this.modelsOf(entry.provider);
            for (const model of models) {
                const rank = this.matchRank(model.id);
                if (rank < 0)
                    continue;
                if (best === undefined ||
                    rank < best.rank ||
                    (rank === best.rank && model.id.length < best.route.model.length)) {
                    best = { route: { provider: entry.provider, model: model.id }, rank };
                }
            }
        }
        const route = best?.route;
        // The topology may have changed mid-scan (invalidate bumped the
        // generation): never cache a route from a stale snapshot.
        if (this.generation === startedAt) {
            this.cache = { at, route };
        }
        this.log.debug(`budget route: ${route ? `${route.provider}/${route.model}` : 'none'}`);
        return route;
    }
    providers() {
        try {
            const entries = this.llm.listConfigurableProviders();
            if (!Array.isArray(entries))
                return [];
            return entries.filter((entry) => entry !== null && typeof entry?.provider === 'string');
        }
        catch (error) {
            this.log.debug(`provider directory unavailable: ${String(error)}`);
            return [];
        }
    }
    async modelsOf(provider) {
        try {
            const models = await this.llm.listModels(provider);
            if (!Array.isArray(models))
                return [];
            return models.filter((model) => model !== null && typeof model?.id === 'string');
        }
        catch (error) {
            this.log.debug(`model catalog for "${provider}" unavailable: ${String(error)}`);
            return [];
        }
    }
    /** Pattern priority: lower index wins; -1 means no match. */
    matchRank(modelId) {
        const lower = modelId.toLowerCase();
        const patterns = this.config.patterns;
        for (let i = 0; i < patterns.length; i++) {
            const pattern = patterns[i];
            if (pattern !== undefined && lower.includes(pattern.toLowerCase()))
                return i;
        }
        return -1;
    }
}
