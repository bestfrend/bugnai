-- Preserve existing rhythms; their original creation time was not stored.
begin;
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
commit;
