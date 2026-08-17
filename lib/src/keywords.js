/**
 * Stage-one caption engine: instant keyword captions from the latest human
 * message, with zero model calls.
 *
 * The pipeline per message: strip noise (code fences, URLs, markup), detect
 * the script, drop function words, then assemble a short phrase capped by
 * word count (Latin) or character count (CJK). Latin captions keep the
 * original word order so the result reads as a topic, not a tag cloud; CJK
 * captions preserve Latin tokens (Express, JWT) whole while trimming loose
 * function words.
 */
import { detectScript } from './language.js';
// ---------------------------------------------------------------------------
// Noise stripping
// ---------------------------------------------------------------------------
/** Remove code fences, inline code, URLs, mailboxes, and markup. */
function stripNoise(text) {
    return text
        .replace(/```[\s\S]*?```/g, ' ')
        .replace(/`[^`]*`/g, ' ')
        .replace(/https?:\/\/\S+/gi, ' ')
        .replace(/[\w.+-]+@[\w.-]+\.\w{2,}/g, ' ')
        .replace(/^#{1,6}\s+/gm, '')
        .replace(/^\s*[-*+]\s+/gm, '')
        .replace(/^\s*>\s?/gm, '')
        .replace(/[*_~]{1,3}([^*_~]+)[*_~]{1,3}/g, '$1');
}
// ---------------------------------------------------------------------------
// Stop-word tables
// ---------------------------------------------------------------------------
/** Latin function words and conversational filler. */
const LATIN_STOPWORDS = new Set([
    'a', 'an', 'the', 'this', 'that', 'these', 'those', 'it', 'its', "it's",
    'there', 'their', 'they', 'we', 'us', 'our', 'ours', 'you', 'your',
    'yours', 'i', 'me', 'my', 'mine', 'he', 'him', 'his', 'she', 'her',
    'hers', 'them',
    'of', 'in', 'on', 'at', 'to', 'for', 'with', 'by', 'from', 'into',
    'onto', 'upon', 'about', 'against', 'between', 'among', 'during',
    'before', 'after', 'above', 'below', 'under', 'over', 'through', 'out',
    'off', 'up', 'down',
    'and', 'or', 'but', 'nor', 'so', 'yet', 'if', 'then', 'than', 'as',
    'because', 'while', 'although', 'unless', 'since', 'until', 'whether',
    'though', 'even',
    'is', 'are', 'was', 'were', 'be', 'been', 'being', 'am', 'do', 'does',
    'did', 'done', 'doing', 'have', 'has', 'had', 'having', 'will', 'would',
    'shall', 'should', 'can', 'could', 'may', 'might', 'must', 'ought',
    'need', 'needs', 'needed', 'want', 'wants', 'wanted', 'try', 'tries',
    'tried', 'trying', 'like', 'likes', 'now', 'today',
    'not', 'no', 'nor', 'never', 'none', 'neither', 'without',
    'what', 'which', 'who', 'whom', 'whose', 'when', 'where', 'why', 'how',
    'all', 'any', 'some', 'each', 'every', 'both', 'few', 'many', 'much',
    'more', 'most', 'other', 'another', 'such', 'own', 'one', 'two',
    'please', 'pls', 'hey', 'hi', 'hello', 'yeah', 'yes', 'ok', 'okay',
    'well', 'just', 'really', 'very', 'quite', 'almost', 'nearly', 'only',
    'also', 'too', 'still', 'already', 'help', 'helps', 'helped',
    'use', 'uses', 'used', 'using', 'make', 'makes', 'made',
    'get', 'gets', 'got', 'gotten', 'look', 'looks', 'looked', 'looking',
]);
/** Latin message-openers to strip before tokenizing. */
const LATIN_OPENERS = [
    'please', 'pls', 'hey', 'hi', 'hello', 'yo', 'thanks', 'thank you', 'thx',
    'can you', 'could you', 'would you', 'will you', 'do you', 'did you',
    'can we', 'could we', 'would we', 'i need', 'i want', 'i have', "i'm",
    'i am', 'we need', 'we want', "let's", 'lets', 'maybe', 'so',
    'okay', 'ok', 'just', 'could i', 'i would like', 'i want to',
];
/** CJK function words (whole-token filter). */
const CJK_FUNCTION_TOKENS = new Set([
    '的', '了', '吗', '呢', '啊', '吧', '呀', '哦', '嗯', '么', '嘛', '诶',
    '这', '那', '这些', '那些', '什么', '怎么', '如何', '为什么', '能不能',
    '可不可以', '要不要', '是不是', '一下', '等等', '之类', '这样', '那样',
    '一个', '一些', '已经', '曾经', '正在', '可以', '能够', '应该', '需要',
    '必须', '可能', '因为', '所以', '但是', '然而', '如果', '虽然', '而且',
    '或者', '以及', '并且', '然后', '接着', '最后', '首先', '其次', '还有',
    '另外', '关于', '对于', '根据', '按照', '通过', '利用', '作为', '成为',
    '主要', '目前', '现在', '当前', '之前', '之后', '以上', '以下',
]);
/** CJK single function characters (token-level filter). */
const CJK_FUNCTION_CHARS = new Set([
    '的', '了', '着', '过', '在', '是', '有', '和', '与', '及', '或', '但',
    '而', '则', '且', '并', '也', '都', '很', '更', '最', '就', '才', '又',
    '再', '还', '已', '曾', '将', '会', '要', '能', '可', '以', '该', '应',
    '需', '让', '把', '被', '对', '从', '向', '往', '于', '为', '因', '由',
    '跟', '同', '比', '按', '依', '随', '给', '用', '我', '你', '他', '她',
    '它', '这', '那', '们', '之', '其', '此', '每', '各', '几', '哪', '何',
    'の', 'を', 'は', 'が', 'に', 'へ', 'も', 'で', 'と', 'から', 'まで', 'より', 'ね',
]);
/** CJK message-openers to strip before tokenizing. */
const CJK_OPENERS = [
    '麻烦你', '麻烦帮', '麻烦', '帮我一下', '帮我看看', '帮我把', '帮我',
    '请你', '请', '你帮我', '你能', '能不能', '可不可以', '我想要', '我想',
    '我要', '我需要', '我们想', '我们要', '我们需要', '这边', '这里',
    'してください', 'ください', 'お願いします', 'お愿いします',
];
const TOKEN_PATTERN = /[\u3400-\u4DBF\u4E00-\u9FFF\u3040-\u30FF\uAC00-\uD7AF]+|[A-Za-z][A-Za-z0-9'-]*/g;
// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------
export class KeywordCaptioner {
    options;
    normalizer;
    constructor(options, normalizer) {
        this.options = options;
        this.normalizer = normalizer;
    }
    /**
     * Produce the instant caption from the latest eligible human message.
     * @param messages - provider revision messages, in log order.
     * @returns a clean caption, or `null` when nothing extractable exists.
     */
    make(messages) {
        const latest = messages[messages.length - 1];
        if (latest === undefined)
            return null;
        const cleaned = stripNoise(latest.text);
        const script = detectScript(cleaned);
        const body = script === 'cjk' ? this.fromCjk(cleaned) : this.fromLatin(cleaned);
        if (body === null)
            return null;
        const caption = this.normalizer.normalize(`${this.options.prefix}${body}`);
        return caption.length > 0 ? caption : null;
    }
    fromLatin(raw) {
        const text = stripOpeners(raw, LATIN_OPENERS);
        const tokens = text.match(/[A-Za-z][A-Za-z0-9'-]*/g) ?? [];
        const kept = [];
        for (const token of tokens) {
            if (LATIN_STOPWORDS.has(token.toLowerCase()))
                continue;
            if (!kept.some((k) => k.toLowerCase() === token.toLowerCase()))
                kept.push(token);
            if (kept.length >= this.options.maxWords)
                break;
        }
        if (kept.length === 0)
            return null;
        // Title case: capitalize every all-lowercase word; tokens that already
        // carry capitals (JWT, Express, API) are left as the author wrote them.
        return kept.map(titleCaseWord).join(' ');
    }
    fromCjk(raw) {
        const text = stripOpeners(raw, CJK_OPENERS);
        const tokens = text.match(TOKEN_PATTERN) ?? [];
        const kept = [];
        for (const token of tokens) {
            if (/[A-Za-z]/.test(token)) {
                if (LATIN_STOPWORDS.has(token.toLowerCase()))
                    continue;
                if (!kept.some((k) => k.toLowerCase() === token.toLowerCase()))
                    kept.push(token);
            }
            else {
                const cleaned = [...token].filter((ch) => !CJK_FUNCTION_CHARS.has(ch)).join('');
                if (cleaned.length === 0)
                    continue;
                if (CJK_FUNCTION_TOKENS.has(cleaned))
                    continue;
                kept.push(cleaned);
            }
        }
        if (kept.length === 0)
            return null;
        return assembleCjk(kept, this.options.maxCjkChars);
    }
}
/** Title-case one Latin word, preserving tokens that already have capitals. */
function titleCaseWord(word) {
    return word === word.toLowerCase() ? word.charAt(0).toUpperCase() + word.slice(1) : word;
}
/** Strip message-openers greedily (longest first, repeat until none match). */
function stripOpeners(text, openers) {
    let out = text;
    let changed = true;
    while (changed) {
        changed = false;
        for (const opener of openers) {
            const pattern = openerPattern(opener);
            if (pattern.test(out)) {
                out = out.replace(pattern, ' ').trimStart();
                changed = true;
                break;
            }
        }
    }
    return out;
}
function openerPattern(opener) {
    const escaped = escapeRegExp(opener);
    // ASCII `\b` does not see CJK boundaries; only Latin openers demand a word
    // boundary so "so long" strips but "soften" never does.
    return /[A-Za-z]/.test(opener)
        ? new RegExp(`^\\s*${escaped}(?=[\\s\\W]|$)`, 'i')
        : new RegExp(`^\\s*${escaped}`);
}
function escapeRegExp(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
/**
 * Join kept CJK/Latin tokens into a character-capped phrase. Latin tokens
 * are kept whole (never split mid-word); a CJK run that would overflow is
 * filled character by character.
 */
function assembleCjk(kept, maxChars) {
    let out = '';
    for (const piece of kept) {
        const next = out === '' ? piece : `${out} ${piece}`;
        if ([...next].length > maxChars) {
            if (/[A-Za-z]/.test(piece))
                break;
            const room = maxChars - [...out].length;
            if (room > 0)
                out += [...piece].slice(0, room).join('');
            break;
        }
        out = next;
    }
    return out;
}
