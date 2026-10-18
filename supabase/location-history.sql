-- Existing Supabase projects: keep the newest approved coordinates visible
-- even when the latest one-time request was declined or failed.
-- Run once in Supabase SQL Editor after member-insights.sql. Safe to re-run.
begin;

drop function if exists public.admin_list_members(text);
create or replace function public.admin_list_members(p_code text)
returns table (
  id uuid,
  nickname text,
  created_at timestamptz,
  last_seen_at timestamptz,
  rhythm_count bigint,
  session_started_at timestamptz,
  device_type text,
  os_name text,
  browser_name text,
  approx_location text,
  location_status text,
  exact_latitude double precision,
  exact_longitude double precision,
  exact_accuracy_m double precision,
  location_captured_at timestamptz,
  location_requested_at timestamptz,
  location_expires_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.admin_code_is_valid(p_code) then
    raise exception 'Invalid administrator code' using errcode = '42501';
  end if;
  return query
    select p.id, p.nickname, p.created_at, mp.last_seen_at,
      (select count(*) from public.performances r where r.owner_id = p.id)::bigint,
      mp.session_started_at, mp.device_type, mp.os_name, mp.browser_name, mp.approx_location,
      lr.status, approved.latitude, approved.longitude, approved.accuracy_m, approved.captured_at, lr.requested_at, lr.expires_at
    from public.profiles p
    left join public.member_presence mp on mp.member_id = p.id
    left join lateral (
      select q.status, q.requested_at, q.expires_at
      from public.location_requests q
      where q.member_id = p.id
      order by q.requested_at desc
      limit 1
    ) lr on true
    left join lateral (
      select q.latitude, q.longitude, q.accuracy_m, q.captured_at
      from public.location_requests q
      where q.member_id = p.id and q.status = 'approved'
      order by q.requested_at desc
      limit 1
    ) approved on true
    order by p.nickname, p.id;
end;
$$;
revoke all on function public.admin_list_members(text) from public;
grant execute on function public.admin_list_members(text) to anon, authenticated;

commit;
