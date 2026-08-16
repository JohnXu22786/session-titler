/**
 * Error vocabulary of the session-caption plugin.
 */
/**
 * A generation attempt that deliberately yields nothing: the service keeps
 * the current title (a skipped revision is not a failure the caller must
 * diagnose). Typical skip reasons: the user pinned a title, the caption would
 * not change anything, no keyword material exists, or no model route is
 * available for refinement.
 */
export class CaptionSkippedError extends Error {
    name = 'CaptionSkippedError';
    constructor(reason) {
        super(`session-caption: ${reason}`);
    }
}
