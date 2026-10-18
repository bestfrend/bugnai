-- Run after the previous location migrations. Removes automatic expiry and
-- preserves existing history, approvals and browser-permission refusal states.
begin;

alter table public.location_requests drop constraint if exists location_requests_status_check;
alter table public.location_requests add constraint location_requests_status_check
  check (status in ('pending', 'approved', 'declined', 'browser_denied', 'error', 'expired', 'cancelled'));
alter table public.location_requests add column if not exists browser_started_at timestamptz;

alter table public.location_requests alter column expires_at drop not null;
alter table public.location_requests alter column expires_at set default null;
update public.location_requests set expires_at = null where status = 'pending';

create or replace function public.member_pending_location_request()
returns table (id uuid, requested_at timestamptz, expires_at timestamptz)
language plpgsql security definer set search_path = '' as $$
begin
  return query select r.id, r.requested_at, r.expires_at from public.location_requests r
    where r.member_id = (select auth.uid()) and r.status = 'pending'
    order by r.requested_at desc limit 1;
end;
$$;
revoke all on function public.member_pending_location_request() from public;
grant execute on function public.member_pending_location_request() to authenticated;

create or replace function public.member_begin_location_request(p_request_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.location_requests set browser_started_at = coalesce(browser_started_at, now())
    where id = p_request_id and member_id = (select auth.uid()) and status = 'pending';
  if not found then raise exception 'Location request is no longer active' using errcode = 'P0002'; end if;
end;
$$;
revoke all on function public.member_begin_location_request(uuid) from public;
grant execute on function public.member_begin_location_request(uuid) to authenticated;

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
    and (status = 'pending' or (status = 'cancelled' and browser_started_at is not null));
  if not found then
    raise exception 'Location request is no longer active' using errcode = 'P0002';
  end if;
end;
$$;
revoke all on function public.member_respond_location_request(uuid, text, double precision, double precision, double precision) from public;
grant execute on function public.member_respond_location_request(uuid, text, double precision, double precision, double precision) to authenticated;

create or replace function public.admin_request_location(p_code text, p_member_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare request_id uuid;
begin
  if not public.admin_code_is_valid(p_code) then raise exception 'Invalid administrator code' using errcode = '42501'; end if;
  if not exists (select 1 from public.member_presence where member_id = p_member_id and last_seen_at > now() - interval '75 seconds') then
    raise exception 'Member is not currently connected' using errcode = 'P0002';
  end if;
  update public.location_requests set status = 'expired', responded_at = now() where member_id = p_member_id and status = 'pending';
  insert into public.location_requests (member_id, expires_at) values (p_member_id, null) returning id into request_id;
  return request_id;
end;
$$;
revoke all on function public.admin_request_location(text, uuid) from public;
grant execute on function public.admin_request_location(text, uuid) to anon, authenticated;

create or replace function public.admin_cancel_location_request(p_code text, p_member_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.admin_code_is_valid(p_code) then raise exception 'Invalid administrator code' using errcode = '42501'; end if;
  update public.location_requests set status = 'cancelled', responded_at = now()
    where member_id = p_member_id and status = 'pending';
  if not found then raise exception 'Location request is no longer active' using errcode = 'P0002'; end if;
end;
$$;
revoke all on function public.admin_cancel_location_request(text, uuid) from public;
grant execute on function public.admin_cancel_location_request(text, uuid) to anon, authenticated;

-- Show the most recently received approval, even if its request was sent earlier.
create or replace function public.admin_list_members(p_code text)
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
    lr.status, approved.latitude, approved.longitude, approved.accuracy_m, approved.captured_at,
    lr.requested_at, lr.expires_at
  from public.profiles p left join public.member_presence mp on mp.member_id = p.id
  left join lateral (select q.status, q.requested_at, q.expires_at from public.location_requests q
    where q.member_id = p.id order by q.requested_at desc, q.id desc limit 1) lr on true
  left join lateral (select q.latitude, q.longitude, q.accuracy_m, q.captured_at from public.location_requests q
    where q.member_id = p.id and q.status = 'approved'
    order by q.captured_at desc nulls last, q.requested_at desc, q.id desc limit 1) approved on true
  order by p.nickname, p.id;
end;
$$;
revoke all on function public.admin_list_members(text) from public;
grant execute on function public.admin_list_members(text) to anon, authenticated;

commit;
