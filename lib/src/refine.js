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
import { BlockAssembler, createUserMessage } from '@deepseek-ai/dsh-llm';
import { CaptionSkippedError } from './errors.js';
import { truncateUtf8 } from './normalizer.js';
/** Message budget estimator: each source message rides as a JSON pair. */
const FRAME_OVERHEAD_BYTES = 256;
export class Refiner {
    llm;
    config;
    summary;
    router;
    normalizer;
    log;
    constructor(llm, config, summary, router, normalizer, log) {
        this.llm = llm;
        this.config = config;
        this.summary = summary;
        this.router = router;
        this.normalizer = normalizer;
        this.log = log;
    }
    /**
     * Produce one refined caption for a revision.
     * @param request - the service-owned revision snapshot.
     * @returns caption, optional note, exact source seqs, and the used route.
     * @throws {CaptionSkippedError} when no route or no usable text exists;
     *   any other throw is a genuine generation failure.
     */
    async refine(request) {
        request.signal.throwIfAborted();
        const { session, messages, route } = request;
        const selected = selectWithinBudget(messages, this.config.maxInputBytes);
        if (selected.length === 0)
            throw new CaptionSkippedError('no source messages within budget');
        const target = await this.router.resolve(route);
        if (target === undefined)
            throw new CaptionSkippedError('no model route available');
        request.signal.throwIfAborted();
        const system = this.systemPrompt();
        const framed = frameMessages(selected);
        const userMessage = createUserMessage({
            content: [{ type: 'text', text: framed }],
            source: { kind: 'plugin', plugin: 'session-caption' },
        });
        const deadline = AbortSignal.any([request.signal, AbortSignal.timeout(this.config.timeoutMs)]);
        const assembler = new BlockAssembler();
        for await (const chunk of this.llm.stream({
            provider: target.provider,
            model: target.model,
            messages: [userMessage],
            system,
            maxTokens: this.config.maxOutputTokens,
            sessionId: session.id,
            purpose: 'session-title',
            signal: deadline,
        })) {
            assembler.push(chunk);
        }
        this.throwForFinish(assembler.finish, request.signal);
        const blocks = assembler.blocks();
        if (blocks.some((block) => block.type === 'tool-call')) {
            throw new Error('session-caption: refiner unexpectedly requested a tool');
        }
        const text = blocks
            .filter((block) => block.type === 'text')
            .map((block) => block.text)
            .join(' ');
        const { title: rawTitle, note } = splitLines(text);
        const title = this.normalizer.normalize(rawTitle);
        if (title.length === 0)
            throw new CaptionSkippedError('refiner produced no caption text');
        this.log.debug(`refined "${title}" via ${target.provider}/${target.model}`);
        return {
            title,
            note: this.summary.enabled ? this.normalizer.normalizeByChars(note, this.summary.maxChars) : '',
            messageSeqs: selected.map((message) => message.seq),
            model: target,
        };
    }
    systemPrompt() {
        const lines = [
            'You are a session captioning assistant. From the supplied human messages,',
            'propose a short caption for an AI coding-assistant session.',
            'Rules:',
            '- Output ONLY the caption on the first line: plain text, no quotes, prefix,',
            '  numbering, Markdown, explanation, or terminal control codes.',
            '- Use the language of the messages.',
            `- Latin-script captions: about ${this.config.maxWords} words. CJK captions:`,
            `  about ${this.config.maxCjkChars} characters.`,
            '- Capture the topic and the intent; drop greetings and filler.',
        ];
        if (this.summary.enabled) {
            lines.push(`- On the second line output a one-sentence session summary (at most`, `  ${this.summary.maxChars} characters) for list display. No other lines.`);
        }
        else {
            lines.push('- No other lines.');
        }
        return lines.join('\n');
    }
    throwForFinish(finish, signal) {
        signal.throwIfAborted();
        switch (finish.kind) {
            case 'stop':
                return;
            case 'error':
            case 'aborted':
                throw new Error(`session-caption: refiner call failed: ${finish.failure.message}`);
            case 'max-tokens':
                throw new Error('session-caption: refiner output hit maxOutputTokens');
            case 'tool-calls':
                throw new Error('session-caption: refiner unexpectedly requested a tool');
            default:
                throw new Error(`session-caption: unsupported finish reason "${String(finish.kind)}"`);
        }
    }
}
/**
 * Select the newest source messages whose framed payload fits the byte
 * budget; the newest message always wins a slot even when it overflows
 * alone (its text is then truncated to the budget).
 */
export function selectWithinBudget(messages, maxBytes) {
    const selected = [];
    let bytes = FRAME_OVERHEAD_BYTES;
    for (let i = messages.length - 1; i >= 0; i--) {
        const message = messages[i];
        if (message === undefined)
            continue;
        const width = Buffer.byteLength(JSON.stringify(message.text), 'utf8');
        if (selected.length > 0 && bytes + width > maxBytes)
            break;
        if (selected.length === 0 && width > maxBytes - FRAME_OVERHEAD_BYTES) {
            selected.unshift({ seq: message.seq, text: truncateUtf8(message.text, maxBytes - FRAME_OVERHEAD_BYTES) });
            break;
        }
        bytes += width;
        selected.unshift(message);
    }
    return selected;
}
/** JSON-frame the selected messages so user text cannot break structure. */
export function frameMessages(selected) {
    return ('Caption this session from the JSON array of human messages below:\n' +
        JSON.stringify(selected.map((message) => ({ seq: message.seq, text: message.text }))));
}
/** First non-empty line is the caption; the rest joins into the note. */
export function splitLines(text) {
    const lines = text.split(/\r?\n/);
    const first = lines.findIndex((line) => line.trim().length > 0);
    if (first < 0)
        return { title: '', note: '' };
    const title = lines[first]?.trim() ?? '';
    const note = lines
        .slice(first + 1)
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .join(' ')
        .trim();
    return { title, note };
}
