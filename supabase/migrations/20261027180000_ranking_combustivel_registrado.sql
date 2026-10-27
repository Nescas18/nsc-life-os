-- NESC · ranking: combustível conta só quando registrado (mesma regra nova do app)
-- O app deixou de somar a estimativa por km ao lucro operacional (ela podia duplicar o combustível de um
-- abastecimento registrado em outro dia do período). A estimativa agora é só informativa no app.
-- Reversão: reaplicar nesc_doc_result de 20261027150000_nesc_ranking_servidor.sql.

create or replace function public.nesc_doc_result(doc jsonb, p_from text, p_to text)
returns table(inc numeric, op numeric, act boolean)
language plpgsql stable set search_path = public, pg_catalog as $$
declare
  v_inc numeric; v_en numeric; v_pass numeric; v_oth numeric; v_act boolean; opcost numeric;
begin
  -- faturamento: Uber + 99, somado em centavos
  select coalesce(sum(round(x.v * 100)), 0) / 100 into v_inc from public.nesc_tx(doc) x
  where x.ty = 'in' and x.app in ('uber', 'n99') and x.d between p_from and p_to;

  -- combustível/energia: só o que foi registrado no período (estimativa por km fica fora do lucro operacional)
  select coalesce(sum(round(x.v * 100)), 0) / 100 into v_en from public.nesc_tx(doc) x
  where x.ty = 'fuel' and x.d between p_from and p_to;

  -- passes: preço dividido em centavos entre os dias COM ATIVIDADE do app dentro da validade;
  -- sem nenhum dia ativo, o valor inteiro fica na data de início (regra do app: passAlloc)
  with act as (select x.app a, x.d from public.nesc_tx(doc) x where x.ty = 'in'
               union select j.app, j.d from public.nesc_jr(doc) j where j.act),
       ps as (select row_number() over () pid, x.app a,
                     greatest(1, ceil(coalesce(nullif(x.vd, 0), 7)))::int n,
                     coalesce(x.vf, x.d) st, round(x.v * 100)::bigint cents
              from public.nesc_tx(doc) x where x.ty = 'pass' and x.app in ('uber', 'n99')),
       pd as (select p.pid, p.a, p.cents, (p.st::date + i)::text dd, i
              from ps p, generate_series(0, p.n - 1) i where p.st ~ '^\d{4}-\d{2}-\d{2}$'),
       used as (select pd.* from pd where exists (select 1 from act where act.a = pd.a and act.d = pd.dd)),
       al0 as (select pid, a, cents, dd, i from used
               union all
               select p.pid, p.a, p.cents, p.st, 0 from ps p
               where p.st ~ '^\d{4}-\d{2}-\d{2}$' and not exists (select 1 from used u where u.pid = p.pid)),
       al as (select a, dd, (cents / cnt) + case when rn <= cents % cnt then 1 else 0 end amt
              from (select al0.*, count(*) over (partition by pid) cnt, row_number() over (partition by pid order by i) rn from al0) z)
  select coalesce(sum(s), 0) into v_pass
  from (select a, sum(amt)::numeric / 100 s from al where dd between p_from and p_to group by a) q;

  -- outros gastos (do app ou gerais do veículo)
  select coalesce(sum(x.v), 0) into v_oth from public.nesc_tx(doc) x
  where x.ty = 'other' and x.d between p_from and p_to and x.app in ('uber', 'n99', 'veic');

  select exists (select 1 from public.nesc_jr(doc) j where j.app in ('uber', 'n99') and j.d between p_from and p_to and j.act) into v_act;

  opcost := round(round(v_en, 2) + round(v_pass, 2) + round(v_oth, 2), 2);
  inc := round(v_inc, 2);
  op := round(v_inc - opcost, 2);
  act := v_inc > 0 or v_act;
  return next;
end $$;

revoke all on function public.nesc_doc_result(jsonb, text, text) from public, anon, authenticated;
