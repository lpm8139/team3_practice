import { afterEach, describe, expect, it } from 'vitest'
import { hashPassword, verifyPassword } from '@/lib/password'
import {
  isPublicIp,
  parseCustomCode,
  parseExpiresAt,
  parsePassword,
  readLimitedText,
  validateOriginalUrl,
} from '@/lib/validation'
import { getConfig } from '@/lib/config'

describe('input validation', () => {
  it.each([
    'http://localhost/',
    'https://127.0.0.1/admin',
    'https://[::1]/',
    'ftp://example.com/file',
    'https://user:secret@example.com/',
  ])('rejects unsafe destination %s', (url) => {
    expect(() => validateOriginalUrl(url)).toThrow()
  })

  it('normalizes public HTTP URLs and accepts the boundary values', () => {
    expect(validateOriginalUrl('https://example.com/a b')).toBe('https://example.com/a%20b')
    expect(parseCustomCode('Ab_1')).toBe('Ab_1')
    expect(parsePassword('12345678')).toBe('12345678')
    expect(parseExpiresAt('2099-01-01T00:00:00+09:00')).toBe('2098-12-31T15:00:00.000Z')
  })

  it('rejects reserved codes, local timestamps and private address ranges', () => {
    expect(() => parseCustomCode('API')).toThrow()
    expect(() => parseExpiresAt('2099-01-01T00:00:00')).toThrow()
    expect(isPublicIp('10.0.0.1')).toBe(false)
    expect(isPublicIp('169.254.169.254')).toBe(false)
    expect(isPublicIp('8.8.8.8')).toBe(true)
  })

  it('enforces streamed byte limits even without Content-Length', async () => {
    const request = new Request('http://local.test', { method: 'POST', body: 'あいうえお' })
    await expect(readLimitedText(request, 10)).rejects.toMatchObject({ status: 413, code: 'TOO_LARGE' })
  })
})

describe('password storage', () => {
  it('uses unique salted hashes and constant-time comparison for valid records', async () => {
    const first = await hashPassword('correct horse')
    const second = await hashPassword('correct horse')
    expect(first).not.toBe(second)
    expect(first).not.toContain('correct horse')
    await expect(verifyPassword('correct horse', first)).resolves.toBe(true)
    await expect(verifyPassword('wrong password', first)).resolves.toBe(false)
    await expect(verifyPassword('correct horse', 'malformed')).resolves.toBe(false)
  }, 15_000)
})

describe('configuration', () => {
  const saved = { ...process.env }
  afterEach(() => { process.env = { ...saved } })

  it('requires all server-only values and rejects embedded credentials', () => {
    delete process.env.APP_URL
    delete process.env.SUPABASE_URL
    delete process.env.SUPABASE_SERVICE_ROLE_KEY
    expect(getConfig()).toBeNull()
    process.env.APP_URL = 'https://user:pass@example.com'
    process.env.SUPABASE_URL = 'https://project.supabase.co'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'server-secret'
    expect(getConfig()).toBeNull()
  })
})
