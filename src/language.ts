/**
 * Script detection: does a message read as CJK or Latin? The keyword
 * captions and the refinement length targets branch on this.
 */

/** CJK Unified Ideographs + Extension A, kana, and hangul. */
const CJK_PATTERN = /[\u3400-\u4DBF\u4E00-\u9FFF\u3040-\u30FF\uAC00-\uD7AF]/
const LATIN_PATTERN = /[A-Za-z]/

export type ScriptKind = 'latin' | 'cjk' | 'none'

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
export function detectScript(text: string): ScriptKind {
  if (text.length === 0) return 'none'
  let cjk = 0
  let latin = 0
  for (const ch of text) {
    if (CJK_PATTERN.test(ch)) cjk++
    else if (LATIN_PATTERN.test(ch)) latin++
  }
  const total = cjk + latin
  if (total === 0) return 'none'
  return cjk / total >= 0.3 ? 'cjk' : 'latin'
}
