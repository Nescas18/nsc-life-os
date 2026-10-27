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
  const pct = () => o.page.evaluate(() => document.querySelector("#view .rs .gl b").firstChild.textContent.trim());
  await setDb(o.page, { cfg: { pass: OFF, goal: 300 } });
  eq("não iniciada", await pct(), "0%");
  await setDb(o.page, { cfg: { pass: OFF, goal: 300 }, tx: [tx({ d: T, type: "in", app: "uber", v: 150 })] });
  eq("parcial", await pct(), "50%");
  await setDb(o.page, { cfg: { pass: OFF, goal: 300 }, tx: [tx({ d: T, type: "in", app: "uber", v: 300 })] });
  eq("concluída", await pct(), "100%");
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
  await o.page.waitForTimeout(150);
  await o.page.click(`[data-edit="${id}"]`);
  await o.page.waitForSelector("#modal.on #mbox form[data-form=edtx]");
  await o.page.waitForTimeout(100); // o modal foca o primeiro campo após 30 ms; preencher antes disso manda o texto para o campo errado
  await o.page.fill('#mbox form[data-form=edtx] input[name=v]', "250,00");
  await o.page.click('#mbox form[data-form=edtx] button.btn');
  s = await cs(o.page, T); eq("faturamento após editar", s.inc, 250); eq("lucro após editar", s.op, 221);
  await o.page.click(`[data-del="tx:${id}"]`);
  await o.page.click("#mbox [data-delok]"); // exclusão pede confirmação
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

/* ===== Cenários da auditoria financeira (NESC 2.0) ===== */
await test("A. Somente receita: Uber 100 + 99 50", async (keep) => {
  const o = await open(); keep(o.ctx);
  await setDb(o.page, { cfg: { pass: OFF }, tx: [tx({ d: T, type: "in", app: "uber", v: 100 }), tx({ d: T, type: "in", app: "n99", v: 50 })] });
  const s = await cs(o.page, T); eq("faturamento", s.inc, 150); eq("despesas", s.expTot, 0); eq("lucro operacional", s.op, 150);
});
await test("B. Receita e despesas: 200 + 100 − 80", async (keep) => {
  const o = await open(); keep(o.ctx);
  await setDb(o.page, { cfg: { pass: OFF }, tx: [tx({ d: T, type: "in", app: "uber", v: 200 }), tx({ d: T, type: "in", app: "n99", v: 100 }), tx({ d: T, type: "fuel", app: "veic", v: 50, unit: "L" }), tx({ d: T, type: "other", app: "veic", v: 30, desc: "Alimentação" })] });
  const s = await cs(o.page, T); eq("faturamento", s.inc, 300); eq("despesas", s.expTot, 80); eq("lucro operacional", s.op, 220);
});
await test("C. Somente despesas: −50", async (keep) => {
  const o = await open(); keep(o.ctx);
  await setDb(o.page, { cfg: { pass: OFF }, tx: [tx({ d: T, type: "other", app: "veic", v: 50 })] });
  const s = await cs(o.page, T); eq("faturamento", s.inc, 0); eq("resultado operacional", s.op, -50);
});
await test("D. Meta ultrapassada: 546 ÷ 220 = 248,18% (sem teto no número, barra em 100%)", async (keep) => {
  const o = await open(); keep(o.ctx);
  await setDb(o.page, { cfg: { pass: OFF, goal: 220 }, tx: [tx({ d: T, type: "in", app: "uber", v: 300 }), tx({ d: T, type: "in", app: "n99", v: 246 })] });
  const g = await o.page.evaluate(() => goalPct(CS(TODAY(), TODAY()).inc, cfg().goal));
  eq("percentual", g.pct, 248.18); eq("barra", g.bar, 100); eq("superada", g.over, true);
  const t = await o.page.evaluate(() => document.querySelector("#view .rs .gl").textContent);
  if (!t.includes("248,18%")) throw new Error("Início não mostrou 248,18%: " + t);
  await o.page.evaluate(() => { tab = "metas"; render(); });
  const m = await o.page.evaluate(() => document.querySelector(".gauge").textContent.replace(/\s+/g, " "));
  if (!m.includes("248,18%") || !m.includes("R$ 546,00") || !m.includes("R$ 220,00")) throw new Error("Metas: " + m.slice(0, 160));
});
await test("D2. Meta zerada ou ausente não gera percentual", async (keep) => {
  const o = await open(); keep(o.ctx);
  const r = await o.page.evaluate(() => [goalPct(100, 0), goalPct(100, undefined), goalPct(0, 220)]);
  eq("meta 0", r[0].has, false); eq("sem meta", r[1].has, false); eq("0 de 220", r[2].pct, 0);
});
await test("D3. Meta de lucro compara com lucro operacional, não com faturamento", async (keep) => {
  const o = await open(); keep(o.ctx);
  await setDb(o.page, { cfg: { pass: OFF }, tx: [tx({ d: T, type: "in", app: "uber", v: 300 }), tx({ d: T, type: "fuel", app: "veic", v: 75, unit: "L" })], goals: [{ id: "g1", kind: "fin", metric: "lucro", per: "dia", target: 150 }, { id: "g2", kind: "fin", metric: "desp", per: "dia", target: 80 }] });
  const r = await o.page.evaluate(() => [goalProgress(db.goals[0]), goalProgress(db.goals[1])]);
  eq("lucro realizado", r[0].real, 225); eq("atingimento do lucro", r[0].pct, 150); eq("despesas dentro do limite", r[1].ok, true); eq("despesas usadas", r[1].pct, 93.75);
});
await test("E. Sem registros: nada inventado; dia sem registro ≠ dia confirmado sem trabalho", async (keep) => {
  const o = await open(); keep(o.ctx);
  await setDb(o.page, { cfg: { pass: OFF, workDays: [1, 2, 3, 4, 5] }, tx: [tx({ d: "2026-10-19", type: "in", app: "uber", v: 100 })], off: { "2026-10-22": { v: true, at: 1 } } });
  const r = await o.page.evaluate(() => ({ pend: pendingDays(14), cs: CS("2026-10-20", "2026-10-25").inc, chart: chartData("2026-10-21", "2026-10-23").map((x) => [x.d, x.has, x.off]) }));
  eq("faturamento sem registros", r.cs, 0);
  if (r.pend.includes("2026-10-22")) throw new Error("dia confirmado sem trabalho apareceu como pendente");
  if (!r.pend.includes("2026-10-23") || r.pend.includes("2026-10-25") || r.pend.includes("2026-10-26")) throw new Error("pendências erradas: " + r.pend.join(","));
  eq("gráfico: 22/10 é folga, não R$ 0", JSON.stringify(r.chart), JSON.stringify([["2026-10-21", false, false], ["2026-10-22", false, true], ["2026-10-23", false, false]]));
});
await test("F. Manutenção: entra uma vez (resultado completo), sem desconto duplo", async (keep) => {
  const o = await open(); keep(o.ctx);
  await setDb(o.page, { cfg: { pass: OFF }, tx: [tx({ d: T, type: "in", app: "uber", v: 300 }), tx({ d: T, type: "fuel", app: "veic", v: 50, unit: "L" }), tx({ id: "tm", d: T, type: "maint", app: "veic", v: 30, desc: "Manutenção: Óleo do motor" })], maint: [{ id: "m1", comp: "oleo", d: T, odo: 73500, part: 20, labor: 10, txId: "tm", at: 1 }] });
  const s = await cs(o.page, T); eq("lucro operacional (sem manutenção)", s.op, 250); eq("resultado com combustível e manutenção", s.full, 220); eq("despesas lançadas", s.expTot, 80);
  const h = await o.page.evaluate(() => histItems().filter((x) => x.k === "maint" || x.k === "mrec").length);
  eq("manutenção listada uma vez no histórico", h, 1);
});
await test("G. Criar, editar e excluir pelo histórico sem resíduo", async (keep) => {
  const o = await open(); keep(o.ctx);
  await setDb(o.page, { cfg: { pass: OFF } });
  await o.page.evaluate(() => { tab = "uber"; render(); });
  await o.page.fill('#reg form[data-form=inc] input[name=v]', "120,35");
  await o.page.click('#reg form[data-form=inc] button.btn');
  const id = await o.page.evaluate(() => db.tx[0].id);
  await o.page.evaluate(() => { tab = "historico"; render(); });
  await o.page.click(`tr[data-hitem="tx:${id}"]`);
  await o.page.click("#mbox [data-edit]");
  await o.page.fill('#mbox form[data-form=edtx] input[name=v]', "130,40");
  await o.page.click('#mbox form[data-form=edtx] button.btn');
  eq("após editar", (await cs(o.page, T)).inc, 130.4);
  await o.page.click(`tr[data-hitem="tx:${id}"]`);
  await o.page.click("#mbox [data-del]");
  await o.page.click("#mbox [data-delok]");
  const s = await cs(o.page, T); eq("após excluir", s.inc, 0); eq("lucro após excluir", s.op, 0);
  eq("itens no histórico", await o.page.evaluate(() => histItems().length), 0);
});
await test("H. Histórico soma o mesmo que o motor e respeita filtros", async (keep) => {
  const o = await open(); keep(o.ctx);
  await setDb(o.page, { cfg: { pass: OFF }, tx: [tx({ d: T, type: "in", app: "uber", v: 10.1 }), tx({ d: T, type: "in", app: "n99", v: 20.2 }), tx({ d: "2026-10-20", type: "in", app: "uber", v: 0.3 }), tx({ d: "2026-09-30", type: "in", app: "uber", v: 999 }), tx({ d: T, type: "fuel", app: "veic", v: 40.05, unit: "L" })] });
  await o.page.evaluate(() => { tab = "historico"; hf.per = "m"; hf.type = "all"; render(); });
  const t = await o.page.evaluate(() => document.querySelector("#view .stats").textContent.replace(/\s+/g, " "));
  const c = await cs(o.page, "2026-10-01", T);
  eq("faturamento do mês (motor)", c.inc, 30.6);
  if (!t.includes("R$ 30,60") || !t.includes("R$ 40,05")) throw new Error("totais do histórico: " + t);
  await o.page.click('[data-htype="n99"]');
  const n = await o.page.evaluate(() => document.querySelectorAll(".htab tbody tr").length);
  eq("filtro 99", n, 1);
});
await test("I. Sincronização não duplica o mesmo registro (nuvem + aparelho)", async (keep) => {
  const o = await open(); keep(o.ctx);
  const r = await o.page.evaluate(() => { const a = Object.assign(empty(), { tx: [{ id: "x1", d: "2026-10-27", type: "in", app: "uber", v: 100, at: 1 }] }), b = Object.assign(empty(), { tx: [{ id: "x1", d: "2026-10-27", type: "in", app: "uber", v: 120, at: 2 }] }); const m = mergeDb(a, b); return { n: m.tx.length, v: m.tx[0].v }; });
  eq("registros após mesclar", r.n, 1); eq("versão mais recente", r.v, 120);
});
await test("J. Centavos: 0,1 + 0,2 e arredondamento de 1,005", async (keep) => {
  const o = await open(); keep(o.ctx);
  const r = await o.page.evaluate(() => [sum([{ v: 0.1 }, { v: 0.2 }]), r2(1.005), r2(-1.005), sum([{ v: 19.99 }, { v: 0.01 }, { v: 33.33 }])]);
  eq("0,1 + 0,2", r[0], 0.3, 0); eq("1,005", r[1], 1.01, 0); eq("−1,005", r[2], -1.01, 0); eq("soma", r[3], 53.33, 0);
});

// ---------- Horas trabalhadas (campos Horas/Minutos, formato e regras) ----------
const durMin = (page, h, m) => page.evaluate(([h, m]) => durMin(h, m), [h, m]);
const prodP = (page, f, t) => page.evaluate(([f, t]) => { const p = prodSum(f, t); return { n: p.n, hd: p.hd, noH: p.noH, min: p.min, hOp: p.hOp, nph: p.nph, avg: p.avg, off: p.off, incCost: p.c.opCost, op: p.c.op, energy: p.c.energy, estFuel: p.c.estFuel }; }, [f, t || f]);

await test("Horas A: 6h30min = 390 e 7h = 420 minutos", async (keep) => {
  const o = await open(); keep(o.ctx);
  eq("6h30", (await durMin(o.page, "6", "30")).min, 390);
  eq("7h", (await durMin(o.page, "7", "")).min, 420);
  eq("formato 390", await o.page.evaluate(() => fmtDur(390)), "6h30min");
  eq("formato 420", await o.page.evaluate(() => fmtDur(420)), "7h00min");
});
await test("Horas B: 6h30 + 7h no mesmo dia (apps diferentes) somam 13h30min", async (keep) => {
  const o = await open(); keep(o.ctx);
  await setDb(o.page, { cfg: { pass: OFF }, jr: [{ id: "u", d: T, app: "uber", v: 2, min: 390, periods: [] }, { id: "n", d: T, app: "n99", v: 2, min: 420, periods: [] }] });
  eq("driverMin soma apps distintos", (await prodP(o.page, T)).min, 810);
  eq("rótulo", await o.page.evaluate(() => fmtDur(810)), "13h30min");
});
await test("Horas C: campo inválido (minutos 75, 6h75) é recusado sem arredondar", async (keep) => {
  const o = await open(); keep(o.ctx);
  const r = await durMin(o.page, "6", "75");
  if (r.ok) throw new Error("6h75 deveria ser inválido: " + JSON.stringify(r));
  eq("horas com texto também recusa", (await durMin(o.page, "6,5", "")).ok, false);
  eq("vazios = não informado", (await durMin(o.page, "", "")).min, null);
  eq(">9h permitido", (await durMin(o.page, "12", "15")).min, 735);
});
await test("Horas D: lucro operacional por hora = R$ 44 (300 − 80 em 5h)", async (keep) => {
  const o = await open(); keep(o.ctx);
  await setDb(o.page, { cfg: { pass: OFF, kml: 0, price: 0 }, tx: [tx({ d: T, type: "in", app: "uber", v: 300 }), tx({ d: T, type: "fuel", app: "veic", v: 80, unit: "L" })], jr: [{ id: "j", d: T, app: "uber", v: 2, min: 300, periods: [] }] });
  const p = await prodP(o.page, T);
  eq("lucro op", p.op, 220); eq("horas", p.min, 300); eq("lucro/h", p.nph, 44);
});
await test("Horas E: sem horas informadas, lucro/h fica indefinido (Sem dados de horas)", async (keep) => {
  const o = await open(); keep(o.ctx);
  await setDb(o.page, { cfg: { pass: OFF }, tx: [tx({ d: T, type: "in", app: "uber", v: 300 })], jr: [{ id: "j", d: T, app: "uber", v: 2, min: 0, periods: [] }] });
  const p = await prodP(o.page, T);
  eq("dias", p.n, 1); eq("dias com horas", p.hd, 0); if (p.nph !== null) throw new Error("lucro/h deveria ser nulo: " + p.nph);
  await o.page.evaluate(() => { tab = "produtividade"; pper = "30"; render(); });
  const txt = await o.page.evaluate(() => document.querySelector("#view").textContent);
  if (!txt.includes("Sem dados de horas")) throw new Error("a tela não mostra 'Sem dados de horas'");
});
await test("Horas F: Uber + 99 no mesmo dia marcados como simultâneos não dobram as horas", async (keep) => {
  const o = await open(); keep(o.ctx);
  await setDb(o.page, { cfg: { pass: OFF }, jr: [{ id: "u", d: T, app: "uber", v: 2, min: 300, periods: [], overlap: true }, { id: "n", d: T, app: "n99", v: 2, min: 240, periods: [], overlap: true }] });
  eq("horas = máx dos apps (sobreposição)", (await prodP(o.page, T)).min, 300);
});
await test("Horas G: editar as horas atualiza o resumo", async (keep) => {
  const o = await open(); keep(o.ctx);
  await setDb(o.page, { cfg: { pass: OFF }, tx: [tx({ d: T, type: "in", app: "uber", v: 200 })], jr: [{ id: "j", d: T, app: "uber", v: 2, min: 240, periods: [] }] });
  eq("antes", (await prodP(o.page, T)).min, 240);
  await o.page.evaluate(() => { const j = db.jr.find((x) => x.id === "j"); j.min = 360; Store.save(); render(); });
  eq("depois", (await prodP(o.page, T)).min, 360);
});
await test("Horas H: estimativa por km não é contada quando há combustível registrado", async (keep) => {
  const o = await open(); keep(o.ctx);
  await setDb(o.page, { cfg: { pass: OFF, kml: 10, price: 6 }, tx: [tx({ d: T, type: "in", app: "uber", v: 300 }), tx({ d: T, type: "fuel", app: "veic", v: 80, unit: "L" })], jr: [{ id: "j", d: T, app: "uber", v: 2, min: 300, periods: [], km: 120 }] });
  const p = await prodP(o.page, T);
  eq("energia registrada", p.energy, 80); eq("lucro op (sem somar estimativa)", p.op, 220); eq("estimativa à parte", p.estFuel, 0);
  await setDb(o.page, { cfg: { pass: OFF, kml: 10, price: 6 }, tx: [tx({ d: T, type: "in", app: "uber", v: 300 })], jr: [{ id: "j", d: T, app: "uber", v: 2, min: 300, periods: [], km: 120 }] });
  const q = await prodP(o.page, T);
  eq("sem combustível registrado: energia 0", q.energy, 0); eq("estimativa calculada (120 km × 0,60)", q.estFuel, 72);
});
await test("Horas I: período sem registros × dia confirmado como folga", async (keep) => {
  const o = await open(); keep(o.ctx);
  await setDb(o.page, { cfg: { pass: OFF }, off: { "2026-10-20": { v: true, at: 1 } }, tx: [tx({ d: "2026-10-22", type: "in", app: "uber", v: 100 })], jr: [{ id: "j", d: "2026-10-22", app: "uber", v: 2, min: 300, periods: [] }] });
  const p = await prodP(o.page, "2026-10-19", "2026-10-21");
  eq("dias com registro no intervalo vazio", p.n, 0); eq("folga confirmada contabilizada", p.off, 1);
  const p2 = await prodP(o.page, "2026-10-01", T);
  eq("um dia registrado no mês", p2.n, 1);
});
await test("Horas J: revisão só sugere correção coerente (6,30 → 6h30), nunca às cegas", async (keep) => {
  const o = await open(); keep(o.ctx);
  const r = await o.page.evaluate(() => {
    const s378 = hrsSuspect({ v: 2, min: 378, periods: [] }); // 6h18 → 6h30
    const s390 = hrsSuspect({ v: 2, min: 390, periods: [] }); // já é 6h30, não sugere
    const s400 = hrsSuspect({ v: 2, min: 400, periods: [] }); // 6h40 não vem de decimal → não sugere
    const sOk = hrsSuspect({ v: 2, min: 378, periods: [], hrsOk: true }); // já confirmado
    return { s378, s390, s400, sOk };
  });
  if (!r.s378 || r.s378.to !== 390) throw new Error("6h18 deveria sugerir 6h30: " + JSON.stringify(r.s378));
  if (r.s390 || r.s400 || r.sOk) throw new Error("sugestão indevida: " + JSON.stringify(r));
});

// ---------- Combustível: consumo do dia (km/L) e prioridade registrado → manual → padrão ----------
const est = (page, f, t) => page.evaluate(([f, t]) => { const s = CS(f, t); return { energy: s.energy, estFuel: s.estFuel, lit: s.litersEst, missing: s.estMissing, manual: s.estManual, op: s.op }; }, [f, t || f]);
await test("Combustível K: 180 km a 12 km/L informado no dia e R$ 6,00/L → 15 L e R$ 90,00 estimados", async (keep) => {
  const o = await open(); keep(o.ctx);
  await setDb(o.page, { cfg: { pass: OFF, kml: 10, price: 6 }, tx: [tx({ d: T, type: "in", app: "uber", v: 300 })], jr: [{ id: "j", d: T, app: "uber", v: 2, min: 300, periods: [], km: 180, kml: 12 }] });
  const e = await est(o.page, T);
  eq("custo estimado", e.estFuel, 90); eq("litros estimados", e.lit, 15); eq("usa consumo do dia", e.manual, true);
  eq("lucro operacional não desconta estimativa", e.op, 300); eq("energia registrada", e.energy, 0);
});
await test("Combustível L: sem consumo do dia, usa o padrão do veículo (180 km ÷ 10 km/L × 6 = R$ 108)", async (keep) => {
  const o = await open(); keep(o.ctx);
  await setDb(o.page, { cfg: { pass: OFF, kml: 10, price: 6 }, jr: [{ id: "j", d: T, app: "uber", v: 2, min: 300, periods: [], km: 180 }] });
  const e = await est(o.page, T);
  eq("custo estimado", e.estFuel, 108); eq("consumo padrão", e.manual, false);
});
await test("Combustível M: gasto real registrado prevalece; km/L do dia não cria segunda despesa", async (keep) => {
  const o = await open(); keep(o.ctx);
  await setDb(o.page, { cfg: { pass: OFF, kml: 10, price: 6 }, tx: [tx({ d: T, type: "in", app: "uber", v: 300 }), tx({ d: T, type: "fuel", app: "veic", v: 95, unit: "L" })], jr: [{ id: "j", d: T, app: "uber", v: 2, min: 300, periods: [], km: 180, kml: 12 }] });
  const e = await est(o.page, T);
  eq("energia = registrado", e.energy, 95); eq("sem estimativa", e.estFuel, 0); eq("lucro", e.op, 205);
});
await test("Combustível N: km sem preço do litro → não estima e avisa (nada inventado)", async (keep) => {
  const o = await open(); keep(o.ctx);
  await setDb(o.page, { cfg: { pass: OFF, kml: 10, price: 0 }, jr: [{ id: "j", d: T, app: "uber", v: 2, min: 60, periods: [], km: 50 }] });
  const e = await est(o.page, T);
  eq("custo", e.estFuel, 0); eq("aviso de dados insuficientes", e.missing, true);
  const e2 = await (async () => { await setDb(o.page, { cfg: { pass: OFF, kml: 10, price: 6 }, jr: [{ id: "j", d: T, app: "uber", v: 2, min: 60, periods: [] }] }); return est(o.page, T); })();
  eq("sem km não há estimativa", e2.estFuel, 0); eq("sem km não é 'dados insuficientes'", e2.missing, false);
});
await test("Combustível O: km/L do dia inválido é recusado no formulário", async (keep) => {
  const o = await open(); keep(o.ctx);
  await setDb(o.page, { cfg: { pass: OFF, kml: 10, price: 6 } });
  await o.page.evaluate(() => { tab = "uber"; lm = "jr"; render(); });
  const r = await o.page.evaluate(() => { const f = document.querySelector('#view form[data-form="jr"]'); f.hh.value = "5"; f.mm.value = "0"; f.kmlDay.value = "0,5"; f.requestSubmit(); return { err: f.querySelector("[data-err]").textContent, n: db.jr.length }; });
  if (!/Consumo do dia inválido/.test(r.err) || r.n !== 0) throw new Error(JSON.stringify(r));
  const r2 = await o.page.evaluate(() => { const f = document.querySelector('#view form[data-form="jr"]'); f.kmlDay.value = "12,4"; f.requestSubmit(); return db.jr.map((j) => j.kml); });
  eq("gravado na jornada", r2[0], 12.4);
  eq("padrão do veículo intacto", await o.page.evaluate(() => cfg().kml), 10);
});

// ---------- Promoções manuais ----------
const submitInc = (page, v, promo, mode) => page.evaluate(([v, promo, mode]) => { const f = document.querySelector('#view form[data-form="inc"]'); f.v.value = v; f.promo.value = promo; f.querySelector(`input[name=promoMode][value=${mode}]`).checked = true; f.requestSubmit(); return { err: f.querySelector("[data-err]").textContent }; }, [v, promo, mode]);
await test("Promoção A: 'já está no valor' guarda o detalhe sem somar de novo (300 com 50 de promoção = 300)", async (keep) => {
  const o = await open(); keep(o.ctx);
  await setDb(o.page, { cfg: { pass: OFF } });
  await o.page.evaluate(() => { tab = "uber"; render(); });
  await submitInc(o.page, "300", "50", "in");
  const r = await o.page.evaluate((t) => { const s = CS(t, t); return { inc: s.inc, promo: s.promo, n: db.tx.length }; }, T);
  eq("faturamento", r.inc, 300); eq("promoção detalhada", r.promo, 50); eq("um lançamento", r.n, 1);
});
await test("Promoção B: 'é um valor a mais' vira lançamento próprio, somado uma vez (300 + 50 = 350)", async (keep) => {
  const o = await open(); keep(o.ctx);
  await setDb(o.page, { cfg: { pass: OFF } });
  await o.page.evaluate(() => { tab = "n99"; render(); });
  await submitInc(o.page, "300", "50", "add");
  const r = await o.page.evaluate((t) => { const s = CS(t, t); return { inc: s.inc, promo: s.promo, n: db.tx.length, kinds: db.tx.map((x) => x.kind || "") }; }, T);
  eq("faturamento", r.inc, 350); eq("promoções", r.promo, 50); eq("dois lançamentos", r.n, 2);
});
await test("Promoção C: incluída maior que o ganho é recusada; promoção sozinha 'a mais' é aceita", async (keep) => {
  const o = await open(); keep(o.ctx);
  await setDb(o.page, { cfg: { pass: OFF } });
  await o.page.evaluate(() => { tab = "uber"; render(); });
  const e = await submitInc(o.page, "40", "50", "in");
  if (!/não pode ser maior/.test(e.err)) throw new Error("esperava recusa: " + e.err);
  await submitInc(o.page, "", "25,50", "add");
  const r = await o.page.evaluate((t) => ({ inc: CS(t, t).inc, n: db.tx.length }), T);
  eq("só a promoção", r.inc, 25.5); eq("um lançamento", r.n, 1);
});
await test("Promoção D: substituir o ganho do dia não apaga a promoção 'a mais' nem a duplica", async (keep) => {
  const o = await open(); keep(o.ctx);
  await setDb(o.page, { cfg: { pass: OFF }, tx: [tx({ d: T, type: "in", app: "uber", v: 200 }), tx({ d: T, type: "in", app: "uber", v: 30, kind: "promo", promo: 30, desc: "Promoção/incentivo Uber" })] });
  await o.page.evaluate(() => { tab = "uber"; render(); });
  await submitInc(o.page, "260", "", "in");
  await o.page.click('[data-dup="replace"]');
  const r = await o.page.evaluate((t) => { const s = CS(t, t); return { inc: s.inc, promo: s.promo }; }, T);
  eq("faturamento = 260 + 30", r.inc, 290); eq("promoção preservada", r.promo, 30);
});

await test("Histórico compacto: explicação recolhida, dias sem registro com contagem real, lista completa e ação na data certa", async (keep) => {
  const o = await open(); keep(o.ctx);
  // relógio em 26/10 (segunda). Seg–sex habituais; registros em 19 e 20/10; 22/10 marcado como não trabalhado → pendentes 21 e 23/10 (24–25 fim de semana, 26 é hoje)
  await setDb(o.page, { cfg: { pass: OFF, workDays: [1, 2, 3, 4, 5] }, tx: [tx({ d: "2026-10-19", type: "in", app: "uber", v: 100 }), tx({ d: "2026-10-20", type: "in", app: "uber", v: 100 })], off: { "2026-10-22": { v: true, at: 1 } } });
  await o.page.evaluate(() => { tab = "historico"; hf.per = "m"; render(); });
  const r = await o.page.evaluate(() => ({ open: !!document.getElementById("tipbox")?.isConnected || /somam os lançamentos/.test(document.querySelector("#view").innerText), n: document.querySelector(".pendn")?.textContent, rows: [...document.querySelectorAll(".pendc .pendr")].map((x) => x.querySelector("[data-pendrec]").dataset.pendrec), visible: [...document.querySelectorAll(".pendc > .pendl .pendr")].length }));
  eq("explicação só aparece quando pedida", r.open, false);
  await o.page.click("#view .cardh .itip");
  const tipTxt = await o.page.evaluate(() => document.getElementById("tipbox")?.innerText || "");
  if (!/Passes entram pelo valor pago/.test(tipTxt) || !/ficam fora desses totais/.test(tipTxt)) throw new Error("explicação do resumo: " + tipTxt);
  await o.page.keyboard.press("Escape");
  if (r.rows.includes("2026-10-22")) throw new Error("dia marcado como não trabalhado apareceu: " + r.rows);
  if (r.rows.some((d) => d >= T)) throw new Error("hoje/futuro tratado como esquecido: " + r.rows);
  eq("pendentes esperados", r.rows.slice().sort().join(","), "2026-10-21,2026-10-23");
  eq("contagem", r.n, r.rows.length + " dias"); if (r.visible > 2) throw new Error("mais de 2 datas visíveis sem expandir");
  const first = r.rows[0];
  await o.page.click(`.pendc [data-offday="${first}"]`);
  const after = await o.page.evaluate((d) => ({ off: isOff(d), still: [...document.querySelectorAll(".pendc [data-pendrec]")].some((b) => b.dataset.pendrec === d) }), first);
  eq("marcado como não trabalhado", after.off, true); eq("sai do aviso", after.still, false);
  return r.rows.length + " dia(s) pendente(s): " + r.rows.join(", ");
});

// ---------- Cores do resultado financeiro (mesma regra em Uber, 99, Início e Relatórios) ----------
await test("Cores: regra central — 350−120 lucro, 100−130 prejuízo, 150−149 equilíbrio; prejuízo grande nunca vira neutro", async (keep) => {
  const o = await open(); keep(o.ctx);
  const r = await o.page.evaluate(() => ({ a: resTone(230, 350), b: resTone(-30, 100), c: resTone(1, 150), z: resTone(0, 0), big: resTone(-25, 2000), small: resTone(6, 100), edge: resTone(-5, 100) }));
  eq("lucro 230", r.a, "pos"); eq("prejuízo −30", r.b, "neg"); eq("equilíbrio 1", r.c, "even"); eq("zero", r.z, "even");
  eq("−25 com faturamento alto continua prejuízo (teto R$ 20)", r.big, "neg"); eq("R$ 6 em R$ 100 já é lucro", r.small, "pos"); eq("−R$ 5 em R$ 100 é equilíbrio", r.edge, "even");
});
for (const [app, nm] of [["uber", "Uber"], ["n99", "99"]]) {
  await test(`Cores na aba ${nm}: card de lucro, resultado completo e lista de dias usam a mesma regra`, async (keep) => {
    const o = await open(); keep(o.ctx);
    const D1 = "2026-10-24", D2 = "2026-10-25";
    await setDb(o.page, { cfg: { pass: OFF }, tx: [
      tx({ d: T, type: "in", app, v: 350 }), tx({ d: T, type: "other", app, v: 120 }),
      tx({ d: D1, type: "in", app, v: 100 }), tx({ d: D1, type: "other", app, v: 130 }),
      tx({ d: D2, type: "in", app, v: 150 }), tx({ d: D2, type: "other", app, v: 149 })] });
    await o.page.evaluate((a) => { tab = a; pday = null; render(); }, app);
    const r = await o.page.evaluate(() => {
      const kp = [...document.querySelectorAll("#view .kpi")].find((k) => /Lucro operacional/.test(k.querySelector("h5").textContent));
      const rows = [...document.querySelectorAll("#view .resd .it")].map((it) => ({ d: it.querySelector(".g").firstChild.textContent.trim(), cls: it.querySelector("b").className, v: it.querySelector("b").textContent, tag: it.querySelector(".tag").textContent, col: getComputedStyle(it.querySelector("b")).color }));
      return { kpi: kp.querySelector(".v span").className, kpiCol: getComputedStyle(kp.querySelector(".v span")).color, rows };
    });
    eq("card de lucro de hoje", r.kpi, "res-pos");
    if (r.kpiCol !== "rgb(95, 196, 142)") throw new Error("lucro do card não está verde: " + r.kpiCol);
    const by = Object.fromEntries(r.rows.map((x) => [x.d, x]));
    eq("hoje: lucro", by["26/10/2026"].cls, "res-pos"); eq("rótulo", by["26/10/2026"].tag, "Lucro");
    eq("24/10: prejuízo", by["24/10/2026"].cls, "res-neg"); eq("rótulo", by["24/10/2026"].tag, "Prejuízo");
    eq("25/10: equilíbrio", by["25/10/2026"].cls, "res-even"); eq("rótulo", by["25/10/2026"].tag, "Equilíbrio");
    if (by["24/10/2026"].col !== "rgb(239, 111, 102)") throw new Error("prejuízo não está vermelho: " + by["24/10/2026"].col);
    // valores intactos: só a cor muda
    eq("valor exibido do prejuízo", by["24/10/2026"].v.replace(/\s/g, " "), "-R$ 30,00");
    const c = await cs(o.page, "2026-10-24"); eq("lucro operacional de 24/10 no motor", c.op, -30);
    return r.rows.map((x) => `${x.d} ${x.v} ${x.tag}`).join(" · ");
  });
}
await test("Cores: Início e Relatórios seguem a mesma regra do resultado", async (keep) => {
  const o = await open(); keep(o.ctx);
  await setDb(o.page, { cfg: { pass: OFF }, tx: [tx({ d: T, type: "in", app: "uber", v: 150 }), tx({ d: T, type: "other", app: "uber", v: 149 })] });
  await o.page.evaluate(() => { tab = "hoje"; hper = "d"; render(); });
  const h = await o.page.evaluate(() => [...document.querySelectorAll("#view b")].filter((b) => /res-/.test(b.className)).map((b) => b.className));
  if (!h.includes("res-even")) throw new Error("Início não usa a regra: " + h);
  await o.page.evaluate(() => { tab = "financas"; fper = "d"; render(); });
  const f = await o.page.evaluate(() => [...document.querySelectorAll("#view .big")].map((b) => b.className));
  if (!f.some((c) => /res-even/.test(c))) throw new Error("Relatórios não usa a regra: " + f);
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
