// Nova home (iframe /home.html) + app principal: rota pública, botões Entrar/Criar conta que abrem
// o login/cadastro existentes por mensagem, cadastro ponta a ponta, analytics anônimo e sem rolagem horizontal.
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
  // Sem internet no teste: fontes/Lenis externos são abortados; a home renderiza com fallback.
  await ctx.route(/cdnjs|cdn\.jsdelivr\.net|fonts\.googleapis|fonts\.gstatic|unpkg\.com/, (r) => r.abort());
  keep(ctx);
  const page = await ctx.newPage(), errs = [], net = [];
  page.on("pageerror", (e) => errs.push(e.message));
  page.on("request", (r) => net.push({ url: r.url(), method: r.method(), body: r.postData() }));
  await page.goto(BASE + hash);
  await page.waitForTimeout(500);
  return { page, errs, net };
}
const visible = (page, sel) => page.evaluate((s) => { const e = document.querySelector(s); if (!e) return false; const r = e.getBoundingClientRect(), st = getComputedStyle(e); return r.width > 0 && r.height > 0 && st.visibility !== "hidden" && st.display !== "none" && !e.closest("[hidden]"); }, sel);
const home = (page) => page.frameLocator("#lpframe");
async function waitHome(page) { await home(page).locator("h1.hero-title").first().waitFor({ timeout: 8000 }); await page.waitForTimeout(1700); }

await test("Visitante sem sessão vê a nova home (iframe), não o login", async (keep) => {
  const { page, errs } = await open(keep);
  assert(await visible(page, "#landing"), "a home não apareceu");
  assert(await visible(page, "#lpframe"), "o iframe da home não apareceu");
  assert(!(await visible(page, "#form-login")), "login apareceu direto");
  await waitHome(page);
  const t = await home(page).locator(".hero-copy").first().innerText();
  assert(/100% gratuito/.test(t) && /Você roda/.test(t), "primeira dobra: " + t.slice(0, 120));
  assert(!errs.length, errs.join(" | "));
});
await test("Criar conta grátis abre o cadastro; Entrar abre o login; Voltar retorna à home", async (keep) => {
  const { page } = await open(keep);
  await waitHome(page);
  await home(page).locator('a[data-auth="register"]').first().click();
  await page.waitForTimeout(400);
  assert(await visible(page, "#form-register"), "Criar conta não abriu o cadastro");
  await page.goBack(); await page.waitForTimeout(400);
  assert(await visible(page, "#landing") && await visible(page, "#lpframe"), "voltar do navegador não retornou à home");
  await waitHome(page);
  await home(page).locator('a[data-auth="login"]').first().click();
  await page.waitForTimeout(400);
  assert(await visible(page, "#form-login"), "Entrar não abriu o login");
  await page.click("#auth-back"); await page.waitForTimeout(400);
  assert(await visible(page, "#landing"), "Voltar para o início não retornou à home");
});
await test("Deep link #entrar abre o login direto (sem passar pela home)", async (keep) => {
  const { page } = await open(keep, {}, "#entrar");
  assert(await visible(page, "#form-login"), "#entrar não abriu o login");
  assert(!(await visible(page, "#lpframe")), "a home apareceu no deep link de login");
});
await test("Cadastro pela nova home entra no app e persiste", async (keep) => {
  const { page } = await open(keep);
  await waitHome(page);
  await home(page).locator('a[data-auth="register"]').first().click();
  await page.waitForSelector("#form-register", { state: "visible", timeout: 8000 });
  await page.fill("#re-name", "Visitante Teste"); await page.fill("#re-email", "visitante@nesc.local"); await page.fill("#re-pass", "segredo123");
  await page.click("#form-register .btn-submit");
  await page.waitForSelector("#app.on #view .grid", { timeout: 8000 });
  assert(!(await visible(page, "#landing")), "a home continuou visível depois de entrar");
  await page.reload(); await page.waitForSelector("#app.on #view .grid", { timeout: 8000 });
  assert(!(await visible(page, "#lpframe")), "usuário logado viu a home ao recarregar");
});
await test("Sem rolagem horizontal na home em várias larguras", async (keep) => {
  for (const w of [320, 375, 430, 768, 1024, 1440]) {
    const { page } = await open(keep, { viewport: { width: w, height: 820 }, isMobile: w < 700, hasTouch: w < 700 });
    await waitHome(page);
    const ov = await home(page).locator("body").evaluate((b) => b.scrollWidth - b.clientWidth).catch(() => 0);
    assert(ov <= 1, `rolagem horizontal em ${w}px: ${ov}`);
  }
});
await test("Analytics anônimo: landing_view e cta_signup, só o nome do evento, e respeita Do Not Track", async (keep) => {
  CONFIG = "window.NSC_CONFIG={supabaseUrl:'https://projeto-falso.supabase.test',supabaseAnonKey:'anon-falsa'};";
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } }); keep(ctx);
    const posts = [];
    await ctx.route(/cdnjs|cdn\.jsdelivr\.net|fonts\.googleapis|fonts\.gstatic|unpkg\.com/, (r) => r.abort());
    await ctx.route(/supabase\.test/, (r) => { if (/landing_events/.test(r.request().url())) posts.push(JSON.parse(r.request().postData() || "{}")); r.fulfill({ status: 201, body: "" }); });
    const page = await ctx.newPage(); await page.goto(BASE); await page.waitForTimeout(500);
    await home(page).locator("h1.hero-title").first().waitFor({ timeout: 8000 }); await page.waitForTimeout(1700);
    await home(page).locator('a[data-auth="register"]').first().click(); await page.waitForTimeout(500);
    const evs = posts.map((p) => p.event);
    assert(evs.includes("landing_view") && evs.includes("cta_signup"), "eventos: " + JSON.stringify(posts));
    assert(posts.every((p) => Object.keys(p).sort().join() === "event,source" && !/@/.test(JSON.stringify(p))), "campos extras: " + JSON.stringify(posts));
    const ctx2 = await browser.newContext({ extraHTTPHeaders: { DNT: "1" } }); keep(ctx2);
    let sent = 0;
    await ctx2.route(/cdnjs|cdn\.jsdelivr\.net|fonts\.googleapis|fonts\.gstatic|unpkg\.com/, (r) => r.abort());
    await ctx2.route(/supabase\.test/, (r) => { if (/landing_events/.test(r.request().url())) sent++; r.fulfill({ status: 201, body: "" }); });
    const p2 = await ctx2.newPage(); await p2.addInitScript(() => Object.defineProperty(navigator, "doNotTrack", { get: () => "1" })); await p2.goto(BASE); await p2.waitForTimeout(600);
    assert(sent === 0, "enviou evento com Do Not Track");
  } finally { CONFIG = "window.NSC_CONFIG={};"; }
});
await test("Indique e ganhe: seção na home cita R$ 1.000 no Pix, mostra o ícone e copia o link", async (keep) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, locale: "pt-BR", permissions: ["clipboard-read", "clipboard-write"] }); keep(ctx);
  await ctx.route(/cdnjs|cdn\.jsdelivr\.net|fonts\.googleapis|fonts\.gstatic|unpkg\.com/, (r) => r.abort());
  const page = await ctx.newPage();
  await page.goto(BASE); await page.waitForTimeout(500);
  await home(page).locator("h1.hero-title").first().waitFor({ timeout: 8000 });
  await home(page).locator("#indique .refer-card").scrollIntoViewIfNeeded();
  const txt = await home(page).locator("#indique").innerText();
  assert(/1\.000/.test(txt) && /Pix/i.test(txt) && /gratuito/i.test(txt), "texto do sorteio ausente na home: " + txt.slice(0, 140));
  assert((await home(page).locator("#indique .refer-pix").count()) === 1, "ícone do Pix ausente na home");
  await home(page).locator("#refer-copy").click();
  await page.waitForTimeout(350);
  const frame = page.frames().find((f) => /home\.html/.test(f.url()));
  const clip = await frame.evaluate(() => navigator.clipboard.readText());
  assert(/nescar\.com\.br/.test(clip) && /1\.000/.test(clip) && /Pix/i.test(clip), "link do sorteio não foi copiado: " + clip);
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
