-- Existing projects: run this additive migration in Supabase SQL Editor.
begin;
alter table public.profiles add column if not exists avatar_data text
  check (avatar_data is null or (
    octet_length(avatar_data) <= 32768
    and avatar_data ~ '^data:image/jpeg;base64,[A-Za-z0-9+/]+={0,2}$'
  ));
grant update (avatar_data) on public.profiles to authenticated;
drop policy if exists profiles_update_own_avatar on public.profiles;
create policy profiles_update_own_avatar on public.profiles for update to authenticated
using ((select auth.uid()) = id) with check ((select auth.uid()) = id);
commit;
