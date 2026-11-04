-- ============================================================================
-- GhostLens • Trava de máquina (HWID único por licença)
--
-- Rode este SQL no Supabase (SQL Editor do projeto mbelyevitfksmknlyhgr).
--
-- Regra nova:
--   • A primeira máquina que ativar a chave fica vinculada (target_hwid).
--   • Qualquer outra máquina é recusada com hwid_mismatch, mesmo em planos
--     PRO / AGENCY / MASTER. Compartilhar a chave em grupo não libera outra
--     máquina.
--   • Dispositivos que JÁ estavam autorizados antes desta regra continuam
--     funcionando; apenas novas máquinas são bloqueadas.
-- ============================================================================

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

  -- Migração: licenças antigas tinham apenas target_hwid. Ele passa a contar
  -- como o primeiro device para preservar o vínculo já existente.
  if v_lic.target_hwid is not null and not exists (
    select 1 from public.ghost_license_devices where license_id = v_lic.id
  ) then
    insert into public.ghost_license_devices (license_id, hwid)
    values (v_lic.id, upper(v_lic.target_hwid));
  end if;

  -- TRAVA NOVA: se a licença já tem um HWID vinculado, só aceita esse HWID
  -- ou um dispositivo que já estava autorizado antes desta regra.
  if v_lic.target_hwid is not null
     and upper(trim(v_lic.target_hwid)) <> v_hwid
     and not exists (
       select 1 from public.ghost_license_devices
       where license_id = v_lic.id and hwid = v_hwid
     ) then
    return jsonb_build_object(
      'success', false,
      'error', 'hwid_mismatch',
      'bound_hwid', v_lic.target_hwid
    );
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

  -- Compatibilidade: mantém o primeiro HWID também na licença.
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

-- Confirmação:
-- select key, email, plan, target_hwid, status, expires_at
-- from public.ghost_licenses
-- where email = 'anthony@ghostlens.ai';
