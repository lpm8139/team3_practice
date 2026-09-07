create table if not exists public.links (
  id uuid primary key default gen_random_uuid(),
  short_code text not null unique,
  original_url text not null,
  is_custom_code boolean not null default false,
  expires_at timestamptz null,
  password_hash text null,
  click_count bigint not null default 0,
  title text null,
  description text null,
  preview_image_url text null,
  site_name text null,
  favicon_url text null,
  created_at timestamptz not null default now(),
  constraint links_short_code_length check (char_length(short_code) between 4 and 32),
  constraint links_original_url_length check (char_length(original_url) between 1 and 2048)
);

create index if not exists links_expires_at_idx on public.links (expires_at);

alter table public.links enable row level security;
revoke all on table public.links from public, anon, authenticated;
grant select, insert, update, delete on table public.links to service_role;

create or replace function public.increment_link_click(p_short_code text)
returns table (
  id uuid, short_code text, original_url text, expires_at timestamptz, password_hash text,
  click_count bigint, title text, description text, preview_image_url text, site_name text, favicon_url text
)
language sql security invoker set search_path = public
as $$
  update public.links as l
     set click_count = l.click_count + 1
   where l.short_code = p_short_code
     and (l.expires_at is null or l.expires_at > now())
  returning l.id, l.short_code, l.original_url, l.expires_at, l.password_hash,
            l.click_count, l.title, l.description, l.preview_image_url, l.site_name, l.favicon_url;
$$;

revoke all on function public.increment_link_click(text) from public, anon, authenticated;
grant execute on function public.increment_link_click(text) to service_role;

create table if not exists public.rate_limits (
  bucket_key text primary key,
  window_started_at timestamptz not null,
  request_count integer not null default 0
);

alter table public.rate_limits enable row level security;
revoke all on table public.rate_limits from public, anon, authenticated;
grant select, insert, update on table public.rate_limits to service_role;

create or replace function public.consume_rate_limit(p_key text, p_limit integer, p_window_seconds integer)
returns boolean language plpgsql security invoker set search_path = public
as $$
declare
  current_window timestamptz := now();
  allowed boolean;
begin
  if p_limit < 1 or p_window_seconds < 1 then return false; end if;
  insert into public.rate_limits(bucket_key, window_started_at, request_count)
  values (p_key, current_window, 1)
  on conflict (bucket_key) do update
    set window_started_at = case
      when public.rate_limits.window_started_at + make_interval(secs => p_window_seconds) <= current_window then current_window
      else public.rate_limits.window_started_at end,
    request_count = case
      when public.rate_limits.window_started_at + make_interval(secs => p_window_seconds) <= current_window then 1
      else least(public.rate_limits.request_count + 1, p_limit + 1) end
  returning request_count <= p_limit into allowed;
  return coalesce(allowed, false);
end;
$$;

revoke all on function public.consume_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_rate_limit(text, integer, integer) to service_role;
