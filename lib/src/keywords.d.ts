import type { CaptionNormalizer } from './normalizer.js';
import type { InstantCaptionConfig } from './config.js';
import type { SessionTitleUserMessage } from '@deepseek-ai/dsh-session-title';
export declare class KeywordCaptioner {
    private readonly options;
    private readonly normalizer;
    constructor(options: InstantCaptionConfig, normalizer: CaptionNormalizer);
    /**
     * Produce the instant caption from the latest eligible human message.
     * @param messages - provider revision messages, in log order.
     * @returns a clean caption, or `null` when nothing extractable exists.
     */
    make(messages: readonly SessionTitleUserMessage[]): string | null;
    private fromLatin;
    private fromCjk;
}
