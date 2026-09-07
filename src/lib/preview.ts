import dns from 'node:dns/promises'
import http from 'node:http'
import https from 'node:https'
import { URL } from 'node:url'
import * as cheerio from 'cheerio'
import { isPublicIp } from './validation'

const MAX_REDIRECTS = 3
const MAX_BYTES = 1024 * 1024
const TIMEOUT_MS = 5000
const USER_AGENT = 'LinkPocketPreview/1.0 (+https://example.invalid/bot)'

export type LinkPreview = {
  title: string | null
  description: string | null
  image_url: string | null
  site_name: string | null
  favicon_url: string | null
}

type ResolvedHost = { address: string; family: 4 | 6 }

async function resolvePublic(hostname: string, timeoutMs: number): Promise<ResolvedHost[]> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const lookup = dns.lookup(hostname, { all: true, verbatim: true })
  const answers = await Promise.race([
    lookup,
    new Promise<Awaited<typeof lookup>>((_, reject) => { timer = setTimeout(() => reject(new Error('DNS timeout')), timeoutMs) }),
  ])
  if (timer) clearTimeout(timer)
  const checkedAnswers = answers
    .filter((answer): answer is { address: string; family: 4 | 6 } => (answer.family === 4 || answer.family === 6) && isPublicIp(answer.address))
  if (!answers.length || checkedAnswers.length !== answers.length) throw new Error('Destination has a non-public address')
  return checkedAnswers
}

function cleanText(value: string | undefined | null, max = 500): string | null {
  const cleaned = value?.replace(/\s+/g, ' ').trim()
  return cleaned ? cleaned.slice(0, max) : null
}

function absoluteHttpUrl(value: string | undefined, base: URL): string | null {
  if (!value) return null
  try {
    const url = new URL(value, base)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null
    return url.toString()
  } catch {
    return null
  }
}

async function requestBody(url: URL, hosts: ResolvedHost[], timeoutMs: number): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  const transport = url.protocol === 'https:' ? https : http
  const selected = hosts[0]
  return await new Promise((resolve, reject) => {
    let settled = false
    const lookup = (_hostname: string, options: { all?: boolean }, callback: (error: NodeJS.ErrnoException | null, address: string | Array<{ address: string; family: number }>, family?: number) => void) => {
      if (options.all) callback(null, [{ address: selected.address, family: selected.family }])
      else callback(null, selected.address, selected.family)
    }
    const req = transport.request({
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port || undefined,
      path: `${url.pathname || '/'}${url.search}`,
      method: 'GET',
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml', 'Accept-Encoding': 'identity', Connection: 'close' },
      timeout: timeoutMs,
      lookup: lookup as unknown as typeof dns.lookup,
      ...(url.protocol === 'https:' ? { servername: url.hostname } : {}),
    }, (response) => {
      const chunks: Buffer[] = []
      let size = 0
      response.on('data', (chunk: Buffer | string) => {
        const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        size += data.length
        if (size > MAX_BYTES) {
          req.destroy(new Error('Preview too large'))
          return
        }
        chunks.push(data)
      })
      response.on('end', () => {
        if (settled) return
        settled = true
        clearTimeout(deadlineTimer)
        resolve({ status: response.statusCode ?? 0, headers: response.headers, body: Buffer.concat(chunks).toString('utf8') })
      })
      response.on('error', (error) => {
        if (!settled) { settled = true; clearTimeout(deadlineTimer); reject(error) }
      })
    })
    const deadlineTimer = setTimeout(() => req.destroy(new Error('Preview timeout')), timeoutMs)
    req.on('timeout', () => req.destroy(new Error('Preview timeout')))
    req.on('error', (error) => { if (!settled) { settled = true; clearTimeout(deadlineTimer); reject(error) } })
    req.end()
  })
}

export async function fetchPreview(input: string): Promise<LinkPreview | null> {
  try {
    const deadline = Date.now() + TIMEOUT_MS
    let current = new URL(input)
    for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
      if (!['http:', 'https:'].includes(current.protocol) || current.username || current.password) return null
      const remaining = deadline - Date.now()
      if (remaining <= 0) return null
      const hosts = await resolvePublic(current.hostname, remaining)
      const response = await requestBody(current, hosts, Math.max(1, deadline - Date.now()))
      if (response.status >= 300 && response.status < 400 && response.headers.location) {
        if (redirect === MAX_REDIRECTS) return null
        current = new URL(response.headers.location, current)
        continue
      }
      if (response.status < 200 || response.status >= 300) return null
      const type = String(response.headers['content-type'] ?? '').toLowerCase()
      if (type && !type.includes('text/html') && !type.includes('application/xhtml+xml')) return null
      const $ = cheerio.load(response.body)
      const title = cleanText($('meta[property="og:title"]').attr('content')) ?? cleanText($('title').first().text())
      const description = cleanText($('meta[property="og:description"]').attr('content')) ?? cleanText($('meta[name="description"]').attr('content'))
      const imageUrl = absoluteHttpUrl($('meta[property="og:image"]').attr('content'), current)
      const siteName = cleanText($('meta[property="og:site_name"]').attr('content'))
      const faviconValue = $('link[rel~="icon" i]').first().attr('href') ?? $('link[rel="shortcut icon" i]').first().attr('href')
      const faviconUrl = absoluteHttpUrl(faviconValue, current)
      return { title, description, image_url: imageUrl, site_name: siteName, favicon_url: faviconUrl }
    }
    return null
  } catch {
    return null
  }
}
