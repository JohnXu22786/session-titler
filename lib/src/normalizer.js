/**
 * Caption text hygiene: cleaning, length caps, and equality comparison.
 *
 * The session-title service applies its own normalization and byte limit on
 * acceptance; this module keeps the proposed text clean and within the
 * service's `maxTitleBytes` budget before it ever reaches that boundary.
 */
/** The service-side ceiling every accepted title must fit in (UTF-8 bytes). */
export const SERVICE_MAX_TITLE_BYTES = 80;
/** Punctuation stripped in runs from the start and end of a caption. */
const EDGE_PUNCTUATION = /^[\s.,;:!?。，；：！？、··\-—_'"“”‘’()[\]{}<>/\\|~`#*+=&%$@]+|[\s.,;:!?。，；：！？、··\-—_'"“”‘’()[\]{}<>/\\|~`#*+=&%$@]+$/g;
/** Control characters that must never reach the log. */
const CONTROL_PATTERN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
/** Repeated punctuation folds to a single mark. */
const REPEAT_PATTERN = /([!?。！？])\1+/g;
/**
 * Normalizes and compares captions for the "did anything change" check:
 * case-insensitive, whitespace- and punctuation-free comparison.
 */
function comparable(text) {
    return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}
export class CaptionNormalizer {
    /**
     * Clean a raw caption: collapse whitespace, strip control characters and
     * edge punctuation, fold repeated marks, then cap the UTF-8 length.
     * @param text - raw proposed caption.
     * @param maxBytes - UTF-8 ceiling; defaults to the service-side budget.
     * @returns the cleaned caption (possibly empty).
     */
    normalize(text, maxBytes = SERVICE_MAX_TITLE_BYTES) {
        let cleaned = text
            .replace(/\s+/g, ' ')
            .replace(CONTROL_PATTERN, '')
            .replace(EDGE_PUNCTUATION, '')
            .replace(REPEAT_PATTERN, '$1')
            .trim();
        cleaned = truncateUtf8(cleaned, maxBytes);
        return cleaned.trim();
    }
    /**
     * Clean text with a *code-point* ceiling instead of a byte ceiling. Used
     * for auxiliary text whose documented budget is in characters (the
     * summary note), where a byte cap would silently halve CJK content.
     * @param text - raw text.
     * @param maxChars - maximum characters (code points).
     * @returns the cleaned text, truncated to the character budget.
     */
    normalizeByChars(text, maxChars) {
        let cleaned = text
            .replace(/\s+/g, ' ')
            .replace(CONTROL_PATTERN, '')
            .replace(EDGE_PUNCTUATION, '')
            .replace(REPEAT_PATTERN, '$1')
            .trim();
        return truncateChars(cleaned, maxChars).trim();
    }
    /**
     * Whether two captions denote the same text for deduplication purposes
     * (ignoring case, whitespace, and punctuation).
     */
    isSame(a, b) {
        return comparable(a) === comparable(b) && comparable(a).length > 0;
    }
}
/**
 * Truncate text to a UTF-8 byte budget without splitting a code point.
 * @param text - input text.
 * @param maxBytes - maximum encoded size.
 * @returns the longest prefix fitting the budget.
 */
export function truncateUtf8(text, maxBytes) {
    if (Buffer.byteLength(text, 'utf8') <= maxBytes)
        return text;
    let out = '';
    let bytes = 0;
    for (const ch of text) {
        const width = Buffer.byteLength(ch, 'utf8');
        if (bytes + width > maxBytes)
            break;
        out += ch;
        bytes += width;
    }
    return out;
}
/** Truncate text to a code-point budget without splitting a surrogate pair. */
export function truncateChars(text, maxChars) {
    if ([...text].length <= maxChars)
        return text;
    return [...text].slice(0, maxChars).join('');
}
