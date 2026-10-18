-- Run once in Supabase SQL Editor. No location history is deleted or exposed.
-- Public Realtime messages contain only {}, never IDs, coordinates or decisions.
begin;

do $$
begin
  if to_regprocedure('realtime.send(jsonb,text,text,boolean)') is null then
    raise exception 'Supabase Realtime Broadcast is unavailable in this project';
  end if;
end;
$$;

create or replace function public.notify_admin_location_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if TG_OP = 'UPDATE' and new is not distinct from old then return null; end if;
  perform realtime.send('{}'::jsonb, 'location_changed', 'admin-location-updates', false);
  return null;
exception when others then
  -- A notification outage must never prevent saving a consent response.
  raise warning 'Admin location notification failed: %', SQLSTATE;
  return null;
end;
$$;
revoke all on function public.notify_admin_location_change() from public, anon, authenticated;

drop trigger if exists admin_location_changed on public.location_requests;
create trigger admin_location_changed after insert or update or delete
  on public.location_requests for each row execute function public.notify_admin_location_change();

-- A short, already-consented acquisition may improve its first saved fix.
create or replace function public.member_refine_location_request(
  p_request_id uuid, p_latitude double precision, p_longitude double precision,
  p_accuracy_m double precision
)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null or p_latitude is null or p_latitude not between -90 and 90
    or p_longitude is null or p_longitude not between -180 and 180
    or p_accuracy_m is null or p_accuracy_m not between 0 and 100000 then
    raise exception 'Invalid coordinates' using errcode = '22023';
  end if;
  update public.location_requests set latitude = p_latitude, longitude = p_longitude,
    accuracy_m = p_accuracy_m, captured_at = now()
  where id = p_request_id and member_id = (select auth.uid()) and status = 'approved'
    and responded_at >= now() - interval '30 seconds' and p_accuracy_m < accuracy_m;
end;
$$;
revoke all on function public.member_refine_location_request(uuid, double precision, double precision, double precision) from public, anon;
grant execute on function public.member_refine_location_request(uuid, double precision, double precision, double precision) to authenticated;

commit;
