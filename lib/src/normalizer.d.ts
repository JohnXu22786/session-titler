/**
 * Caption text hygiene: cleaning, length caps, and equality comparison.
 *
 * The session-title service applies its own normalization and byte limit on
 * acceptance; this module keeps the proposed text clean and within the
 * service's `maxTitleBytes` budget before it ever reaches that boundary.
 */
/** The service-side ceiling every accepted title must fit in (UTF-8 bytes). */
export declare const SERVICE_MAX_TITLE_BYTES = 80;
export declare class CaptionNormalizer {
    /**
     * Clean a raw caption: collapse whitespace, strip control characters and
     * edge punctuation, fold repeated marks, then cap the UTF-8 length.
     * @param text - raw proposed caption.
     * @param maxBytes - UTF-8 ceiling; defaults to the service-side budget.
     * @returns the cleaned caption (possibly empty).
     */
    normalize(text: string, maxBytes?: number): string;
    /**
     * Clean text with a *code-point* ceiling instead of a byte ceiling. Used
     * for auxiliary text whose documented budget is in characters (the
     * summary note), where a byte cap would silently halve CJK content.
     * @param text - raw text.
     * @param maxChars - maximum characters (code points).
     * @returns the cleaned text, truncated to the character budget.
     */
    normalizeByChars(text: string, maxChars: number): string;
    /**
     * Whether two captions denote the same text for deduplication purposes
     * (ignoring case, whitespace, and punctuation).
     */
    isSame(a: string, b: string): boolean;
}
/**
 * Truncate text to a UTF-8 byte budget without splitting a code point.
 * @param text - input text.
 * @param maxBytes - maximum encoded size.
 * @returns the longest prefix fitting the budget.
 */
export declare function truncateUtf8(text: string, maxBytes: number): string;
/** Truncate text to a code-point budget without splitting a surrogate pair. */
export declare function truncateChars(text: string, maxChars: number): string;
