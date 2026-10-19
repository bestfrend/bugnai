-- Run once after piano-octaves.sql and recordings-no-time-limit.sql.
-- Adds the visual stage kit; it uses the fixed CC0 Virtuosity sound recordings.
begin;

alter table public.performances drop constraint if exists performances_kit_check;
alter table public.performances add constraint performances_kit_check
  check (kit in ('classic-v1', 'virtuosity-v1', 'stage-v1', 'salamander-v1'));

commit;
