/**
 * dsh-session-caption — two-phase session captions for the DeepSeek Harness.
 *
 * Plugin entry: a Cordis bundle that registers the sole `ctx.sessionTitle`
 * provider and drives the two stages from the durable `session/event` feed.
 */
import { SessionTitleProviderId } from '@deepseek-ai/dsh-session-title';
import { resolveCaptionConfig, Config } from './config.js';
import { createCaptionFlow } from './flow.js';
import './events.js';
export const name = 'session-caption';
export const inject = ['sessionTitle', 'sessions', 'llm'];
export { Config };
/**
 * Mount the caption flow.
 * @param ctx - context with the title, session, and LLM services ready.
 * @param config - loader configuration (defaults apply when omitted).
 */
export function apply(ctx, config) {
    const resolved = resolveCaptionConfig(config);
    const logger = ctx.logger('session-caption');
    const flow = createCaptionFlow(ctx, resolved, logger);
    ctx.on('session/event', (session, event) => {
        flow.onSessionEvent(session, event);
    });
    ctx.on('llm/adapters-updated', () => {
        flow.router.invalidate();
    });
    ctx.effect(() => {
        flow.dispose();
    });
    ctx.sessionTitle.register({
        id: SessionTitleProviderId('session-caption'),
        automatic: 'all-user-messages',
        generate: (request) => flow.generate(request),
    });
    if (resolved.debug) {
        logger.debug('session-caption mounted');
    }
}
