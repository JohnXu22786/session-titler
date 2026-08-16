/**
 * Script detection: does a message read as CJK or Latin? The keyword
 * captions and the refinement length targets branch on this.
 */
export type ScriptKind = 'latin' | 'cjk' | 'none';
/**
 * Classify the dominant script of a message.
 *
 * A message counts as CJK when CJK characters make up at least 30% of its
 * letters — mixed prompts like "帮我设置 Express 的 JWT 认证" stay CJK so the
 * caption keeps natural Chinese phrasing while preserving the Latin tokens.
 *
 * @param text - message text, possibly empty or punctuation-only.
 * @returns `cjk`, `latin`, or `none` when the message has no letters at all.
 */
export declare function detectScript(text: string): ScriptKind;
