-- ============================================================================
-- GhostLens - Registro central de licencas
-- Rodar no SQL Editor do projeto ErosChat (mbelyevitfksmknlyhgr)
-- Idempotente: pode rodar mais de uma vez sem apagar dados.
-- ============================================================================

create extension if not exists pgcrypto;

create table if not exists public.ghost_licenses (
  id            uuid primary key default gen_random_uuid(),
  key           text not null unique,
  email         text not null,
  plan          text not null,
  code          text not null check (code in ('SOLO', 'PRO', 'AGENCY', 'MASTER')),
  max_devices   integer not null default 1 check (max_devices between 1 and 1000),
  provider      text not null check (provider in ('stripe', 'asaas', 'manual', 'admin')),
  payment_id    text unique,
  amount_brl    numeric(10, 2),
  target_hwid   text,
  status        text not null default 'active' check (status in ('active', 'revoked', 'expired')),
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null,
  bound_at      timestamptz
);

create index if not exists ghost_licenses_email_idx
  on public.ghost_licenses (lower(email));

create index if not exists ghost_licenses_status_idx
  on public.ghost_licenses (status);

create index if not exists ghost_licenses_hwid_idx
  on public.ghost_licenses (target_hwid);

alter table public.ghost_licenses enable row level security;

-- Vincula a licenca ao primeiro HWID de forma atomica.
create or replace function public.bind_ghost_license(p_key text, p_hwid text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.ghost_licenses%rowtype;
begin
  select * into v_row
  from public.ghost_licenses
  where key = upper(trim(p_key))
  for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'license_not_found');
  end if;

  if v_row.status <> 'active' then
    return jsonb_build_object('success', false, 'error', 'license_inactive');
  end if;

  if v_row.expires_at <= now() then
    return jsonb_build_object('success', false, 'error', 'license_expired');
  end if;

  if v_row.target_hwid is not null and v_row.target_hwid <> upper(trim(p_hwid)) then
    return jsonb_build_object(
      'success', false,
      'error', 'hwid_mismatch',
      'bound_hwid', v_row.target_hwid
    );
  end if;

  if v_row.target_hwid is null then
    update public.ghost_licenses
       set target_hwid = upper(trim(p_hwid)),
           bound_at = now()
     where id = v_row.id
     returning * into v_row;
  end if;

  return jsonb_build_object('success', true, 'license', to_jsonb(v_row));
end;
$$;

revoke all on function public.bind_ghost_license(text, text) from public, anon, authenticated;
grant execute on function public.bind_ghost_license(text, text) to service_role;
grant select, insert, update on public.ghost_licenses to service_role;

-- ============================================================================
-- Dispositivos por licenca (planos com mais de 1 device)
-- ============================================================================

create table if not exists public.ghost_license_devices (
  id            uuid primary key default gen_random_uuid(),
  license_id    uuid not null references public.ghost_licenses(id) on delete cascade,
  hwid          text not null,
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  revoked_at    timestamptz,
  unique (license_id, hwid)
);

create index if not exists ghost_license_devices_license_idx
  on public.ghost_license_devices (license_id)
  where revoked_at is null;

alter table public.ghost_license_devices enable row level security;
grant select, insert, update on public.ghost_license_devices to service_role;

-- Vincula (ou revalida) um HWID respeitando max_devices, de forma atomica.
create or replace function public.bind_ghost_license_device(p_key text, p_hwid text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lic public.ghost_licenses%rowtype;
  v_device public.ghost_license_devices%rowtype;
  v_hwid text := upper(trim(p_hwid));
  v_count int;
begin
  select * into v_lic
  from public.ghost_licenses
  where key = upper(trim(p_key))
  for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'license_not_found');
  end if;

  if v_lic.status <> 'active' then
    return jsonb_build_object('success', false, 'error', 'license_inactive');
  end if;

  if v_lic.expires_at <= now() then
    return jsonb_build_object('success', false, 'error', 'license_expired');
  end if;

  -- Migracao: licencas antigas tinham apenas target_hwid.
  if v_lic.target_hwid is not null and not exists (
    select 1 from public.ghost_license_devices where license_id = v_lic.id
  ) then
    insert into public.ghost_license_devices (license_id, hwid)
    values (v_lic.id, upper(v_lic.target_hwid));
  end if;

  select * into v_device
  from public.ghost_license_devices
  where license_id = v_lic.id and hwid = v_hwid;

  if found then
    if v_device.revoked_at is not null then
      return jsonb_build_object('success', false, 'error', 'device_revoked');
    end if;

    update public.ghost_license_devices
       set last_seen_at = now()
     where id = v_device.id;

    select count(*) into v_count
    from public.ghost_license_devices
    where license_id = v_lic.id and revoked_at is null;

    return jsonb_build_object(
      'success', true,
      'license', to_jsonb(v_lic),
      'device_count', v_count
    );
  end if;

  select count(*) into v_count
  from public.ghost_license_devices
  where license_id = v_lic.id and revoked_at is null;

  if v_count >= v_lic.max_devices then
    return jsonb_build_object(
      'success', false,
      'error', 'device_limit_reached',
      'max_devices', v_lic.max_devices
    );
  end if;

  insert into public.ghost_license_devices (license_id, hwid)
  values (v_lic.id, v_hwid);

  if v_lic.target_hwid is null then
    update public.ghost_licenses
       set target_hwid = v_hwid, bound_at = now()
     where id = v_lic.id
     returning * into v_lic;
  end if;

  return jsonb_build_object(
    'success', true,
    'license', to_jsonb(v_lic),
    'device_count', v_count + 1
  );
end;
$$;

revoke all on function public.bind_ghost_license_device(text, text) from public, anon, authenticated;
grant execute on function public.bind_ghost_license_device(text, text) to service_role;

-- ============================================================================
-- Rate limit compartilhado entre instancias serverless
-- ============================================================================

create table if not exists public.ghost_rate_limits (
  bucket        text primary key,
  window_start  timestamptz not null default now(),
  count         int not null default 0
);

alter table public.ghost_rate_limits enable row level security;
grant select, insert, update on public.ghost_rate_limits to service_role;

create or replace function public.check_rate_limit(
  p_bucket text,
  p_limit int,
  p_window_seconds int
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.ghost_rate_limits%rowtype;
begin
  insert into public.ghost_rate_limits (bucket, window_start, count)
  values (p_bucket, now(), 1)
  on conflict (bucket) do update
    set count = case
          when public.ghost_rate_limits.window_start < now() - make_interval(secs => p_window_seconds)
            then 1
          else public.ghost_rate_limits.count + 1
        end,
        window_start = case
          when public.ghost_rate_limits.window_start < now() - make_interval(secs => p_window_seconds)
            then now()
          else public.ghost_rate_limits.window_start
        end
  returning * into v_row;

  return jsonb_build_object(
    'allowed', v_row.count <= p_limit,
    'count', v_row.count,
    'limit', p_limit,
    'reset_at', extract(epoch from v_row.window_start + make_interval(secs => p_window_seconds))
  );
end;
$$;

revoke all on function public.check_rate_limit(text, int, int) from public, anon, authenticated;
grant execute on function public.check_rate_limit(text, int, int) to service_role;
