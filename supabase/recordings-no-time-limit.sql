-- Run after piano-octaves.sql. Removes the two-minute cap for all instruments.
-- Preserves saved recordings, ownership rules and the 6000-note payload limit.
begin;

create or replace function public.valid_drum_events(notes jsonb, duration integer)
returns boolean language plpgsql immutable set search_path = '' as $$
declare
  note jsonb;
  note_time numeric;
  previous_time numeric := -1;
  note_end numeric := 0;
  piano boolean;
  is_piano boolean;
begin
  if notes is null or duration is null or duration < 0
     or jsonb_typeof(notes) <> 'array' then return false; end if;
  if jsonb_array_length(notes) < 1 or jsonb_array_length(notes) > 6000 then return false; end if;
  for note in select value from jsonb_array_elements(notes) loop
    if jsonb_typeof(note) <> 'object' then return false; end if;
    if jsonb_typeof(note->'key') is distinct from 'string'
       or jsonb_typeof(note->'time') is distinct from 'number' then return false; end if;
    is_piano := note->>'key' ~ '^((c|cs|d|ds|e|f|fs|g|gs|a|as|b)[2-6]|c7)$';
    if piano is null then piano := is_piano; end if;
    if piano <> is_piano then return false; end if;
    if not is_piano and note->>'key' not in ('w','a','s','d','j','k','l') then return false; end if;
    if (select count(*) from jsonb_object_keys(note)) not in (2, 3, 4)
       or (note - 'key' - 'time' - 'velocity' - 'length') <> '{}'::jsonb then return false; end if;
    if note ? 'velocity' then
      if jsonb_typeof(note->'velocity') is distinct from 'number' then return false; end if;
      note_time := (note->>'velocity')::numeric;
      if note_time <> trunc(note_time) or note_time < 1 or note_time > 127 then return false; end if;
    end if;
    note_time := (note->>'time')::numeric;
    if note_time <> trunc(note_time) or note_time < 0 or note_time > duration
       or note_time < previous_time then return false; end if;
    if previous_time = -1 and note_time <> 0 then return false; end if;
    if is_piano then
      if jsonb_typeof(note->'length') is distinct from 'number'
         or jsonb_typeof(note->'velocity') is distinct from 'number' then return false; end if;
      if (note->>'length')::numeric <> trunc((note->>'length')::numeric)
         or (note->>'length')::numeric < 0
         or note_time + (note->>'length')::numeric > duration then return false; end if;
      note_end := greatest(note_end, note_time + (note->>'length')::numeric);
    elsif note ? 'length' then return false;
    else note_end := note_time;
    end if;
    previous_time := note_time;
  end loop;
  return note_end = duration;
end;
$$;

commit;
