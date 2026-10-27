-- NESC · ranking calculado no servidor
-- Antes: o navegador calculava faturamento/lucro e gravava em driver_global_ranking (uma linha por usuário,
-- sobrescrita a cada período). Resultado: ranking quase sempre vazio, valores que o próprio usuário podia
-- alterar e nome/veículo/faturamento legíveis por qualquer conta.
-- Agora: nesc_ranking() lê os registros salvos de cada conta (lifeos_user_data, o mesmo documento que o app
-- sincroniza) e aplica a MESMA regra de lucro operacional do app (index.html → stats/CS). Só devolve posição,
-- apelido e o valor do critério escolhido. Nenhum cliente grava posição ou valor de ranking.
-- Reversão: ver o bloco "ROLLBACK" no fim do arquivo.

-- número de um campo JSON (aceita número ou texto numérico; o resto vira null)
create or replace function public.nesc_num(j jsonb) returns numeric
language sql immutable set search_path = pg_catalog as $$
  select case jsonb_typeof(j)
    when 'number' then (j #>> '{}')::numeric
    when 'string' then case when (j #>> '{}') ~ '^\s*-?\d+(\.\d+)?\s*$' then btrim(j #>> '{}')::numeric end
  end
$$;

-- jornada com atividade (mesma regra de hasAct no app: minutos > 0, viagens > 0 ou km > 0)
create or replace function public.nesc_jr_act(j jsonb) returns boolean
language plpgsql immutable set search_path = public, pg_catalog as $$
declare m numeric := 0; hs int; he int;
begin
  if public.nesc_num(j->'v') = 2 then
    m := greatest(0, coalesce(public.nesc_num(j->'min'), 0));
  elsif coalesce(j->>'start','') ~ '^\d{1,2}:\d{2}' and coalesce(j->>'end','') ~ '^\d{1,2}:\d{2}' then
    hs := split_part(j->>'start', ':', 1)::int * 60 + split_part(j->>'start', ':', 2)::int;
    he := split_part(j->>'end', ':', 1)::int * 60 + split_part(j->>'end', ':', 2)::int;
    m := he - hs; if m <= 0 then m := m + 1440; end if;
    m := greatest(0, m - coalesce(public.nesc_num(j->'pause'), 0));
  end if;
  return m > 0 or coalesce(public.nesc_num(j->'trips'), 0) > 0 or coalesce(public.nesc_num(j->'km'), 0) > 0;
end $$;

-- lançamentos (tx) e jornadas (jr) válidos de um documento, já sem os itens excluídos (_del)
create or replace function public.nesc_tx(doc jsonb)
returns table(id text, d text, ty text, app text, v numeric, vd numeric, vf text)
language sql immutable set search_path = public, pg_catalog as $$
  select t->>'id', t->>'d', t->>'type', coalesce(nullif(t->>'app', ''), 'uber'), coalesce(public.nesc_num(t->'v'), 0),
         public.nesc_num(t->'validDays'), nullif(t->>'validFrom', '')
  from jsonb_array_elements(case when jsonb_typeof(doc->'tx') = 'array' then doc->'tx' else '[]'::jsonb end) t
  where jsonb_typeof(t) = 'object'
    and not coalesce(t->>'id' is not null and jsonb_typeof(doc->'_del') = 'object' and (doc->'_del') ? (t->>'id'), false)  -- sem _del: nada excluído
$$;
create or replace function public.nesc_jr(doc jsonb)
returns table(d text, app text, km numeric, act boolean)
language sql immutable set search_path = public, pg_catalog as $$
  select j->>'d', j->>'app', public.nesc_num(j->'km'), public.nesc_jr_act(j)
  from jsonb_array_elements(case when jsonb_typeof(doc->'jr') = 'array' then doc->'jr' else '[]'::jsonb end) j
  where jsonb_typeof(j) = 'object'
    and not coalesce(j->>'id' is not null and jsonb_typeof(doc->'_del') = 'object' and (doc->'_del') ? (j->>'id'), false)  -- sem _del: nada excluído
$$;

-- faturamento e lucro operacional de UMA conta no período [p_from, p_to] (datas locais AAAA-MM-DD).
-- lucro operacional = faturamento − combustível/energia − passes rateados − outros gastos
-- (manutenção e custos fixos ficam fora, como no app). Arredondamentos em centavos como no app.
create or replace function public.nesc_doc_result(doc jsonb, p_from text, p_to text)
returns table(inc numeric, op numeric, act boolean)
language plpgsql stable set search_path = public, pg_catalog as $$
declare
  c jsonb := case when jsonb_typeof(doc->'cfg') = 'object' then doc->'cfg' else '{}'::jsonb end;
  veh jsonb := doc->'vehicle';
  en text := case when jsonb_typeof(veh) = 'object' then coalesce(veh->>'energy', '') else 'flex' end;
  kml numeric := case when c ? 'kml' then public.nesc_num(c->'kml') else 10 end;
  price numeric := case when c ? 'price' then public.nesc_num(c->'price') else 6 end;
  kwh numeric := case when c ? 'kwh' then public.nesc_num(c->'kwh') else 0.95 end;
  kmkwh numeric := case when c ? 'kmkwh' then public.nesc_num(c->'kmkwh') else 6 end;
  loss numeric := case when c ? 'loss' then public.nesc_num(c->'loss') else 10 end;
  evs numeric := case when c ? 'evShare' then public.nesc_num(c->'evShare') else 50 end;
  lossf numeric; fuelc numeric; el numeric; share numeric; ktot numeric;
  v_inc numeric; v_en numeric; v_pass numeric; v_oth numeric; v_act boolean; opcost numeric;
begin
  lossf := least(50, greatest(0, coalesce(loss, 0))) / 100;
  fuelc := case when kml > 0 then coalesce(price, 0) / kml else 0 end;
  el := case when kmkwh > 0 then coalesce(kwh, 0) / (kmkwh * (1 - lossf)) else 0 end;
  share := case when en = 'ev' then 1 when en = 'phev' then least(100, greatest(0, coalesce(evs, 0))) / 100 else 0 end;
  ktot := fuelc * (1 - share) + el * share;

  -- faturamento: Uber + 99, somado em centavos
  select coalesce(sum(round(x.v * 100)), 0) / 100 into v_inc from public.nesc_tx(doc) x
  where x.ty = 'in' and x.app in ('uber', 'n99') and x.d between p_from and p_to;

  -- energia dia a dia: abastecimento registrado vale o real; sem ele, km da jornada × custo por km
  with fu as (select x.d, sum(round(x.v * 100)) / 100 v from public.nesc_tx(doc) x where x.ty = 'fuel' and x.d between p_from and p_to group by x.d),
       km as (select j.d, sum(j.km) v from public.nesc_jr(doc) j where j.app in ('uber', 'n99') and j.d between p_from and p_to and j.km is not null group by j.d),
       ds as (select fu.d from fu union select km.d from km)
  select coalesce(sum(case when coalesce(fu.v, 0) > 0 then fu.v when coalesce(km.v, 0) > 0 then km.v * ktot else 0 end), 0)
  into v_en from ds left join fu using (d) left join km using (d);

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

-- apelido público: o escolhido pelo participante (até 24 caracteres) ou "Motorista #XXXX" derivado do id,
-- sem revelar nome, e-mail ou o próprio id
create or replace function public.nesc_alias(uid uuid, cfg jsonb) returns text
language sql immutable set search_path = pg_catalog as $$
  select coalesce(
    nullif(left(btrim(regexp_replace(coalesce(cfg->>'rankNick', ''), '[[:cntrl:]<>"]', '', 'g')), 24), ''),
    'Motorista #' || upper(substr(md5(uid::text || ':nesc-ranking'), 1, 4)))
$$;

-- ranking: só para usuários autenticados; devolve posição (empates com a mesma posição e a seguinte ajustada:
-- 1, 1, 3), apelido, valor do critério, se é você, e as linhas vizinhas à sua (2 acima e 2 abaixo)
create or replace function public.nesc_ranking(p_from date, p_to date, p_metric text default 'lucro', p_limit int default 50)
returns table(pos int, alias text, value numeric, is_me boolean, row_no int, participants int)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare me uuid := auth.uid(); lim int := least(greatest(coalesce(p_limit, 50), 1), 100);
begin
  if me is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if p_from is null or p_to is null or p_from > p_to or p_to - p_from > 92
     or p_to > current_date + 1 or p_from < date '2020-01-01' then
    raise exception 'invalid_period' using errcode = '22023';
  end if;
  if p_metric is null or p_metric not in ('lucro', 'faturamento') then raise exception 'invalid_metric' using errcode = '22023'; end if;
  return query
  with r as (
    select u.user_id, x.inc, x.op, x.act, u.data->'cfg' cfg
    from public.lifeos_user_data u
    cross join lateral public.nesc_doc_result(u.data, p_from::text, p_to::text) x
    where coalesce(u.data->'cfg'->'rankOut', 'false'::jsonb) <> 'true'::jsonb  -- quem optou por não participar fica fora
  ), v as (
    select r.user_id, case when p_metric = 'lucro' then r.op else r.inc end val, r.cfg from r where r.act
  ), k as (
    select v.*, rank() over (order by v.val desc)::int rk, row_number() over (order by v.val desc, v.user_id)::int rn, count(*) over ()::int n from v
  ), mine as (select k.rn from k where k.user_id = me)
  select k.rk, public.nesc_alias(k.user_id, k.cfg), k.val, k.user_id = me, k.rn, k.n
  from k
  where k.rn <= lim or abs(k.rn - coalesce((select mine.rn from mine), -1000)) <= 2
  order by k.rn;
end $$;

revoke all on function public.nesc_num(jsonb) from public, anon, authenticated;
revoke all on function public.nesc_jr_act(jsonb) from public, anon, authenticated;
revoke all on function public.nesc_tx(jsonb) from public, anon, authenticated;
revoke all on function public.nesc_jr(jsonb) from public, anon, authenticated;
revoke all on function public.nesc_doc_result(jsonb, text, text) from public, anon, authenticated;
revoke all on function public.nesc_alias(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.nesc_ranking(date, date, text, int) from public, anon;
grant execute on function public.nesc_ranking(date, date, text, int) to authenticated;

-- a tabela antiga deixa de aceitar escrita/leitura pelo app (RLS continua ativo, só sem políticas);
-- os dados existentes não são apagados
drop policy if exists "Users publish own ranking" on public.driver_global_ranking;
drop policy if exists "Users update own ranking" on public.driver_global_ranking;
drop policy if exists "Ranking public read" on public.driver_global_ranking;

-- ROLLBACK (manual, se necessário):
-- create policy "Ranking public read" on public.driver_global_ranking for select to authenticated using (true);
-- create policy "Users publish own ranking" on public.driver_global_ranking for insert to authenticated with check (auth.uid() = user_id);
-- create policy "Users update own ranking" on public.driver_global_ranking for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
-- drop function public.nesc_ranking(date, date, text, int); drop function public.nesc_alias(uuid, jsonb);
-- drop function public.nesc_doc_result(jsonb, text, text); drop function public.nesc_tx(jsonb); drop function public.nesc_jr(jsonb); drop function public.nesc_jr_act(jsonb); drop function public.nesc_num(jsonb);
