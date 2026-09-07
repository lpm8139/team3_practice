export type AppConfig = {
  appUrl: string
  supabaseUrl: string
  serviceRoleKey: string
}

export function getConfig(): AppConfig | null {
  const appUrl = process.env.APP_URL?.trim()
  const supabaseUrl = process.env.SUPABASE_URL?.trim()
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!appUrl || !supabaseUrl || !serviceRoleKey) return null
  try {
    const parsedApp = new URL(appUrl)
    const parsedSupabase = new URL(supabaseUrl)
    if (!['http:', 'https:'].includes(parsedApp.protocol) || !['http:', 'https:'].includes(parsedSupabase.protocol)) return null
    if (parsedApp.username || parsedApp.password || parsedSupabase.username || parsedSupabase.password) return null
    return { appUrl: parsedApp.toString().replace(/\/$/, ''), supabaseUrl, serviceRoleKey }
  } catch {
    return null
  }
}
