import { Config, type CaptionConfig } from './config.js';
import type { CaptionContext } from './context.js';
import './events.js';
export declare const name = "session-caption";
export declare const inject: string[];
export { Config };
/**
 * Mount the caption flow.
 * @param ctx - context with the title, session, and LLM services ready.
 * @param config - loader configuration (defaults apply when omitted).
 */
export declare function apply(ctx: CaptionContext, config: CaptionConfig): void;
