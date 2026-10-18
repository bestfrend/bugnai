-- Run after location-request-expiry.sql to distinguish in-app refusal from
-- the browser/OS denying location permission. Existing records are preserved.
begin;

alter table public.location_requests drop constraint if exists location_requests_status_check;
alter table public.location_requests add constraint location_requests_status_check
  check (status in ('pending', 'approved', 'declined', 'browser_denied', 'error', 'expired'));

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
  where id = p_request_id and member_id = (select auth.uid()) and status = 'pending' and expires_at > now();
  if not found then
    raise exception 'Location request is no longer active' using errcode = 'P0002';
  end if;
end;
$$;
revoke all on function public.member_respond_location_request(uuid, text, double precision, double precision, double precision) from public;
grant execute on function public.member_respond_location_request(uuid, text, double precision, double precision, double precision) to authenticated;

commit;
