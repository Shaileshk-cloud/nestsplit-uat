-- NestSplit production data model. Run in the Supabase SQL editor before
-- replacing the local session adapter with the authenticated Supabase adapter.
create extension if not exists pgcrypto;

create table if not exists public.houses (
  id uuid primary key default gen_random_uuid(),
  public_id text unique not null,
  name text not null,
  pin_hash text not null,
  owner_id uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);
create table if not exists public.house_members (
  id uuid primary key default gen_random_uuid(),
  house_id uuid not null references public.houses(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  name text not null,
  mobile text not null unique,
  role text not null check (role in ('owner','member')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (house_id, mobile)
);
create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  house_id uuid not null references public.houses(id) on delete cascade,
  created_by uuid not null references public.house_members(id),
  paid_by uuid not null references public.house_members(id),
  title text not null, amount numeric(12,2) not null check (amount > 0),
  category text not null default 'Other', expense_date date not null default current_date,
  created_at timestamptz not null default now()
);
create table if not exists public.settlements (
  id uuid primary key default gen_random_uuid(), house_id uuid not null references public.houses(id) on delete cascade,
  from_member_id uuid not null references public.house_members(id), to_member_id uuid not null references public.house_members(id),
  amount numeric(12,2) not null check (amount > 0), settled_on date not null default current_date, created_at timestamptz not null default now()
);
alter table public.houses enable row level security; alter table public.house_members enable row level security;
alter table public.expenses enable row level security; alter table public.settlements enable row level security;
-- Use SECURITY DEFINER RPCs for registration, member login, and PIN comparison;
-- never expose pin_hash or use a client-side service role key.
