import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('migration against local PostgreSQL engine', () => {
  let db: PGlite
  beforeAll(async () => {
    db = new PGlite()
    await db.exec('create role anon; create role authenticated; create role service_role bypassrls; grant usage on schema public to anon, authenticated, service_role;')
    await db.exec(readFileSync(resolve('supabase/migrations/001_initial.sql'), 'utf8'))
  }, 30_000)
  afterAll(async () => { await db?.close() })

  it('uses the agreed columns and preserves unique custom codes', async () => {
    await db.exec("insert into links(short_code, original_url, is_custom_code, title, description, preview_image_url, site_name, favicon_url) values ('first1', 'https://example.com/', true, 'title', 'description', null, 'site', null)")
    await expect(db.exec("insert into links(short_code, original_url) values ('first1', 'https://example.org/')")).rejects.toThrow(/unique|duplicate/i)
  })

  it('increments exactly once per successful RPC and rejects expiry', async () => {
    await db.exec("insert into links(short_code,original_url) values ('count1','https://example.com/'); insert into links(short_code,original_url,expires_at) values ('expired1','https://example.com/',now()-interval '1 second')")
    await db.exec('set role service_role')
    try {
      await Promise.all(Array.from({length: 20}, () => db.query("select * from increment_link_click('count1')")))
      const count = await db.query<{click_count:string}>("select click_count::text from links where short_code='count1'")
      expect(count.rows[0].click_count).toBe('20')
      expect((await db.query("select * from increment_link_click('expired1')")).rows).toHaveLength(0)
      expect((await db.query("select * from increment_link_click('absent1')")).rows).toHaveLength(0)
    } finally { await db.exec('reset role') }
  })

  it('rejects all requests after a rate window is consumed and permits a new window', async () => {
    await db.exec('set role service_role')
    try {
      const allowed: boolean[] = []
      for (let i = 0; i < 5; i++) {
        const result = await db.query<{allowed:boolean}>("select consume_rate_limit('test-client', 2, 60) as allowed")
        allowed.push(result.rows[0].allowed)
      }
      expect(allowed).toEqual([true, true, false, false, false])
      await db.exec("update rate_limits set window_started_at=now()-interval '61 seconds' where bucket_key='test-client'")
      const result = await db.query<{allowed:boolean}>("select consume_rate_limit('test-client', 2, 60) as allowed")
      expect(result.rows[0].allowed).toBe(true)
    } finally { await db.exec('reset role') }
  })

  it.each(['anon', 'authenticated'])('denies %s access to data and privileged RPCs', async (role) => {
    await db.exec(`set role ${role}`)
    try {
      await expect(db.query('select * from links')).rejects.toThrow(/permission denied/)
      await expect(db.query("insert into links(short_code, original_url) values ('forged1','https://example.com/')")).rejects.toThrow(/permission denied/)
      await expect(db.query("select * from increment_link_click('count1')")).rejects.toThrow(/permission denied/)
      await expect(db.query("select consume_rate_limit('forged',1,60)")).rejects.toThrow(/permission denied/)
    } finally { await db.exec('reset role') }
  })
})
