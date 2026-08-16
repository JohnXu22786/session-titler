import { BudgetRouter } from './budget.js';
import { CaptionSkippedError } from './errors.js';
import { KeywordCaptioner } from './keywords.js';
import { CaptionNormalizer, truncateUtf8, SERVICE_MAX_TITLE_BYTES } from './normalizer.js';
import { IdlePacemaker } from './pacemaker.js';
import { Refiner } from './refine.js';
export function createCaptionFlow(deps, config, log) {
    const pacemaker = new IdlePacemaker(config.timing, log);
    const normalizer = new CaptionNormalizer();
    const keywords = new KeywordCaptioner(config.instant, normalizer);
    const router = new BudgetRouter(deps.llm, config.budget, config.timing.modelCacheMs, explicitRoute(config), log);
    const refiner = new Refiner(deps.llm, config.refine, config.summary, router, normalizer, log);
    /** Abort handles for in-flight refinements, keyed by session id. */
    const refinementSignals = new Map();
    const startRefinement = (session) => {
        if (!config.refine.enabled)
            return;
        pacemaker.scheduleRefine(session.id, () => {
            const controller = new AbortController();
            refinementSignals.set(session.id, controller);
            return deps.sessionTitle.refresh(session, controller.signal).finally(() => {
                // The call has settled (or was aborted); drop the handle so a long
                // harness lifetime does not accumulate one controller per session.
                refinementSignals.delete(session.id);
            });
        }, () => {
            const current = deps.sessionTitle.get(session);
            return current === undefined || current.source.kind !== 'user';
        });
    };
    const dedupeTitle = (session, title) => {
        if (!config.dedup.enabled)
            return title;
        const taken = new Set();
        for (const other of deps.sessions.list()) {
            if (other.id === session.id)
                continue;
            const theirs = deps.sessionTitle.get(other)?.title;
            if (theirs !== undefined && theirs.length > 0)
                taken.add(theirs);
        }
        if (!taken.has(title))
            return title;
        for (let n = 2; n <= 99; n++) {
            const suffix = ` ${config.dedup.suffix.replace('{n}', String(n))}`;
            const room = SERVICE_MAX_TITLE_BYTES - Buffer.byteLength(suffix, 'utf8');
            if (room < 1)
                break; // an oversized suffix cannot produce a valid title
            const candidate = `${truncateUtf8(title, room)}${suffix}`;
            if (Buffer.byteLength(candidate, 'utf8') > SERVICE_MAX_TITLE_BYTES)
                break;
            if (!taken.has(candidate))
                return candidate;
        }
        return title;
    };
    const recordNote = (session, refined, title) => {
        if (!config.summary.enabled || refined.note.length === 0)
            return;
        try {
            session.append('session/caption-note', {
                title,
                note: refined.note,
                messageSeqs: [...refined.messageSeqs],
            });
        }
        catch (error) {
            log.debug(`caption-note append failed: ${String(error)}`);
        }
    };
    const generate = async (request) => {
        request.signal.throwIfAborted();
        const { session, messages } = request;
        const current = deps.sessionTitle.get(session);
        if (current?.source.kind === 'user') {
            // The user pinned a title; never compete with it.
            throw new CaptionSkippedError('user title pinned; automatic captions stopped');
        }
        if (config.instant.enabled && pacemaker.isBusy(session.id)) {
            const caption = keywords.make(messages);
            if (caption === null)
                throw new CaptionSkippedError('no caption material in the latest message');
            const title = dedupeTitle(session, caption);
            if (config.dedup.enabled && current !== undefined && normalizer.isSame(title, current.title)) {
                throw new CaptionSkippedError('caption unchanged; keeping the current title');
            }
            startRefinement(session);
            const latest = messages[messages.length - 1];
            return { title, messageSeqs: latest === undefined ? [] : [latest.seq] };
        }
        if (config.refine.enabled && !pacemaker.isBusy(session.id)) {
            const refined = await refiner.refine(request);
            // Re-read the fold: a user rename that landed during the call wins.
            const latest = deps.sessionTitle.get(session);
            if (latest?.source.kind === 'user') {
                throw new CaptionSkippedError('user title pinned during refinement');
            }
            // New input that arrived while the model was working supersedes this
            // revision: the pending timer re-arm will refine the newer snapshot.
            const newestInput = latestUserMessageSeq(session);
            if (newestInput !== undefined && !refined.messageSeqs.includes(newestInput)) {
                throw new CaptionSkippedError('refinement superseded by newer input');
            }
            const title = dedupeTitle(session, refined.title);
            if (config.dedup.enabled && latest !== undefined && normalizer.isSame(title, latest.title)) {
                pacemaker.markStable(session.id);
                throw new CaptionSkippedError('caption unchanged; marking stable');
            }
            recordNote(session, refined, title);
            return { title, messageSeqs: refined.messageSeqs, model: refined.model };
        }
        throw new CaptionSkippedError('no caption stage eligible (refine disabled or session busy)');
    };
    const onSessionEvent = (session, event) => {
        pacemaker.poke(session.id);
        if (event.type === 'user/message') {
            pacemaker.markDirty(session.id);
            startRefinement(session);
        }
    };
    return {
        generate,
        onSessionEvent,
        dispose: () => {
            for (const controller of refinementSignals.values())
                controller.abort();
            refinementSignals.clear();
            pacemaker.dispose();
        },
        router,
    };
}
function explicitRoute(config) {
    const { provider, model } = config.model;
    return provider.length > 0 && model.length > 0 ? { provider, model } : undefined;
}
/** The log seq of the newest `user/message` event, if any. */
function latestUserMessageSeq(session) {
    const events = session.events;
    for (let i = events.length - 1; i >= 0; i--) {
        if (events[i]?.type === 'user/message')
            return events[i]?.seq;
    }
    return undefined;
}
