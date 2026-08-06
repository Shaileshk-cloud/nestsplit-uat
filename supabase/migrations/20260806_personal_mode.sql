-- Personal mode is deliberately independent from houses, expenses, and settlements.
-- Registration/login should be exposed through SECURITY DEFINER RPCs so PIN hashes
-- are never returned to the browser.
create table if not exists public.personal_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  name text not null,
  mobile text not null unique,
  pin_hash text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.personal_entries (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.personal_profiles(id) on delete cascade,
  title text not null,
  amount numeric(12,2) not null check (amount > 0),
  category text not null default 'Other',
  entry_kind text not null check (entry_kind in ('income', 'expense')),
  entry_date date not null default current_date,
  created_at timestamptz not null default now()
);

alter table public.personal_profiles enable row level security;
alter table public.personal_entries enable row level security;

-- Add policies/RPCs with the application's chosen authenticated identity provider.
-- Do not join personal_entries into household reports or balance calculations.
