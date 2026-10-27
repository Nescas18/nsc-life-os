// Ranking calculado no servidor (supabase/migrations/*.sql, aplicadas em ordem) testado num Postgres local
// (PGlite) — nunca no banco de produção. Inclui paridade com o motor de cálculo do app (index.html) via Playwright.
// Uso: node tests/ranking.spec.mjs   (requer os pacotes "@electric-sql/pglite" e "playwright")
import http from "node:http";
import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const req = createRequire(import.meta.url);
let PGlite, chromium;
try { ({ PGlite } = req("@electric-sql/pglite")); ({ chromium } = req("playwright")); }
catch (e) { console.error("Instale '@electric-sql/pglite' e 'playwright' (ou use NODE_PATH)."); process.exit(2); }

const migDir = path.join(ROOT, "supabase/migrations");
// aplica todas as migrations do projeto em ordem (as mais novas podem substituir funções das anteriores)
const MIGRATIONS = await Promise.all((await readdir(migDir)).filter((f) => f.endsWith(".sql")).sort().map(async (f) => [f, await readFile(path.join(migDir, f), "utf8")]));

const db = new PGlite();
await db.exec(`
  create role anon; create role authenticated;
  create schema auth;
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated; grant execute on function auth.uid() to anon, authenticated;
  create table public.lifeos_user_data(user_id uuid primary key, data jsonb not null default '{}', updated_at timestamptz default now());
  alter table public.lifeos_user_data enable row level security;
  create policy own_read on public.lifeos_user_data for select to authenticated using (auth.uid() = user_id);
  create table public.driver_global_ranking(user_id uuid primary key, display_name text, vehicle text, period_start date, period_end date, revenue numeric, operating_profit numeric, highlighted_app text, updated_at timestamptz);
  alter table public.driver_global_ranking enable row level security;
  create policy "Ranking public read" on public.driver_global_ranking for select to authenticated using (true);
  create policy "Users publish own ranking" on public.driver_global_ranking for insert to authenticated with check (auth.uid() = user_id);
  create policy "Users update own ranking" on public.driver_global_ranking for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
  create table public.profiles(id uuid primary key, name text not null default '', email text, occupation text, income_type text, role text not null default 'user', status text not null default 'pending', created_at timestamptz not null default now(), updated_at timestamptz not null default now());
  grant usage on schema public to anon, authenticated;
  grant select, insert, update, delete on all tables in schema public to anon, authenticated;
`);
for (const [f, sql] of MIGRATIONS) { try { await db.exec(sql); } catch (e) { console.error("Falha ao aplicar " + f + ": " + e.message); process.exit(1); } }

const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const results = [];
const assert = (c, m) => { if (!c) throw new Error(m); };
async function test(name, fn) { try { const i = await fn(); results.push({ name, ok: true, info: i || "" }); } catch (e) { results.push({ name, ok: false, info: e.message }); } }
async function setDocs(docs) { await db.exec("reset role; delete from public.lifeos_user_data;"); for (const [id, d] of Object.entries(docs)) await db.query("insert into public.lifeos_user_data(user_id,data) values ($1,$2::jsonb)", [id, JSON.stringify(d)]); }
async function rank(me, f, t, metric = "lucro", limit = 50) {
  await db.exec("reset role;");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [me]);
  await db.exec("set role authenticated;");
  try { return (await db.query("select * from public.nesc_ranking($1::date,$2::date,$3,$4)", [f, t, metric, limit])).rows; }
  finally { await db.exec("reset role;"); }
}
const tx = (d, type, app, v, o = {}) => ({ id: Math.random().toString(36).slice(2), d, type, app, v, at: 1, ...o });
const OFF = { pass: { uber: { on: false }, n99: { on: false } } };
const F = "2026-10-01", T = "2026-10-07";

await test("1. Dois participantes com resultados diferentes: ordem por lucro operacional", async () => {
  await setDocs({ [U(1)]: { cfg: OFF, tx: [tx("2026-10-02", "in", "uber", 300), tx("2026-10-02", "fuel", "veic", 50)] }, [U(2)]: { cfg: OFF, tx: [tx("2026-10-03", "in", "n99", 400), tx("2026-10-03", "other", "veic", 180)] } });
  const r = await rank(U(1), F, T);
  assert(r.length === 2 && r[0].is_me && Number(r[0].value) === 250 && Number(r[1].value) === 220 && r[0].pos === 1 && r[1].pos === 2, JSON.stringify(r));
  const g = await rank(U(1), F, T, "faturamento");
  assert(!g[0].is_me && Number(g[0].value) === 400, "faturamento deve inverter a ordem: " + JSON.stringify(g));
});
await test("2. Empate: mesma posição e a seguinte ajustada (1, 1, 3)", async () => {
  await setDocs({ [U(1)]: { cfg: OFF, tx: [tx("2026-10-02", "in", "uber", 200)] }, [U(2)]: { cfg: OFF, tx: [tx("2026-10-02", "in", "n99", 200)] }, [U(3)]: { cfg: OFF, tx: [tx("2026-10-02", "in", "uber", 100)] } });
  const r = await rank(U(3), F, T);
  assert(JSON.stringify(r.map((x) => x.pos)) === "[1,1,3]", JSON.stringify(r.map((x) => x.pos)));
});
await test("3. Usuário sem registros não recebe posição nem valor", async () => {
  await setDocs({ [U(1)]: { cfg: OFF, tx: [tx("2026-10-02", "in", "uber", 200)] }, [U(9)]: { cfg: OFF } });
  const r = await rank(U(9), F, T);
  assert(r.length === 1 && !r.some((x) => x.is_me), JSON.stringify(r));
});
await test("4. Receita e despesas no mesmo período (com passe rateado pelos dias trabalhados)", async () => {
  await setDocs({ [U(1)]: { cfg: OFF, tx: [tx("2026-10-02", "in", "n99", 120), tx("2026-10-02", "pass", "n99", 74.99, { validDays: 3, validFrom: "2026-10-02" }), tx("2026-10-02", "other", "veic", 10)] } });
  const r = await rank(U(1), F, T);
  assert(Number(r[0].value) === 35.01, "120 − 74,99 − 10 = 35,01, obtido " + r[0].value);
  const d4 = await rank(U(1), "2026-10-04", "2026-10-04");
  assert(d4.length === 0, "dia sem registro não pode entrar com lucro negativo do passe");
});
await test("5. Alterar um lançamento muda a posição", async () => {
  const a = { cfg: OFF, tx: [tx("2026-10-02", "in", "uber", 100)] };
  await setDocs({ [U(1)]: a, [U(2)]: { cfg: OFF, tx: [tx("2026-10-02", "in", "uber", 150)] } });
  assert((await rank(U(1), F, T)).find((x) => x.is_me).pos === 2, "antes");
  a.tx[0].v = 300; await setDocs({ [U(1)]: a, [U(2)]: { cfg: OFF, tx: [tx("2026-10-02", "in", "uber", 150)] } });
  assert((await rank(U(1), F, T)).find((x) => x.is_me).pos === 1, "depois de editar");
});
await test("6. Lançamento excluído deixa de contar (lista e marcador _del)", async () => {
  const x = tx("2026-10-02", "in", "uber", 500);
  await setDocs({ [U(1)]: { cfg: OFF, tx: [x, tx("2026-10-03", "in", "uber", 50)], _del: { [x.id]: 1 } } });
  assert(Number((await rank(U(1), F, T))[0].value) === 50, "registro marcado como excluído foi somado");
});
await test("7. Mudança de período usa só as datas do período", async () => {
  await setDocs({ [U(1)]: { cfg: OFF, tx: [tx("2026-10-02", "in", "uber", 100), tx("2026-10-15", "in", "uber", 70)] } });
  assert(Number((await rank(U(1), F, T))[0].value) === 100, "semana 1");
  assert(Number((await rank(U(1), "2026-10-01", "2026-10-26"))[0].value) === 170, "mês");
  assert((await rank(U(1), "2026-10-20", "2026-10-26")).length === 0, "semana sem registros");
});
await test("8. Registros em datas diferentes e despesas não contadas duas vezes", async () => {
  await setDocs({ [U(1)]: { cfg: OFF, tx: [tx("2026-10-01", "in", "uber", 100), tx("2026-10-07", "in", "n99", 60), tx("2026-10-07", "fuel", "veic", 40), tx("2026-10-08", "fuel", "veic", 999), tx("2026-10-07", "maint", "veic", 300)] } });
  const r = await rank(U(1), F, T);
  assert(Number(r[0].value) === 120, "160 − 40 (manutenção fora do lucro operacional, combustível de 08/10 fora do período): " + r[0].value);
});
await test("9. Privacidade: só posição, apelido e valor; nada de e-mail, nome, id, veículo ou despesas", async () => {
  await setDocs({ [U(1)]: { cfg: { ...OFF, rankNick: "  <b>Rei da Madrugada</b>\u0007 " }, vehicle: { brand: "Fiat", model: "Argo" }, tx: [tx("2026-10-02", "in", "uber", 100, { desc: "corrida aeroporto" })] }, [U(2)]: { cfg: OFF, tx: [tx("2026-10-02", "in", "uber", 90)] }, [U(3)]: { cfg: { ...OFF, rankOut: true }, tx: [tx("2026-10-02", "in", "uber", 999)] } });
  const r = await rank(U(2), F, T);
  const cols = Object.keys(r[0]).sort().join(",");
  assert(cols === "alias,is_me,participants,pos,row_no,value", "colunas: " + cols);
  const txt = JSON.stringify(r);
  assert(!/Fiat|Argo|aeroporto|00000000|@/.test(txt), "vazou dado privado: " + txt);
  assert(r[0].alias === "bRei da Madrugada/b" && /^Motorista #[0-9A-F]{4}$/.test(r[1].alias), "apelidos: " + r.map((x) => x.alias));
  assert(r.length === 2, "quem optou por não participar apareceu");
  await db.exec("reset role; set role anon;");
  let denied = false; try { await db.query("select * from public.nesc_ranking('2026-10-01','2026-10-07','lucro',50)"); } catch { denied = true; }
  await db.exec("reset role;");
  assert(denied, "visitante sem login conseguiu consultar o ranking");
  await db.exec("set role authenticated;");
  let d2 = false; try { await db.query("select * from public.nesc_doc_result('{}'::jsonb,'2026-10-01','2026-10-07')"); } catch { d2 = true; }
  let d3 = false; try { const q = await db.query("select user_id from public.lifeos_user_data"); d3 = q.rows.every((x) => x.user_id === U(2)); } catch { d3 = true; } // RLS: só a própria linha
  await db.exec("reset role;");
  assert(d2 && d3, "acesso direto a funções internas ou aos dados de outros usuários");
});
await test("10. Ninguém altera a própria posição pelo navegador", async () => {
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [U(1)]);
  await db.exec("set role authenticated;");
  let blocked = false;
  try { await db.query("insert into public.driver_global_ranking(user_id, display_name, operating_profit, period_start, period_end) values ($1,'x',999999,'2026-10-01','2026-10-07')", [U(1)]); } catch { blocked = true; }
  await db.exec("reset role;");
  assert(blocked, "o cliente ainda consegue gravar valor de ranking");
  let bad = 0;
  for (const args of [["2026-10-07", "2026-10-01", "lucro"], ["2026-01-01", "2026-12-31", "lucro"], ["2026-10-01", "2026-10-07", "lucro; drop table x"]]) {
    try { await rank(U(1), ...args); } catch { bad++; }
  }
  assert(bad === 3, "parâmetros inválidos aceitos: " + (3 - bad));
});
await test("11. Custo estimado por km não entra no lucro do ranking; só combustível registrado", async () => {
  const jr = [{ id: "j1", d: "2026-10-02", app: "uber", v: 2, min: 300, periods: [], km: 120 }, { id: "j2", d: "2026-10-03", app: "uber", v: 2, min: 300, periods: [], km: 120 }];
  await setDocs({ [U(1)]: { cfg: { ...OFF, kml: 10, price: 6 }, jr, tx: [tx("2026-10-02", "in", "uber", 300), tx("2026-10-03", "in", "uber", 300)] } });
  assert(Number((await rank(U(1), F, T))[0].value) === 600, "sem abastecimento registrado o lucro é 600");
  await setDocs({ [U(1)]: { cfg: { ...OFF, kml: 10, price: 6 }, jr, tx: [tx("2026-10-02", "in", "uber", 300), tx("2026-10-03", "in", "uber", 300), tx("2026-10-02", "fuel", "veic", 80)] } });
  assert(Number((await rank(U(1), F, T))[0].value) === 520, "com R$ 80 registrados: 600 − 80, sem somar estimativa do outro dia");
});

// ---------- paridade com o motor do app ----------
const server = http.createServer(async (rq, rs) => {
  const p = decodeURIComponent(new URL(rq.url, "http://x").pathname);
  if (p === "/config.js") return rs.end("window.NSC_CONFIG={};");
  const f = path.join(ROOT, p === "/" ? "index.html" : p);
  if (!f.startsWith(ROOT) || !existsSync(f)) { rs.writeHead(404); return rs.end(); }
  rs.end(await readFile(f));
});
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
const browser = await chromium.launch();
await test("Paridade: servidor e app calculam o mesmo faturamento e lucro em 300 contas aleatórias", async () => {
  let seed = 7; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const pick = (a) => a[Math.floor(rnd() * a.length)], day = () => "2026-10-" + String(1 + Math.floor(rnd() * 20)).padStart(2, "0"), money = () => Math.round(rnd() * 40000) / 100;
  const docs = [];
  for (let k = 0; k < 300; k++) {
    const t = [], j = [];
    for (let i = 0; i < 1 + Math.floor(rnd() * 14); i++) {
      const ty = pick(["in", "in", "in", "fuel", "other", "maint", "pass"]), d = day();
      const o = tx(d, ty, ty === "fuel" ? "veic" : pick(["uber", "n99", "veic", undefined]), money());
      if (ty === "pass") { o.app = pick(["uber", "n99"]); o.v = pick([29, 77, 28.99, 74.99, 27.99]); o.validDays = pick([1, 3, 180, undefined]); if (rnd() < 0.7) o.validFrom = d; }
      t.push(o);
    }
    for (let i = 0; i < Math.floor(rnd() * 6); i++) j.push({ id: "j" + i, d: day(), app: pick(["uber", "n99"]), v: 2, min: pick([0, 120, 300]), periods: [], km: pick([null, 0, 37.5, 95, 140.3]), trips: pick([null, 0, 7]) });
    const cfg = { ...OFF, kml: pick([8.5, 10, 12.3]), price: pick([5.89, 6.19, 6]) };
    const vehicle = pick([null, { energy: "flex" }, { energy: "ev" }, { energy: "phev" }]);
    if (vehicle && vehicle.energy !== "flex") Object.assign(cfg, { kwh: 0.95, kmkwh: pick([5.5, 6.6]), loss: 10, evShare: 60 });
    const dd = { tx: t, jr: j, cfg, vehicle }; const r_ = rnd(); if (r_ < 0.2 && t.length) dd._del = { [t[0].id]: 1 }; else if (r_ < 0.5) dd._del = {}; else if (r_ < 0.6) dd.cfg = undefined; docs.push(dd); // metade sem _del, algumas sem cfg
  }
  const periods = [["2026-10-01", "2026-10-20"], ["2026-10-05", "2026-10-11"], ["2026-10-09", "2026-10-09"]];
  const ctx = await browser.newContext(); await ctx.route(/cdnjs|jsdelivr/, (r) => r.abort());
  const pg = await ctx.newPage();
  await pg.addInitScript(() => localStorage.setItem("nsc_session", JSON.stringify({ email: "p@nesc.local", name: "P" })));
  await pg.goto(`http://127.0.0.1:${server.address().port}/`); await pg.waitForFunction(() => typeof CS === "function" && typeof db !== "undefined" && db);
  const js = await pg.evaluate(([docs, periods]) => docs.map((d) => periods.map(([f, t]) => { db = Object.assign(empty(), JSON.parse(JSON.stringify(d))); db._del = db._del || {}; db.tx = db.tx.filter((x) => !db._del[x.id]); db.jr = db.jr.filter((x) => !db._del[x.id]); migrate(); const c = CS(f, t); return [c.inc, c.op, c.inc > 0 || c.jr.some(hasAct)]; })), [docs, periods]);
  await ctx.close();
  let diff = [], n = 0;
  for (let k = 0; k < docs.length; k++) for (let p = 0; p < periods.length; p++) {
    const r = (await db.query("select * from public.nesc_doc_result($1::jsonb, $2, $3)", [JSON.stringify(docs[k]), ...periods[p]])).rows[0];
    n++;
    if (Math.abs(Number(r.inc) - js[k][p][0]) > 0.001 || Math.abs(Number(r.op) - js[k][p][1]) > 0.001 || r.act !== js[k][p][2]) diff.push({ k, p, sql: [r.inc, r.op, r.act], js: js[k][p] });
  }
  assert(!diff.length, diff.length + " divergência(s): " + JSON.stringify(diff.slice(0, 3)));
  return n + " comparações idênticas";
});
await browser.close(); server.close();

let fail = 0;
for (const r of results) { if (!r.ok) fail++; console.log(`${r.ok ? "✓" : "✗"} ${r.name}${r.info ? " — " + r.info : ""}`); }
console.log(`\n${results.length - fail}/${results.length} testes passaram.`);
process.exit(fail ? 1 : 0);
