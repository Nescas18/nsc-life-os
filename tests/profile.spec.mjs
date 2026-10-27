// Data de nascimento no perfil (supabase/migrations/*_perfil_data_nascimento.sql) testada num Postgres local (PGlite).
// Reproduz as políticas de acesso de public.profiles do projeto. Nunca roda no banco de produção.
// Uso: node tests/profile.spec.mjs   (requer "@electric-sql/pglite")
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let PGlite;
try { ({ PGlite } = createRequire(import.meta.url)("@electric-sql/pglite")); }
catch { console.error("Instale '@electric-sql/pglite' (ou use NODE_PATH)."); process.exit(2); }

const migDir = path.join(ROOT, "supabase/migrations");
const MIG = await readFile(path.join(migDir, (await readdir(migDir)).find((f) => f.includes("perfil_data_nascimento"))), "utf8");
const db = new PGlite();
await db.exec(`
  create role anon; create role authenticated;
  create schema auth;
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated; grant execute on function auth.uid() to anon, authenticated;
  create table auth.users(id uuid primary key, email text, raw_user_meta_data jsonb);
  create table public.profiles(id uuid primary key, name text not null default '', email text, occupation text, income_type text, role text not null default 'user', status text not null default 'pending', created_at timestamptz not null default now(), last_login_at timestamptz, updated_at timestamptz not null default now());
  create function public.is_admin() returns boolean language sql stable security definer set search_path = '' as $$ select exists(select 1 from public.profiles where id = auth.uid() and role = 'admin') $$;
  alter table public.profiles enable row level security;
  create policy profiles_select_own_or_admin on public.profiles for select to authenticated using (((select auth.uid()) = id) or (select public.is_admin()));
  create policy profiles_update_own_or_admin on public.profiles for update to authenticated using (((select auth.uid()) = id) or (select public.is_admin())) with check (((select auth.uid()) = id) or (select public.is_admin()));
  create function public.handle_new_user() returns trigger language plpgsql security definer set search_path = '' as $f$
  begin insert into public.profiles (id, name, email, occupation, income_type, role, status) values (new.id, coalesce(new.raw_user_meta_data ->> 'name', ''), new.email, new.raw_user_meta_data ->> 'occupation', new.raw_user_meta_data ->> 'income_type', 'user', 'pending') on conflict (id) do nothing; return new; end; $f$;
  create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();
  grant usage on schema public to anon, authenticated;
  grant select, insert, update, delete on all tables in schema public to anon, authenticated;
  insert into auth.users values ('00000000-0000-4000-8000-000000000001', 'antiga@nesc.local', '{"name":"Conta antiga"}');
`);
await db.exec(MIG);

const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const results = [];
const assert = (c, m) => { if (!c) throw new Error(m); };
async function test(name, fn) { try { const i = await fn(); results.push({ name, ok: true, info: i || "" }); } catch (e) { results.push({ name, ok: false, info: e.message }); } }
const signup = (n, meta) => db.query("insert into auth.users values ($1,$2,$3::jsonb)", [U(n), `u${n}@nesc.local`, JSON.stringify(meta)]);
const birth = async (n) => (await db.query("select birth_date::text b from public.profiles where id=$1", [U(n)])).rows[0]?.b ?? null;
async function as(n, fn) {
  await db.exec("reset role;"); await db.query("select set_config('request.jwt.claim.sub', $1, false)", [n ? U(n) : ""]);
  await db.exec(n ? "set role authenticated;" : "set role anon;");
  try { return await fn(); } finally { await db.exec("reset role;"); }
}

await test("1. Cadastro com data válida grava a data no perfil", async () => {
  await signup(2, { name: "Ana", birth_date: "1990-05-17" });
  assert((await birth(2)) === "1990-05-17", "obtido " + (await birth(2)));
});
await test("2. Datas impossíveis, futuras, antigas demais ou malformadas não bloqueiam o cadastro e ficam vazias", async () => {
  const bad = ["2001-02-30", "2099-01-01", "1850-01-01", "17/05/1990", "<script>", ""];
  for (let i = 0; i < bad.length; i++) { await signup(10 + i, { name: "X", birth_date: bad[i] }); assert((await birth(10 + i)) === null, bad[i] + " virou " + (await birth(10 + i))); }
  return bad.length + " casos";
});
await test("3. Conta antiga continua sem data (null) e pode completar depois", async () => {
  assert((await birth(1)) === null, "conta antiga recebeu valor");
  await as(1, () => db.query("update public.profiles set birth_date='1985-11-03' where id=$1", [U(1)]));
  assert((await birth(1)) === "1985-11-03", "não salvou");
});
await test("4. Data futura e anterior a 1900 recusadas na edição", async () => {
  let fut = false, old = false;
  try { await as(1, () => db.query("update public.profiles set birth_date = current_date + 1 where id=$1", [U(1)])); } catch { fut = true; }
  try { await as(1, () => db.query("update public.profiles set birth_date = '1899-12-31' where id=$1", [U(1)])); } catch { old = true; }
  assert(fut && old && (await birth(1)) === "1985-11-03", "aceitou data inválida");
});
await test("5. Outro usuário não lê nem altera a data de nascimento", async () => {
  const rows = await as(3, () => db.query("select id, birth_date from public.profiles where id=$1", [U(2)]));
  assert(rows.rows.length === 0, "leu perfil alheio");
  const up = await as(3, () => db.query("update public.profiles set birth_date='2000-01-01' where id=$1", [U(2)]));
  assert((up.affectedRows || 0) === 0 && (await birth(2)) === "1990-05-17", "alterou perfil alheio");
});
await test("6. Visitante sem login não consulta datas de nascimento (nem por e-mail)", async () => {
  const r = await as(0, () => db.query("select birth_date from public.profiles where email='u2@nesc.local'"));
  assert(r.rows.length === 0, "visitante leu " + JSON.stringify(r.rows));
  let denied = false; try { await as(0, () => db.query("select public.nesc_safe_birth('1990-05-17')")); } catch { denied = true; }
  assert(denied, "função interna exposta ao público");
});
await test("7. Funções internas não são chamáveis por usuários autenticados", async () => {
  let denied = false; try { await as(2, () => db.query("select public.nesc_safe_birth('1990-05-17')")); } catch (e) { denied = /permission denied/.test(e.message); }
  assert(denied, "nesc_safe_birth exposta");
});

let fail = 0;
for (const r of results) { if (!r.ok) fail++; console.log(`${r.ok ? "✓" : "✗"} ${r.name}${r.info ? " — " + r.info : ""}`); }
console.log(`\n${results.length - fail}/${results.length} testes passaram.`);
process.exit(fail ? 1 : 0);
