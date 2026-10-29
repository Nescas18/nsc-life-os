// Celular: revisão de horas, relatórios e gráfico de faturamento diário, executados no index.html real em um Chromium (Playwright).
// Larguras 320, 375, 390 e 430 px (celular) e 1280 px (computador). Tudo em modo local, sem Supabase de produção.
// Uso: node tests/mobile.spec.mjs
import http from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let chromium;
try { ({ chromium } = createRequire(import.meta.url)("playwright")); } catch { console.error("Instale o pacote 'playwright'."); process.exit(2); }
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".webp": "image/webp", ".png": "image/png" };
const server = http.createServer(async (req, res) => {
  const p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (p === "/config.js") return res.end("window.NSC_CONFIG={};");
  const f = path.join(ROOT, p === "/" ? "index.html" : p);
  if (!f.startsWith(ROOT) || !existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "content-type": TYPES[path.extname(f)] || "application/octet-stream" });
  res.end(await readFile(f));
});
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
const BASE = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch();
const results = [];
const assert = (c, m) => { if (!c) throw new Error(m); };
const T = "2026-10-27";
const addD = (d, n) => { const x = new Date(d + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const MOBILE = [320, 375, 390, 430];

/* 30 dias com valores grandes, 6 jornadas com horas suspeitas ("6,30" lido como 6h18) e dias da semana sem horas */
function seed({ big = false } = {}) {
  const tx = [], jr = []; let k = 0; const id = () => "s" + k++;
  for (let i = 0; i < 30; i++) { const d = addD(T, -i); const dow = new Date(d + "T12:00:00Z").getUTCDay(); if (dow === 6) continue;
    tx.push({ id: id(), d, type: "in", app: "uber", v: big ? 48712.36 : (i % 3 ? 248.37 + i : 1266.48), at: 1 });
    tx.push({ id: id(), d, type: "in", app: "n99", v: big ? 39876.54 : (i % 2 ? 132.9 : 987.65), at: 1 });
    if (i % 4 === 0) tx.push({ id: id(), d, type: "fuel", app: "veic", v: 120, at: 1 });
    if (i < 6) jr.push({ id: "j" + i, d, app: i % 2 ? "n99" : "uber", v: 2, min: [378, 429, 327, 378, 429, 327][i] });
    else if (dow !== 0 && dow !== 3) jr.push({ id: id(), d, app: "uber", v: 2, min: 480, hrsOk: true }); // domingo e quarta: sem horas
  }
  return { cfg: { pass: { uber: { on: false }, n99: { on: false } }, workDays: [0, 1, 2, 3, 4, 5] }, tx, jr, vehicle: { brand: "Fiat", model: "Argo", custom: true, energy: "flex", body: "hatch" } };
}
async function open(w, { tab = "produtividade", data = seed() } = {}) {
  const mob = w <= 900;
  const ctx = await browser.newContext({ viewport: { width: w, height: mob ? 800 : 860 }, isMobile: mob, hasTouch: mob, timezoneId: "America/Sao_Paulo", locale: "pt-BR" });
  await ctx.route(/cdnjs|cdn\.jsdelivr\.net/, (r) => r.abort());
  const page = await ctx.newPage(); const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  await page.clock.setFixedTime(new Date(T + "T15:00:00-03:00"));
  await page.addInitScript(([s]) => { if (sessionStorage.getItem("__i")) return; sessionStorage.setItem("__i", "1");
    localStorage.setItem("nsc_session", JSON.stringify({ email: "m@n.local", name: "Ana" })); localStorage.setItem("nsc_db_m@n.local", JSON.stringify(s));
    localStorage.setItem("nesc_bot_m@n.local", JSON.stringify({ muted: true })); }, [data]);
  await page.goto(BASE); await page.waitForTimeout(500);
  if (tab) await page.evaluate((t) => { tab = t; render(); }, tab);
  await page.waitForTimeout(150);
  return { ctx, page, errs };
}
/* quebras letra a letra, textos cortados e estouros da tela dentro de um seletor */
const layoutIssues = (page, sel) => page.evaluate((sel) => {
  const bad = [], rg = document.createRange(), vw = document.documentElement.clientWidth;
  for (const root of document.querySelectorAll(sel)) {
    const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: (n) => n.nodeValue.trim() && n.parentElement.closest("thead") === null ? 1 : 3 }); let n;
    while ((n = tw.nextNode())) { rg.selectNodeContents(n); const rs = [...rg.getClientRects()].filter((r) => r.width); const t = n.nodeValue.trim(), words = t.split(/\s+/);
      if (rs.length > words.length + 1) bad.push("quebrado em " + rs.length + " linhas: " + t.slice(0, 24));
      if (rs.some((r) => r.width < 12) && t.length > 2) bad.push("coluna estreita: " + t.slice(0, 24));
      if (/^(\d{2}\/\d{2}\/\d{4}|R\$\s?[\d.,]+(\/h)?|\+?−?R\$\s?[\d.,]+|\d+h\d{2}min)$/.test(t) && rs.length > 1) bad.push("valor/data em mais de uma linha: " + t);
      const box = n.parentElement.closest("td,dd,.hrv-vals>div,.hrv-top,button,th") || n.parentElement; const b = box.getBoundingClientRect();
      if (rs.some((r) => r.right > b.right + 1 || r.left < b.left - 1)) bad.push("texto passa da caixa: " + t.slice(0, 24));
      if (rs.some((r) => r.right > vw + .5 || r.left < -.5)) bad.push("fora da tela: " + t.slice(0, 24)); }
  }
  if (document.documentElement.scrollWidth > vw) bad.push("rolagem horizontal da página: " + document.documentElement.scrollWidth + " > " + vw);
  return [...new Set(bad)];
}, sel);
async function test(name, fn) {
  if (process.env.ONLY && !name.startsWith(process.env.ONLY)) return;
  const ctxs = [];
  try { const r = await fn((c) => (ctxs.push(c), c)); results.push({ name, ok: true, info: r || "" }); }
  catch (e) { results.push({ name, ok: false, info: e.message }); }
  finally { for (const c of ctxs) await c.close(); }
}

await test("1. Revisão de horas em 320–430 px: data em uma linha, texto quebra só entre palavras, botões cabem e dizem o valor aplicado", async (keep) => {
  for (const w of MOBILE) {
    const { ctx, page, errs } = await open(w); keep(ctx);
    const iss = await layoutIssues(page, "#hrs-review");
    assert(!iss.length, `${w}px: ` + iss.join(" | "));
    const r = await page.evaluate(() => { const p = document.getElementById("hrs-review"), P = p.getBoundingClientRect(), d = p.querySelector(".hrv-d"), rg = document.createRange(); rg.selectNodeContents(d);
      const bt = [...p.querySelectorAll("[data-hrsfix]")].map((b) => { const r = b.getBoundingClientRect(); return { t: b.textContent.trim(), l: r.left, r: r.right, w: r.width, h: r.height }; });
      return { P: [P.left, P.right], dateLines: rg.getClientRects().length, date: d.textContent, bt, txtW: p.querySelector(".hrv-why").getBoundingClientRect().width }; });
    assert(r.dateLines === 1 && /^\d{2}\/\d{2}\/\d{4}$/.test(r.date), `${w}px: data em ${r.dateLines} linhas (${r.date})`);
    assert(r.bt.length === 2 && /^Corrigir para \d+h\d{2}min$/.test(r.bt[0].t) && /^Manter \d+h\d{2}min$/.test(r.bt[1].t), `${w}px: rótulos dos botões: ` + JSON.stringify(r.bt.map((b) => b.t)));
    assert(r.bt.every((b) => b.l >= r.P[0] && b.r <= r.P[1] && b.h >= 40), `${w}px: botões fora do painel ou pequenos demais: ` + JSON.stringify(r.bt));
    assert(r.txtW > 200, `${w}px: descrição espremida (${Math.round(r.txtW)}px)`);
    if (w <= 390) assert(r.bt[0].w > (r.P[1] - r.P[0]) * .6, `${w}px: botões deveriam ficar empilhados em largura total`);
    assert(!errs.length, errs.join(" | "));
  }
});
await test("2. Corrigir e Manter alteram só o registro mostrado (valor original guardado) e nada muda sem a escolha do usuário", async (keep) => {
  const { ctx, page } = await open(375); keep(ctx);
  const before = await page.evaluate(() => JSON.stringify(db));
  await page.evaluate(() => { tab = "hoje"; render(); tab = "produtividade"; render(); }); // só mostrar o painel não altera dados
  assert((await page.evaluate(() => JSON.stringify(db))) === before, "renderizar o painel alterou os dados");
  const first = await page.evaluate(() => document.querySelector("#hrs-review [data-hrsfix]").dataset.hrsfix.split(":")[0]);
  await page.click('#hrs-review [data-hrsfix$=":1"]'); await page.waitForTimeout(80);
  const a = await page.evaluate((id) => { const prev = JSON.parse(window.__b || "null"); return { j: db.jr.find((x) => x.id === id), others: db.jr.filter((x) => x.id !== id), tx: db.tx.length }; }, first);
  const b0 = JSON.parse(before);
  assert(a.j.min === 390 && a.j.minOrig === 378 && a.j.hrsOk, "correção: " + JSON.stringify(a.j));
  assert(JSON.stringify(a.others.map((x) => [x.id, x.min, !!x.hrsOk])) === JSON.stringify(b0.jr.filter((x) => x.id !== first).map((x) => [x.id, x.min, !!x.hrsOk])), "outros registros foram alterados");
  assert(a.tx === b0.tx.length, "lançamentos financeiros alterados");
  const second = await page.evaluate(() => document.querySelector("#hrs-review [data-hrsfix]").dataset.hrsfix.split(":")[0]);
  assert(second !== first, "o próximo registro não apareceu");
  await page.click('#hrs-review [data-hrsfix$=":0"]'); await page.waitForTimeout(80);
  const m = await page.evaluate((id) => db.jr.find((x) => x.id === id), second);
  assert(m.hrsOk && m.min === b0.jr.find((x) => x.id === second).min && m.minOrig == null, "manter: " + JSON.stringify(m));
  // persiste no aparelho
  await page.reload(); await page.waitForTimeout(500);
  const p = await page.evaluate(([a, b]) => { const s = JSON.parse(localStorage.getItem("nsc_db_m@n.local")); return [s.jr.find((x) => x.id === a).min, s.jr.find((x) => x.id === b).hrsOk]; }, [first, second]);
  assert(p[0] === 390 && p[1] === true, "não persistiu: " + p);
});
await test("3. Após confirmar, a página fica na mesma posição (sem recarga nem salto); ao final, aviso de conclusão no mesmo lugar", async (keep) => {
  for (const w of [320, 390, 1280]) {
    const { ctx, page } = await open(w); keep(ctx);
    await page.evaluate(() => { window.__mark = 1; const m = document.querySelector("main"), r = document.getElementById("hrs-review"); m.scrollTop += r.getBoundingClientRect().top - 180; });
    await page.waitForTimeout(80);
    const tops = [], total = await page.evaluate(() => hrsReview().length);
    for (let i = 0; i < total; i++) {
      const b = await page.evaluate(() => [document.getElementById("hrs-review").getBoundingClientRect().top, document.querySelector("main").scrollTop]);
      const btn = await page.$('#hrs-review [data-hrsfix$=":' + (i % 2 ? "0" : "1") + '"]'); if (!btn) break;
      await btn.click(); await page.waitForTimeout(60);
      const a = await page.evaluate(() => [document.getElementById("hrs-review").getBoundingClientRect().top, document.querySelector("main").scrollTop]);
      tops.push(Math.round(a[0] - b[0]));
    }
    const fin = await page.evaluate(() => ({ mark: window.__mark, done: !!document.querySelector("#hrs-review.done"), left: hrsReview().length, nav: performance.getEntriesByType("navigation").length }));
    assert(total >= 3 && tops.length === total && tops.every((d) => Math.abs(d) <= 1), `${w}px: o painel saiu do lugar: ` + tops.join(","));
    assert(fin.mark === 1 && fin.done && fin.left === 0, `${w}px: ` + JSON.stringify(fin));
  }
});
await test("4. Uber × 99 com valores grandes: dois cartões empilhados no celular, cinco métricas, valores completos", async (keep) => {
  for (const w of [...MOBILE, 1280]) {
    const { ctx, page } = await open(w, { data: seed({ big: true }) }); keep(ctx);
    const iss = await layoutIssues(page, ".apc");
    assert(!iss.length, `${w}px: ` + iss.join(" | "));
    const r = await page.evaluate(() => { const cs = [...document.querySelectorAll(".apc-c")]; return { n: cs.length, names: cs.map((c) => c.querySelector("h4").textContent.trim()), rows: cs.map((c) => [...c.querySelectorAll("dt")].map((d) => d.textContent)), vals: cs.map((c) => [...c.querySelectorAll("dd")].map((d) => d.textContent.trim())), stacked: cs.length === 2 && cs[1].getBoundingClientRect().top >= cs[0].getBoundingClientRect().bottom - 1 }; });
    assert(r.n === 2 && r.names[0] === "Uber" && r.names[1] === "99", `${w}px: ` + JSON.stringify(r.names));
    for (const rows of r.rows) assert(JSON.stringify(rows) === JSON.stringify(["Dias trabalhados", "Faturamento", "Lucro operacional", "Horas trabalhadas", "Lucro por hora"]), `${w}px: métricas: ` + rows);
    assert(r.vals.flat().filter((v) => /^R\$\s\d{1,3}(\.\d{3})+,\d{2}$/.test(v)).length >= 4, `${w}px: valores grandes incompletos: ` + r.vals.flat());
    if (w <= 430) assert(r.stacked, `${w}px: cartões deveriam estar empilhados`);
  }
});
await test("5. Por dia da semana: tabela no computador, cartões no celular; dias sem horas mostram 'Sem horas registradas'; amostra pequena discreta", async (keep) => {
  for (const w of [...MOBILE, 1280]) {
    const { ctx, page } = await open(w); keep(ctx);
    const iss = await layoutIssues(page, ".dowt");
    assert(!iss.length, `${w}px: ` + iss.join(" | "));
    const r = await page.evaluate(() => { const t = document.querySelector(".dowt"), rows = [...t.querySelectorAll("tbody tr")];
      const noh = rows.filter((tr) => /Sem horas registradas/.test(tr.textContent)).map((tr) => tr.querySelector("th").textContent);
      return { rows: rows.length, noh, headVisible: t.querySelector("thead").getBoundingClientRect().height > 5, cards: getComputedStyle(rows[0]).display, labels: [...rows[0].querySelectorAll("td")].map((td) => td.dataset.l), note: !!t.parentElement.querySelector(".note") }; });
    assert(r.noh.some((d) => /Domingo|Quarta/.test(d)), `${w}px: dia sem horas sem o aviso: ` + JSON.stringify(r));
    assert(JSON.stringify(r.labels) === JSON.stringify(["Dias registrados", "Faturamento", "Horas", "Lucro/h"]), `${w}px: rótulos: ` + r.labels);
    if (w <= 430) assert(!r.headVisible && r.cards === "grid", `${w}px: deveria virar cartões: ` + JSON.stringify(r));
    else assert(r.headVisible && r.cards === "table-row", `${w}px: deveria ser tabela: ` + JSON.stringify(r));
    // a célula "Sem horas registradas" ocupa Horas + Lucro/h: a linha continua alinhada com as demais
    if (w === 1280) { const al = await page.evaluate(() => { const rows = [...document.querySelectorAll(".dowt tbody tr")]; const edge = (tr) => Math.round(tr.lastElementChild.getBoundingClientRect().right); return new Set(rows.map(edge)).size; }); assert(al === 1, "linhas desalinhadas na tabela"); }
  }
  // amostra pequena: aviso discreto na linha e nota
  const { ctx, page } = await open(375, { data: (() => { const s = seed(); s.tx = s.tx.filter((x) => x.d >= addD(T, -9)); s.jr = s.jr.filter((x) => x.d >= addD(T, -9)); return s; })() }); keep(ctx);
  const sm = await page.evaluate(() => ({ tags: [...document.querySelectorAll(".dowt th small")].map((e) => [e.textContent, getComputedStyle(e).fontSize]), note: (document.querySelector(".dowt").parentElement.querySelector(".note") || {}).textContent }));
  assert(sm.tags.length && sm.tags.every(([t, f]) => t === "amostra pequena" && parseFloat(f) <= 12) && /amostra pequena/.test(sm.note || ""), "aviso de amostra pequena: " + JSON.stringify(sm));
});
await test("6. Relatórios: comparação com o período anterior sem rolagem lateral no celular e com a coluna Diferença visível", async (keep) => {
  for (const w of [...MOBILE, 1280]) {
    const { ctx, page } = await open(w, { tab: "financas", data: seed({ big: true }) }); keep(ctx);
    const iss = await layoutIssues(page, ".ctab");
    assert(!iss.length, `${w}px: ` + iss.join(" | "));
    const r = await page.evaluate(() => { const t = document.querySelector(".ctab"), w = t.closest(".scrollx"); const d = [...t.querySelectorAll('td[data-l="Diferença"]')].map((e) => { const r = e.getBoundingClientRect(); return r.right <= w.getBoundingClientRect().right + 1 && r.width > 0; }); return { scroll: t.scrollWidth > w.clientWidth + 1, diffVisible: d.length === 5 && d.every(Boolean) }; });
    assert(!r.scroll && r.diffVisible, `${w}px: ` + JSON.stringify(r));
  }
});
await test("7. Nenhuma aba gera rolagem horizontal da página em 320 px", async (keep) => {
  const { ctx, page } = await open(320); keep(ctx);
  // faixas roláveis de propósito (ex.: filtros em chips, que vão de borda a borda) podem ter conteúdo além da tela: ele rola dentro delas
  const bad = await page.evaluate(() => { const out = [], vw = innerWidth, inScroller = (e) => { for (let p = e.parentElement; p && p.id !== "view"; p = p.parentElement) { const o = getComputedStyle(p).overflowX; if (o === "auto" || o === "scroll") return true; } return false; };
    for (const t of ["hoje", "uber", "n99", "historico", "despesas", "manutencao", "metas", "financas", "config", "produtividade", "ia", "conquistas", "ranking"]) { tab = t; render();
      if (document.documentElement.scrollWidth > vw) out.push(t + ": página " + document.documentElement.scrollWidth);
      document.querySelectorAll("#view *").forEach((e) => { const r = e.getBoundingClientRect(); if (r.width && (r.right > vw + .5 || r.left < -.5) && !inScroller(e) && !e.closest("thead,.sr-only")) out.push(t + ": " + e.tagName + "." + String(e.className).slice(0, 20)); }); }
    return [...new Set(out)]; });
  assert(!bad.length, bad.join(", "));
});

/* ---------- gráfico de faturamento diário (barras) ---------- */
/* últimos 29 dias: T-2 sem registro, T-4 folga confirmada, T-5 só jornada (R$ 0,00), demais com Uber e 99 */
const CV = [401.75, 426.8, 51, 405.48, 405.29, 409.96, 600, 1266.48, 312.1];
function chartSeed() {
  const tx = [], jr = []; let k = 0; const id = () => "g" + k++;
  for (let i = 0; i < 29; i++) { const d = addD(T, -i);
    if (i === 2 || i === 4) continue;
    if (i === 5) { jr.push({ id: id(), d, app: "uber", v: 2, min: 120, hrsOk: true }); continue; }
    const v = CV[i % CV.length]; tx.push({ id: id(), d, type: "in", app: "uber", v: Math.round(v * 62) / 100, at: 1 }); tx.push({ id: id(), d, type: "in", app: "n99", v: Math.round(v * 38) / 100, at: 1 }); }
  return { cfg: { pass: { uber: { on: false }, n99: { on: false } } }, tx, jr, off: { [addD(T, -4)]: { v: true, at: 1 } }, vehicle: { brand: "X", model: "Y", custom: true } };
}
const openChart = async (w, per = "w", app = "tot") => { const o = await open(w, { tab: "hoje", data: chartSeed() }); await o.page.evaluate(([p, a]) => { hper = p; cap = a; render(); }, [per, app]); await o.page.waitForTimeout(1500); return o; };
/* colisões: valor × valor e valor × barra de outra coluna */
const chartIssues = (page) => page.evaluate(() => { const bs = [...document.querySelectorAll("#dchart .bc")], out = [];
  const R = bs.map((b) => b.querySelector(".val").getBoundingClientRect()), BR = bs.map((b) => { const x = b.querySelector(".bar,.mk"); return x ? x.getBoundingClientRect() : null; });
  const hit = (a, c) => a.width && c.width && a.left < c.right - .5 && a.right > c.left + .5 && a.top < c.bottom - .5 && a.bottom > c.top + .5;
  for (let i = 0; i < bs.length; i++) for (let j = 0; j < bs.length; j++) { if (i === j) continue; if (hit(R[i], R[j])) out.push(`valor ${i}×${j}`); if (BR[j] && hit(R[i], BR[j])) out.push(`valor ${i}×barra ${j}`); }
  if (document.documentElement.scrollWidth > innerWidth) out.push("rolagem horizontal da página");
  return [...new Set(out)]; });

await test("8. Gráfico: barras com o faturamento bruto real de cada dia; R$ 0,00 só em dia registrado; sem registro e folga diferenciados; Total = Uber + 99", async (keep) => {
  const { ctx, page } = await openChart(1280); keep(ctx);
  const r = await page.evaluate(() => { const el = document.getElementById("dchart"), f = el.dataset.f, t = el.dataset.t;
    return { lines: el.querySelectorAll("svg path").length, cols: [...el.querySelectorAll(".bc")].map((b) => [b.className.match(/s-(\w+)/)[1], b.querySelector(".val").textContent, !!b.querySelector(".bar")]),
      head: el.querySelector(".bch-k b").textContent, cs: brl(CS(f, t).inc), f, t }; });
  assert(r.lines === 0, "ainda há linhas no gráfico");
  assert(r.head === r.cs, `total do gráfico ${r.head} ≠ faturamento do período ${r.cs}`);
  const exp = []; for (let i = 6; i >= 0; i--) { const v = CV[i % CV.length], u = Math.round(v * 62) / 100, n = Math.round(v * 38) / 100;
    exp.push(i === 2 ? ["none", "—", false] : i === 4 ? ["off", "folga", false] : i === 5 ? ["zero", "R$ 0,00", true] : ["val", "R$ " + (u + n).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }), true]); }
  const norm = (x) => JSON.stringify(x).replace(/ /g, " ");
  assert(norm(r.cols) === norm(exp), "colunas: " + norm(r.cols) + " ≠ " + norm(exp));
  // Uber e 99 separados somam o total do dia (nada contado duas vezes)
  const s = await page.evaluate(() => { const el = document.getElementById("dchart"), f = el.dataset.f, t = el.dataset.t, out = {};
    for (const a of ["tot", "uber", "n99"]) { cap = a; drawChart(); out[a] = [...el.querySelectorAll(".bc")].map((b) => b.querySelector(".val").textContent); out[a + "H"] = el.querySelector(".bch-k b").textContent; }
    out.u = brl(AS("uber", f, t).inc); out.n = brl(AS("n99", f, t).inc); cap = "tot"; drawChart(); return out; });
  assert(s.uberH === s.u && s.n99H === s.n, `totais por app: ${s.uberH}/${s.u} · ${s.n99H}/${s.n}`);
  const num = (x) => +String(x).replace(/[^\d,]/g, "").replace(",", ".") || 0;
  s.tot.forEach((v, i) => { if (/\d/.test(v) && /\d/.test(s.uber[i]) && /\d/.test(s.n99[i])) assert(Math.abs(num(v) - num(s.uber[i]) - num(s.n99[i])) < .005, `dia ${i}: ${v} ≠ ${s.uber[i]} + ${s.n99[i]}`); });
  // o dia só com jornada é R$ 0,00 na Uber (jornada da Uber) e "—" na 99 (nada registrado para a 99)
  assert(/0,00/.test(s.uber[1]) && s.n99[1] === "—", "jornada só da Uber: " + s.uber[1] + " / " + s.n99[1]);
});
await test("9. Gráfico no celular (320–430 px): 7 dias sem rolagem lateral, valores legíveis e sem colisão; no mês, rola só dentro do gráfico a partir do dia mais recente", async (keep) => {
  for (const w of MOBILE) {
    const { ctx, page } = await openChart(w); keep(ctx);
    const iss = await chartIssues(page); assert(!iss.length, `${w}px 7 dias: ` + iss.join(" | "));
    const r = await page.evaluate(() => { const sc = document.querySelector("#dchart .bch-sc"), v = document.querySelector("#dchart .bc .val"); return { scroll: sc.scrollWidth > sc.clientWidth + 1, fs: parseFloat(getComputedStyle(v).fontSize), dl: parseFloat(getComputedStyle(document.querySelector("#dchart .bc .dl")).fontSize) }; });
    assert(!r.scroll && r.fs >= 10 && r.dl >= 10, `${w}px 7 dias: ` + JSON.stringify(r));
    await page.evaluate(() => { hper = "m"; render(); }); await page.waitForTimeout(1200);
    const m = await page.evaluate(() => { const sc = document.querySelector("#dchart .bch-sc"), bs = [...document.querySelectorAll("#dchart .bc")], last = bs[bs.length - 1].getBoundingClientRect(), S = sc.getBoundingClientRect(); return { n: bs.length, scroll: sc.scrollWidth > sc.clientWidth + 1, lastVisible: last.right <= S.right + 1 && last.left >= S.left - 1, page: document.documentElement.scrollWidth <= innerWidth }; });
    assert(m.n >= 27 && m.scroll && m.lastVisible && m.page, `${w}px mês: ` + JSON.stringify(m));
    const im = await chartIssues(page); assert(!im.length, `${w}px mês: ` + im.join(" | "));
  }
});
await test("10. Gráfico no computador: 'R$' acima das barras nos 7 dias; no mês, sem rolagem e com os valores exatos na vertical, sem colisão", async (keep) => {
  const { ctx, page } = await openChart(1280); keep(ctx);
  const a = await page.evaluate(() => [...document.querySelectorAll("#dchart .bc.s-val .val")].map((v) => v.textContent));
  assert(a.length && a.every((v) => /^R\$\s/.test(v)), "valores sem R$: " + a);
  await page.evaluate(() => { hper = "m"; render(); }); await page.waitForTimeout(1500);
  const r = await page.evaluate(() => { const sc = document.querySelector("#dchart .bch-sc"), b = document.querySelector("#dchart .bch"), v = document.querySelector("#dchart .bc.s-val .val"); return { scroll: sc.scrollWidth > sc.clientWidth + 1, vlab: b.classList.contains("vlab"), tr: getComputedStyle(v).transform, fill: getComputedStyle(v).webkitTextFillColor, text: v.textContent }; });
  assert(!r.scroll && r.vlab && r.tr !== "none" && !/rgba\(0, 0, 0, 0\)|transparent/.test(r.fill) && /\d,\d{2}$/.test(r.text), "mês no computador: " + JSON.stringify(r));
  const iss = await chartIssues(page); assert(!iss.length, iss.join(" | "));
});
await test("11. Filtro Total/Uber/99 redesenha só o gráfico com as cores do app; toque numa barra mostra data completa e valor; toque fora fecha", async (keep) => {
  const { ctx, page } = await openChart(390); keep(ctx);
  await page.evaluate(() => { window.__mark = 1; document.getElementById("view").dataset.mark = "1"; });
  for (const [a, c] of [["uber", "rgb(207, 207, 213)"], ["n99", "rgb(239, 207, 18)"], ["tot", "rgb(236, 196, 99)"]]) {
    await page.tap(`#dchart [data-cap="${a}"]`); await page.waitForTimeout(100);
    const r = await page.evaluate(() => ({ app: document.querySelector("#dchart .bch").dataset.app, on: document.querySelector("#dchart [data-cap].on").dataset.cap, c1: getComputedStyle(document.querySelector("#dchart .bch")).getPropertyValue("--c1").trim(), same: document.getElementById("view").dataset.mark === "1" && window.__mark === 1 }));
    assert(r.app === a && r.on === a && r.same, `filtro ${a}: ` + JSON.stringify(r));
    const col = await page.evaluate(() => { const b = document.querySelector("#dchart .bc.s-val:not(.top) .bar"); return getComputedStyle(b).backgroundImage; });
    assert(col.includes(c), `cor das barras em ${a}: ${col}`);
  }
  await page.tap("#dchart .bc.s-val >> nth=-1"); await page.waitForTimeout(80);
  const tip = await page.evaluate(() => { const t = document.querySelector("#dchart .ctip.on"); if (!t) return null; const r = t.getBoundingClientRect(), el = document.getElementById("dchart").getBoundingClientRect(); return { txt: t.textContent, inside: r.left >= el.left - .5 && r.right <= el.right + .5 }; });
  assert(tip && /\d{1,2} de \w+ de 2026/.test(tip.txt) && /Faturamento bruto/.test(tip.txt) && /R\$/.test(tip.txt) && tip.inside, "tooltip: " + JSON.stringify(tip));
  await page.touchscreen.tap(20, 120); await page.waitForTimeout(80);
  assert(!(await page.$("#dchart .ctip.on")), "o tooltip não fechou com toque fora");
  // dia sem registro explica que não é zero
  await page.tap("#dchart .bc.s-none"); const t2 = await page.textContent("#dchart .ctip.on");
  assert(/Sem registro/.test(t2) && /não é R\$ 0,00/.test(t2), "tooltip de dia sem registro: " + t2);
});
await test("12. Comparação com o período anterior só com dados suficientes; animação só quando os dados mudam e nunca com movimento reduzido", async (keep) => {
  const { ctx, page } = await openChart(1280); keep(ctx);
  const c = await page.evaluate(() => document.querySelector("#dchart .bch-m").textContent);
  assert(/[▲▼] [\d,]+% vs 7 dias anteriores/.test(c), "comparação ausente com dados suficientes: " + c);
  const few = await page.evaluate(() => { const keepTx = db.tx; db.tx = db.tx.filter((x) => x.d >= addD(TODAY(), -8)); render(); const t = document.querySelector("#dchart .bch-m").textContent; db.tx = keepTx; render(); return t; });
  assert(!/%/.test(few), "comparou com período anterior sem dados suficientes: " + few);
  const an = await page.evaluate(() => { const a = document.querySelector("#dchart .bch").classList.contains("anim"); dispatchEvent(new Event("resize")); return a; });
  await page.waitForTimeout(300);
  const after = await page.evaluate(() => document.querySelector("#dchart .bch").classList.contains("anim"));
  assert(after === false, "reanimou ao redimensionar (sem mudança nos dados)");
  const ctx2 = await browser.newContext({ viewport: { width: 390, height: 800 }, reducedMotion: "reduce", isMobile: true, hasTouch: true }); keep(ctx2);
  await ctx2.route(/cdnjs|cdn\.jsdelivr\.net/, (r) => r.abort());
  const p2 = await ctx2.newPage(); await p2.clock.setFixedTime(new Date(T + "T15:00:00-03:00"));
  await p2.addInitScript((s) => { localStorage.setItem("nsc_session", JSON.stringify({ email: "m@n.local", name: "Ana" })); localStorage.setItem("nsc_db_m@n.local", JSON.stringify(s)); }, chartSeed());
  await p2.goto(BASE); await p2.waitForTimeout(700);
  const rm = await p2.evaluate(() => ({ cls: document.querySelector("#dchart .bch").className, an: getComputedStyle(document.querySelector("#dchart .bar")).animationName }));
  assert(!/anim/.test(rm.cls) && rm.an === "none", "movimento reduzido ignorado: " + JSON.stringify(rm));
});

await browser.close(); server.close();
let fail = 0;
for (const r of results) { if (!r.ok) fail++; console.log(`${r.ok ? "✓" : "✗"} ${r.name}${r.info ? " — " + r.info : ""}`); }
console.log(`\n${results.length - fail}/${results.length} testes passaram.`);
process.exit(fail ? 1 : 0);
