-- =============================================================================
-- 20260813 — Enterprise CRUD, member management, and security hardening
--
-- This migration bundles the review fixes that need SQL with the new
-- enterprise feature RPCs. Everything is idempotent (safe to re-run) and keeps
-- the existing architecture: all house writes go through SECURITY DEFINER RPCs
-- guarded by auth.uid() + active-membership; direct table writes are denied by
-- RLS. All money math is integer paise.
--
-- Sections:
--   1. Schema additions (house_members.removed_at, expenses.edited_at)
--   2. Finding #3 — lock expenses / settlements / expense_splits to SELECT-only
--   3. Finding #2 — a removed member cannot silently rejoin via code
--   4. Finding #4 — refresh_my_money_reminders is idempotent (no error on re-run)
--   5. House expense edit / delete RPCs
--   6. Member management RPCs (leave / rename / joining toggle)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Schema additions
-- -----------------------------------------------------------------------------
-- removed_at marks an owner-initiated removal so a rejoin-by-code cannot
-- silently reactivate the membership (see §3). A NULL value means "not removed"
-- (never joined-and-removed, or voluntarily left — which is reversible).
alter table public.house_members add column if not exists removed_at timestamptz;

-- edited_at is the light audit trail for expense edits (NULL = never edited).
alter table public.expenses add column if not exists edited_at timestamptz;

-- -----------------------------------------------------------------------------
-- 2. Finding #3 — RLS lockdown
--
-- expenses / settlements / expense_splits previously had `for all` policies, so
-- any active member could INSERT/UPDATE/DELETE directly and bypass the RPC
-- validation (paise reconciliation, payer/participant checks, permissions).
-- Replace them with SELECT-only policies. All writes continue through the
-- SECURITY DEFINER RPCs, which run as the function owner and bypass RLS.
--
-- RLS is already enabled on these tables (20260805); the statements below are
-- idempotent and re-assert it defensively.
-- -----------------------------------------------------------------------------
alter table public.expenses        enable row level security;
alter table public.settlements     enable row level security;
alter table public.expense_splits  enable row level security;

drop policy if exists expenses_members_access on public.expenses;
drop policy if exists expenses_members_select on public.expenses;
create policy expenses_members_select on public.expenses
  for select using (public.is_house_member(house_id));

drop policy if exists settlements_members_access on public.settlements;
drop policy if exists settlements_members_select on public.settlements;
create policy settlements_members_select on public.settlements
  for select using (public.is_house_member(house_id));

drop policy if exists expense_splits_members_access on public.expense_splits;
drop policy if exists expense_splits_members_select on public.expense_splits;
create policy expense_splits_members_select on public.expense_splits
  for select using (
    exists(select 1 from public.expenses e
           where e.id = expense_id and public.is_house_member(e.house_id))
  );

-- -----------------------------------------------------------------------------
-- 3. Finding #2 — removed members cannot silently rejoin
--
-- join_house_by_code previously did `on conflict ... do update set active = true`
-- unconditionally, so a member an owner had removed could re-add themselves just
-- by entering the code. Now: if a membership row exists and was removed by an
-- owner (removed_at is not null), reject with a clear message. Voluntary leavers
-- (removed_at is null, active = false) may still rejoin freely.
-- -----------------------------------------------------------------------------
create or replace function public.join_house_by_code(input_code text)
returns public.houses language plpgsql security definer set search_path = public as $$
declare selected_house public.houses; existing public.house_members;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  select * into selected_house from public.houses
    where house_code = upper(trim(input_code)) and joining_enabled;
  if selected_house.id is null then raise exception 'House not found or joining is disabled'; end if;

  select * into existing from public.house_members
    where house_id = selected_house.id and profile_id = auth.uid();
  if existing.id is not null and existing.removed_at is not null then
    raise exception 'You were removed from this house. Ask an owner to add you back.';
  end if;

  insert into public.house_members(house_id, profile_id, name, role, active)
    select selected_house.id, id, display_name, 'member', true
    from public.profiles where id = auth.uid()
  on conflict (house_id, profile_id) where profile_id is not null
    do update set active = true;
  return selected_house;
end;
$$;

-- Owner member management now stamps removed_at on removal and clears it on
-- re-add, so §3's rejoin guard has a signal to key off.
create or replace function public.set_house_member_active(input_house_id uuid, input_member_id uuid, input_active boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_house_owner(input_house_id) then raise exception 'Only a house owner can manage members'; end if;
  if exists(select 1 from public.house_members
            where id = input_member_id and house_id = input_house_id and profile_id = auth.uid())
  then raise exception 'Owners cannot remove themselves'; end if;
  update public.house_members
     set active = input_active,
         removed_at = case when input_active then null else now() end
   where id = input_member_id and house_id = input_house_id;
  if not found then raise exception 'Member not found'; end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- 4. Finding #4 — refresh_my_money_reminders idempotency
--
-- The notifications_no_dupe unique index (target_id, user_id, kind) means a
-- second call for a still-pending item would violate the constraint and throw.
-- Add `on conflict ... do nothing` so repeat calls (client-per-session or a
-- daily job) are safe no-ops.
-- -----------------------------------------------------------------------------
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
    and not exists(select 1 from public.notifications n where n.user_id = m.user_id and n.target_id = m.id and n.kind = 'money_due' and n.created_at::date = current_date)
  on conflict (target_id, user_id, kind) where target_id is not null do nothing;
end;
$$;

-- -----------------------------------------------------------------------------
-- 5. House expense edit / delete
--
-- Permission model: the expense CREATOR or any house OWNER may edit/delete.
-- update_house_expense_v2 mirrors add_house_expense_v2's validation exactly and
-- atomically replaces the expense_splits rows; delete_house_expense hard-deletes
-- (splits cascade) after a best-effort audit notification to participants.
-- -----------------------------------------------------------------------------
create or replace function public.update_house_expense_v2(
  input_expense_id   uuid,
  input_title        text,
  input_amount       numeric,
  input_category     text,
  input_date         date,
  input_paid_by      uuid,
  input_split_method text,
  participant_ids    uuid[],
  split_values       numeric[] default null
) returns public.expenses
  language plpgsql security definer set search_path = public
as $$
declare
  v_house_id          uuid;
  v_created_by        uuid;
  v_caller_member_id  uuid;
  v_expense           public.expenses;
  v_n                 int;
  v_amount_paise      bigint;
  v_allocated_paise   bigint;
  v_share_paise       bigint;
  v_remainder_paise   bigint;
  v_pct_sum           numeric;
  v_share_sum         numeric;
  v_split_amounts     numeric[];
  i                   int;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;

  -- Locate the expense and its house.
  select house_id, created_by into v_house_id, v_created_by
    from public.expenses where id = input_expense_id;
  if v_house_id is null then raise exception 'Expense not found'; end if;

  -- Caller must be an active member of that house.
  select id into v_caller_member_id
    from public.house_members
    where house_id = v_house_id and profile_id = auth.uid() and active;
  if v_caller_member_id is null then raise exception 'Not a house member'; end if;

  -- Only the creator or a house owner may edit.
  if v_caller_member_id <> v_created_by and not public.is_house_owner(v_house_id) then
    raise exception 'Only the expense creator or a house owner can edit this expense';
  end if;

  -- ── Input validation (mirrors add_house_expense_v2) ──────────────────────
  if trim(coalesce(input_title, '')) = '' then raise exception 'Expense title is required'; end if;
  if input_amount is null or input_amount <= 0 then raise exception 'Expense amount must be greater than zero'; end if;
  if input_split_method not in ('equal', 'exact', 'percentage', 'shares') then
    raise exception 'split_method must be equal, exact, percentage, or shares';
  end if;
  if not exists (select 1 from public.house_members
                 where id = input_paid_by and house_id = v_house_id and active) then
    raise exception 'Payer is not an active member of this house';
  end if;

  v_n := coalesce(array_length(participant_ids, 1), 0);
  if v_n = 0 then raise exception 'At least one participant is required'; end if;
  if exists (select 1 from unnest(participant_ids) as pid
             where not exists (select 1 from public.house_members
                               where id = pid and house_id = v_house_id and active)) then
    raise exception 'One or more participants are not active members of this house';
  end if;
  if (select count(*) from (select distinct pid from unnest(participant_ids) as pid) t) <> v_n then
    raise exception 'Duplicate participants are not allowed';
  end if;

  -- ── Compute split amounts in paise (last participant absorbs remainder) ──
  v_amount_paise := round(input_amount * 100)::bigint;
  v_split_amounts := array_fill(0::numeric, array[v_n]);

  if input_split_method = 'equal' then
    v_share_paise     := v_amount_paise / v_n;
    v_remainder_paise := v_amount_paise - (v_share_paise * v_n);
    for i in 1..v_n loop
      v_split_amounts[i] := case when i < v_n
        then v_share_paise::numeric / 100
        else (v_share_paise + v_remainder_paise)::numeric / 100 end;
    end loop;

  elsif input_split_method = 'exact' then
    if coalesce(array_length(split_values, 1), 0) <> v_n then
      raise exception 'split_values length must match participant_ids length for exact split';
    end if;
    if exists (select 1 from unnest(split_values) as sv where sv < 0) then
      raise exception 'Split amounts cannot be negative';
    end if;
    if round(input_amount * 100)::bigint <>
       (select sum(round(sv * 100)::bigint) from unnest(split_values) as sv) then
      raise exception 'Exact split amounts must sum to the total expense amount';
    end if;
    v_split_amounts := split_values;

  elsif input_split_method = 'percentage' then
    if coalesce(array_length(split_values, 1), 0) <> v_n then
      raise exception 'split_values length must match participant_ids length for percentage split';
    end if;
    if exists (select 1 from unnest(split_values) as sv where sv < 0) then
      raise exception 'Percentages cannot be negative';
    end if;
    select sum(sv) into v_pct_sum from unnest(split_values) as sv;
    if abs(v_pct_sum - 100) > 0.01 then
      raise exception 'Percentages must sum to 100 (got %)', round(v_pct_sum, 4);
    end if;
    v_allocated_paise := 0;
    for i in 1..v_n loop
      if i < v_n then
        v_split_amounts[i] := floor(v_amount_paise * split_values[i] / 100)::numeric / 100;
        v_allocated_paise  := v_allocated_paise + floor(v_amount_paise * split_values[i] / 100)::bigint;
      else
        v_split_amounts[i] := (v_amount_paise - v_allocated_paise)::numeric / 100;
      end if;
    end loop;

  elsif input_split_method = 'shares' then
    if coalesce(array_length(split_values, 1), 0) <> v_n then
      raise exception 'split_values length must match participant_ids length for shares split';
    end if;
    if exists (select 1 from unnest(split_values) as sv where sv < 0) then
      raise exception 'Share weights cannot be negative';
    end if;
    select sum(sv) into v_share_sum from unnest(split_values) as sv;
    if coalesce(v_share_sum, 0) <= 0 then
      raise exception 'At least one share weight must be greater than zero';
    end if;
    v_allocated_paise := 0;
    for i in 1..v_n loop
      if i < v_n then
        v_split_amounts[i] := floor(v_amount_paise * split_values[i] / v_share_sum)::numeric / 100;
        v_allocated_paise  := v_allocated_paise + floor(v_amount_paise * split_values[i] / v_share_sum)::bigint;
      else
        v_split_amounts[i] := (v_amount_paise - v_allocated_paise)::numeric / 100;
      end if;
    end loop;
  end if;

  if (select sum(round(sv * 100)::bigint) from unnest(v_split_amounts) as sv) <> v_amount_paise then
    raise exception 'Internal error: split amounts do not sum to expense total';
  end if;

  -- ── Apply the update atomically: expense row, then replace splits ────────
  update public.expenses
     set title = trim(input_title),
         amount = input_amount,
         category = coalesce(nullif(trim(coalesce(input_category, '')), ''), 'Other'),
         expense_date = coalesce(input_date, current_date),
         paid_by = input_paid_by,
         edited_at = now()
   where id = input_expense_id
   returning * into v_expense;

  delete from public.expense_splits where expense_id = input_expense_id;
  for i in 1..v_n loop
    insert into public.expense_splits(expense_id, member_id, amount)
    values (v_expense.id, participant_ids[i], v_split_amounts[i]);
  end loop;

  return v_expense;
end;
$$;

create or replace function public.delete_house_expense(input_expense_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_house_id     uuid;
  v_created_by   uuid;
  v_title        text;
  v_amount       numeric;
  v_caller       uuid;
  v_caller_name  text;
  rec            record;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;

  select house_id, created_by, title, amount
    into v_house_id, v_created_by, v_title, v_amount
    from public.expenses where id = input_expense_id;
  if v_house_id is null then raise exception 'Expense not found'; end if;

  select id, name into v_caller, v_caller_name
    from public.house_members
    where house_id = v_house_id and profile_id = auth.uid() and active;
  if v_caller is null then raise exception 'Not a house member'; end if;

  if v_caller <> v_created_by and not public.is_house_owner(v_house_id) then
    raise exception 'Only the expense creator or a house owner can delete this expense';
  end if;

  -- Best-effort audit notification to participants (never blocks the delete).
  begin
    for rec in
      select distinct hm.profile_id
      from public.expense_splits es
      join public.house_members hm on hm.id = es.member_id
      where es.expense_id = input_expense_id
        and hm.profile_id is not null
        and hm.profile_id <> auth.uid()
        and not exists (select 1 from public.notification_preferences p
                        where p.user_id = hm.profile_id and p.house_activity = false)
    loop
      insert into public.notifications(user_id, kind, title, body, target_type, target_id)
      values (rec.profile_id, 'house_expense_deleted', 'Expense removed',
              v_caller_name || ' deleted "' || v_title || '" (₹' ||
              trim(to_char(v_amount, 'FM999G999G999D00')) || ').',
              'house_expense', input_expense_id)
      on conflict (target_id, user_id, kind) do nothing;
    end loop;
  exception when others then
    raise warning 'delete_house_expense notify failed for %: %', input_expense_id, sqlerrm;
  end;

  delete from public.expenses where id = input_expense_id;  -- splits cascade
end;
$$;

-- -----------------------------------------------------------------------------
-- 6. Member management
-- -----------------------------------------------------------------------------
-- leave_house: the caller deactivates their own membership. removed_at stays
-- NULL (a voluntary leave is reversible via join-by-code). The last active
-- owner cannot leave — they must transfer ownership or manage members first.
create or replace function public.leave_house(input_house_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_member_id uuid; v_role text; v_active_owner_count int;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  select id, role into v_member_id, v_role
    from public.house_members
    where house_id = input_house_id and profile_id = auth.uid() and active;
  if v_member_id is null then raise exception 'You are not an active member of this house'; end if;

  if v_role = 'owner' then
    select count(*) into v_active_owner_count
      from public.house_members
      where house_id = input_house_id and role = 'owner' and active;
    if v_active_owner_count <= 1 then
      raise exception 'The last owner cannot leave. Transfer ownership or remove other members first.';
    end if;
  end if;

  update public.house_members
     set active = false, removed_at = null
   where id = v_member_id;
end;
$$;

-- rename_house / set_house_joining: owner-only house settings. No `houses`
-- UPDATE policy exists, so these definer RPCs are the only write path.
create or replace function public.rename_house(input_house_id uuid, new_name text)
returns public.houses language plpgsql security definer set search_path = public as $$
declare result public.houses;
begin
  if not public.is_house_owner(input_house_id) then raise exception 'Only a house owner can rename the house'; end if;
  if trim(coalesce(new_name, '')) = '' then raise exception 'House name is required'; end if;
  update public.houses set name = trim(new_name), updated_at = now()
    where id = input_house_id returning * into result;
  if result.id is null then raise exception 'House not found'; end if;
  return result;
end;
$$;

create or replace function public.set_house_joining(input_house_id uuid, input_enabled boolean)
returns public.houses language plpgsql security definer set search_path = public as $$
declare result public.houses;
begin
  if not public.is_house_owner(input_house_id) then raise exception 'Only a house owner can change joining settings'; end if;
  update public.houses set joining_enabled = input_enabled, updated_at = now()
    where id = input_house_id returning * into result;
  if result.id is null then raise exception 'House not found'; end if;
  return result;
end;
$$;

-- -----------------------------------------------------------------------------
-- Grants — RLS + auth.uid() guards inside each function do the real enforcement.
-- -----------------------------------------------------------------------------
grant execute on function public.update_house_expense_v2(uuid, text, numeric, text, date, uuid, text, uuid[], numeric[]) to authenticated;
grant execute on function public.delete_house_expense(uuid) to authenticated;
grant execute on function public.leave_house(uuid) to authenticated;
grant execute on function public.rename_house(uuid, text) to authenticated;
grant execute on function public.set_house_joining(uuid, boolean) to authenticated;
grant execute on function public.join_house_by_code(text) to authenticated;
grant execute on function public.set_house_member_active(uuid, uuid, boolean) to authenticated;
grant execute on function public.refresh_my_money_reminders() to authenticated;
