-- =============================================================================
-- House Expense Notifications
--
-- Adds:
--   1. Unique idempotency index on notifications to prevent duplicate rows
--      for the same (expense, recipient, kind) triple.
--   2. notify_house_expense_added() — internal helper called by
--      add_house_expense_v2 after splits are written.  It creates one
--      personalised notification per participant (excluding the creator),
--      using each participant's ACTUAL expense_splits.amount.
--   3. add_house_expense_v2 is replaced (same signature) with an appended
--      call to notify_house_expense_added at the very end.  The notification
--      step is wrapped in an exception block so a notification failure never
--      rolls back the expense itself.
--   4. mark_notifications_read(notification_ids uuid[]) — RPC called by the
--      frontend to bulk-mark notifications as read.
--
-- Nothing in this migration alters the notifications table structure or any
-- existing RLS policy.  All changes are additive.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Idempotency index
--    Prevents duplicate notifications for the same target+user+kind combo.
--    We use a partial index (where target_id is not null) because generic
--    reminders may not have a target_id.
-- ---------------------------------------------------------------------------
create unique index if not exists notifications_no_dupe
  on public.notifications(target_id, user_id, kind)
  where target_id is not null;

-- ---------------------------------------------------------------------------
-- 2. notify_house_expense_added
--    Called internally — NOT directly by clients (no GRANT needed).
--
--    Logic:
--      • Looks up the house name, creator's member name, and expense title/
--        amount from the rows that were just inserted.
--      • For every expense_splits row belonging to this expense where the
--        split member is NOT the creator member, finds the member's profile_id,
--        checks that notification_preferences.house_activity is true (or that
--        no preferences row exists — defaults to true), and inserts one
--        notification row.
--      • Uses ON CONFLICT DO NOTHING on the idempotency index so a retry
--        never produces duplicates.
--      • Respects house_activity preference; silently skips members who
--        opted out.
-- ---------------------------------------------------------------------------
create or replace function public.notify_house_expense_added(
  p_expense_id      uuid,
  p_creator_member_id uuid   -- house_members.id of the person who created the expense
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_house_id    uuid;
  v_house_name  text;
  v_creator_name text;
  v_title       text;
  v_amount      numeric;
  v_amount_fmt  text;
  v_share_fmt   text;
  rec           record;
begin
  -- Fetch expense context (house + creator name + title + amount)
  select
    e.house_id,
    h.name,
    hm.name,
    e.title,
    e.amount
  into v_house_id, v_house_name, v_creator_name, v_title, v_amount
  from public.expenses e
  join public.houses h on h.id = e.house_id
  join public.house_members hm on hm.id = p_creator_member_id
  where e.id = p_expense_id;

  if v_house_id is null then
    return;  -- expense not found; silently exit
  end if;

  -- Format total amount once
  v_amount_fmt := '₹' || trim(to_char(v_amount, 'FM999G999G999D00'));

  -- Iterate over participants who are NOT the creator
  for rec in
    select
      es.member_id,
      es.amount   as split_amount,
      hm.profile_id
    from public.expense_splits es
    join public.house_members hm on hm.id = es.member_id
    where es.expense_id = p_expense_id
      and es.member_id <> p_creator_member_id
      and hm.profile_id is not null  -- only members with an auth account
  loop
    -- Check notification preference (default true if no prefs row exists)
    if exists (
      select 1 from public.notification_preferences
      where user_id = rec.profile_id and house_activity = false
    ) then
      continue;  -- user opted out
    end if;

    v_share_fmt := '₹' || trim(to_char(rec.split_amount, 'FM999G999G999D00'));

    insert into public.notifications(
      user_id,
      kind,
      title,
      body,
      target_type,
      target_id
    ) values (
      rec.profile_id,
      'house_expense_added',
      v_house_name,
      v_creator_name || ' added ' || v_amount_fmt || ' for ' || v_title || '. Your share is ' || v_share_fmt || '.',
      'house_expense',
      p_expense_id
    )
    on conflict (target_id, user_id, kind) do nothing;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Replace add_house_expense_v2 — identical body, notification call appended
--    at the very end inside a BEGIN/EXCEPTION block so a notification failure
--    never rolls back the successfully written expense and splits.
-- ---------------------------------------------------------------------------
create or replace function public.add_house_expense_v2(
  input_house_id     uuid,
  input_title        text,
  input_amount       numeric,
  input_category     text,
  input_date         date,
  input_paid_by      uuid,
  input_split_method text,
  participant_ids    uuid[],
  split_values       numeric[] default null
) returns public.expenses
  language plpgsql
  security definer
  set search_path = public
as $$
declare
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
  -- ── Authentication ──────────────────────────────────────────────────────
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  -- ── Caller membership ───────────────────────────────────────────────────
  select id into v_caller_member_id
  from public.house_members
  where house_id = input_house_id
    and profile_id = auth.uid()
    and active;

  if v_caller_member_id is null then
    raise exception 'Not a house member';
  end if;

  -- ── Input validation ────────────────────────────────────────────────────
  if trim(coalesce(input_title, '')) = '' then
    raise exception 'Expense title is required';
  end if;
  if input_amount is null or input_amount <= 0 then
    raise exception 'Expense amount must be greater than zero';
  end if;
  if input_split_method not in ('equal', 'exact', 'percentage', 'shares') then
    raise exception 'split_method must be equal, exact, percentage, or shares';
  end if;

  -- ── Payer validation ────────────────────────────────────────────────────
  if not exists (
    select 1 from public.house_members
    where id = input_paid_by and house_id = input_house_id and active
  ) then
    raise exception 'Payer is not an active member of this house';
  end if;

  -- ── Participants validation ──────────────────────────────────────────────
  v_n := coalesce(array_length(participant_ids, 1), 0);
  if v_n = 0 then
    raise exception 'At least one participant is required';
  end if;
  if exists (
    select 1 from unnest(participant_ids) as pid
    where not exists (
      select 1 from public.house_members
      where id = pid and house_id = input_house_id and active
    )
  ) then
    raise exception 'One or more participants are not active members of this house';
  end if;
  if (select count(*) from (select distinct pid from unnest(participant_ids) as pid) t) <> v_n then
    raise exception 'Duplicate participants are not allowed';
  end if;

  -- ── Compute split amounts in paise ──────────────────────────────────────
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

  -- ── Final safety check ──────────────────────────────────────────────────
  if (select sum(round(sv * 100)::bigint) from unnest(v_split_amounts) as sv)
     <> v_amount_paise then
    raise exception 'Internal error: split amounts do not sum to expense total';
  end if;

  -- ── Atomically insert expense + splits ──────────────────────────────────
  insert into public.expenses(
    house_id, created_by, paid_by, title, amount, category, expense_date
  ) values (
    input_house_id,
    v_caller_member_id,
    input_paid_by,
    trim(input_title),
    input_amount,
    coalesce(nullif(trim(coalesce(input_category, '')), ''), 'Other'),
    coalesce(input_date, current_date)
  )
  returning * into v_expense;

  for i in 1..v_n loop
    insert into public.expense_splits(expense_id, member_id, amount)
    values (v_expense.id, participant_ids[i], v_split_amounts[i]);
  end loop;

  -- ── Notify other participants (best-effort — never rolls back expense) ───
  begin
    perform public.notify_house_expense_added(v_expense.id, v_caller_member_id);
  exception when others then
    -- Log to pg_log in development; silently continue in production.
    raise warning 'notify_house_expense_added failed for expense %: %', v_expense.id, sqlerrm;
  end;

  return v_expense;
end;
$$;

grant execute on function public.add_house_expense_v2(
  uuid, text, numeric, text, date, uuid, text, uuid[], numeric[]
) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. mark_notifications_read
--    Bulk-marks notifications as read.  Only marks rows owned by auth.uid()
--    so a user can never mark another user's notifications.
--    Passing an empty array marks ALL unread notifications for the caller.
-- ---------------------------------------------------------------------------
create or replace function public.mark_notifications_read(
  notification_ids uuid[] default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if notification_ids is null or array_length(notification_ids, 1) is null then
    -- Mark all unread
    update public.notifications
    set read_at = now()
    where user_id = auth.uid()
      and read_at is null;
  else
    -- Mark specific IDs (only those owned by caller)
    update public.notifications
    set read_at = now()
    where id = any(notification_ids)
      and user_id = auth.uid()
      and read_at is null;
  end if;
end;
$$;

grant execute on function public.mark_notifications_read(uuid[]) to authenticated;
