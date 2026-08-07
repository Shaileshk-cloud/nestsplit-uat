-- NestSplit authenticated spaces. This migration is additive and leaves existing
-- PIN-era records intact; new application flows use auth.users as the identity.
create extension if not exists pgcrypto;

-- Some existing projects have not run the earlier PIN-era draft migration.
-- Create its tables here when absent so this migration is safe from a clean DB.
create table if not exists public.houses (
  id uuid primary key default gen_random_uuid(),
  public_id text unique not null,
  name text not null,
  pin_hash text,
  owner_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create table if not exists public.house_members (
  id uuid primary key default gen_random_uuid(),
  house_id uuid not null references public.houses(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  name text not null,
  mobile text,
  role text not null check (role in ('owner', 'member')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (house_id, mobile)
);
create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  house_id uuid not null references public.houses(id) on delete cascade,
  created_by uuid not null references public.house_members(id),
  paid_by uuid not null references public.house_members(id),
  title text not null,
  amount numeric(12,2) not null check (amount > 0),
  category text not null default 'Other',
  expense_date date not null default current_date,
  created_at timestamptz not null default now()
);
create table if not exists public.settlements (
  id uuid primary key default gen_random_uuid(),
  house_id uuid not null references public.houses(id) on delete cascade,
  from_member_id uuid not null references public.house_members(id),
  to_member_id uuid not null references public.house_members(id),
  amount numeric(12,2) not null check (amount > 0),
  settled_on date not null default current_date,
  created_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'NestSplit member',
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', 'NestSplit member'), new.raw_user_meta_data ->> 'avatar_url')
  on conflict (id) do nothing;
  return new;
end;
$$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();

-- Remove PIN-only requirements for future records while retaining historical fields.
alter table public.houses alter column pin_hash drop not null;
alter table public.house_members alter column mobile drop not null;
alter table public.house_members drop constraint if exists house_members_mobile_key;
alter table public.house_members add column if not exists profile_id uuid references public.profiles(id) on delete cascade;
alter table public.house_members add column if not exists joined_at timestamptz not null default now();
create unique index if not exists house_members_one_profile_per_house on public.house_members(house_id, profile_id) where profile_id is not null;

alter table public.houses add column if not exists house_code text;
alter table public.houses add column if not exists joining_enabled boolean not null default true;
alter table public.houses add column if not exists updated_at timestamptz not null default now();
create unique index if not exists houses_house_code_key on public.houses(house_code) where house_code is not null;

create or replace function public.nestsplit_house_code()
returns text language plpgsql volatile as $$
declare code text;
begin
  loop
    code := 'NX-' || upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 6));
    exit when not exists (select 1 from public.houses where house_code = code);
  end loop;
  return code;
end;
$$;

create table if not exists public.personal_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  transaction_kind text not null check (transaction_kind in ('income', 'expense')),
  amount numeric(12,2) not null check (amount > 0),
  category text not null default 'Other',
  description text not null,
  notes text,
  transaction_date date not null default current_date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists personal_transactions_user_date on public.personal_transactions(user_id, transaction_date desc);

create table if not exists public.personal_money_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  direction text not null check (direction in ('give', 'get')),
  person_name text not null,
  phone text,
  amount numeric(12,2) not null check (amount > 0),
  reason text not null,
  notes text,
  due_date date,
  status text not null default 'pending' check (status in ('pending', 'paid', 'received', 'cancelled')),
  completed_at timestamptz,
  linked_transaction_id uuid unique references public.personal_transactions(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((direction = 'give' and status <> 'received') or (direction = 'get' and status <> 'paid'))
);
create index if not exists personal_money_items_user_due on public.personal_money_items(user_id, status, due_date);

create table if not exists public.house_invites (
  id uuid primary key default gen_random_uuid(),
  house_id uuid not null references public.houses(id) on delete cascade,
  token text not null unique default encode(gen_random_bytes(24), 'hex'),
  created_by uuid not null references public.profiles(id),
  revoked_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null,
  title text not null,
  body text not null,
  target_type text,
  target_id uuid,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists notifications_user_unread on public.notifications(user_id, read_at, created_at desc);

create table if not exists public.notification_preferences (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  payment_reminders boolean not null default true,
  money_to_get_reminders boolean not null default true,
  house_activity boolean not null default true,
  spending_insights boolean not null default true,
  monthly_summary boolean not null default true,
  reminder_days_before integer[] not null default array[0,1],
  quiet_hours_start time,
  quiet_hours_end time,
  prompt_dismissed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

create or replace function public.is_house_member(target_house_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.house_members where house_id = target_house_id and profile_id = auth.uid() and active);
$$;
create or replace function public.is_house_owner(target_house_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.house_members where house_id = target_house_id and profile_id = auth.uid() and role = 'owner' and active);
$$;

create or replace function public.create_house_for_me(house_name text)
returns public.houses language plpgsql security definer set search_path = public as $$
declare created_house public.houses;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if trim(house_name) = '' then raise exception 'House name is required'; end if;
  insert into public.houses(public_id, name, owner_id, house_code) values ('legacy-' || gen_random_uuid(), trim(house_name), auth.uid(), public.nestsplit_house_code()) returning * into created_house;
  insert into public.house_members(house_id, profile_id, name, role, active) select created_house.id, id, display_name, 'owner', true from public.profiles where id = auth.uid();
  insert into public.house_invites(house_id, created_by) values (created_house.id, auth.uid());
  return created_house;
end;
$$;

create or replace function public.join_house_by_code(input_code text)
returns public.houses language plpgsql security definer set search_path = public as $$
declare selected_house public.houses;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  select * into selected_house from public.houses where house_code = upper(trim(input_code)) and joining_enabled;
  if selected_house.id is null then raise exception 'House not found or joining is disabled'; end if;
  insert into public.house_members(house_id, profile_id, name, role, active) select selected_house.id, id, display_name, 'member', true from public.profiles where id = auth.uid() on conflict (house_id, profile_id) where profile_id is not null do update set active = true;
  return selected_house;
end;
$$;

create or replace function public.join_house_by_invite(input_token text)
returns public.houses language plpgsql security definer set search_path = public as $$
declare selected_house public.houses;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  select h.* into selected_house from public.house_invites i join public.houses h on h.id = i.house_id where i.token = input_token and i.revoked_at is null and (i.expires_at is null or i.expires_at > now()) and h.joining_enabled;
  if selected_house.id is null then raise exception 'This invite is no longer available'; end if;
  return public.join_house_by_code(selected_house.house_code);
end;
$$;

-- Atomic and idempotent: the row is locked and the unique linked transaction
-- prevents a second click from producing another expense/income.
create or replace function public.complete_personal_money_item(item_id uuid)
returns public.personal_money_items language plpgsql security definer set search_path = public as $$
declare item public.personal_money_items; created_transaction uuid;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  select * into item from public.personal_money_items where id = item_id and user_id = auth.uid() for update;
  if item.id is null then raise exception 'Money item not found'; end if;
  if item.linked_transaction_id is not null then return item; end if;
  if item.status <> 'pending' then raise exception 'Only pending money items can be completed'; end if;
  insert into public.personal_transactions(user_id, transaction_kind, amount, category, description, notes, transaction_date)
  values (auth.uid(), case when item.direction = 'give' then 'expense' else 'income' end, item.amount, 'Money reminder', item.reason || ' — ' || item.person_name, item.notes, current_date)
  returning id into created_transaction;
  update public.personal_money_items set status = case when item.direction = 'give' then 'paid' else 'received' end, completed_at = now(), linked_transaction_id = created_transaction, updated_at = now() where id = item.id returning * into item;
  return item;
end;
$$;

alter table public.profiles enable row level security;
alter table public.personal_transactions enable row level security;
alter table public.personal_money_items enable row level security;
alter table public.house_invites enable row level security;
alter table public.notifications enable row level security;
alter table public.notification_preferences enable row level security;
alter table public.push_subscriptions enable row level security;

drop policy if exists profiles_self on public.profiles;
create policy profiles_self on public.profiles for all using (id = auth.uid()) with check (id = auth.uid());
drop policy if exists personal_transactions_self on public.personal_transactions;
create policy personal_transactions_self on public.personal_transactions for all using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists personal_money_items_self on public.personal_money_items;
create policy personal_money_items_self on public.personal_money_items for all using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists notifications_self on public.notifications;
create policy notifications_self on public.notifications for all using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists notification_preferences_self on public.notification_preferences;
create policy notification_preferences_self on public.notification_preferences for all using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists push_subscriptions_self on public.push_subscriptions;
create policy push_subscriptions_self on public.push_subscriptions for all using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists houses_members_select on public.houses;
create policy houses_members_select on public.houses for select using (public.is_house_member(id));
drop policy if exists house_members_members_select on public.house_members;
create policy house_members_members_select on public.house_members for select using (public.is_house_member(house_id));
drop policy if exists house_invites_owners on public.house_invites;
create policy house_invites_owners on public.house_invites for all using (public.is_house_owner(house_id)) with check (public.is_house_owner(house_id));
drop policy if exists expenses_members_access on public.expenses;
create policy expenses_members_access on public.expenses for all using (public.is_house_member(house_id)) with check (public.is_house_member(house_id));
drop policy if exists settlements_members_access on public.settlements;
create policy settlements_members_access on public.settlements for all using (public.is_house_member(house_id)) with check (public.is_house_member(house_id));
