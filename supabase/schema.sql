-- Run once in the Supabase SQL Editor. Safe to re-run for this initial schema.
begin;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nickname text not null check (nickname = btrim(nickname) and char_length(nickname) between 1 and 24),
  created_at timestamptz not null default now()
);

-- Validate payloads in the database as well as the browser.
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

create table if not exists public.performances (
  owner_id uuid not null references public.profiles(id) on delete cascade,
  slot smallint not null check (slot between 1 and 50),
  events jsonb not null,
  duration_ms integer not null,
  updated_at timestamptz not null default now(),
  primary key (owner_id, slot),
  constraint valid_performance check (public.valid_drum_events(events, duration_ms))
);

create or replace function public.stamp_performance()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists stamp_performance on public.performances;
create trigger stamp_performance before insert or update on public.performances
for each row execute function public.stamp_performance();

alter table public.profiles enable row level security;
alter table public.performances enable row level security;

revoke all on public.profiles, public.performances from anon, authenticated;
grant select, insert on public.profiles to authenticated;
grant select, insert, update, delete on public.performances to authenticated;
revoke all on function public.valid_drum_events(jsonb, integer) from public;
grant execute on function public.valid_drum_events(jsonb, integer) to authenticated;
revoke all on function public.stamp_performance() from public;

-- Anonymous Auth users have the authenticated role, not the unauthenticated anon role.
drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated using (true);
drop policy if exists profiles_create_own on public.profiles;
create policy profiles_create_own on public.profiles for insert to authenticated
with check ((select auth.uid()) = id);

drop policy if exists performances_read on public.performances;
create policy performances_read on public.performances for select to authenticated using (true);
drop policy if exists performances_create_own on public.performances;
create policy performances_create_own on public.performances for insert to authenticated
with check ((select auth.uid()) = owner_id);
drop policy if exists performances_update_own on public.performances;
create policy performances_update_own on public.performances for update to authenticated
using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
drop policy if exists performances_delete_own on public.performances;
create policy performances_delete_own on public.performances for delete to authenticated
using ((select auth.uid()) = owner_id);

alter table public.profiles add column if not exists avatar_data text
  check (avatar_data is null or (
    octet_length(avatar_data) <= 32768
    and avatar_data ~ '^data:image/jpeg;base64,[A-Za-z0-9+/]+={0,2}$'
  ));
grant update (avatar_data) on public.profiles to authenticated;
drop policy if exists profiles_update_own_avatar on public.profiles;
create policy profiles_update_own_avatar on public.profiles for update to authenticated
using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

alter table public.performances drop constraint if exists performances_slot_check;
alter table public.performances add constraint performances_slot_check check (slot between 1 and 50);
alter table public.performances add column if not exists title text not null default ''
  check (title = btrim(title) and char_length(title) <= 60);

alter table public.performances add column if not exists created_at timestamptz;
alter table public.performances disable trigger stamp_performance;
update public.performances set created_at = updated_at where created_at is null;
alter table public.performances enable trigger stamp_performance;
alter table public.performances alter column created_at set default now();
alter table public.performances alter column created_at set not null;

create or replace function public.stamp_performance()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  if tg_op = 'INSERT' then
    new.created_at := now();
  else
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;

alter table public.performances add column if not exists kit text not null default 'classic-v1';
alter table public.performances drop constraint if exists performances_kit_check;
alter table public.performances add constraint performances_kit_check
  check (kit in ('classic-v1', 'virtuosity-v1', 'stage-v1', 'salamander-v1'));
alter table public.performances drop constraint if exists performances_piano_check;
alter table public.performances add constraint performances_piano_check check (
  (kit = 'salamander-v1') = (events->0->>'key' ~ '^((c|cs|d|ds|e|f|fs|g|gs|a|as|b)[2-6]|c7)$')
);

-- Reserve nicknames across all deployments of this project.

create or replace function public.profile_nickname_key(p_nickname text)
returns text language sql immutable strict set search_path = '' as $$
  select pg_catalog.lower(pg_catalog.btrim(pg_catalog.regexp_replace(p_nickname, '[[:space:]]+', ' ', 'g')));
$$;

create table if not exists public.profile_nickname_keys (
  nickname_key text primary key
);
alter table public.profile_nickname_keys enable row level security;
revoke all on public.profile_nickname_keys from public, anon, authenticated;

-- Prevent writes between reserving the existing names and enabling the trigger.
lock table public.profiles in share row exclusive mode;
insert into public.profile_nickname_keys(nickname_key)
select distinct public.profile_nickname_key(nickname) from public.profiles
on conflict do nothing;

create or replace function public.reserve_profile_nickname()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  old_key text;
  new_key text;
begin
  if TG_OP <> 'INSERT' then old_key := public.profile_nickname_key(OLD.nickname); end if;
  if TG_OP <> 'DELETE' then new_key := public.profile_nickname_key(NEW.nickname); end if;
  if TG_OP = 'UPDATE' and old_key = new_key then return NEW; end if;

  if TG_OP <> 'DELETE' then
    if new_key = '' then
      raise exception 'Nickname must not be blank' using errcode = '23514';
    end if;
    -- The primary key also arbitrates simultaneous attempts from different sites.
    insert into public.profile_nickname_keys(nickname_key) values (new_key)
    on conflict do nothing;
    if not found then
      raise exception 'Nickname is already taken' using errcode = '23505';
    end if;
  end if;

  if TG_OP <> 'INSERT' then
    -- Serialize releases too: two old duplicate accounts may be deleted together.
    perform 1 from public.profile_nickname_keys where nickname_key = old_key for update;
    delete from public.profile_nickname_keys k where k.nickname_key = old_key
      and not exists (select 1 from public.profiles p
        where public.profile_nickname_key(p.nickname) = old_key);
  end if;
  if TG_OP = 'DELETE' then return OLD; end if;
  return NEW;
end;
$$;
revoke all on function public.reserve_profile_nickname() from public, anon, authenticated;
drop trigger if exists profiles_reserve_nickname on public.profiles;
create trigger profiles_reserve_nickname
  after insert or update of nickname or delete on public.profiles
  for each row execute function public.reserve_profile_nickname();


commit;
