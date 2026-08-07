-- Completes the authenticated House UI contract. Run this after the two
-- authenticated-space migrations already applied to Supabase.
create or replace function public.add_house_expense(
  input_house_id uuid,
  input_title text,
  input_amount numeric,
  input_category text,
  input_date date,
  participant_ids uuid[] default null,
  input_paid_by uuid default null
) returns public.expenses language plpgsql security definer set search_path = public as $$
declare payer_member uuid; result public.expenses; selected_members uuid[]; share numeric;
begin
  if auth.uid() is null or not public.is_house_member(input_house_id) then raise exception 'Not a house member'; end if;
  if trim(input_title) = '' or input_amount <= 0 then raise exception 'A title and positive amount are required'; end if;
  select coalesce(input_paid_by, id) into payer_member from public.house_members where house_id = input_house_id and profile_id = auth.uid() and active;
  if input_paid_by is not null and not exists(select 1 from public.house_members where id = input_paid_by and house_id = input_house_id and active) then raise exception 'Invalid payer'; end if;
  selected_members := coalesce(participant_ids, array(select id from public.house_members where house_id = input_house_id and active));
  if coalesce(array_length(selected_members, 1), 0) = 0 then raise exception 'Choose at least one participant'; end if;
  if exists(select 1 from unnest(selected_members) selected_id where not exists(select 1 from public.house_members where id = selected_id and house_id = input_house_id and active)) then raise exception 'Invalid participant'; end if;
  insert into public.expenses(house_id, created_by, paid_by, title, amount, category, expense_date)
  values(input_house_id, (select id from public.house_members where house_id = input_house_id and profile_id = auth.uid() and active), payer_member, trim(input_title), input_amount, coalesce(nullif(trim(input_category), ''), 'Other'), coalesce(input_date, current_date)) returning * into result;
  share := round(input_amount / array_length(selected_members, 1), 2);
  insert into public.expense_splits(expense_id, member_id, amount)
  select result.id, selected_id, case when selected_id = selected_members[array_length(selected_members, 1)] then input_amount - share * (array_length(selected_members, 1) - 1) else share end from unnest(selected_members) selected_id;
  return result;
end;
$$;

create or replace function public.set_house_member_active(input_house_id uuid, input_member_id uuid, input_active boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_house_owner(input_house_id) then raise exception 'Only a house owner can manage members'; end if;
  if exists(select 1 from public.house_members where id = input_member_id and house_id = input_house_id and profile_id = auth.uid()) then raise exception 'Owners cannot remove themselves'; end if;
  update public.house_members set active = input_active where id = input_member_id and house_id = input_house_id;
  if not found then raise exception 'Member not found'; end if;
end;
$$;
