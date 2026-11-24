-- Run this ONCE in Supabase: SQL Editor -> New query -> paste -> Run.
-- It is safe to run again later (for example to change the two emails).
--
-- 1. Replace the two example emails below with the emails of you and your father.
-- 2. Create both users first in Authentication -> Users -> Add user (tick "Auto Confirm User").

-- ---------------------------------------------------------------------------
-- Who is allowed in. Only these two emails can read or write the data.
-- ---------------------------------------------------------------------------
create table if not exists public.allowed_users (email text primary key);
delete from public.allowed_users;
insert into public.allowed_users (email) values
  ('you@example.com'),      -- <- your email
  ('papa@example.com');     -- <- your father's email

-- ---------------------------------------------------------------------------
-- The data. One row per person / group / expense / payment, stored as JSON.
-- Deleting is done by marking a row deleted so other devices learn about it.
-- ---------------------------------------------------------------------------
create table if not exists public.records (
  coll       text        not null,                         -- people | groups | expenses | settlements
  id         text        not null,
  data       jsonb       not null,
  updated_at bigint      not null default 0,               -- client clock in ms, newest wins
  deleted    boolean     not null default false,
  server_ts  timestamptz not null default clock_timestamp(),
  primary key (coll, id)
);
create index if not exists records_server_ts_idx on public.records (server_ts);

-- Keep the newest version of a record and stamp when the server last changed it.
create or replace function public.records_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'UPDATE' and new.updated_at <= old.updated_at then
    return null;                                           -- an older or identical copy: ignore it
  end if;
  new.server_ts := clock_timestamp();
  return new;
end;
$$;
drop trigger if exists records_guard on public.records;
create trigger records_guard before insert or update on public.records
  for each row execute function public.records_guard();

-- ---------------------------------------------------------------------------
-- Security (row level security)
-- ---------------------------------------------------------------------------
alter table public.allowed_users enable row level security;   -- no policies: not readable through the API
alter table public.records       enable row level security;

create or replace function public.is_allowed() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.allowed_users
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

drop policy if exists "allowed can read"   on public.records;
drop policy if exists "allowed can insert" on public.records;
drop policy if exists "allowed can update" on public.records;
create policy "allowed can read"   on public.records for select to authenticated using (public.is_allowed());
create policy "allowed can insert" on public.records for insert to authenticated with check (public.is_allowed());
create policy "allowed can update" on public.records for update to authenticated using (public.is_allowed()) with check (public.is_allowed());
-- No delete policy on purpose: nobody can wipe the table through the API.

revoke all on public.records from anon;
grant select, insert, update on public.records to authenticated;
