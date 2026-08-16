import { describe, expect, it } from 'vitest'
import { detectScript } from '../src/language.js'

describe('detectScript', () => {
  it('classifies plain English as latin', () => {
    expect(detectScript('Please fix the login bug')).toBe('latin')
    expect(detectScript('Set up JWT auth in Express')).toBe('latin')
  })

  it('classifies Chinese, Japanese, and Korean as cjk', () => {
    expect(detectScript('帮我设置 Express 的 JWT 登录认证')).toBe('cjk')
    expect(detectScript('データベースの接続プールを設定する')).toBe('cjk')
    expect(detectScript('로그인 버그를 수정해 줘')).toBe('cjk')
    expect(detectScript('重构数据库查询以使用连接池')).toBe('cjk')
  })

  it('treats mixed prompts with a CJK majority as cjk', () => {
    expect(detectScript('请用 Redis 实现缓存')).toBe('cjk')
    expect(detectScript('把 docker-compose.yml 里的端口改一下')).toBe('cjk')
  })

  it('treats Latin-heavy mixed prompts as latin', () => {
    expect(detectScript('using connection pooling with Postgres')).toBe('latin')
    expect(detectScript('JWT login flow')).toBe('latin')
  })

  it('returns none for empty or punctuation-only input', () => {
    expect(detectScript('')).toBe('none')
    expect(detectScript('???!!! ---')).toBe('none')
    expect(detectScript('123456')).toBe('none')
  })
})
