import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { getConfig } from './config'

export function getAdminClient(): SupabaseClient | null {
  const config = getConfig()
  if (!config) return null
  return createClient(config.supabaseUrl, config.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

export type LinkRecord = {
  id: string
  short_code: string
  original_url: string
  expires_at: string | null
  password_hash: string | null
  click_count: number | string
  title: string | null
  description: string | null
  preview_image_url: string | null
  site_name: string | null
  favicon_url: string | null
}

export const linkSelect = [
  'id', 'short_code', 'original_url', 'expires_at', 'password_hash', 'click_count',
  'title', 'description', 'preview_image_url', 'site_name', 'favicon_url',
].join(',')

export async function getLink(client: SupabaseClient, shortCode: string): Promise<LinkRecord | null> {
  const result = await client.from('links').select(linkSelect).eq('short_code', shortCode).maybeSingle()
  if (result.error) throw result.error
  return result.data as LinkRecord | null
}

export async function incrementAllowedLink(client: SupabaseClient, shortCode: string): Promise<LinkRecord | null> {
  const result = await client.rpc('increment_link_click', { p_short_code: shortCode })
  if (result.error) throw result.error
  const row = Array.isArray(result.data) ? result.data[0] : result.data
  return (row ?? null) as LinkRecord | null
}

export async function consumeRateLimit(client: SupabaseClient, key: string, limit: number, windowSeconds: number): Promise<boolean> {
  const result = await client.rpc('consume_rate_limit', {
    p_key: key,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  })
  if (result.error) throw result.error
  return result.data === true || result.data === 'true' || result.data === 1
}
