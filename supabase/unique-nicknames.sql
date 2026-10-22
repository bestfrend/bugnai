-- Run in Supabase SQL Editor after schema.sql. Safe to run again.
-- Existing profiles and recordings are preserved, including any old duplicate
-- names. Their names are reserved against further registrations until unused.
begin;

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
