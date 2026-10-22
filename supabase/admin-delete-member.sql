-- Run after member-insights.sql in Supabase SQL Editor.
-- Adds administrator-only account deletion without changing location functions.
begin;

create or replace function public.admin_delete_member(p_code text, p_member_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.admin_code_is_valid(p_code) then
    raise exception 'Invalid administrator code' using errcode = '42501';
  end if;
  -- Foreign-key cascades remove the profile (including avatar), recordings,
  -- presence and location history in the same transaction as the auth account.
  delete from auth.users u where u.id = p_member_id
    and exists (select 1 from public.profiles p where p.id = u.id);
  if not found then
    raise exception 'Member no longer exists' using errcode = 'P0002';
  end if;
end;
$$;
revoke all on function public.admin_delete_member(text, uuid) from public;
grant execute on function public.admin_delete_member(text, uuid) to anon, authenticated;

commit;
