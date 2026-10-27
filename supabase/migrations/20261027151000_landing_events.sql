-- NESC · contagem anônima de eventos da landing page (sem cookies, sem identificador, sem dados pessoais)
-- Visitantes só podem INSERIR nomes de evento fixos; ninguém lê pela API pública. Leitura apenas pelo painel/SQL.
create table if not exists public.landing_events (
  id bigint generated always as identity primary key,
  event text not null check (event in ('landing_view', 'cta_signup', 'cta_login', 'cta_how', 'cta_ranking', 'signup_done')),
  source text check (source is null or char_length(source) <= 40),
  created_at timestamptz not null default now()
);
alter table public.landing_events enable row level security;
drop policy if exists "landing events insert" on public.landing_events;
create policy "landing events insert" on public.landing_events for insert to anon, authenticated with check (true);
revoke all on public.landing_events from anon, authenticated;
grant insert on public.landing_events to anon, authenticated;

-- ROLLBACK: drop table public.landing_events;
