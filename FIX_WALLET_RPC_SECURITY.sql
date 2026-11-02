-- ============================================================================
-- CORREÇÃO CRÍTICA DE AUTORIZAÇÃO - FUNÇÕES DE CARTEIRA/VIP
-- Rodar no SQL Editor do projeto ErosChat (mbelyevitfksmknlyhgr)
--
-- Falhas corrigidas:
-- 1. debit_ghost_wallet aceitava p_user_id de qualquer chamador (inclusive anon)
--    e debitava a carteira de outro usuário.
-- 2. credit_ghost_wallet estava executável por anon/authenticated -> crédito
--    grátis para qualquer e-mail.
-- 3. set_musas_fans estava executável por anon/authenticated -> VIP grátis.
-- ============================================================================

-- 1. débito: só service_role pode informar p_user_id; usuário comum usa auth.uid()
create or replace function public.debit_ghost_wallet(
  p_amount numeric,
  p_description text default 'Processamento de Mídia GhostLens',
  p_user_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_current_balance numeric;
  v_new_balance numeric;
begin
  -- Impede que um cliente escolha a carteira de outra pessoa.
  if p_user_id is not null and coalesce(auth.role(), '') <> 'service_role' then
    return jsonb_build_object('success', false, 'error', 'forbidden');
  end if;

  v_user_id := coalesce(p_user_id, auth.uid());

  if v_user_id is null then
    return jsonb_build_object('success', false, 'error', 'nao_autenticado');
  end if;

  select balance into v_current_balance
  from public.ghost_wallets
  where user_id = v_user_id
  for update;

  if v_current_balance is null or v_current_balance < p_amount then
    return jsonb_build_object(
      'success', false,
      'error', 'saldo_insuficiente',
      'current_balance', coalesce(v_current_balance, 0)
    );
  end if;

  v_new_balance := v_current_balance - p_amount;

  update public.ghost_wallets
     set balance = v_new_balance,
         updated_at = now()
   where user_id = v_user_id;

  insert into public.ghost_transactions (user_id, amount, type, description, status)
  values (v_user_id, -p_amount, 'debit', p_description, 'completed');

  return jsonb_build_object(
    'success', true,
    'new_balance', v_new_balance,
    'debited', p_amount
  );
end;
$$;

revoke all on function public.debit_ghost_wallet(numeric, text, uuid) from public, anon;
grant execute on function public.debit_ghost_wallet(numeric, text, uuid) to authenticated, service_role;

-- 2 e 3. crédito/VIP: apenas webhooks (service_role).
-- O bloco cobre qualquer assinatura/overload existente.
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('credit_ghost_wallet', 'set_musas_fans')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    execute format('grant execute on function %s to service_role', r.sig);
  end loop;
end
$$;

-- Conferência: estas consultas devem mostrar service_role nas funções de
-- crédito/VIP e authenticated + service_role no débito.
select
  p.proname,
  pg_get_function_identity_arguments(p.oid) as args,
  p.proacl
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('debit_ghost_wallet', 'credit_ghost_wallet', 'set_musas_fans', 'credit_real_eros', 'set_vip');
