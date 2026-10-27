// Landing page pública: rotas, botões, celular de demonstração, privacidade da demo e analytics anônimo.
// Uso: node tests/landing.spec.mjs   (Playwright; modo local, sem tocar em produção)
import http from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let chromium;
try { ({ chromium } = createRequire(import.meta.url)("playwright")); } catch { console.error("Instale o pacote 'playwright'."); process.exit(2); }
let CONFIG = "window.NSC_CONFIG={};";
const server = http.createServer(async (req, res) => {
  const p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (p === "/config.js") return res.end(CONFIG);
  const f = path.join(ROOT, p === "/" ? "index.html" : p);
  if (!f.startsWith(ROOT) || !existsSync(f)) { res.writeHead(404); return res.end(); }
  res.end(await readFile(f));
});
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
const BASE = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch();
const results = [];
const assert = (c, m) => { if (!c) throw new Error(m); };
async function test(name, fn) { const ctxs = []; try { results.push({ name, ok: true, info: (await fn((c) => ctxs.push(c))) || "" }); } catch (e) { results.push({ name, ok: false, info: e.message.split("\n")[0] }); } finally { for (const c of ctxs) await c.close(); } }
async function open(keep, opts = {}, hash = "") {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, locale: "pt-BR", ...opts });
  await ctx.route(/cdnjs|cdn\.jsdelivr\.net/, (r) => r.abort());
  keep(ctx);
  const page = await ctx.newPage(), errs = [], net = [];
  page.on("pageerror", (e) => errs.push(e.message));
  page.on("request", (r) => net.push({ url: r.url(), method: r.method(), body: r.postData() }));
  await page.goto(BASE + hash);
  await page.waitForTimeout(500);
  return { page, errs, net };
}
const visible = (page, sel) => page.evaluate((s) => { const e = document.querySelector(s); if (!e) return false; const r = e.getBoundingClientRect(), st = getComputedStyle(e); return r.width > 0 && r.height > 0 && st.visibility !== "hidden" && st.display !== "none" && !e.closest("[hidden]"); }, sel);

await test("Visitante sem sessão vê a landing (não o login) com a gratuidade em destaque", async (keep) => {
  const { page, errs } = await open(keep);
  assert(await visible(page, "#landing h1"), "landing não apareceu");
  assert(!(await visible(page, "#form-login")), "login apareceu direto");
  const t = await page.textContent("#landing .lp-hero");
  assert(/100% gratuito/.test(t) && /Você dirige/.test(t), "primeira dobra: " + t.slice(0, 120));
  assert(!errs.length, errs.join(" | "));
});
await test("Botões: Entrar abre o login, Criar conta abre o cadastro, Voltar retorna à landing", async (keep) => {
  const { page } = await open(keep);
  await page.click(".lp-hact a[href='#entrar']"); await page.waitForTimeout(300);
  assert(await visible(page, "#form-login"), "Entrar não abriu o login");
  await page.goBack(); await page.waitForTimeout(300);
  assert(await visible(page, "#landing h1"), "voltar do navegador não retornou à landing");
  await page.click(".lp-hero a[href='#criar-conta']"); await page.waitForTimeout(300);
  assert(await visible(page, "#form-register"), "Criar conta não abriu o cadastro");
  await page.click("#auth-back"); await page.waitForTimeout(300);
  assert(await visible(page, "#landing h1"), "link Voltar não retornou");
  await page.click(".lp-finalbox .lp-link"); await page.waitForTimeout(300);
  assert(await visible(page, "#form-login"), "link final 'Já tenho conta' não abriu o login");
});
await test("Todos os links internos apontam para destinos que existem", async (keep) => {
  const { page } = await open(keep);
  const bad = await page.evaluate(() => [...document.querySelectorAll("#landing a")].map((a) => [a.getAttribute("href"), a.dataset.lpgo]).filter(([h, g]) => !(h === "#" || h === "#entrar" || h === "#criar-conta" || (h && h.startsWith("#") && document.getElementById(h.slice(1))) || (g && document.getElementById(g)))));
  assert(!bad.length, "links sem destino: " + JSON.stringify(bad));
});
await test("Cadastro pela landing continua funcionando e entra no app", async (keep) => {
  const { page } = await open(keep, {}, "#criar-conta");
  await page.fill("#re-name", "Visitante Teste"); await page.fill("#re-email", "visitante@nesc.local"); await page.fill("#re-pass", "segredo123");
  await page.click("#form-register .btn-submit");
  await page.waitForSelector("#app.on #view .grid", { timeout: 8000 });
  assert(!(await visible(page, "#landing")), "landing continuou visível depois de entrar");
  await page.reload(); await page.waitForSelector("#app.on #view .grid", { timeout: 8000 });
  assert(!(await visible(page, "#landing h1")), "usuário logado viu a landing ao recarregar");
});
await test("Celular: inclina com o mouse e volta ao centro ao sair", async (keep) => {
  const { page } = await open(keep);
  const box = await page.locator("#ph").boundingBox();
  await page.mouse.move(box.x + box.width * 0.95, box.y + box.height * 0.2); await page.waitForTimeout(700);
  const ry = await page.evaluate(() => parseFloat(getComputedStyle(document.getElementById("ph")).getPropertyValue("--ry")));
  assert(ry > 2 && ry <= 9.01, "inclinação ao mover: " + ry);
  await page.mouse.move(20, 400); await page.waitForTimeout(2500);
  const back = await page.evaluate(() => parseFloat(getComputedStyle(document.getElementById("ph")).getPropertyValue("--ry")));
  assert(Math.abs(back) < 1, "não voltou ao centro: " + back);
});
await test("Demonstração muda de tela sozinha, com contas coerentes, sem tocar em dados ou rede", async (keep) => {
  const { page, net } = await open(keep, { reducedMotion: "reduce" });
  const ls0 = await page.evaluate(() => JSON.stringify(Object.keys(localStorage).sort()));
  await page.evaluate(() => { window.__sc = []; const g = LP.go.bind(LP); LP.go = (x) => { window.__sc.push(x); g(x); }; });
  await page.waitForTimeout(3000);
  const seen = new Set(await page.evaluate(() => window.__sc));
  assert(["reg", "exp", "meta", "hist", "rank", "dash"].every((x) => seen.has(x)), "telas vistas: " + [...seen].join(","));
  const m = await page.evaluate(() => ({ inc: LP.inc(), op: LP.op(), exp: LP.st.exp, ok: Math.abs(LP.op() - (LP.inc() - LP.st.exp)) < 0.001, db: typeof db === "undefined" ? "x" : db, user }));
  assert(m.ok && m.db === null && m.user === null, JSON.stringify(m));
  const ls1 = await page.evaluate(() => JSON.stringify(Object.keys(localStorage).sort()));
  assert(ls0 === ls1, "a demonstração gravou no armazenamento: " + ls1);
  const ext = net.filter((r) => !r.url.startsWith(BASE) && !/cdnjs|jsdelivr/.test(r.url));
  assert(!ext.length, "requisições externas: " + ext.map((r) => r.url).join(", "));
  const lbl = await page.textContent(".ph-demo");
  assert(/Demonstração/.test(lbl), "falta o aviso de demonstração");
  return [...seen].join(" → ");
});
await test("Rolagem: o conteúdo do celular acompanha a seção (desktop)", async (keep) => {
  const { page } = await open(keep, { reducedMotion: "reduce" });
  for (const sc of ["exp", "meta", "rank"]) {
    await page.evaluate((sc) => document.querySelector(`.lp-step[data-scene='${sc}']`).scrollIntoView({ block: "center" }), sc);
    await page.waitForTimeout(700);
    const cur = await page.evaluate(() => LP.lock);
    assert(cur === sc, `seção ${sc} mostrou ${cur}`);
  }
  const ph = await page.locator("#ph").boundingBox();
  assert(ph && ph.y >= 0 && ph.y + ph.height <= 860, "celular saiu da tela durante a rolagem");
});
await test("Celular estreito: sem rolagem horizontal; menu abre, fecha com Esc e navega", async (keep) => {
  for (const w of [320, 375, 430, 768, 1024, 1440]) {
    const { page } = await open(keep, { viewport: { width: w, height: 800 }, isMobile: w < 700, hasTouch: w < 700 });
    const ov = await page.evaluate(() => { const l = document.getElementById("landing"); return l.scrollWidth - l.clientWidth; });
    assert(ov <= 0, `rolagem horizontal em ${w}px: ${ov}`);
    const ph = await page.locator("#ph").boundingBox();
    assert(ph.x >= 0 && ph.x + ph.width <= w + 1, `celular passa da tela em ${w}px`);
    if (w <= 430) {
      await page.click("#lp-burger"); await page.waitForTimeout(300);
      assert(await visible(page, "#lp-nav.open a[href='#faq']"), "menu não abriu");
      await page.keyboard.press("Escape");
      assert(!(await page.evaluate(() => document.getElementById("lp-nav").classList.contains("open"))), "Esc não fechou");
      await page.click("#lp-burger"); await page.click("#lp-nav a[href='#faq']"); await page.waitForTimeout(900);
      const top = await page.evaluate(() => document.getElementById("faq").getBoundingClientRect().top);
      assert(top < 200, "link do menu não levou ao FAQ: " + top);
    }
  }
});
await test("Perguntas frequentes abrem por teclado", async (keep) => {
  const { page } = await open(keep);
  await page.focus("#faq details summary"); await page.keyboard.press("Enter");
  assert(await page.evaluate(() => document.querySelector("#faq details").open), "não abriu com Enter");
});
await test("Analytics anônimo: CTA envia só o nome do evento (sem dados pessoais) e respeita Do Not Track", async (keep) => {
  CONFIG = "window.NSC_CONFIG={supabaseUrl:'https://projeto-falso.supabase.test',supabaseAnonKey:'anon-falsa'};";
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } }); keep(ctx);
    const posts = [];
    await ctx.route(/cdnjs|cdn\.jsdelivr\.net/, (r) => r.abort());
    await ctx.route(/supabase\.test/, (r) => { if (/landing_events/.test(r.request().url())) posts.push(JSON.parse(r.request().postData() || "{}")); r.fulfill({ status: 201, body: "" }); });
    const page = await ctx.newPage(); await page.goto(BASE); await page.waitForTimeout(600);
    await page.click(".lp-hero a[href='#criar-conta']"); await page.waitForTimeout(400);
    const evs = posts.map((p) => p.event);
    assert(evs.includes("landing_view") && evs.includes("cta_signup"), "eventos: " + JSON.stringify(posts));
    assert(posts.every((p) => Object.keys(p).sort().join() === "event,source" && !/@/.test(JSON.stringify(p))), "campos extras: " + JSON.stringify(posts));
    const ctx2 = await browser.newContext({ extraHTTPHeaders: { DNT: "1" } }); keep(ctx2);
    let sent = 0; await ctx2.route(/cdnjs|cdn\.jsdelivr\.net/, (r) => r.abort()); await ctx2.route(/supabase\.test/, (r) => { if (/landing_events/.test(r.request().url())) sent++; r.fulfill({ status: 201, body: "" }); });
    const p2 = await ctx2.newPage(); await p2.addInitScript(() => Object.defineProperty(navigator, "doNotTrack", { get: () => "1" })); await p2.goto(BASE); await p2.waitForTimeout(500);
    assert(sent === 0, "enviou evento com Do Not Track");
  } finally { CONFIG = "window.NSC_CONFIG={};"; }
});

await test("Anel da meta: percentual (inclusive acima de 100%) cabe inteiro no miolo do círculo, até em 320 px", async (keep) => {
  const { page } = await open(keep, { viewport: { width: 320, height: 640 }, isMobile: true, hasTouch: true });
  const r = await page.evaluate(() => ["86%", "107,03%", "125,50%", "1000,00%"].map((t) => {
    const box = document.createElement("div"); box.className = "lp-phone"; box.innerHTML = `<div class="dm-ring"><svg viewBox="0 0 120 120"><circle class="t" cx="60" cy="60" r="52"/><circle class="p" cx="60" cy="60" r="52" transform="rotate(-90 60 60)"/><text class="dm-rt" x="60" y="56" text-anchor="middle" dominant-baseline="central" font-size="${ringFs(t)}">${t}</text></svg></div>`;
    document.body.appendChild(box); const b = box.querySelector("text").getBBox(); box.remove();
    // miolo do anel: raio 52 − meia espessura (4,5) = 47,5. Os quatro cantos da caixa do texto precisam ficar dentro.
    const far = Math.max(...[[b.x, b.y], [b.x + b.width, b.y], [b.x, b.y + b.height], [b.x + b.width, b.y + b.height]].map(([x, y]) => Math.hypot(x - 60, y - 60)));
    return { t, fs: ringFs(t), w: Math.round(b.width), far: Math.round(far * 10) / 10 };
  }));
  const bad = r.filter((x) => x.far > 47.5);
  assert(!bad.length, "texto encosta ou sai do anel: " + JSON.stringify(bad));
  assert(r.find((x) => x.t === "107,03%").fs >= 14, "fonte pequena demais para 107,03%");
  return r.map((x) => `${x.t}: fonte ${x.fs}, largura ${x.w}, canto mais distante ${x.far}`).join(" · ");
});

await browser.close(); server.close();
let fail = 0;
for (const r of results) { if (!r.ok) fail++; console.log(`${r.ok ? "✓" : "✗"} ${r.name}${r.info ? " — " + r.info : ""}`); }
console.log(`\n${results.length - fail}/${results.length} testes passaram.`);
process.exit(fail ? 1 : 0);
