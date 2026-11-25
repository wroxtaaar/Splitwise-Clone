-- Push notifications. Run this once in Supabase -> SQL Editor, AFTER setup.sql.
-- Then follow "Push notifications" in the README (Edge Function + two secrets).
--
-- How it works: when one of you adds, edits or deletes an expense or payment, a trigger tells the
-- "notify" Edge Function, which sends a push (through Firebase) to the other person's phones.

create extension if not exists pg_net;

-- Where the trigger sends its message. Filled in by the last statement in this file's instructions.
create table if not exists public.push_config (
  id     int primary key default 1 check (id = 1),
  url    text not null,
  secret text not null
);
alter table public.push_config enable row level security;   -- no policies: nobody but the database itself can read it
revoke all on public.push_config from anon, authenticated;

-- One row per phone that agreed to notifications.
create table if not exists public.push_tokens (
  token      text primary key,
  user_id    uuid not null,
  updated_at timestamptz not null default now()
);
alter table public.push_tokens enable row level security;   -- no policies: only the functions below can touch it
revoke all on public.push_tokens from anon, authenticated;

create or replace function public.register_push_token(t text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_allowed() then raise exception 'not allowed'; end if;
  insert into public.push_tokens (token, user_id) values (t, auth.uid())
  on conflict (token) do update set user_id = auth.uid(), updated_at = now();
end $$;

create or replace function public.unregister_push_token(t text) returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from public.push_tokens where token = t and user_id = auth.uid();
end $$;

revoke all on function public.register_push_token(text), public.unregister_push_token(text) from public, anon;
grant execute on function public.register_push_token(text), public.unregister_push_token(text) to authenticated;

-- Fires after every expense/payment change. Never blocks saving: any failure here is swallowed.
create or replace function public.notify_push() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  cfg  public.push_config;
  kind text;
begin
  if new.coll not in ('expenses', 'settlements') then return null; end if;
  if coalesce(new.data ->> 'imported', '') = 'true' then return null; end if;   -- imported history never notifies
  if tg_op = 'INSERT' then
    if not new.deleted then kind := 'added'; end if;
  elsif new.deleted and not old.deleted then
    kind := 'deleted';
  elsif not new.deleted and new.data is distinct from old.data then
    kind := 'edited';
  end if;
  if kind is null then return null; end if;

  select * into cfg from public.push_config where id = 1;
  if not found then return null; end if;

  begin
    perform net.http_post(
      url     := cfg.url,
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', cfg.secret),
      body    := jsonb_build_object('kind', kind, 'coll', new.coll, 'id', new.id, 'actor', auth.uid(),
                                    'data', new.data, 'old', case when tg_op = 'UPDATE' then old.data end)
    );
  exception when others then
    null;
  end;
  return null;
end $$;

drop trigger if exists records_push on public.records;
create trigger records_push after insert or update on public.records
  for each row execute function public.notify_push();
