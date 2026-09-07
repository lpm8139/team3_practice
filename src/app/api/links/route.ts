import { randomInt } from 'node:crypto'
import { NextResponse } from 'next/server'
import { getConfig } from '@/lib/config'
import { ApiError, errorResponse } from '@/lib/errors'
import { getAdminClient, consumeRateLimit } from '@/lib/db'
import { hashPassword } from '@/lib/password'
import { fetchPreview, type LinkPreview } from '@/lib/preview'
import {
  MAX_BODY_LENGTH,
  parseCustomCode,
  parseExpiresAt,
  parsePassword,
  requestIp,
  readLimitedText,
  validateOriginalUrl,
} from '@/lib/validation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type LinkInput = {
  original_url?: unknown
  custom_code?: unknown
  expires_at?: unknown
  password?: unknown
}

function randomCode(length = 8): string {
  const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
  return Array.from({ length }, () => alphabet[randomInt(alphabet.length)]).join('')
}

function shortUrl(appUrl: string, code: string): string {
  return new URL(`/${encodeURIComponent(code)}`, `${appUrl}/`).toString()
}

function previewFields(preview: LinkPreview | null) {
  return {
    title: preview?.title ?? null,
    description: preview?.description ?? null,
    preview_image_url: preview?.image_url ?? null,
    site_name: preview?.site_name ?? null,
    favicon_url: preview?.favicon_url ?? null,
  }
}

async function readJson(request: Request): Promise<LinkInput> {
  const body = await readLimitedText(request, MAX_BODY_LENGTH)
  try {
    const parsed: unknown = JSON.parse(body)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('object expected')
    return parsed as LinkInput
  } catch {
    throw new ApiError(400, 'INVALID_REQUEST', 'Request body must be valid JSON.')
  }
}

function isDuplicate(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === '23505')
}

export async function POST(request: Request) {
  try {
    const config = getConfig()
    const client = getAdminClient()
    if (!config || !client) throw new ApiError(503, 'SERVICE_UNAVAILABLE', 'Link service is not configured.')
    const contentType = request.headers.get('content-type')?.toLowerCase() ?? ''
    if (!contentType.startsWith('application/json')) {
      throw new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Content-Type must be application/json.')
    }
    const allowed = await consumeRateLimit(client, `create:${requestIp(request)}`, 30, 60)
    if (!allowed) throw new ApiError(429, 'RATE_LIMITED', 'Too many link creation requests.')

    const input = await readJson(request)
    const originalUrl = validateOriginalUrl(input.original_url)
    const customCode = parseCustomCode(input.custom_code)
    const expiresAt = parseExpiresAt(input.expires_at)
    const password = parsePassword(input.password)
    const passwordHash = password ? await hashPassword(password) : null
    const preview = await fetchPreview(originalUrl)
    const values = {
      original_url: originalUrl,
      is_custom_code: customCode !== null,
      expires_at: expiresAt,
      password_hash: passwordHash,
      ...previewFields(preview),
    }

    let inserted: Record<string, unknown> | null = null
    let code = customCode
    for (let attempt = 0; attempt < 4; attempt += 1) {
      code = customCode ?? randomCode()
      const result = await client.from('links').insert({ ...values, short_code: code }).select('*').single()
      if (!result.error && result.data) {
        inserted = result.data as Record<string, unknown>
        break
      }
      if (!isDuplicate(result.error)) throw result.error
      if (customCode) throw new ApiError(409, 'CONFLICT', 'That custom code is already in use.')
    }
    if (!inserted || !code) throw new ApiError(503, 'SERVICE_UNAVAILABLE', 'Could not allocate a short code.')

    return NextResponse.json({
      short_code: code,
      short_url: shortUrl(config.appUrl, code),
      original_url: String(inserted.original_url ?? originalUrl),
      expires_at: inserted.expires_at == null ? null : String(inserted.expires_at),
      click_count: String(inserted.click_count ?? '0'),
      preview: {
        title: inserted.title == null ? null : String(inserted.title),
        description: inserted.description == null ? null : String(inserted.description),
        image_url: inserted.preview_image_url == null ? null : String(inserted.preview_image_url),
        site_name: inserted.site_name == null ? null : String(inserted.site_name),
        favicon_url: inserted.favicon_url == null ? null : String(inserted.favicon_url),
      },
    }, { status: 201, headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return errorResponse(error)
  }
}
