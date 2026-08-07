-- Authenticated shared-expense primitives. This follows the already-applied
-- authenticated-spaces migration and does not alter historical expenses.
create table if not exists public.expense_splits (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null references public.expenses(id) on delete cascade,
  member_id uuid not null references public.house_members(id) on delete cascade,
  amount numeric(12,2) not null check (amount >= 0),
  created_at timestamptz not null default now(),
  unique(expense_id, member_id)
);
create index if not exists expense_splits_member on public.expense_splits(member_id);
alter table public.expense_splits enable row level security;
drop policy if exists expense_splits_members_access on public.expense_splits;
create policy expense_splits_members_access on public.expense_splits for all
  using (exists(select 1 from public.expenses e where e.id = expense_id and public.is_house_member(e.house_id)))
  with check (exists(select 1 from public.expenses e where e.id = expense_id and public.is_house_member(e.house_id)));

create or replace function public.add_house_expense(
  input_house_id uuid,
  input_title text,
  input_amount numeric,
  input_category text,
  input_date date,
  participant_ids uuid[] default null
) returns public.expenses language plpgsql security definer set search_path = public as $$
declare payer_member uuid; result public.expenses; selected_members uuid[]; share numeric;
begin
  if auth.uid() is null or not public.is_house_member(input_house_id) then raise exception 'Not a house member'; end if;
  if trim(input_title) = '' or input_amount <= 0 then raise exception 'A title and positive amount are required'; end if;
  select id into payer_member from public.house_members where house_id = input_house_id and profile_id = auth.uid() and active;
  selected_members := coalesce(participant_ids, array(select id from public.house_members where house_id = input_house_id and active));
  if coalesce(array_length(selected_members, 1), 0) = 0 then raise exception 'Choose at least one participant'; end if;
  if exists(select 1 from unnest(selected_members) selected_id where not exists(select 1 from public.house_members where id = selected_id and house_id = input_house_id and active)) then raise exception 'Invalid participant'; end if;
  insert into public.expenses(house_id, created_by, paid_by, title, amount, category, expense_date)
  values(input_house_id, payer_member, payer_member, trim(input_title), input_amount, coalesce(nullif(trim(input_category), ''), 'Other'), coalesce(input_date, current_date)) returning * into result;
  share := round(input_amount / array_length(selected_members, 1), 2);
  insert into public.expense_splits(expense_id, member_id, amount)
  select result.id, selected_id, case when selected_id = selected_members[array_length(selected_members, 1)] then input_amount - share * (array_length(selected_members, 1) - 1) else share end from unnest(selected_members) selected_id;
  return result;
end;
$$;

create or replace function public.record_house_settlement(input_house_id uuid, recipient_member_id uuid, input_amount numeric, input_date date default current_date)
returns public.settlements language plpgsql security definer set search_path = public as $$
declare payer_member uuid; result public.settlements;
begin
  if auth.uid() is null or not public.is_house_member(input_house_id) then raise exception 'Not a house member'; end if;
  if input_amount <= 0 then raise exception 'Settlement amount must be positive'; end if;
  select id into payer_member from public.house_members where house_id = input_house_id and profile_id = auth.uid() and active;
  if not exists(select 1 from public.house_members where id = recipient_member_id and house_id = input_house_id and active) or payer_member = recipient_member_id then raise exception 'Invalid recipient'; end if;
  insert into public.settlements(house_id, from_member_id, to_member_id, amount, settled_on) values(input_house_id, payer_member, recipient_member_id, input_amount, coalesce(input_date, current_date)) returning * into result;
  return result;
end;
$$;

-- Idempotently creates in-app reminders. A scheduled job can call this daily for
-- all users; clients may call it only for their own current session.
create or replace function public.refresh_my_money_reminders()
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  insert into public.notifications(user_id, kind, title, body, target_type, target_id)
  select m.user_id, 'money_due',
    case when m.direction = 'give' then '₹' || trim(to_char(m.amount, 'FM999G999G999D00')) || ' due ' || case when m.due_date = current_date then 'today 💸' when m.due_date = current_date + 1 then 'tomorrow 💸' else 'soon 💸' end else '₹' || trim(to_char(m.amount, 'FM999G999G999D00')) || ' to collect 💰' end,
    case when m.direction = 'give' then 'You need to give ' || m.person_name || ' ₹' || trim(to_char(m.amount, 'FM999G999G999D00')) || '.' else m.person_name || ' owes you ₹' || trim(to_char(m.amount, 'FM999G999G999D00')) || '.' end,
    'money_item', m.id
  from public.personal_money_items m
  where m.user_id = auth.uid() and m.status = 'pending' and m.due_date between current_date - 7 and current_date + 1
    and not exists(select 1 from public.notifications n where n.user_id = m.user_id and n.target_id = m.id and n.kind = 'money_due' and n.created_at::date = current_date);
end;
$$;
