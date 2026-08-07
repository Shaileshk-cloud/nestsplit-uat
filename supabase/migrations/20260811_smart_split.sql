-- =============================================================================
-- Phase 1: Smart Split
-- Adds add_house_expense_v2, which supports Equal / Exact / Percentage / Shares
-- splitting modes with full server-side validation.
--
-- The original add_house_expense is LEFT INTACT so existing data and any
-- legacy callers continue to work.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- add_house_expense_v2
--
-- Parameters (exact names — PostgREST matches by name):
--   input_house_id   uuid          — which house the expense belongs to
--   input_title      text          — description / title
--   input_amount     numeric       — total expense amount (must be > 0)
--   input_category   text          — category string
--   input_date       date          — expense date (defaults to today if null)
--   input_paid_by    uuid          — house_members.id of the payer
--   input_split_method text        — 'equal' | 'exact' | 'percentage' | 'shares'
--   participant_ids  uuid[]        — member IDs to split between (must be non-empty)
--   split_values     numeric[]     — parallel array: amounts/pct/shares per participant
--                                    (ignored for split_method = 'equal')
--
-- Validation:
--   • auth.uid() must be an active member of input_house_id
--   • input_paid_by must be an active member of input_house_id
--   • every participant_ids entry must be an active member of the same house
--   • no duplicate participant_ids
--   • participant_ids must not be empty
--   • input_amount > 0
--   • every derived split amount >= 0
--   • final allocated total (in paise) must exactly equal input_amount (in paise)
--   • For 'exact':      sum(split_values) = input_amount
--   • For 'percentage': sum(split_values) = 100  (tolerance ±0.01)
--   • For 'shares':     all split_values >= 0, at least one > 0
--   • For 'equal':      split_values is ignored; equal amounts computed internally
--
-- Atomicity: expense row + all expense_splits rows are inserted in one
-- transaction; any failure rolls back everything.
-- ---------------------------------------------------------------------------

create or replace function public.add_house_expense_v2(
  input_house_id   uuid,
  input_title      text,
  input_amount     numeric,
  input_category   text,
  input_date       date,
  input_paid_by    uuid,
  input_split_method text,
  participant_ids  uuid[],
  split_values     numeric[] default null
) returns public.expenses
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_caller_member_id  uuid;
  v_expense           public.expenses;
  v_n                 int;
  v_amount_paise      bigint;   -- input_amount expressed in integer paise
  v_allocated_paise   bigint;   -- running sum for rounding reconciliation
  v_share_paise       bigint;   -- per-member equal share in paise
  v_remainder_paise   bigint;   -- leftover paise added to last member
  v_pct_sum           numeric;
  v_share_sum         numeric;
  v_split_amounts     numeric[];  -- final monetary amounts parallel to participant_ids
  i                   int;
begin
  -- ── Authentication ──────────────────────────────────────────────────────
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  -- ── Membership: caller ──────────────────────────────────────────────────
  select id into v_caller_member_id
  from public.house_members
  where house_id = input_house_id
    and profile_id = auth.uid()
    and active;

  if v_caller_member_id is null then
    raise exception 'Not a house member';
  end if;

  -- ── Basic input validation ───────────────────────────────────────────────
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
    where id = input_paid_by
      and house_id = input_house_id
      and active
  ) then
    raise exception 'Payer is not an active member of this house';
  end if;

  -- ── Participants validation ──────────────────────────────────────────────
  v_n := coalesce(array_length(participant_ids, 1), 0);

  if v_n = 0 then
    raise exception 'At least one participant is required';
  end if;

  -- Each participant must be active member of this house
  if exists (
    select 1
    from unnest(participant_ids) as pid
    where not exists (
      select 1 from public.house_members
      where id = pid
        and house_id = input_house_id
        and active
    )
  ) then
    raise exception 'One or more participants are not active members of this house';
  end if;

  -- No duplicate participants
  if (select count(*) from (select distinct pid from unnest(participant_ids) as pid) t) <> v_n then
    raise exception 'Duplicate participants are not allowed';
  end if;

  -- ── Compute final split_amounts[] in currency units ─────────────────────
  -- All monetary rounding uses integer paise (1 INR = 100 paise) to avoid
  -- floating-point drift. The last participant absorbs any rounding remainder
  -- so the total always exactly equals input_amount.

  v_amount_paise := round(input_amount * 100)::bigint;
  v_split_amounts := array_fill(0::numeric, array[v_n]);

  if input_split_method = 'equal' then
    -- Equal: distribute evenly; last member absorbs paise remainder
    v_share_paise := v_amount_paise / v_n;          -- integer division
    v_remainder_paise := v_amount_paise - (v_share_paise * v_n);

    for i in 1..v_n loop
      if i < v_n then
        v_split_amounts[i] := v_share_paise::numeric / 100;
      else
        v_split_amounts[i] := (v_share_paise + v_remainder_paise)::numeric / 100;
      end if;
    end loop;

  elsif input_split_method = 'exact' then
    -- Exact: split_values are already monetary amounts; validate sum = input_amount
    if coalesce(array_length(split_values, 1), 0) <> v_n then
      raise exception 'split_values length must match participant_ids length for exact split';
    end if;

    -- Validate no negative amounts
    if exists (select 1 from unnest(split_values) as sv where sv < 0) then
      raise exception 'Split amounts cannot be negative';
    end if;

    -- Validate total matches (compare in paise to avoid float drift)
    if round(input_amount * 100)::bigint <>
       (select sum(round(sv * 100)::bigint) from unnest(split_values) as sv) then
      raise exception 'Exact split amounts must sum to the total expense amount';
    end if;

    v_split_amounts := split_values;

  elsif input_split_method = 'percentage' then
    -- Percentage: split_values are percentages; must sum to 100
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

    -- Convert percentages to paise amounts; last participant absorbs remainder
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
    -- Shares: split_values are unitless weights; at least one must be > 0
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

    -- Convert shares to paise amounts; last participant absorbs remainder
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

  -- ── Final safety check: allocated total must exactly equal input_amount ──
  -- This should never fire given the logic above, but is a hard guard.
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

  -- Insert splits; the parallel arrays share the same index
  for i in 1..v_n loop
    insert into public.expense_splits(expense_id, member_id, amount)
    values (v_expense.id, participant_ids[i], v_split_amounts[i]);
  end loop;

  return v_expense;
end;
$$;

-- Grant execute to authenticated role (RLS + auth.uid() guard inside the fn)
grant execute on function public.add_house_expense_v2(
  uuid, text, numeric, text, date, uuid, text, uuid[], numeric[]
) to authenticated;
