-- Run this once in the Supabase SQL editor (free project).

create table if not exists public.tracker (
  id text primary key,
  progress jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.tracker enable row level security;

grant select, insert, update on public.tracker to anon, authenticated;

drop policy if exists "tracker read" on public.tracker;
create policy "tracker read"
  on public.tracker
  for select
  to anon, authenticated
  using (true);

drop policy if exists "tracker insert" on public.tracker;
create policy "tracker insert"
  on public.tracker
  for insert
  to anon, authenticated
  with check (true);

drop policy if exists "tracker update" on public.tracker;
create policy "tracker update"
  on public.tracker
  for update
  to anon, authenticated
  using (true)
  with check (true);
