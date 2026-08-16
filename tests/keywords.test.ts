import { describe, expect, it } from 'vitest'
import { KeywordCaptioner } from '../src/keywords.js'
import { CaptionNormalizer } from '../src/normalizer.js'
import type { InstantCaptionConfig } from '../src/config.js'
import type { SessionTitleUserMessage } from '@deepseek-ai/dsh-session-title'

const normalizer = new CaptionNormalizer()

function engine(overrides: Partial<InstantCaptionConfig> = {}): KeywordCaptioner {
  const config: InstantCaptionConfig = {
    enabled: true,
    prefix: '',
    maxWords: 6,
    maxCjkChars: 14,
    ...overrides,
  }
  return new KeywordCaptioner(config, normalizer)
}

function msg(seq: number, text: string): SessionTitleUserMessage {
  return { seq, text }
}

describe('KeywordCaptioner.make — Latin', () => {
  it('drops function words and keeps content words in order', () => {
    const caption = engine().make([msg(1, 'Can you help me set up JWT authentication in my Express app?')])
    expect(caption).toBe('Set JWT Authentication Express App')
  })

  it('keeps the verb of an action request', () => {
    expect(engine().make([msg(1, 'Please fix the login form email validation')])).toBe('Fix Login Form Email Validation')
  })

  it('limits the word count', () => {
    const caption = engine({ maxWords: 3 }).make([msg(1, 'Refactor the database queries to use connection pooling')])
    expect(caption).toBe('Refactor Database Queries')
  })

  it('capitalizes only the first word', () => {
    const caption = engine().make([msg(1, 'write tests for the payment processing module')])
    expect(caption).toBe('Write Tests Payment Processing Module')
  })

  it('strips openers like please/can you/thanks', () => {
    expect(engine().make([msg(1, 'thanks, can you please check the api response format')])).toBe('Check Api Response Format')
  })
})

describe('KeywordCaptioner.make — CJK', () => {
  it('filters function characters and keeps mixed Latin tokens', () => {
    const caption = engine({ maxCjkChars: 19 }).make([msg(1, '帮我设置 Express 的 JWT 登录认证')])
    expect(caption).toBe('设置 Express JWT 登录认证')
  })

  it('caps CJK captions by characters without splitting Latin words', () => {
    // 2 + 1 + 7 (Express) = 10 chars exactly; the next Latin token would overflow.
    const caption = engine({ maxCjkChars: 10 }).make([msg(1, '帮我设置 Express 的 JWT 登录认证')])
    expect(caption).toBe('设置 Express')
  })

  it('fills the remaining room from a CJK run', () => {
    // 设置 + Express = 10 chars; 登录认证 needs 5 more but only 3 remain,
    // so the run is cut to its first three characters.
    const caption = engine({ maxCjkChars: 13 }).make([msg(1, '帮我设置 Express 的登录认证')])
    expect(caption).toBe('设置 Express登录认')
  })

  it('fits everything when the budget allows', () => {
    const caption = engine({ maxCjkChars: 19 }).make([msg(1, '帮我设置 Express 的 JWT 登录认证')])
    expect(caption).toBe('设置 Express JWT 登录认证')
  })

  it('keeps Japanese text', () => {
    // データベース接続プール設定 is one contiguous CJK run of 13 chars;
    // の/を are stripped, the run is cut to the 12-char budget.
    const caption = engine({ maxCjkChars: 12 }).make([msg(1, 'データベースの接続プールを設定してください')])
    expect(caption).toBe('データベース接続プール設')
  })
})

describe('KeywordCaptioner.make — noise and edges', () => {
  it('strips code fences, inline code, URLs, and markup', () => {
    const text = 'Please look at ```const x = 1``` and check https://example.com/readme and the main branch'
    expect(engine().make([msg(1, text)])).toBe('Check Main Branch')
  })

  it('returns null for an empty or noise-only message', () => {
    expect(engine().make([])).toBeNull()
    expect(engine().make([msg(1, '')])).toBeNull()
    expect(engine().make([msg(1, 'https://example.com')])).toBeNull()
    expect(engine().make([msg(1, '!!! ### ???')])).toBeNull()
  })

  it('uses only the latest message', () => {
    const caption = engine().make([msg(1, 'old topic here'), msg(2, 'fix the logout redirect now')])
    expect(caption).toBe('Fix Logout Redirect')
  })

  it('applies the configured prefix', () => {
    const caption = engine({ prefix: '⚡ ' }).make([msg(1, 'fix the login bug')])
    expect(caption).toBe('⚡ Fix Login Bug')
  })

  it('caps the final caption within the service byte budget', () => {
    const caption = engine().make([msg(1, 'please elaborate on the architectural tradeoffs of event sourcing versus outbox patterns in distributed payment systems with at-least-once delivery semantics')])
    expect(caption).not.toBeNull()
    expect(Buffer.byteLength(caption!, 'utf8')).toBeLessThanOrEqual(80)
  })
})
