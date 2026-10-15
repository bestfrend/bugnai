-- Add the versioned kit and optional strike velocity without changing old rhythms.
begin;
alter table public.performances add column if not exists kit text not null default 'classic-v1'
  check (kit in ('classic-v1', 'virtuosity-v1'));

create or replace function public.valid_drum_events(notes jsonb, duration integer)
returns boolean language plpgsql immutable set search_path = '' as $$
declare
  note jsonb;
  note_time numeric;
  previous_time numeric := -1;
begin
  if notes is null or duration is null or duration < 0 or duration > 120000
     or jsonb_typeof(notes) <> 'array' then return false; end if;
  if jsonb_array_length(notes) < 1 or jsonb_array_length(notes) > 6000 then return false; end if;
  for note in select value from jsonb_array_elements(notes) loop
    if jsonb_typeof(note) <> 'object' then return false; end if;
    if jsonb_typeof(note->'key') is distinct from 'string'
       or jsonb_typeof(note->'time') is distinct from 'number' then return false; end if;
    if note->>'key' not in ('w','a','s','d','j','k','l') then return false; end if;
    if (select count(*) from jsonb_object_keys(note)) not in (2, 3)
       or (note - 'key' - 'time' - 'velocity') <> '{}'::jsonb then return false; end if;
    if note ? 'velocity' then
      if jsonb_typeof(note->'velocity') is distinct from 'number' then return false; end if;
      note_time := (note->>'velocity')::numeric;
      if note_time <> trunc(note_time) or note_time < 1 or note_time > 127 then return false; end if;
    end if;
    note_time := (note->>'time')::numeric;
    if note_time <> trunc(note_time) or note_time < 0 or note_time > 120000
       or note_time < previous_time then return false; end if;
    if previous_time = -1 and note_time <> 0 then return false; end if;
    previous_time := note_time;
  end loop;
  return previous_time = duration;
end;
$$;
commit;
