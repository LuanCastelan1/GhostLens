-- ============================================================================
-- GhostLens • Registro central de licenças
-- Rodar no SQL Editor do Supabase (project mbelyevitfksmknlyhgr)
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

-- RLS ligado e SEM policies públicas: apenas a service_role (usada pelas
-- funções serverless) consegue ler/gravar. O anon key não acessa nada.
alter table public.ghost_licenses enable row level security;

-- Vincula a licença ao primeiro HWID de forma atômica (evita corrida entre
-- duas ativações simultâneas da mesma chave).
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

-- As funções serverless usam a service_role; nenhum acesso anônimo à tabela.
grant select, insert, update on public.ghost_licenses to service_role;
