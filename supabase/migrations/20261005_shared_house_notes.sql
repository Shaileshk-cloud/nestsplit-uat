-- One collaboratively editable note for each house.
create table if not exists public.house_shared_notes (
  house_id uuid primary key references public.houses(id) on delete cascade,
  content text not null default '',
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.house_shared_notes enable row level security;

drop policy if exists house_shared_notes_members_access on public.house_shared_notes;
create policy house_shared_notes_members_access
  on public.house_shared_notes
  for all
  using (public.is_house_member(house_id))
  with check (public.is_house_member(house_id) and updated_by = auth.uid());

-- Broadcast edits to the other members who currently have the note open.
do $$
begin
  alter publication supabase_realtime add table public.house_shared_notes;
exception
  when duplicate_object then null;
end;
$$;
