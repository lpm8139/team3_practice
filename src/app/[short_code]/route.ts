import { NextResponse } from 'next/server'
import { getAdminClient, getLink, incrementAllowedLink, consumeRateLimit, type LinkRecord } from '@/lib/db'
import { ApiError, errorResponse } from '@/lib/errors'
import { getConfig } from '@/lib/config'
import { verifyPassword } from '@/lib/password'
import { parseShortCode, requestIp, readLimitedText } from '@/lib/validation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ short_code: string }> }

function noStoreHeaders(extra: HeadersInit = {}): HeadersInit {
  return { 'Cache-Control': 'no-store, max-age=0', 'Referrer-Policy': 'no-referrer', ...extra }
}

function expired(link: LinkRecord): boolean {
  return link.expires_at !== null && Date.parse(link.expires_at) <= Date.now()
}

async function contextCode(context: RouteContext): Promise<string> {
  const params = await context.params
  return parseShortCode(params?.short_code)
}

async function load(client: NonNullable<ReturnType<typeof getAdminClient>>, code: string): Promise<LinkRecord> {
  const link = await getLink(client, code)
  if (!link) throw new ApiError(404, 'NOT_FOUND', 'Short link not found.')
  if (expired(link)) throw new ApiError(410, 'EXPIRED', 'This short link has expired.')
  return link
}

function passwordForm(code: string): NextResponse {
  const escapedCode = code.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>パスワードが必要です</title><style>body{margin:0;background:#f7f4ed;color:#173c3b;font-family:system-ui,sans-serif}main{max-width:28rem;margin:12vh auto;padding:2rem;background:#fffdf8;border:1px solid #d9e4dd;border-radius:12px}label,input,button{display:block;width:100%;box-sizing:border-box}input{margin:.6rem 0 1rem;padding:.8rem;border:1px solid #bdd3c9;border-radius:7px}button{padding:.8rem;border:0;border-radius:7px;background:#1d7770;color:white}</style></head><body><main><h1>パスワードが必要です</h1><p>この短縮リンクは保護されています。</p><form method="post" action="/${escapedCode}"><label>パスワード<input type="password" name="password" maxlength="128" required autocomplete="current-password"></label><button type="submit">リンクを開く</button></form></main></body></html>`
  return new NextResponse(html, { status: 200, headers: noStoreHeaders({ 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'" }) })
}

function redirectResponse(destination: string): NextResponse {
  const response = NextResponse.redirect(destination, 302)
  Object.entries(noStoreHeaders()).forEach(([key, value]) => response.headers.set(key, String(value)))
  return response
}

async function redirectOrForm(request: Request, context: RouteContext, count: boolean): Promise<NextResponse> {
  const code = await contextCode(context)
  const client = getAdminClient()
  if (!client || !getConfig()) throw new ApiError(503, 'SERVICE_UNAVAILABLE', 'Link service is not configured.')
  const link = await load(client, code)
  if (link.password_hash) return count ? passwordForm(code) : new NextResponse(null, { status: 200, headers: noStoreHeaders() })
  if (!count) return new NextResponse(null, { status: 302, headers: noStoreHeaders({ Location: link.original_url }) })
  const incremented = await incrementAllowedLink(client, code)
  if (!incremented) {
    const current = await getLink(client, code)
    if (current && expired(current)) throw new ApiError(410, 'EXPIRED', 'This short link has expired.')
    throw new ApiError(404, 'NOT_FOUND', 'Short link not found.')
  }
  return redirectResponse(incremented.original_url)
}

export async function GET(request: Request, context: RouteContext) {
  try {
    return await redirectOrForm(request, context, true)
  } catch (error) {
    return errorResponse(error)
  }
}

export async function HEAD(request: Request, context: RouteContext) {
  try {
    return await redirectOrForm(request, context, false)
  } catch (error) {
    return errorResponse(error)
  }
}

async function postedPassword(request: Request): Promise<string | null> {
  const contentType = request.headers.get('content-type')?.toLowerCase() ?? ''
  if (contentType.startsWith('application/json')) {
    let parsed: unknown
    try { parsed = JSON.parse(await readLimitedText(request, 4096)) } catch (error) {
      if (error instanceof ApiError) throw error
      throw new ApiError(400, 'INVALID_REQUEST', 'Request body must be valid JSON.')
    }
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) && typeof (parsed as { password?: unknown }).password === 'string'
      ? (parsed as { password: string }).password
      : null
  }
  if (contentType.startsWith('application/x-www-form-urlencoded')) {
    const value = new URLSearchParams(await readLimitedText(request, 4096)).get('password')
    return value
  }
  throw new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Content-Type must be JSON or a form submission.')
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const code = await contextCode(context)
    const client = getAdminClient()
    if (!client || !getConfig()) throw new ApiError(503, 'SERVICE_UNAVAILABLE', 'Link service is not configured.')
    const allowed = await consumeRateLimit(client, `auth:${requestIp(request)}`, 20, 60)
    if (!allowed) throw new ApiError(429, 'RATE_LIMITED', 'Too many authentication attempts.')
    const password = await postedPassword(request)
    const link = await load(client, code)
    if (password !== null && password.length > 128) throw new ApiError(400, 'INVALID_REQUEST', 'password must be at most 128 characters.')
    if (!password || !link.password_hash || !(await verifyPassword(password, link.password_hash))) {
      throw new ApiError(401, 'UNAUTHORIZED', 'Invalid password.')
    }
    const incremented = await incrementAllowedLink(client, code)
    if (!incremented) {
      const current = await getLink(client, code)
      if (current && expired(current)) throw new ApiError(410, 'EXPIRED', 'This short link has expired.')
      throw new ApiError(404, 'NOT_FOUND', 'Short link not found.')
    }
    return redirectResponse(incremented.original_url)
  } catch (error) {
    return errorResponse(error)
  }
}
