/**
 * Durable event vocabulary used by this plugin.
 *
 * `session/title` is owned by the harness title service; it is restated here
 * so the standalone type layer (stubs) sees it. `session/caption-note` is
 * contributed by this plugin: a log-only, information-bearing record that
 * never enters the model surface or derived history. Consumers that meet an
 * unknown log-only event type may skip it; on harness builds that mark
 * informational records, the marker is applied by the session service.
 */
import type { SessionTitleEventData } from '@deepseek-ai/dsh-session-title';
/** Payload of the log-only `session/caption-note` event. */
export interface CaptionNoteData {
    /** The accepted caption at refinement time (post deduplication). */
    title: string;
    /** One-line session summary harvested from the same model reply. */
    note: string;
    /** Exact human `user/message` seqs the refinement used. */
    messageSeqs: readonly number[];
}
declare module '@deepseek-ai/dsh-session/types' {
    interface SessionEventMap {
        /**
         * Latest-wins session title snapshot. Log-only: it never enters the
         * model surface or derived history. (Restated; owned by the title
         * service package.)
         */
        'session/title': SessionTitleEventData;
        /**
         * One-line session summary produced alongside a refined caption.
         * Log-only: it never enters the model surface or derived history.
         */
        'session/caption-note': CaptionNoteData;
    }
}
