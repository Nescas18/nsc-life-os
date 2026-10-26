// Testes do motor financeiro do NESC, executados no próprio index.html dentro de um navegador real (Playwright).
// Uso: node tests/finance.spec.mjs   (requer o pacote "playwright" e um Chromium instalados na máquina)
// Os testes rodam SEMPRE em modo local: o config.js é substituído por uma configuração vazia, então nada
// toca o Supabase de produção. Os valores esperados vêm das regras documentadas em docs/CALCULOS.md,
// não do resultado atual do código.
import http from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let chromium;
try {
  ({ chromium } = createRequire(import.meta.url)("playwright")); // require respeita NODE_PATH
} catch {
  console.error("Pacote 'playwright' não encontrado. Instale com: npm i -D playwright && npx playwright install chromium");
  process.exit(2);
}

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".png": "image/png", ".ico": "image/x-icon", ".webmanifest": "application/manifest+json" };
const server = http.createServer(async (req, res) => {
  const p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (p === "/config.js") { res.writeHead(200, { "content-type": TYPES[".js"] }); return res.end("window.NSC_CONFIG={};"); }
  const f = path.join(ROOT, p === "/" ? "index.html" : p);
  if (!f.startsWith(ROOT) || !existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "content-type": TYPES[path.extname(f)] || "application/octet-stream" });
  res.end(await readFile(f));
});
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
const BASE = `http://127.0.0.1:${server.address().port}/`;

const browser = await chromium.launch();
const USER = { email: "teste@nesc.local", name: "Motorista Teste" };
const OFF = { uber: { on: false }, n99: { on: false } };
const results = [];
const near = (a, b, eps = 0.005) => Math.abs(a - b) <= eps;

// abre o app já autenticado em modo local, com o relógio fixo no horário de Brasília
async function open(now = "2026-10-26T12:00:00-03:00", seed = null) {
  const ctx = await browser.newContext({ timezoneId: "America/Sao_Paulo", locale: "pt-BR", viewport: { width: 390, height: 844 } });
  await ctx.route(/cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net/, (r) => r.abort());
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.clock.setFixedTime(new Date(now));
  await page.addInitScript(([u, s]) => {
    if (sessionStorage.getItem("seeded")) return;
    sessionStorage.setItem("seeded", "1");
    localStorage.setItem("nsc_session", JSON.stringify(u));
    if (s) localStorage.setItem("nsc_db_" + u.email, JSON.stringify(s));
  }, [USER, seed]);
  await page.goto(BASE);
  await page.waitForFunction(() => document.querySelector("#app.on #view .grid"));
  return { page, ctx, errors };
}
// substitui os dados da conta de teste e redesenha
const setDb = (page, data) => page.evaluate((d) => { db = Object.assign(empty(), JSON.parse(JSON.stringify(d))); migrate(); Store.save(); render(); }, data);
const cs = (page, f, t) => page.evaluate(([f, t]) => { const s = CS(f, t); return { inc: s.inc, opCost: s.opCost, op: s.op, full: s.full, own: s.own, pass: s.pass, energy: s.energy, expTot: s.expTot, wd: s.wd.size, maint: s.maint }; }, [f, t || f]);
const as = (page, a, f, t) => page.evaluate(([a, f, t]) => { const s = AS(a, f, t); return { inc: s.inc, op: s.op, energy: s.energy, pass: s.pass }; }, [a, f, t || f]);
const tx = (o) => Object.assign({ id: Math.random().toString(36).slice(2), at: Date.now() }, o);
const pass99 = (from, extra = {}) => tx({ d: from, type: "pass", app: "n99", v: 74.99, desc: "Pacote de tempo · 3 dias ilimitado · 99", validDays: 3, validFrom: from, packageId: "time3", ...extra });

async function test(name, fn) {
  let ctx;
  try {
    const r = await fn((o) => (ctx = o));
    results.push({ name, ok: true, info: r || "" });
  } catch (e) {
    results.push({ name, ok: false, info: e.message });
  } finally {
    if (ctx) await ctx.close();
  }
}
function eq(label, got, want, eps) {
  const ok = typeof want === "number" ? near(got, want, eps) : got === want;
  if (!ok) throw new Error(`${label}: esperado ${JSON.stringify(want)}, obtido ${JSON.stringify(got)}`);
}

const T = "2026-10-26";

await test("Regressão 26/10: pacote 99 de 3 dias comprado em 24/10 não gera custo em dia sem registro", async (keep) => {
  const o = await open(); keep(o.ctx);
  await setDb(o.page, { cfg: { pass: OFF }, tx: [tx({ d: "2026-10-24", type: "in", app: "n99", v: 120 }), pass99("2026-10-24")] });
  const d26 = await cs(o.page, T), d24 = await cs(o.page, "2026-10-24"), w = await cs(o.page, "2026-10-24", T);
  eq("lucro operacional em 26/10", d26.op, 0); eq("custo operacional em 26/10", d26.opCost, 0);
  eq("lucro operacional em 24/10 (único dia usado)", d24.op, 120 - 74.99);
  eq("lucro operacional 24–26/10", w.op, 120 - 74.99);
  const card = await o.page.evaluate(() => [...document.querySelectorAll("[data-kpi=op], .c")].map((e) => e.textContent).join("|"));
  if (/-\s?R\$\s?25,00|R\$\s?-25,00|−R\$\s?25,00/.test(card)) throw new Error("A tela Hoje ainda mostra −R$ 25,00");
  return `26/10 = R$ ${d26.op.toFixed(2)} · 24/10 = R$ ${d24.op.toFixed(2)}`;
});

await test("Passe usado em 2 dos 3 dias: custo dividido entre os dias trabalhados e total preservado", async (keep) => {
  const o = await open(); keep(o.ctx);
  await setDb(o.page, { cfg: { pass: OFF }, tx: [tx({ d: "2026-10-24", type: "in", app: "n99", v: 100 }), tx({ d: "2026-10-25", type: "in", app: "n99", v: 80 }), pass99("2026-10-24")] });
  eq("passe em 24/10 (recebe o centavo restante)", (await cs(o.page, "2026-10-24")).pass, 37.5);
  eq("passe em 25/10", (await cs(o.page, "2026-10-25")).pass, 37.49);
  eq("passe em 26/10", (await cs(o.page, T)).pass, 0);
  eq("passe no período 24–26/10", (await cs(o.page, "2026-10-24", T)).pass, 74.99);
});

await test("1. Sem registros", async (keep) => {
  const o = await open(); keep(o.ctx);
  await setDb(o.page, { cfg: { pass: OFF } });
  const s = await cs(o.page, T);
  eq("faturamento", s.inc, 0); eq("custos operacionais", s.opCost, 0); eq("lucro operacional", s.op, 0); eq("resultado completo", s.full, 0); eq("despesas", s.expTot, 0);
});

await test("2. Apenas ganhos", async (keep) => {
  const o = await open(); keep(o.ctx);
  await setDb(o.page, { cfg: { pass: OFF }, tx: [tx({ d: T, type: "in", app: "uber", v: 250.5 })] });
  const s = await cs(o.page, T);
  eq("faturamento", s.inc, 250.5); eq("lucro operacional", s.op, 250.5); eq("custos", s.opCost, 0);
});

await test("3. Apenas despesas", async (keep) => {
  const o = await open(); keep(o.ctx);
  await setDb(o.page, { cfg: { pass: OFF }, tx: [tx({ d: T, type: "fuel", app: "veic", v: 100, unit: "L" }), tx({ d: T, type: "other", app: "veic", v: 40 })] });
  const s = await cs(o.page, T);
  eq("custos operacionais", s.opCost, 140); eq("lucro operacional", s.op, -140); eq("despesas registradas", s.expTot, 140);
});

await test("4. Ganhos e despesas", async (keep) => {
  const o = await open(); keep(o.ctx);
  await setDb(o.page, { cfg: { pass: OFF }, tx: [tx({ d: T, type: "in", app: "uber", v: 300 }), tx({ d: T, type: "fuel", app: "veic", v: 100, unit: "L" }), tx({ d: T, type: "maint", app: "veic", v: 80 })] });
  const s = await cs(o.page, T);
  eq("lucro operacional", s.op, 200); eq("resultado completo", s.full, 120); eq("manutenção", s.maint, 80);
});

await test("5. Custos fixos recorrentes (rateio diário, fora do lucro operacional)", async (keep) => {
  const o = await open(); keep(o.ctx);
  await setDb(o.page, { cfg: { pass: OFF, own: { parcela: 930, seguro: 0, ipva: 365, deprec: 0, outros: 0 } } });
  const d = await cs(o.page, T), m = await cs(o.page, "2026-10-01", T), full = await cs(o.page, "2026-10-01", "2026-10-31");
  eq("lucro operacional do dia", d.op, 0); eq("custo fixo do dia", d.own, 31); eq("resultado completo do dia", d.full, -31);
  eq("custo fixo 01–26/10", m.own, 806); eq("custo fixo outubro completo", full.own, 961);
});

await test("6. Uber e 99 no mesmo dia (combustível dividido por km)", async (keep) => {
  const o = await open(); keep(o.ctx);
  await setDb(o.page, {
    cfg: { pass: OFF },
    tx: [tx({ d: T, type: "in", app: "uber", v: 200 }), tx({ d: T, type: "in", app: "n99", v: 150 }), tx({ d: T, type: "fuel", app: "veic", v: 70, unit: "L" })],
    jr: [{ id: "j1", d: T, app: "uber", v: 2, min: 240, periods: [], km: 60 }, { id: "j2", d: T, app: "n99", v: 2, min: 120, periods: [], km: 40 }],
  });
  const c = await cs(o.page, T), u = await as(o.page, "uber", T), n = await as(o.page, "n99", T);
  eq("faturamento consolidado", c.inc, 350); eq("dias trabalhados", c.wd, 1); eq("combustível total", c.energy, 70);
  eq("combustível Uber", u.energy, 42); eq("combustível 99", n.energy, 28); eq("lucro Uber + 99 = consolidado", u.op + n.op, c.op);
});

await test("7. Períodos hoje / 7 dias / mês", async (keep) => {
  const o = await open(); keep(o.ctx);
  await setDb(o.page, { cfg: { pass: OFF }, tx: [["2026-10-26", 100], ["2026-10-23", 50], ["2026-10-16", 30], ["2026-10-01", 20], ["2026-09-30", 999]].map(([d, v]) => tx({ d, type: "in", app: "uber", v })) });
  const r = await o.page.evaluate(() => ["d", "w", "m"].map((p) => { const [f, t] = range(p); return CS(f, t).inc; }));
  eq("hoje", r[0], 100); eq("7 dias", r[1], 150); eq("mês atual", r[2], 200);
});

await test("8. Registro perto da meia-noite usa a data local", async (keep) => {
  const o = await open("2026-10-26T23:59:30-03:00"); keep(o.ctx);
  await setDb(o.page, { cfg: { pass: OFF } });
  eq("TODAY às 23:59", await o.page.evaluate(() => TODAY()), "2026-10-26");
  await o.page.evaluate(() => { tab = "uber"; render(); });
  await o.page.fill('#reg form[data-form=inc] input[name=v]', "88,00");
  await o.page.click('#reg form[data-form=inc] button.btn');
  const d = await o.page.evaluate(() => db.tx.filter((x) => x.type === "in").map((x) => x.d));
  eq("data gravada", d.join(","), "2026-10-26");
  const o2 = await open("2026-10-27T00:00:30-03:00", await o.page.evaluate(() => db)); keep(o2.ctx); await o.ctx.close();
  eq("TODAY à 00:00", await o2.page.evaluate(() => TODAY()), "2026-10-27");
  eq("faturamento do novo dia", (await cs(o2.page, "2026-10-27")).inc, 0);
  eq("faturamento do dia anterior", (await cs(o2.page, "2026-10-26")).inc, 88);
});

await test("9. Decimais e arredondamento", async (keep) => {
  const o = await open(); keep(o.ctx);
  const p = await o.page.evaluate(() => [parseMoney("250,50"), parseMoney("250.50"), parseMoney("1.250,50"), parseMoney("1,250.50"), parseMoney("R$ 1.250")]);
  eq("250,50", p[0], 250.5); eq("250.50", p[1], 250.5); eq("1.250,50", p[2], 1250.5); eq("1,250.50", p[3], 1250.5); eq("R$ 1.250", p[4], 1250);
  await setDb(o.page, { cfg: { pass: OFF }, tx: [0.1, 0.2, 33.33, 33.33, 33.33].map((v) => tx({ d: T, type: "in", app: "uber", v })) });
  const txt = await o.page.evaluate(() => brl(CS(TODAY(), TODAY()).inc));
  eq("soma exibida", txt.replace(/\s/g, " "), "R$ 100,29");
  await setDb(o.page, { cfg: { pass: OFF }, tx: ["2026-10-24", "2026-10-25", "2026-10-26"].map((d) => tx({ d, type: "in", app: "n99", v: 10 })).concat([pass99("2026-10-24")]) });
  eq("passe de R$ 74,99 em 3 dias soma exatamente o preço", (await cs(o.page, "2026-10-24", T)).pass, 74.99);
});

await test("10. Meta diária: não iniciada, parcial e concluída", async (keep) => {
  const o = await open(); keep(o.ctx);
  const goalTxt = () => o.page.evaluate(() => document.querySelector("#view").textContent.replace(/\s+/g, " "));
  await setDb(o.page, { cfg: { pass: OFF, goal: 300 } });
  if (!/0% da meta/.test(await goalTxt())) throw new Error("meta não iniciada deveria mostrar 0%");
  await setDb(o.page, { cfg: { pass: OFF, goal: 300 }, tx: [tx({ d: T, type: "in", app: "uber", v: 150 })] });
  if (!/50% da meta/.test(await goalTxt())) throw new Error("meta parcial deveria mostrar 50%");
  await setDb(o.page, { cfg: { pass: OFF, goal: 300 }, tx: [tx({ d: T, type: "in", app: "uber", v: 300 })] });
  if (!/100% da meta/.test(await goalTxt())) throw new Error("meta concluída deveria mostrar 100%");
});

await test("11. Editar e excluir lançamento (com passe automático)", async (keep) => {
  const o = await open(); keep(o.ctx);
  await setDb(o.page, { cfg: { pass: { uber: { on: true, packageId: "time24", v: 29, days: 1 }, n99: { on: false } } } });
  await o.page.evaluate(() => { tab = "uber"; render(); });
  await o.page.fill('#reg form[data-form=inc] input[name=v]', "200");
  await o.page.click('#reg form[data-form=inc] button.btn');
  let s = await cs(o.page, T);
  eq("faturamento após salvar", s.inc, 200); eq("passe de 24h lançado", s.pass, 29); eq("lucro operacional", s.op, 171);
  const id = await o.page.evaluate(() => db.tx.find((x) => x.type === "in").id);
  await o.page.click(`[data-edit="${id}"]`);
  await o.page.fill('#mbox form[data-form=edtx] input[name=v]', "250,00");
  await o.page.click('#mbox form[data-form=edtx] button.btn');
  s = await cs(o.page, T); eq("faturamento após editar", s.inc, 250); eq("lucro após editar", s.op, 221);
  await o.page.click(`[data-del="tx:${id}"]`);
  s = await cs(o.page, T); eq("faturamento após excluir", s.inc, 0); eq("passe após excluir", s.pass, 0); eq("lucro após excluir", s.op, 0);
});

await test("12. A tela atualiza logo após salvar", async (keep) => {
  const o = await open(); keep(o.ctx);
  await setDb(o.page, { cfg: { pass: OFF } });
  await o.page.evaluate(() => { tab = "n99"; render(); });
  await o.page.fill('#reg form[data-form=inc] input[name=v]', "123,45");
  await o.page.click('#reg form[data-form=inc] button.btn');
  const k = await o.page.evaluate(() => document.querySelector(".kpis").textContent.replace(/\s+/g, " "));
  if (!k.includes("123,45")) throw new Error("KPI de faturamento não mostrou R$ 123,45: " + k.slice(0, 120));
  await o.page.evaluate(() => { tab = "hoje"; render(); });
  const h = await o.page.evaluate(() => document.querySelector("#view").textContent.replace(/\s+/g, " "));
  if (!h.includes("123,45")) throw new Error("Hoje não mostrou o novo faturamento");
});

await test("13. Período que atravessa meses", async (keep) => {
  const o = await open(); keep(o.ctx);
  await setDb(o.page, { cfg: { pass: OFF, own: { parcela: 900 } }, tx: [tx({ d: "2026-09-29", type: "in", app: "uber", v: 100 }), tx({ d: "2026-10-02", type: "in", app: "n99", v: 60 })] });
  const s = await cs(o.page, "2026-09-28", "2026-10-03");
  eq("faturamento", s.inc, 160); eq("custo fixo (3/30 de set + 3/31 de out)", s.own, 90 + (900 * 3) / 31); eq("dias trabalhados", s.wd, 2);
});

await test("14. Conta sem histórico: todas as áreas abrem sem erro", async (keep) => {
  const o = await open(); keep(o.ctx);
  const tabs = await o.page.evaluate(() => TABS.map((t) => t[0]));
  for (const t of tabs) await o.page.evaluate((t) => { tab = t; render(); }, t);
  await o.page.evaluate(() => { tab = "hoje"; render(); });
  const s = await cs(o.page, T); eq("lucro operacional", s.op, 0);
  if (o.errors.length) throw new Error("erros de JavaScript: " + o.errors.join(" | "));
  return tabs.length + " áreas renderizadas";
});

await browser.close();
server.close();
let fail = 0;
for (const r of results) {
  if (!r.ok) fail++;
  console.log(`${r.ok ? "✓" : "✗"} ${r.name}${r.info ? " — " + r.info : ""}`);
}
console.log(`\n${results.length - fail}/${results.length} testes passaram.`);
process.exit(fail ? 1 : 0);
