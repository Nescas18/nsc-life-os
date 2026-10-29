// Testes de interface do NESC (Playwright, modo local — nada toca o Supabase de produção).
// Uso: node tests/ui.spec.mjs   · Opcional: THREE_JS=/caminho/three.min.js para testar também as cenas 3D.
import http from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let chromium;
try {
  ({ chromium } = createRequire(import.meta.url)("playwright"));
} catch {
  console.error("Pacote 'playwright' não encontrado. Instale com: npm i -D playwright && npx playwright install chromium");
  process.exit(2);
}
const THREE_JS = process.env.THREE_JS && existsSync(process.env.THREE_JS) ? readFileSync(process.env.THREE_JS) : null;
const server = http.createServer(async (req, res) => {
  const p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (p === "/config.js") return res.end("window.NSC_CONFIG={};");
  const f = path.join(ROOT, p === "/" ? "index.html" : p);
  if (!f.startsWith(ROOT) || !existsSync(f)) { res.writeHead(404); return res.end(); }
  res.end(await readFile(f));
});
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
const BASE = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const results = [];
async function test(name, fn) {
  if (process.env.ONLY && !name.includes(process.env.ONLY)) return; // ONLY=trecho roda só os testes com esse nome
  const ctxs = [];
  try { results.push({ name, ok: true, info: (await fn((c) => ctxs.push(c))) || "" }); }
  catch (e) { results.push({ name, ok: false, info: e.message.split("\n")[0] }); }
  finally { for (const c of ctxs) await c.close(); }
}
async function ctxFor(keep, opts = {}) {
  const ctx = await browser.newContext({ timezoneId: "America/Sao_Paulo", locale: "pt-BR", viewport: { width: 390, height: 844 }, ...opts });
  await ctx.route(/cdnjs\.cloudflare\.com/, (r) => (THREE_JS && !opts.noWebGL ? r.fulfill({ body: THREE_JS, contentType: "text/javascript" }) : r.abort()));
  await ctx.route(/cdn\.jsdelivr\.net/, (r) => r.abort());
  keep(ctx);
  return ctx;
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const tx = (d, app, v) => ({ id: Math.random().toString(36).slice(2), d, type: "in", app, v, at: 1 });
const SEED = { vehicle: { brand: "Fiat", model: "Argo", custom: true, body: "hatch", energy: "flex", odo: 73500, odoD: "2026-10-20" }, maint: [{ id: "m1", comp: "oleo", d: "2026-09-01", odo: 68000, nextKm: 75000, nkAuto: false, part: 100, labor: 20, at: 1 }], cfg: { goal: 300, pass: { uber: { on: false }, n99: { on: false } } }, tx: [tx("2026-10-26", "uber", 182.4), tx("2026-10-26", "n99", 96.1), tx("2026-10-24", "n99", 120), tx("2026-10-22", "uber", 140)] };
async function loggedPage(ctx, seed = SEED) {
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.clock.setFixedTime(new Date("2026-10-26T15:00:00-03:00"));
  await page.addInitScript((s) => {
    if (sessionStorage.getItem("seeded")) return;
    sessionStorage.setItem("seeded", "1");
    localStorage.setItem("nsc_session", JSON.stringify({ email: "ui@nesc.local", name: "Teste UI" }));
    localStorage.setItem("nsc_db_ui@nesc.local", JSON.stringify(s));
  }, seed);
  await page.goto(BASE);
  await page.waitForSelector("#app.on #view .grid");
  return { page, errors };
}

await test("Login: erro mostra mensagem, marca campos e devolve o botão", async (keep) => {
  const ctx = await ctxFor(keep), page = await ctx.newPage();
  await page.goto(BASE + "#entrar");
  await page.fill("#li-email", "ninguem@nesc.local");
  await page.fill("#li-pass", "senhaerrada");
  await page.click("#form-login .btn-submit");
  await page.waitForFunction(() => document.getElementById("auth-err").textContent.length > 0);
  const st = await page.evaluate(() => ({ msg: document.getElementById("auth-err").textContent, inv: document.getElementById("li-email").getAttribute("aria-invalid"), dis: document.querySelector("#form-login .btn-submit").disabled, lab: document.querySelector("#form-login .bl").textContent }));
  assert(/incorretos/.test(st.msg), "mensagem: " + st.msg);
  assert(st.inv === "true" && !st.dis && st.lab === "Entrar", JSON.stringify(st));
});

await test("Criar conta → entra no app; Sair → volta ao login e recarregar não reabre o app", async (keep) => {
  const ctx = await ctxFor(keep), page = await ctx.newPage();
  await page.goto(BASE + "#criar-conta");
  await page.fill("#re-name", "Pessoa Teste");
  await page.fill("#re-email", "nova@nesc.local");
  await page.fill("#re-pass", "segredo123");
  await page.click("#form-register .btn-submit");
  await page.waitForSelector("#app.on #view .grid", { timeout: 8000 });
  assert(await page.evaluate(() => document.querySelector("#view h1").textContent.includes("Pessoa")), "saudação");
  await page.evaluate(() => openSheet());
  await page.click("#mbox [data-logout]");
  await page.waitForSelector("#form-login", { state: "visible" });
  assert(!(await page.evaluate(() => document.getElementById("app").classList.contains("on"))), "app ainda visível após sair");
  await page.reload();
  await page.waitForTimeout(600);
  assert(await page.isVisible("#form-login"), "login não apareceu após recarregar");
  assert(!(await page.evaluate(() => document.getElementById("app").classList.contains("on"))), "área protegida reabriu após recarregar");
  await page.fill("#li-email", "nova@nesc.local");
  await page.fill("#li-pass", "segredo123");
  await page.click("#form-login .btn-submit");
  await page.waitForSelector("#app.on #view .grid", { timeout: 8000 });
  return "cadastro, saída e novo login ok";
});

await test("Sair pelo menu lateral (desktop)", async (keep) => {
  const ctx = await ctxFor(keep, { viewport: { width: 1280, height: 860 } });
  const { page } = await loggedPage(ctx);
  await page.click("aside .user [data-logout]");
  await page.waitForSelector("#form-login", { state: "visible" });
  await page.reload();
  await page.waitForTimeout(500);
  assert(await page.isVisible("#form-login"), "não voltou ao login");
});

const WIDTHS = [320, 360, 375, 390, 430, 768, 1024, 1440];
await test("Sem rolagem horizontal em 8 larguras (login, todas as áreas e modal de registro)", async (keep) => {
  const bad = [];
  for (const w of WIDTHS) {
    const ctx = await ctxFor(keep, { viewport: { width: w, height: 820 }, hasTouch: w < 700, isMobile: w < 700 });
    const lp = await ctx.newPage();
    await lp.goto(BASE + "#entrar");
    const lw = await lp.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    if (lw > 0) bad.push(`login@${w}: +${lw}px`);
    await lp.close();
    const { page, errors } = await loggedPage(ctx);
    const TABS = await page.evaluate(() => TABS.map((t) => t[0]));
    for (const t of TABS) {
      await page.evaluate((t) => { tab = t; render(); }, t);
      const o = await page.evaluate(() => { const m = document.querySelector("main"), W = m.clientWidth; const out = [...document.querySelectorAll("#view *")].filter((e) => { const r = e.getBoundingClientRect(); return r.width && r.right > W + m.getBoundingClientRect().left + 1 && !e.closest(".scrollx") && !e.closest(".sr-only"); }).slice(0, 3).map((e) => (e.className || e.tagName).toString().slice(0, 30)); return { sw: m.scrollWidth - m.clientWidth, out }; });
      if (o.sw > 0 || o.out.length) bad.push(`${t}@${w}: ${o.sw}px ${o.out.join(",")}`);
    }
    await page.evaluate(() => { tab = "hoje"; render(); openInc("uber"); });
    const mo = await page.evaluate(() => { const b = document.getElementById("mbox").getBoundingClientRect(), f = [...document.querySelectorAll("#mbox .f")].map((e) => e.getBoundingClientRect()); let ov = false; for (let i = 0; i < f.length; i++) for (let j = i + 1; j < f.length; j++) { const a = f[i], c = f[j]; if (a.left < c.right - 1 && c.left < a.right - 1 && a.top < c.bottom - 1 && c.top < a.bottom - 1) ov = true; } return { right: b.right, W: innerWidth, ov }; });
    if (mo.right > mo.W + 1 || mo.ov) bad.push(`modal ganho@${w}: ${JSON.stringify(mo)}`);
    if (errors.length) bad.push(`erros@${w}: ${errors.join(" | ")}`);
  }
  assert(!bad.length, bad.join(" · "));
  return WIDTHS.join(", ") + " px";
});

await test("Gráfico do resumo: barras diárias, valor acima de cada barra, tooltip com a data completa e estado vazio", async (keep) => {
  const ctx = await ctxFor(keep, { viewport: { width: 1280, height: 900 } });
  const { page } = await loggedPage(ctx);
  const r = await page.evaluate(() => ({ lines: document.querySelectorAll("#dchart svg path").length, cols: document.querySelectorAll("#dchart .bc").length, bars: document.querySelectorAll("#dchart .bc .bar").length }));
  assert(r.lines === 0 && r.cols === 7 && r.bars >= 1, "esperava 7 colunas de barras e nenhuma linha: " + JSON.stringify(r));
  const last = page.locator("#dchart .bc").last();
  await last.scrollIntoViewIfNeeded();
  assert(/278,50/.test(await last.locator(".val").textContent()), "valor acima da barra de hoje: " + (await last.locator(".val").textContent()));
  await last.hover();
  const tip = await page.evaluate(() => document.querySelector("#dchart .ctip.on")?.textContent || "");
  assert(tip.includes("26 de outubro de 2026") && tip.includes("278,50"), "tooltip: " + tip);
  await page.evaluate(() => { db.tx = []; db.jr = []; render(); });
  assert(await page.isVisible("#dchart .cempty"), "estado vazio não apareceu");
  await page.click('[data-hper="m"]');
  assert((await page.textContent("#rs-h")).includes("mês"), "período mês");
});

await test("Sem WebGL: login e globo mostram alternativas estáticas, sem erros", async (keep) => {
  const ctx = await ctxFor(keep, { noWebGL: true });
  const p1 = await ctx.newPage();
  const errs = [];
  p1.on("pageerror", (e) => errs.push(e.message));
  await p1.goto(BASE + "#entrar");
  assert(await p1.locator(".gl-fallback").count(), "fallback do login ausente");
  await p1.close();
  const { page, errors } = await loggedPage(ctx);
  assert(await page.locator("#globe .gl-orb").count(), "fallback do globo ausente");
  assert(!errs.length && !errors.length, [...errs, ...errors].join(" | "));
});

await test("Movimento reduzido: app funciona e a frase do login não alterna", async (keep) => {
  const ctx = await ctxFor(keep, { reducedMotion: "reduce" });
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  await page.goto(BASE + "#entrar");
  const a = await page.textContent("#rot");
  await page.waitForTimeout(3300);
  assert((await page.textContent("#rot")) === a, "a frase mudou com movimento reduzido");
  assert(!errs.length, errs.join(" | "));
});

await test("Celular: sem faixa lateral; menu desce com as áreas principais, navega, fecha e o conteúdo usa a largura toda", async (keep) => {
  const ctx = await ctxFor(keep, { viewport: { width: 360, height: 780 }, hasTouch: true, isMobile: true });
  const { page } = await loggedPage(ctx);
  const closed = await page.evaluate(() => ({ bar: document.querySelector("aside").getBoundingClientRect().height, main: document.querySelector("main").getBoundingClientRect().width, vw: innerWidth }));
  assert(closed.bar <= 64, "barra superior alta demais: " + closed.bar);
  assert(closed.main === closed.vw, "o conteúdo não usa a largura toda: " + JSON.stringify(closed));
  assert(!(await page.locator("[data-more]").count()), "ainda existe o botão Mais");
  await page.click("[data-navtog]");
  await page.waitForTimeout(500);
  assert(await page.evaluate(() => document.getElementById("app").classList.contains("navx")), "não abriu");
  assert((await page.getAttribute("[data-navtog]", "aria-expanded")) === "true", "aria-expanded não atualizou");
  const vis = await page.evaluate(() => [...document.querySelectorAll("aside .nav")].filter((b) => { const r = b.getBoundingClientRect(); return r.width > 0 && r.top >= 0 && r.bottom <= innerHeight; }).map((b) => b.dataset.go));
  for (const k of ["hoje", "uber", "n99", "historico", "despesas", "manutencao", "metas", "financas", "config"]) assert(vis.includes(k), "não visível com o menu aberto: " + k + " (" + vis.join(",") + ")");
  await page.click('aside [data-go="historico"]');
  assert(await page.evaluate(() => tab === "historico" && !document.getElementById("app").classList.contains("navx")), "não navegou/fechou");
  await page.click("[data-navtog]"); await page.keyboard.press("Escape");
  assert(await page.evaluate(() => !document.getElementById("app").classList.contains("navx")), "Esc não fechou");
  return "barra de " + closed.bar + " px, conteúdo com " + closed.main + " px";
});
await test("Desktop: menu lateral recolhe e lembra a escolha", async (keep) => {
  const ctx = await ctxFor(keep, { viewport: { width: 1280, height: 860 } });
  const { page } = await loggedPage(ctx);
  await page.click("[data-navtog]");
  await page.waitForTimeout(450); // transição de largura
  const w = await page.evaluate(() => document.querySelector("aside").getBoundingClientRect().width);
  assert(w < 100, "não recolheu: " + w);
  await page.reload(); await page.waitForSelector("#app.on");
  assert(await page.evaluate(() => document.getElementById("app").classList.contains("navc")), "não lembrou");
});
await test("Metas: sugestão abre formulário preenchido e cria meta de faturamento com progresso", async (keep) => {
  const ctx = await ctxFor(keep);
  const { page } = await loggedPage(ctx);
  await page.evaluate(() => { tab = "metas"; render(); });
  await page.click("[data-gsug]");
  assert((await page.inputValue("#g-v")) === "220,00", "valor da sugestão");
  await page.click("#mbox form[data-form=gnew] button.btn");
  const t = await page.evaluate(() => document.querySelector(".it.goal").textContent.replace(/\s+/g, " "));
  assert(/Atingimento: 126,59%/.test(t) && /superada/.test(t), t.slice(0, 200));
  assert(!(await page.evaluate(() => document.body.textContent.includes("Ler 5 páginas"))), "exemplo antigo ainda aparece");
});
await test("Lembrete de dia sem registro: \"Não trabalhei\" grava confirmação separada e some do aviso", async (keep) => {
  const ctx = await ctxFor(keep);
  const seed = Object.assign({}, SEED, { cfg: Object.assign({}, SEED.cfg, { workDays: [0, 1, 2, 3, 4, 5, 6] }) });
  const { page } = await loggedPage(ctx, seed);
  assert(await page.isVisible(".remind [data-offday]"), "lembrete não apareceu");
  const d = await page.getAttribute(".remind [data-offday]", "data-offday");
  const n0 = await page.evaluate(() => db.tx.length);
  await page.click(".remind [data-offday]");
  const r = await page.evaluate((d) => ({ off: db.off[d], n: db.tx.length, still: [...document.querySelectorAll(".remind [data-offday]")].some((b) => b.dataset.offday === d) }), d);
  assert(r.off && r.off.v === true && r.n === n0 && !r.still, JSON.stringify(r));
});
await test("Manutenção: aba própria com quilometragem e \"restam 1.500 km\"; Uber sem bloco de manutenção", async (keep) => {
  const ctx = await ctxFor(keep);
  const { page } = await loggedPage(ctx);
  await page.evaluate(() => { tab = "manutencao"; render(); });
  assert((await page.textContent("#view")).includes("restam 1.500 km"), "distância restante");
  await page.evaluate(() => { tab = "uber"; render(); });
  assert(!(await page.locator("#view #manut").count()), "manutenção ainda dentro da aba Uber");
  await page.evaluate(() => openOnboard());
  await page.waitForTimeout(100); // espera o foco automático do modal (30 ms) para não disputar o preenchimento
  await page.fill("#ob-odo", "-5");
  await page.click("#mbox form[data-form=ob] button.btn");
  const okErr = await page.waitForFunction(() => /inválida/.test((document.getElementById("oberr") || {}).textContent || ""), null, { timeout: 8000 }).then(() => true, () => false);
  assert(okErr, "aceitou km negativo");
});

if (THREE_JS) {
  await test("3D: cenas renderizam e respondem ao mouse sem erros", async (keep) => {
    const ctx = await ctxFor(keep, { viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    const errs = [];
    page.on("pageerror", (e) => errs.push(e.message));
    await page.goto(BASE + "#entrar");
    await page.waitForTimeout(1500);
    assert(await page.evaluate(() => loginOn), "cena do login não iniciou");
    await page.mouse.move(1200, 100);
    await page.waitForTimeout(700);
    const px = await page.evaluate(() => ptr.x);
    assert(px > 0.1, "paralaxe não respondeu (ptr.x=" + px + ")");
    assert(!errs.length, errs.join(" | "));
    return "paralaxe ptr.x=" + px.toFixed(2);
  });
}

await test("Jornada: Data, Horas/Minutos e Viagens sem sobreposição em 5 larguras; 6 h 30 min salva 390", async (keep) => {
  const out = [];
  for (const [w, h] of [[1440, 900], [1024, 800], [820, 1100], [390, 844], [320, 700]]) {
    const ctx = await ctxFor(keep, { viewport: { width: w, height: h }, isMobile: w < 700, hasTouch: w < 700 });
    const { page } = await loggedPage(ctx);
    await page.evaluate(() => { tab = "uber"; lm = "jr"; render(); });
    const r = await page.evaluate(() => {
      const f = document.querySelector("#reg form[data-form=jr]"), row = f.querySelector(".jrtop"), R = (e) => e.getBoundingClientRect();
      const els = [...row.querySelectorAll("input,.durrow span,label")].filter((e) => R(e).width > 0), hit = [];
      for (let i = 0; i < els.length; i++) for (let j = i + 1; j < els.length; j++) { const a = R(els[i]), b = R(els[j]); if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) hit.push((els[i].name || els[i].textContent.trim()) + "×" + (els[j].name || els[j].textContent.trim())); }
      const out = [...row.children].flatMap((c) => [...c.querySelectorAll("input")].filter((x) => R(x).right > R(c).right + 1 || R(x).left < R(c).left - 1).map((x) => x.name));
      return { hit, out, sw: document.documentElement.scrollWidth, vw: innerWidth };
    });
    assert(!r.hit.length, `${w}px: sobreposição ${r.hit.join(", ")}`);
    assert(!r.out.length, `${w}px: campo fora da coluna ${r.out.join(", ")}`);
    assert(r.sw <= r.vw, `${w}px: rolagem horizontal (${r.sw} > ${r.vw})`);
    if (w === 320) {
      await page.fill("#reg form[data-form=jr] input[name=hh]", "6");
      await page.fill("#reg form[data-form=jr] input[name=mm]", "30");
      await page.click("#reg form[data-form=jr] button.btn:not([type=button])");
      const m = await page.evaluate(() => db.jr.filter((j) => j.app === "uber" && j.d === TODAY()).map((j) => j.min));
      assert(m.length === 1 && m[0] === 390, "6 h 30 min deveria salvar 390 minutos: " + JSON.stringify(m));
    }
    out.push(w + "px ok");
  }
  return out.join(" · ");
});

await test("Ícones de informação: abrem por toque e clique, ficam dentro da tela e fecham com Esc, ✕ e toque fora", async (keep) => {
  let n = 0;
  for (const [w, h, mob] of [[320, 640, true], [1280, 860, false]]) {
    const ctx = await ctxFor(keep, { viewport: { width: w, height: h }, isMobile: mob, hasTouch: mob });
    const { page } = await loggedPage(ctx);
    for (const t of ["historico", "uber", "financas", "produtividade", "despesas", "hoje"]) {
      await page.evaluate((t) => { Bot.put({ muted: true }); Bot.hide(); tab = t; render(); }, t); // mascote silenciado: este teste é dos ícones "i"
      const count = await page.locator("#view .itip:visible").count(); // ícones dentro de blocos recolhidos só contam quando abertos
      for (let k = 0; k < count; k++) {
        const b = page.locator("#view .itip:visible").nth(k); await b.scrollIntoViewIfNeeded();
        if (mob) await b.tap(); else await b.click();
        const r = await page.evaluate(() => { const el = document.getElementById("tipbox"); if (!el || !el.isConnected) return null; const R = el.getBoundingClientRect(); return { l: R.left, r: R.right, t: R.top, b: R.bottom, vw: document.documentElement.clientWidth, vh: innerHeight, txt: el.querySelector(".tipb").textContent.trim().length, exp: document.querySelector('.itip[aria-expanded="true"]') !== null }; });
        assert(r && r.txt > 20 && r.exp, `${w}px ${t} #${k}: balão não abriu`);
        assert(r.l >= 0 && r.r <= r.vw && r.t >= 0 && r.b <= r.vh, `${w}px ${t} #${k}: balão fora da tela ${JSON.stringify(r)}`);
        if (k % 3 === 0) await page.keyboard.press("Escape"); else if (k % 3 === 1) await page.click("#tipbox .tipx"); else await page.mouse.click(4, Math.round(h * .6));
        assert(await page.evaluate(() => !document.getElementById("tipbox")?.isConnected), `${w}px ${t} #${k}: não fechou`);
        n++;
      }
    }
  }
  assert(n >= 10, "poucos ícones encontrados: " + n);
  return n + " explicações verificadas";
});

await browser.close();
server.close();
let fail = 0;
for (const r of results) { if (!r.ok) fail++; console.log(`${r.ok ? "✓" : "✗"} ${r.name}${r.info ? " — " + r.info : ""}`); }
console.log(`\n${results.length - fail}/${results.length} testes passaram.`);
process.exit(fail ? 1 : 0);
