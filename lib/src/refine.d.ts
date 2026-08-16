/**
 * Stage-two refiner: turn the conversation snapshot into a polished caption
 * through one cheap auxiliary model call, optionally harvesting a one-line
 * summary from the same response.
 *
 * The system instruction is strict about output shape (line one: the caption;
 * line two, when enabled: the summary), the source messages travel as a JSON
 * frame so user text cannot break the structure, and every terminal finish
 * reason other than a clean stop discards the revision.
 */
import { type LlmService } from '@deepseek-ai/dsh-llm';
import type { SessionTitleModelProvenance, SessionTitleProviderRequest, SessionTitleUserMessage } from '@deepseek-ai/dsh-session-title';
import type { BudgetRouter } from './budget.js';
import type { RefineCaptionConfig, SummaryConfig } from './config.js';
import type { CaptionNormalizer } from './normalizer.js';
export interface RefinerLog {
    warn(message: string, ...args: unknown[]): void;
    debug(message: string): void;
}
/** A refined caption plus the optional summary harvested from the reply. */
export interface RefinedCaption {
    title: string;
    note: string;
    messageSeqs: readonly number[];
    model: SessionTitleModelProvenance;
}
export declare class Refiner {
    private readonly llm;
    private readonly config;
    private readonly summary;
    private readonly router;
    private readonly normalizer;
    private readonly log;
    constructor(llm: LlmService, config: RefineCaptionConfig, summary: SummaryConfig, router: BudgetRouter, normalizer: CaptionNormalizer, log: RefinerLog);
    /**
     * Produce one refined caption for a revision.
     * @param request - the service-owned revision snapshot.
     * @returns caption, optional note, exact source seqs, and the used route.
     * @throws {CaptionSkippedError} when no route or no usable text exists;
     *   any other throw is a genuine generation failure.
     */
    refine(request: SessionTitleProviderRequest): Promise<RefinedCaption>;
    private systemPrompt;
    private throwForFinish;
}
/**
 * Select the newest source messages whose framed payload fits the byte
 * budget; the newest message always wins a slot even when it overflows
 * alone (its text is then truncated to the budget).
 */
export declare function selectWithinBudget(messages: readonly SessionTitleUserMessage[], maxBytes: number): readonly SessionTitleUserMessage[];
/** JSON-frame the selected messages so user text cannot break structure. */
export declare function frameMessages(selected: readonly SessionTitleUserMessage[]): string;
/** First non-empty line is the caption; the rest joins into the note. */
export declare function splitLines(text: string): {
    title: string;
    note: string;
};
