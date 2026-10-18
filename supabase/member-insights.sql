-- Device details, private presence and consent-based one-time location requests.
-- Run this entire file once in Supabase SQL Editor. Safe to re-run.
begin;

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.member_presence (
  member_id uuid primary key references public.profiles(id) on delete cascade,
  last_seen_at timestamptz not null default now()
);
alter table public.member_presence enable row level security;
revoke all on public.member_presence from anon, authenticated;

-- Migrate timestamps from the earlier public-column version, if it was used.
alter table public.profiles add column if not exists last_seen_at timestamptz;
insert into public.member_presence (member_id, last_seen_at)
select id, last_seen_at from public.profiles where last_seen_at is not null
on conflict (member_id) do update set last_seen_at = excluded.last_seen_at;
alter table public.profiles drop column if exists last_seen_at;

create or replace function public.touch_member_presence()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  member uuid := (select auth.uid());
begin
  if member is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  insert into public.member_presence (member_id, last_seen_at)
  values (member, now())
  on conflict (member_id) do update set last_seen_at = excluded.last_seen_at;
end;
$$;
revoke all on function public.touch_member_presence() from public;
grant execute on function public.touch_member_presence() to authenticated;

create table if not exists public.admin_secrets (
  singleton boolean primary key default true check (singleton),
  code_hash text not null
);
alter table public.admin_secrets enable row level security;
revoke all on public.admin_secrets from anon, authenticated;

alter table public.member_presence add column if not exists session_started_at timestamptz;
alter table public.member_presence add column if not exists device_type text;
alter table public.member_presence add column if not exists os_name text;
alter table public.member_presence add column if not exists browser_name text;
alter table public.member_presence add column if not exists approx_location text;

create or replace function public.start_member_session(
  p_device_type text,
  p_os_name text,
  p_browser_name text,
  p_approx_location text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  member uuid := (select auth.uid());
begin
  if member is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_device_type not in ('Telefonas', 'Planšetė', 'Kompiuteris')
     or char_length(p_os_name) not between 1 and 40
     or char_length(p_browser_name) not between 1 and 40
     or char_length(coalesce(p_approx_location, '')) > 160 then
    raise exception 'Invalid device details' using errcode = '22023';
  end if;
  insert into public.member_presence (
    member_id, last_seen_at, session_started_at, device_type, os_name, browser_name, approx_location
  ) values (
    member, now(), now(), p_device_type, p_os_name, p_browser_name, p_approx_location
  )
  on conflict (member_id) do update set
    last_seen_at = excluded.last_seen_at,
    session_started_at = excluded.session_started_at,
    device_type = excluded.device_type,
    os_name = excluded.os_name,
    browser_name = excluded.browser_name,
    approx_location = excluded.approx_location;
end;
$$;
revoke all on function public.start_member_session(text, text, text, text) from public;
grant execute on function public.start_member_session(text, text, text, text) to authenticated;

create table if not exists public.location_requests (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.profiles(id) on delete cascade,
  requested_at timestamptz not null default now(),
  responded_at timestamptz,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'declined', 'browser_denied', 'error', 'expired')),
  latitude double precision check (latitude is null or latitude between -90 and 90),
  longitude double precision check (longitude is null or longitude between -180 and 180),
  accuracy_m double precision check (accuracy_m is null or accuracy_m between 0 and 100000),
  captured_at timestamptz
);
create index if not exists location_requests_member_time
  on public.location_requests (member_id, requested_at desc);
alter table public.location_requests drop constraint if exists location_requests_status_check;
alter table public.location_requests add constraint location_requests_status_check
  check (status in ('pending', 'approved', 'declined', 'browser_denied', 'error', 'expired'));
alter table public.location_requests enable row level security;
revoke all on public.location_requests from anon, authenticated;
alter table public.location_requests add column if not exists expires_at timestamptz;
update public.location_requests set expires_at = requested_at + interval '10 seconds' where expires_at is null;
alter table public.location_requests alter column expires_at set not null;

create or replace function public.member_pending_location_request()
returns table (id uuid, requested_at timestamptz, expires_at timestamptz)
language plpgsql security definer set search_path = '' as $$
begin
  update public.location_requests set status = 'expired', responded_at = now()
    where member_id = (select auth.uid()) and status = 'pending' and location_requests.expires_at <= now();
  return query select r.id, r.requested_at, r.expires_at from public.location_requests r
    where r.member_id = (select auth.uid()) and r.status = 'pending' and r.expires_at > now()
    order by r.requested_at desc limit 1;
end;
$$;
revoke all on function public.member_pending_location_request() from public;
grant execute on function public.member_pending_location_request() to authenticated;

create or replace function public.member_respond_location_request(
  p_request_id uuid,
  p_decision text,
  p_latitude double precision default null,
  p_longitude double precision default null,
  p_accuracy_m double precision default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or p_decision not in ('approved', 'declined', 'browser_denied', 'error') then
    raise exception 'Invalid location response' using errcode = '22023';
  end if;
  if p_decision = 'approved' and (
    p_latitude is null or p_latitude not between -90 and 90
    or p_longitude is null or p_longitude not between -180 and 180
    or p_accuracy_m is null or p_accuracy_m not between 0 and 100000
  ) then
    raise exception 'Invalid coordinates' using errcode = '22023';
  end if;
  update public.location_requests set
    status = p_decision,
    responded_at = now(),
    latitude = case when p_decision = 'approved' then p_latitude end,
    longitude = case when p_decision = 'approved' then p_longitude end,
    accuracy_m = case when p_decision = 'approved' then p_accuracy_m end,
    captured_at = case when p_decision = 'approved' then now() end
  where id = p_request_id
    and member_id = (select auth.uid())
    and status = 'pending';
  if not found then
    raise exception 'Location request is no longer active' using errcode = 'P0002';
  end if;
end;
$$;
revoke all on function public.member_respond_location_request(uuid, text, double precision, double precision, double precision) from public;
grant execute on function public.member_respond_location_request(uuid, text, double precision, double precision, double precision) to authenticated;

create or replace function public.admin_code_is_valid(p_code text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(exists (
    select 1 from public.admin_secrets s
    where s.singleton
      and p_code is not null
      and char_length(p_code) >= 4
      and extensions.crypt(p_code, s.code_hash) = s.code_hash
  ), false)
$$;
revoke all on function public.admin_code_is_valid(text) from public;

create or replace function public.admin_request_location(p_code text, p_member_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_id uuid;
begin
  if not public.admin_code_is_valid(p_code) then
    raise exception 'Invalid administrator code' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles where id = p_member_id) then
    raise exception 'Member not found' using errcode = 'P0002';
  end if;
  update public.location_requests
    set status = 'expired', responded_at = now()
    where member_id = p_member_id and status = 'pending';
  insert into public.location_requests (member_id)
    values (p_member_id) returning id into request_id;
  return request_id;
end;
$$;
revoke all on function public.admin_request_location(text, uuid) from public;
grant execute on function public.admin_request_location(text, uuid) to anon, authenticated;

drop function if exists public.admin_list_members();
drop function if exists public.admin_list_members(text);
create function public.admin_list_members(p_code text)
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
  location_requested_at timestamptz
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
      lr.status, approved.latitude, approved.longitude, approved.accuracy_m, approved.captured_at, lr.requested_at
    from public.profiles p
    left join public.member_presence mp on mp.member_id = p.id
    left join lateral (
      select q.status, q.requested_at
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

create or replace function public.member_respond_location_request(
  p_request_id uuid, p_decision text, p_latitude double precision default null,
  p_longitude double precision default null, p_accuracy_m double precision default null
)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null or p_decision not in ('approved', 'declined', 'browser_denied', 'error') then
    raise exception 'Invalid location response' using errcode = '22023';
  end if;
  if p_decision = 'approved' and (p_latitude is null or p_latitude not between -90 and 90
    or p_longitude is null or p_longitude not between -180 and 180
    or p_accuracy_m is null or p_accuracy_m not between 0 and 100000) then
    raise exception 'Invalid coordinates' using errcode = '22023';
  end if;
  update public.location_requests set status = p_decision, responded_at = now(),
    latitude = case when p_decision = 'approved' then p_latitude end,
    longitude = case when p_decision = 'approved' then p_longitude end,
    accuracy_m = case when p_decision = 'approved' then p_accuracy_m end,
    captured_at = case when p_decision = 'approved' then now() end
  where id = p_request_id and member_id = (select auth.uid())
    and status = 'pending' and expires_at > now();
  if not found then
    update public.location_requests set status = 'expired', responded_at = now()
      where id = p_request_id and member_id = (select auth.uid()) and status = 'pending';
    raise exception 'Location request is no longer active' using errcode = 'P0002';
  end if;
end;
$$;

create or replace function public.admin_request_location(p_code text, p_member_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare request_id uuid;
begin
  if not public.admin_code_is_valid(p_code) then raise exception 'Invalid administrator code' using errcode = '42501'; end if;
  if not exists (select 1 from public.member_presence where member_id = p_member_id and last_seen_at > now() - interval '75 seconds') then
    raise exception 'Member is not currently connected' using errcode = 'P0002';
  end if;
  update public.location_requests set status = 'expired', responded_at = now()
    where member_id = p_member_id and status = 'pending';
  insert into public.location_requests (member_id, expires_at)
    values (p_member_id, now() + interval '10 seconds') returning id into request_id;
  return request_id;
end;
$$;

create or replace function public.admin_cancel_location_request(p_code text, p_member_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.admin_code_is_valid(p_code) then raise exception 'Invalid administrator code' using errcode = '42501'; end if;
  update public.location_requests set status = 'expired', responded_at = now()
    where member_id = p_member_id and status = 'pending' and expires_at > now();
  if not found then raise exception 'Location request is no longer active' using errcode = 'P0002'; end if;
end;
$$;
revoke all on function public.admin_cancel_location_request(text, uuid) from public;
grant execute on function public.admin_cancel_location_request(text, uuid) to anon, authenticated;

drop function if exists public.admin_list_members(text);
create function public.admin_list_members(p_code text)
returns table (id uuid, nickname text, created_at timestamptz, last_seen_at timestamptz,
  rhythm_count bigint, session_started_at timestamptz, device_type text, os_name text,
  browser_name text, approx_location text, location_status text, exact_latitude double precision,
  exact_longitude double precision, exact_accuracy_m double precision, location_captured_at timestamptz,
  location_requested_at timestamptz, location_expires_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.admin_code_is_valid(p_code) then raise exception 'Invalid administrator code' using errcode = '42501'; end if;
  return query select p.id, p.nickname, p.created_at, mp.last_seen_at,
    (select count(*) from public.performances r where r.owner_id = p.id)::bigint,
    mp.session_started_at, mp.device_type, mp.os_name, mp.browser_name, mp.approx_location,
    case when lr.status = 'pending' and lr.expires_at <= now() then 'expired' else lr.status end,
    approved.latitude, approved.longitude, approved.accuracy_m, approved.captured_at, lr.requested_at, lr.expires_at
  from public.profiles p
  left join public.member_presence mp on mp.member_id = p.id
  left join lateral (select q.status, q.requested_at, q.expires_at from public.location_requests q where q.member_id = p.id order by q.requested_at desc limit 1) lr on true
  left join lateral (select q.latitude, q.longitude, q.accuracy_m, q.captured_at from public.location_requests q where q.member_id = p.id and q.status = 'approved' order by q.requested_at desc limit 1) approved on true
  order by p.nickname, p.id;
end;
$$;
revoke all on function public.admin_list_members(text) from public;
grant execute on function public.admin_list_members(text) to anon, authenticated;

commit;
