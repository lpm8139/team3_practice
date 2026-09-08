import ipaddr from 'ipaddr.js'
import { ApiError } from './errors'

export const MAX_URL_LENGTH = 2048
export const MAX_BODY_LENGTH = 64 * 1024
export const SHORT_CODE_RE = /^[A-Za-z0-9_-]{4,32}$/
const RESERVED_CODES = new Set([
  'api', 'admin', 'login', 'logout', 'signin', 'signup', 'health', 'status', 'favicon.ico',
  'robots.txt', 'sitemap.xml', 'assets', 'static', 'public', '_next', 'undefined', 'null',
])

export function isReservedCode(code: string): boolean {
  return RESERVED_CODES.has(code.toLowerCase())
}

export function parseShortCode(code: unknown): string {
  if (typeof code !== 'string' || !SHORT_CODE_RE.test(code) || isReservedCode(code)) {
    throw new ApiError(404, 'NOT_FOUND', 'Short link not found.')
  }
  return code
}

export function isPublicIp(value: string): boolean {
  try {
    const address = ipaddr.parse(value)
    const range = address.range()
    return range === 'unicast'
  } catch {
    return false
  }
}

export function isPrivateLiteralHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host === 'local') return true
  try {
    return !isPublicIp(host)
  } catch {
    return false
  }
}

export function validateOriginalUrl(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_URL_LENGTH) {
    throw new ApiError(400, 'INVALID_REQUEST', 'original_url must be a valid HTTP or HTTPS URL.')
  }
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new ApiError(400, 'INVALID_REQUEST', 'original_url must be a valid HTTP or HTTPS URL.')
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || !parsed.hostname) {
    throw new ApiError(400, 'INVALID_REQUEST', 'original_url must be a valid HTTP or HTTPS URL without credentials.')
  }
  const normalizedHost = parsed.hostname.toLowerCase()
  if (normalizedHost === 'localhost' || normalizedHost.endsWith('.localhost') || normalizedHost.endsWith('.local') || normalizedHost === 'local') {
    throw new ApiError(400, 'INVALID_REQUEST', 'Private and local destinations are not allowed.')
  }
  const literalHost = normalizedHost.replace(/^\[|\]$/g, '')
  if (isPrivateLiteralHostname(parsed.hostname)) {
    // A hostname that is not an IP literal is allowed here and is rechecked by the preview fetcher.
    try {
      ipaddr.parse(literalHost)
      throw new ApiError(400, 'INVALID_REQUEST', 'Private and local destinations are not allowed.')
    } catch (error) {
      if (error instanceof ApiError) throw error
    }
  }
  return parsed.toString()
}

export function parseExpiresAt(value: unknown): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string' || !value.trim() || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    throw new ApiError(400, 'INVALID_REQUEST', 'expires_at must be a future ISO timestamp or null.')
  }
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp) || timestamp <= Date.now()) {
    throw new ApiError(400, 'INVALID_REQUEST', 'expires_at must be a future ISO timestamp or null.')
  }
  return new Date(timestamp).toISOString()
}

export function parseCustomCode(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string' || !SHORT_CODE_RE.test(value) || isReservedCode(value)) {
    throw new ApiError(400, 'INVALID_REQUEST', 'custom_code must be 4-32 letters, numbers, hyphens, or underscores.')
  }
  return value
}

export function parsePassword(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string' || value.length < 8 || value.length > 128) {
    throw new ApiError(400, 'INVALID_REQUEST', 'password must be 8-128 characters.')
  }
  return value
}

export function requestIp(request: Request): string {
  const raw = (request.headers.get('x-vercel-forwarded-for') ?? request.headers.get('x-forwarded-for') ?? request.headers.get('x-real-ip'))?.split(',')[0]?.trim()
  const candidate = raw?.replace(/^\[|\]$/g, '')
  if (!candidate || candidate.length > 128) return 'unknown'
  try {
    ipaddr.parse(candidate)
    return candidate
  } catch {
    return 'unknown'
  }
}

export async function readLimitedText(request: Request, maxBytes: number): Promise<string> {
  const declared = request.headers.get('content-length')
  if (declared !== null) {
    const length = Number(declared)
    if (!Number.isSafeInteger(length) || length < 0) throw new ApiError(400, 'INVALID_REQUEST', 'Invalid Content-Length.')
    if (length > maxBytes) throw new ApiError(413, 'TOO_LARGE', 'Request body is too large.')
  }
  if (!request.body) return ''
  const reader = request.body.getReader()
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let bytes = 0
  let text = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > maxBytes) {
        await reader.cancel()
        throw new ApiError(413, 'TOO_LARGE', 'Request body is too large.')
      }
      text += decoder.decode(value, { stream: true })
    }
    return text + decoder.decode()
  } catch (error) {
    if (error instanceof ApiError) throw error
    throw new ApiError(400, 'INVALID_REQUEST', 'Request body is not valid UTF-8.')
  }
}
