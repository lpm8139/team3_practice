import { afterEach, describe, expect, it } from 'vitest'
import { POST as createLink } from '@/app/api/links/route'
import { GET as openLink } from '@/app/[short_code]/route'

const saved = { ...process.env }
afterEach(() => { process.env = { ...saved } })

describe('route failure contracts without external services', () => {
  it('returns the unified 503 error without exposing configuration details', async () => {
    delete process.env.APP_URL
    delete process.env.SUPABASE_URL
    delete process.env.SUPABASE_SERVICE_ROLE_KEY
    const response = await createLink(new Request('http://local.test/api/links', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ original_url: 'https://example.com/' }),
    }))
    expect(response.status).toBe(503)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toEqual({
      error: { code: 'SERVICE_UNAVAILABLE', message: 'Link service is not configured.' },
    })
  })

  it('validates the path before attempting a database connection', async () => {
    const response = await openLink(new Request('http://local.test/bad'), {
      params: Promise.resolve({ short_code: 'bad' }),
    })
    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ error: { code: 'NOT_FOUND' } })
  })
})
