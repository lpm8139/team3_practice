import { afterEach, expect, it, vi } from 'vitest'
import { requestIp } from '@/lib/validation'

afterEach(() => vi.unstubAllEnvs())
const req = (headers: Record<string, string>) => new Request('https://short.example', { headers })

it('ignores all caller-supplied identities outside Vercel', () => {
  vi.stubEnv('VERCEL', '')
  for (const ip of ['1.1.1.1', '8.8.8.8']) {
    expect(requestIp(req({ 'x-vercel-forwarded-for': ip, 'x-forwarded-for': ip, 'x-real-ip': ip }))).toBe('unknown')
  }
})

it('uses only the trusted Vercel identity and fails closed on missing or malformed values', () => {
  vi.stubEnv('VERCEL', '1')
  expect(requestIp(req({ 'x-vercel-forwarded-for': '8.8.8.8', 'x-forwarded-for': '1.1.1.1' }))).toBe('8.8.8.8')
  expect(requestIp(req({ 'x-forwarded-for': '1.1.1.1' }))).toBe('unknown')
  for (const value of ['bad', '8.8.8.8, 1.1.1.1', 'x'.repeat(129)]) {
    expect(requestIp(req({ 'x-vercel-forwarded-for': value }))).toBe('unknown')
  }
})

it('puts equivalent IP representations into the same rate-limit bucket', () => {
  vi.stubEnv('VERCEL', '1')
  const identity = (ip: string) => requestIp(req({ 'x-vercel-forwarded-for': ip }))
  expect(identity('2001:4860:0:0:0:0:0:8888')).toBe(identity('2001:4860::8888'))
  expect(identity('::ffff:8.8.8.8')).toBe(identity('8.8.8.8'))
})
