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

commit;
