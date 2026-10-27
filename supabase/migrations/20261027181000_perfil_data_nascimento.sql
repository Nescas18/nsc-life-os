-- NESC · data de nascimento no perfil (opcional, privada)
-- Fica em public.profiles, que só o próprio usuário (e administradores) pode ler/editar pela RLS já existente.
-- Não aparece no ranking nem em nenhuma consulta pública. Não serve para entrar na conta nem para trocar senha.
-- Contas antigas ficam com birth_date = null e continuam funcionando normalmente.

alter table public.profiles add column if not exists birth_date date;
alter table public.profiles drop constraint if exists profiles_birth_date_range;
alter table public.profiles add constraint profiles_birth_date_range check (birth_date is null or birth_date >= date '1900-01-01');

-- data futura é recusada (CHECK não pode usar current_date)
create or replace function public.nesc_check_birth() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.birth_date is not null and new.birth_date > current_date then
    raise exception 'birth_date_future' using errcode = '22023';
  end if;
  return new;
end $$;
drop trigger if exists nesc_check_birth on public.profiles;
create trigger nesc_check_birth before insert or update of birth_date on public.profiles
  for each row execute function public.nesc_check_birth();

-- conversão tolerante: qualquer valor inválido vira null, para nunca impedir um cadastro
create or replace function public.nesc_safe_birth(t text) returns date
language plpgsql stable set search_path = '' as $$
declare d date;
begin
  if t is null or t !~ '^\d{4}-\d{2}-\d{2}$' then return null; end if;
  begin d := t::date; exception when others then return null; end;
  if d < date '1900-01-01' or d > current_date then return null; end if;
  return d;
end $$;

-- cadastro: copia a data informada no formulário (metadados do cadastro) para o perfil
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $function$
begin
  insert into public.profiles (id, name, email, occupation, income_type, role, status, birth_date)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'name', ''),
    new.email,
    new.raw_user_meta_data ->> 'occupation',
    new.raw_user_meta_data ->> 'income_type',
    'user',
    'pending',
    public.nesc_safe_birth(new.raw_user_meta_data ->> 'birth_date')
  )
  on conflict (id) do nothing;
  return new;
end;
$function$;

revoke all on function public.nesc_check_birth() from public, anon, authenticated;
revoke all on function public.nesc_safe_birth(text) from public, anon, authenticated;

-- ROLLBACK: drop trigger nesc_check_birth on public.profiles; drop function public.nesc_check_birth();
-- reaplicar a versão anterior de handle_new_user (sem birth_date); drop function public.nesc_safe_birth(text);
-- alter table public.profiles drop column birth_date;  (apaga as datas já informadas)
