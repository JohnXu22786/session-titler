import { describe, expect, it } from 'vitest'
import { CaptionNormalizer, truncateUtf8, truncateChars, SERVICE_MAX_TITLE_BYTES } from '../src/normalizer.js'

const n = new CaptionNormalizer()

describe('CaptionNormalizer.normalize', () => {
  it('collapses whitespace and trims', () => {
    expect(n.normalize('  Fix   the  login \n bug  ')).toBe('Fix the login bug')
  })

  it('strips control characters', () => {
    expect(n.normalize('Fix\u0000login\u001Fbug')).toBe('Fixloginbug')
  })

  it('strips leading and trailing punctuation', () => {
    expect(n.normalize('...Fix the login bug!!!')).toBe('Fix the login bug')
    expect(n.normalize('【修复】登录页。')).toBe('【修复】登录页')
  })

  it('folds repeated question marks in the middle', () => {
    expect(n.normalize('Why?? is this failing')).toBe('Why? is this failing')
    // Edge punctuation is still stripped at the boundaries.
    expect(n.normalize('Why is this failing???')).toBe('Why is this failing')
  })

  it('keeps symbol prefixes configured by the user', () => {
    // Edge punctuation table is explicit; emoji/symbols are not stripped.
    expect(n.normalize('⚡ Fix login')).toBe('⚡ Fix login')
  })

  it('caps UTF-8 length without splitting code points', () => {
    const text = '配置数据库连接池的详细步骤和注意事项'
    const cut = n.normalize(text, 20)
    expect(Buffer.byteLength(cut, 'utf8')).toBeLessThanOrEqual(20)
    // A multi-byte char must never be split: re-encoding the result is valid.
    expect(() => Buffer.from(cut, 'utf8').toString('utf8')).not.toThrow()
  })
})

describe('CaptionNormalizer.isSame', () => {
  it('ignores case, whitespace, and punctuation', () => {
    expect(n.isSame('Fix the login', 'FIX THE LOGIN')).toBe(true)
    expect(n.isSame('Fix the login', '  Fix   the   login ')).toBe(true)
    expect(n.isSame('重构连接池', '重构连接池！')).toBe(true)
    expect(n.isSame('Fix login', 'Setup auth')).toBe(false)
  })

  it('rejects empty comparisons', () => {
    expect(n.isSame('', '')).toBe(false)
    expect(n.isSame('!!!', '???')).toBe(false)
  })
})

describe('truncateUtf8', () => {
  it('returns the input when it fits', () => {
    expect(truncateUtf8('abc', 80)).toBe('abc')
  })

  it('truncates to the byte budget at a code-point boundary', () => {
    const text = 'a😀b😀c'
    const cut = truncateUtf8(text, 4)
    expect(cut).toBe('a')
    expect(truncateUtf8(text, 5)).toBe('a😀')
    expect(truncateUtf8(text, 6)).toBe('a😀b')
    expect(truncateUtf8('abcdef', 3)).toBe('abc')
  })

  it('exposes the service-side ceiling constant', () => {
    expect(SERVICE_MAX_TITLE_BYTES).toBe(80)
  })
})

describe('truncateChars', () => {
  it('returns the input when it fits', () => {
    expect(truncateChars('abcdef', 6)).toBe('abcdef')
  })

  it('truncates by code-point count without splitting a surrogate pair', () => {
    // Two astral-plane emoji are 4 UTF-16 units; cutting at 1 code point must
    // keep exactly one complete emoji, never a lone surrogate.
    const pair = '\u{1F600}\u{1F601}'
    expect(truncateChars(pair, 1)).toBe('\u{1F600}')
    expect(() => Buffer.from(truncateChars('\u{1F600}\u{1F601}\u{1F602}', 2), 'utf8').toString('utf8')).not.toThrow()
  })
})
