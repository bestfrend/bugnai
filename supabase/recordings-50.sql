-- Existing projects: run in Supabase SQL Editor. Preserves every saved rhythm.
begin;
alter table public.performances drop constraint if exists performances_slot_check;
alter table public.performances add constraint performances_slot_check check (slot between 1 and 50);
alter table public.performances add column if not exists title text not null default ''
  check (title = btrim(title) and char_length(title) <= 60);
commit;
