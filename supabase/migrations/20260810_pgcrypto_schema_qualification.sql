-- Supabase installs pgcrypto in the `extensions` schema. The existing
-- SECURITY DEFINER functions intentionally use `search_path = public`, so
-- unqualified pgcrypto calls cannot be resolved at runtime.
create extension if not exists pgcrypto with schema extensions;

-- House codes are created inside create_house_for_me(), so this function must
-- resolve the random-byte generator without relying on the caller search path.
create or replace function public.nestsplit_house_code()
returns text language plpgsql volatile as $$
declare code text;
begin
  loop
    code := 'NX-' || upper(substr(pg_catalog.encode(extensions.gen_random_bytes(6), 'hex'), 1, 6));
    exit when not exists (select 1 from public.houses where house_code = code);
  end loop;
  return code;
end;
$$;

-- Keep invite tokens cryptographically secure and make the extension lookup
-- explicit for both existing and newly-created House invite rows.
alter table public.house_invites
  alter column token set default pg_catalog.encode(extensions.gen_random_bytes(24), 'hex');

-- pg_catalog.gen_random_uuid() is the built-in secure UUID generator on the
-- PostgreSQL versions used by Supabase. Explicit qualification avoids any
-- dependency on the SECURITY DEFINER search_path.
create or replace function public.create_house_for_me(house_name text)
returns public.houses language plpgsql security definer set search_path = public as $$
declare created_house public.houses;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if trim(house_name) = '' then raise exception 'House name is required'; end if;

  insert into public.houses(public_id, name, owner_id, house_code)
  values ('legacy-' || pg_catalog.gen_random_uuid(), trim(house_name), auth.uid(), public.nestsplit_house_code())
  returning * into created_house;

  insert into public.house_members(house_id, profile_id, name, role, active)
  select created_house.id, id, display_name, 'owner', true
  from public.profiles
  where id = auth.uid();

  insert into public.house_invites(house_id, created_by)
  values (created_house.id, auth.uid());

  return created_house;
end;
$$;
