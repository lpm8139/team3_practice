import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  inserted: null as Record<string, unknown> | null,
  insertError: null as Record<string, unknown> | null,
  link: null as Record<string, unknown> | null,
  incremented: null as Record<string, unknown> | null,
  increments: 0,
}))

vi.mock('@/lib/config', () => ({
  getConfig: () => ({ appUrl: 'https://short.example', supabaseUrl: 'https://db.example', serviceRoleKey: 'secret' }),
}))
vi.mock('@/lib/preview', () => ({
  fetchPreview: async () => ({ title: 'Example', description: null, image_url: null, site_name: 'Example', favicon_url: null }),
}))
vi.mock('@/lib/password', () => ({
  hashPassword: async () => 'scrypt$test',
  verifyPassword: async (password: string) => password === 'correct-password',
}))
vi.mock('@/lib/db', () => ({
  getAdminClient: () => ({
    from: () => ({
      insert: (values: Record<string, unknown>) => ({
        select: () => ({
          single: async () => ({
            data: state.inserted ? { ...state.inserted, ...values } : null,
            error: state.insertError,
          }),
        }),
      }),
    }),
  }),
  consumeRateLimit: async () => true,
  getLink: async () => state.link,
  incrementAllowedLink: async () => {
    state.increments += 1
    return state.incremented
  },
}))

import { POST as createLink } from '@/app/api/links/route'
import { GET as openLink, HEAD as inspectLink, POST as unlockLink } from '@/app/[short_code]/route'

const context = { params: Promise.resolve({ short_code: 'demo1' }) }

describe('create-link API', () => {
  beforeEach(() => {
    state.inserted = { original_url: 'https://example.com/', expires_at: null, click_count: 0, title: 'Example', description: null, preview_image_url: null, site_name: 'Example', favicon_url: null }
    state.insertError = null
    state.increments = 0
  })

  it('creates a custom link using snake_case and the unified response', async () => {
    const response = await createLink(new Request('https://short.example/api/links', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ original_url: 'https://example.com/', custom_code: 'demo1' }),
    }))
    expect(response.status).toBe(201)
    expect(await response.json()).toEqual({
      short_code: 'demo1', short_url: 'https://short.example/demo1', original_url: 'https://example.com/', expires_at: null, click_count: '0',
      preview: { title: 'Example', description: null, image_url: null, site_name: 'Example', favicon_url: null },
    })
  })

  it('returns 409 for a duplicate custom code', async () => {
    state.inserted = null
    state.insertError = { code: '23505' }
    const response = await createLink(new Request('https://short.example/api/links', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ original_url: 'https://example.com/', custom_code: 'demo1' }),
    }))
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ error: { code: 'CONFLICT' } })
  })
})

describe('redirect and password routes', () => {
  beforeEach(() => {
    state.link = { id: 'id', short_code: 'demo1', original_url: 'https://destination.example/path', expires_at: null, password_hash: null, click_count: 0, title: null, description: null, preview_image_url: null, site_name: null, favicon_url: null }
    state.incremented = { ...state.link, click_count: 1 }
    state.increments = 0
  })

  it('uses 302 and increments only GET', async () => {
    const head = await inspectLink(new Request('https://short.example/demo1', { method: 'HEAD' }), context)
    expect(head.status).toBe(302)
    expect(state.increments).toBe(0)
    const get = await openLink(new Request('https://short.example/demo1'), context)
    expect(get.status).toBe(302)
    expect(get.headers.get('location')).toBe('https://destination.example/path')
    expect(get.headers.get('cache-control')).toContain('no-store')
    expect(state.increments).toBe(1)
  })

  it('does not reveal or count a protected destination before authentication', async () => {
    state.link = { ...state.link!, password_hash: 'scrypt$test' }
    state.incremented = { ...state.link, click_count: 1 }
    const get = await openLink(new Request('https://short.example/demo1'), context)
    const html = await get.text()
    expect(get.status).toBe(200)
    expect(html).not.toContain('destination.example')
    expect(state.increments).toBe(0)

    const wrong = await unlockLink(new Request('https://short.example/demo1', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'wrong-password' }),
    }), context)
    expect(wrong.status).toBe(401)
    expect(state.increments).toBe(0)

    const correct = await unlockLink(new Request('https://short.example/demo1', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'password=correct-password',
    }), context)
    expect(correct.status).toBe(302)
    expect(state.increments).toBe(1)
  })
})
