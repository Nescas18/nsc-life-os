// Mascote/copiloto do NESC: 20 cenários do copiloto + 12 critérios da cabeça flutuante, executados no index.html real em um Chromium (Playwright).
// Tudo em modo local (sem Supabase de produção). A "nuvem" é simulada trocando Cloud.push dentro da página.
// Uso: node tests/bot.spec.mjs
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
const T = "2026-10-26";
const tx = (d, type, app, v, o = {}) => ({ id: Math.random().toString(36).slice(2), d, type, app, v, at: 1, ...o });
const OFF = { uber: { on: false }, n99: { on: false } };

async function ctxOf(opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, timezoneId: "America/Sao_Paulo", locale: "pt-BR", ...opts });
  await ctx.route(/cdnjs|cdn\.jsdelivr\.net/, (r) => r.abort());
  return ctx;
}
/* abre a página; com `user`, já entra no app com os dados `seed`. Registra todas as falas exibidas em window.__said */
async function open(ctx, { user, seed, hash = "", fresh = true } = {}) {
  const page = await ctx.newPage(); const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  await page.clock.setFixedTime(new Date(T + "T15:00:00-03:00"));
  await page.addInitScript(([u, s, fresh]) => {
    if (fresh && !sessionStorage.getItem("__init")) { sessionStorage.setItem("__init", "1"); if (u) { localStorage.setItem("nsc_session", JSON.stringify(u)); if (s) localStorage.setItem("nsc_db_" + u.email, JSON.stringify(s)); } }
    window.__said = [];
    const iv = setInterval(() => { if (typeof Bot !== "undefined" && Bot.show && !Bot.__w) { Bot.__w = 1; const o = Bot.show.bind(Bot); Bot.show = (m) => { window.__said.push(m.text); return o(m); }; clearInterval(iv); } }, 5);
  }, [user || null, seed || null, fresh]);
  await page.goto(BASE + hash);
  await page.waitForTimeout(250);
  return { page, errs };
}
const said = (page) => page.evaluate(() => window.__said.join("\n"));
const bubble = (page) => page.evaluate(() => { const b = document.querySelector("#bot .bot-bub"); return b && !b.hidden ? b.innerText : ""; });
const fast = (page) => page.evaluate(() => { Bot.GAP = 0; }); // testes: sem o intervalo de 20 s entre falas automáticas
async function test(name, fn) {
  if (process.env.ONLY && !name.startsWith(process.env.ONLY)) return; // ex.: ONLY=A7 node tests/bot.spec.mjs
  const ctxs = []; const keep = (c) => (ctxs.push(c), c);
  try { const r = await fn(keep); results.push({ name, ok: true, info: r || "" }); }
  catch (e) { results.push({ name, ok: false, info: e.message }); }
  finally { for (const c of ctxs) await c.close(); }
}
const U1 = { email: "motorista1@nesc.local", name: "Ana" }, U2 = { email: "motorista2@nesc.local", name: "Bia" };

await test("1. Visitante na página pública: mascote oficial aparece e se apresenta", async (keep) => {
  const ctx = keep(await ctxOf()); const { page, errs } = await open(ctx);
  await page.waitForFunction(() => /Fala, motorista/.test(document.querySelector("#bot .bot-msg")?.textContent || ""), null, { timeout: 6000 });
  const r = await page.evaluate(() => { const img = document.querySelector("#bot img"), h = document.querySelector("#bot .bot-head").getBoundingClientRect(); return { src: img.currentSrc, w: img.naturalWidth, inView: h.right <= innerWidth && h.bottom <= innerHeight && h.left >= 0 }; });
  assert(/cabeca-open-\d+\.(webp|png)/.test(r.src) && r.w > 0, "imagem da cabeça não carregou: " + JSON.stringify(r));
  assert(r.inView, "mascote fora da tela");
  assert(!errs.length, errs.join(" | "));
  return r.src.split("/").pop();
});
await test("2. Visitante dispensa a apresentação e ela não volta na próxima visita", async (keep) => {
  const ctx = keep(await ctxOf()); const { page } = await open(ctx);
  await page.waitForFunction(() => /Fala, motorista/.test(document.querySelector("#bot .bot-msg")?.textContent || ""), null, { timeout: 6000 });
  await page.click("#bot .bot-acts button.sec"); // "Agora não"
  assert(!(await bubble(page)), "balão continuou aberto");
  await page.reload(); await page.waitForTimeout(3200);
  assert(!/Fala, motorista/.test(await said(page)), "apresentação repetida na segunda visita");
});
await test("3. Início do cadastro: modo de orientação com dica por campo (sem ler a senha)", async (keep) => {
  const ctx = keep(await ctxOf()); const { page } = await open(ctx, { hash: "#criar-conta" });
  await page.waitForFunction(() => /Bora criar sua conta/.test(window.__said.join(" ")), null, { timeout: 4000 });
  await page.waitForTimeout(100);
  await page.click("#re-email"); await page.waitForTimeout(80);
  assert(/recuperar a senha/.test(await bubble(page)), "sem dica do campo de e-mail");
  await page.fill("#re-pass", "Zx9-segredo-ULTRA"); await page.waitForTimeout(80);
  assert(/senha forte/.test(await bubble(page)), "sem dica de senha forte");
  const leak = await page.evaluate(() => window.__said.join(" ") + JSON.stringify(Object.fromEntries(Object.keys(localStorage).filter((k) => k.startsWith("nesc_bot_")).map((k) => [k, localStorage.getItem(k)]))));
  assert(!leak.includes("Zx9-segredo-ULTRA"), "a senha apareceu em falas ou no armazenamento do mascote");
});
await test("4. Erro de validação explicado em linguagem simples", async (keep) => {
  const ctx = keep(await ctxOf()); const { page } = await open(ctx, { hash: "#criar-conta" });
  await page.waitForTimeout(150);
  await page.fill("#re-name", "Ana"); await page.fill("#re-email", "ana@nesc.local"); await page.fill("#re-birth", "2999-01-01"); await page.fill("#re-pass", "Senha2026x");
  await page.click("#form-register .btn-submit");
  await page.waitForFunction(() => /data de nascimento não está valendo/.test(document.querySelector("#bot .bot-msg")?.textContent || ""), null, { timeout: 3000 });
  assert(!/Sua conta foi criada/.test(await said(page)), "anunciou conta criada sem sucesso");
});
await test("5. Conta criada: confirmação só depois do sucesso (local) e aviso de confirmação de e-mail (nuvem)", async (keep) => {
  const ctx = keep(await ctxOf()); const { page } = await open(ctx, { hash: "#criar-conta" });
  await page.waitForTimeout(150);
  await page.fill("#re-name", "Ana"); await page.fill("#re-email", "nova@nesc.local"); await page.fill("#re-pass", "Senha2026x");
  await page.click("#form-register .btn-submit");
  await page.waitForFunction(() => document.getElementById("app").classList.contains("on"), null, { timeout: 5000 });
  await page.waitForFunction(() => /Sua conta foi criada/.test(window.__said.join(" ")), null, { timeout: 4000 });
  const ctx2 = keep(await ctxOf()); const p2 = (await open(ctx2, { hash: "#criar-conta" })).page;
  await p2.evaluate(() => { Auth.signUp = async () => { const e = new Error("Conta criada. Confirme o e-mail que enviamos e depois entre."); e.info = true; throw e; }; });
  await p2.waitForTimeout(150);
  await p2.fill("#re-name", "Bia"); await p2.fill("#re-email", "bia@nesc.local"); await p2.fill("#re-pass", "Senha2026x");
  await p2.click("#form-register .btn-submit");
  await p2.waitForFunction(() => /Falta só confirmar o e-mail/.test(document.querySelector("#bot .bot-msg")?.textContent || ""), null, { timeout: 3000 });
  assert(!/Sua conta foi criada\. Agora/.test(await said(p2)), "boas-vindas do app antes de existir sessão");
});
await test("6. Usuário entra: checklist de configuração com etapas reais e níveis", async (keep) => {
  const ctx = keep(await ctxOf()); const { page } = await open(ctx, { user: U1, seed: { cfg: { pass: OFF } } });
  await page.waitForFunction(() => /configuração rápida/.test(window.__said.join(" ")), null, { timeout: 5000 });
  const ck = await page.evaluate(() => [...document.querySelectorAll("#bot .bot-ck li")].map((li) => li.innerText.replace(/\s+/g, " ")));
  assert(ck.length === 5 && /Primeiro lançamento\s*essencial/i.test(ck[1]) && /Veículo\s*recomendada/i.test(ck[2]) && /Meta do dia\s*opcional/i.test(ck[4]), "checklist: " + JSON.stringify(ck));
  assert(await page.evaluate(() => document.getElementById("bot").classList.contains("alert")), "sem estado de atenção com pendência essencial");
});
await test("7/8. Cadastrar veículo atualiza o checklist; com o essencial pronto, avisa que a configuração básica fechou (uma vez)", async (keep) => {
  const ctx = keep(await ctxOf()); const { page } = await open(ctx, { user: U1, seed: { cfg: { pass: OFF }, tx: [tx(T, "in", "uber", 200)] } });
  await page.waitForTimeout(400); await fast(page);
  await page.evaluate(() => { db.vehicle = { brand: "Fiat", model: "Argo", custom: true, energy: "flex", body: "hatch" }; Bot.lastForm = "ob"; Store.save(); });
  await page.waitForFunction(() => /Veículo cadastrado\. Já atualizei/.test(window.__said.join(" ")), null, { timeout: 3000 });
  const t = await said(page);
  assert(/Fechou!/.test(t), "não avisou configuração básica completa: " + t);
  const pend = await page.evaluate(() => Bot.ck().pending.map((i) => i.id));
  assert(!pend.includes("veiculo") && !pend.includes("registro"), "checklist ainda pede o que já foi feito: " + pend);
  await page.evaluate(() => { db.vehicle.odo = 70000; Store.save(); }); await page.waitForTimeout(800);
  assert((await said(page)).match(/Fechou!/g).length === 1, "repetiu o aviso de configuração completa");
});
await test("9. Uber sem registros: orientação para começar, sem presumir que trabalhou", async (keep) => {
  const ctx = keep(await ctxOf()); const { page } = await open(ctx, { user: U1, seed: { cfg: { pass: OFF }, tx: [tx(T, "in", "n99", 100)], vehicle: { brand: "X", model: "Y", custom: true } } });
  await page.waitForTimeout(300); await fast(page); await page.evaluate(() => Bot.hide());
  await page.evaluate(() => { tab = "uber"; render(); });
  const ok9 = await page.waitForFunction(() => /Ainda não tem lançamentos da Uber/.test(window.__said.join(" ")), null, { timeout: 3000 }).then(() => true, () => false);
  if (!ok9) throw new Error("uber: " + JSON.stringify(await page.evaluate(() => ({ said: window.__said, cur: Bot.cur && Bot.cur.text, q: Bot.queue && Bot.queue.text, area: Bot.area, tabSeen: Bot.tabSeen, last: Date.now() - Bot.last, ae: document.activeElement && document.activeElement.tagName + "#" + document.activeElement.id }))));
});
await test("10/11. Lançamento salvo: confirmação só depois da gravação (local imediato; nuvem só após o envio)", async (keep) => {
  const ctx = keep(await ctxOf()); const { page } = await open(ctx, { user: U1, seed: { cfg: { pass: OFF }, vehicle: { brand: "X", model: "Y", custom: true } } });
  await page.waitForTimeout(300); await fast(page); await page.evaluate(() => { Bot.hide(); tab = "uber"; render(); });
  await page.fill("#reg form[data-form=inc] input[name=v]", "180"); await page.click("#reg form[data-form=inc] button.btn:not([type=button])");
  await page.waitForFunction(() => /Primeiro lançamento salvo/.test(window.__said.join(" ")), null, { timeout: 3000 });
  // nuvem: envio demora 2 s; a confirmação não pode sair antes disso
  const ctx2 = keep(await ctxOf()); const p2 = (await open(ctx2, { user: U2, seed: { cfg: { pass: OFF }, vehicle: { brand: "X", model: "Y", custom: true } } })).page;
  await p2.waitForTimeout(300); await fast(p2);
  await p2.evaluate(() => { user.id = "u2"; Cloud.on = true; window.__pushed = 0; Cloud.push = () => new Promise((ok) => setTimeout(() => { window.__pushed++; ok(); }, 2000)); Bot.hide(); tab = "uber"; render(); });
  await p2.fill("#reg form[data-form=inc] input[name=v]", "150"); await p2.click("#reg form[data-form=inc] button.btn:not([type=button])");
  await p2.waitForTimeout(1900);
  assert(!/Primeiro lançamento salvo/.test(await said(p2)), "confirmou antes de a nuvem responder");
  await p2.waitForFunction(() => window.__pushed > 0 && /Primeiro lançamento salvo/.test(window.__said.join(" ")), null, { timeout: 4000 });
});
await test("12. Histórico (dias sem registro ≠ não trabalhei) e Metas (opcional, faturamento × lucro)", async (keep) => {
  const ctx = keep(await ctxOf()); const { page } = await open(ctx, { user: U1, seed: { cfg: { pass: OFF, workDays: [1, 2, 3, 4, 5] }, tx: [tx("2026-10-19", "in", "uber", 100)], vehicle: { brand: "X", model: "Y", custom: true } } });
  await page.waitForTimeout(300); await fast(page); await page.evaluate(() => { Bot.hide(); tab = "historico"; render(); });
  const ok12 = await page.waitForFunction(() => /(dias habituais|dia habitual) sem lançamento.*Não trabalhei/.test(window.__said.join(" ")), null, { timeout: 3000 }).then(() => true, () => false);
  if (!ok12) throw new Error("histórico: " + JSON.stringify(await page.evaluate(() => ({ said: window.__said, pend: pendingDays(14), cur: Bot.cur && Bot.cur.text, q: Bot.queue && Bot.queue.text, area: Bot.area, tabSeen: Bot.tabSeen }))));
  await page.evaluate(() => { Bot.hide(); tab = "metas"; render(); });
  await page.waitForFunction(() => /Metas são opcionais/.test(window.__said.join(" ")), null, { timeout: 3000 });
});
await test("13/14. Resumo do dia: positivo, prejuízo, equilíbrio (mesma regra do app) e meta superada", async (keep) => {
  const ctx = keep(await ctxOf()); const { page } = await open(ctx, { user: U1, seed: { cfg: { pass: OFF } } });
  await page.waitForTimeout(200);
  const r = await page.evaluate((T) => {
    const run = (tx, goal) => { db = Object.assign(empty(), { cfg: { pass: { uber: { on: false }, n99: { on: false } }, goal: goal || 0 }, tx }); migrate(); const m = Bot.finMsg(), c = CS(T, T); return { t: m.text, tone: resTone(c.op, c.inc) }; };
    const X = (v, type) => ({ id: Math.random().toString(36).slice(2), d: T, type, app: type === "in" ? "uber" : "veic", v, at: 1 });
    return { pos: run([X(350, "in"), X(120, "other")]), neg: run([X(100, "in"), X(130, "other")]), even: run([X(150, "in"), X(149, "other")]), goal: run([X(321.1, "in")], 300), miss: run([X(100, "in")], 300) };
  }, T);
  assert(r.pos.tone === "pos" && /fechou no positivo/.test(r.pos.t) && /230,00/.test(r.pos.t), "positivo: " + r.pos.t);
  assert(r.neg.tone === "neg" && /gastos passaram das receitas/.test(r.neg.t), "prejuízo: " + r.neg.t);
  assert(r.even.tone === "even" && /zero a zero/.test(r.even.t), "equilíbrio: " + r.even.t);
  assert(/passou da meta de faturamento de hoje.*107,03%/.test(r.goal.t), "meta superada: " + r.goal.t);
  assert(/Faltam .*200,00.*rodar com segurança/.test(r.miss.t), "meta não atingida: " + r.miss.t);
});
await test("15. Navegar entre abas não repete a mesma fala", async (keep) => {
  const ctx = keep(await ctxOf()); const { page } = await open(ctx, { user: U1, seed: { cfg: { pass: OFF }, tx: [tx(T, "in", "uber", 100)], vehicle: { brand: "X", model: "Y", custom: true } } });
  await page.waitForTimeout(300); await fast(page);
  for (const t of ["uber", "despesas", "uber", "despesas", "uber"]) { await page.evaluate((t) => { Bot.hide(); tab = t; render(); }, t); await page.waitForTimeout(1100); }
  const s = await said(page);
  assert((s.match(/faturamento é o que a Uber te pagou/g) || []).length === 1, "fala da Uber repetida: " + s);
  assert((s.match(/Lance combustível, manutenção/g) || []).length === 1, "fala de Despesas repetida");
});
await test("16. Celular: mascote menor, dentro da tela, sem rolagem horizontal; balão não sai da tela", async (keep) => {
  const ctx = keep(await ctxOf({ viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true })); const { page } = await open(ctx, { user: U1, seed: { cfg: { pass: OFF } } });
  await page.waitForFunction(() => !document.querySelector("#bot .bot-bub").hidden, null, { timeout: 5000 });
  const r = await page.evaluate(() => { const hd = document.querySelector("#bot .bot-head"), h = hd.getBoundingClientRect(), b = document.querySelector("#bot .bot-bub").getBoundingClientRect(); return { hw: hd.offsetWidth, h: [h.left, h.right, h.bottom], b: [b.left, b.right, b.top, b.bottom], vw: innerWidth, vh: innerHeight, sw: document.documentElement.scrollWidth }; });
  assert(r.hw <= 60, "mascote grande demais no celular: " + r.hw);
  assert(r.h[0] >= 0 && r.h[1] <= r.vw && r.h[2] <= r.vh && r.b[0] >= 0 && r.b[1] <= r.vw && r.b[2] >= 0 && r.b[3] <= r.vh, "fora da tela: " + JSON.stringify(r));
  assert(r.sw <= r.vw, "rolagem horizontal");
  const ctx2 = keep(await ctxOf()); const p2 = (await open(ctx2, { user: U1, seed: { cfg: { pass: OFF } } })).page;
  assert((await p2.evaluate(() => document.querySelector("#bot .bot-head").offsetWidth)) >= 60, "no computador o mascote deveria ser maior");
});
await test("16b. Tocar fora do balão o recolhe (não fica preso sobre botões)", async (keep) => {
  const ctx = keep(await ctxOf({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })); const { page } = await open(ctx, { user: U1, seed: { cfg: { pass: OFF } } });
  await page.waitForFunction(() => !document.querySelector("#bot .bot-bub").hidden, null, { timeout: 5000 });
  await page.touchscreen.tap(30, 200);
  assert(!(await bubble(page)), "balão continuou aberto depois de tocar fora");
});
await test("17. Minimizar e silenciar: persistem e o mascote para de falar sozinho (toque ainda dá dica)", async (keep) => {
  const ctx = keep(await ctxOf()); const { page } = await open(ctx, { user: U1, seed: { cfg: { pass: OFF }, tx: [tx(T, "in", "uber", 100)], vehicle: { brand: "X", model: "Y", custom: true } } });
  await page.waitForTimeout(300); await fast(page);
  await page.evaluate(() => Bot.show({ text: "teste" })); await page.click('#bot [data-bot="mute"]');
  assert(await page.evaluate(() => Bot.st().muted === true), "não silenciou");
  await page.evaluate(() => { Bot.hide(); window.__said = []; tab = "despesas"; render(); }); await page.waitForTimeout(1200);
  assert(!(await said(page)), "falou sozinho mesmo silenciado");
  await page.click("#bot .bot-head"); assert(await bubble(page), "toque no mascote silenciado deveria dar dica");
  await page.click('#bot [data-bot="min"]');
  assert(await page.evaluate(() => document.getElementById("bot").classList.contains("min") && Bot.st().min), "não minimizou");
  await page.reload(); await page.waitForTimeout(400);
  assert(await page.evaluate(() => document.getElementById("bot").classList.contains("min")), "preferência não persistiu");
});
await test("18. Movimento reduzido: sem flutuação/animações e sem inclinação pelo cursor", async (keep) => {
  const ctx = keep(await ctxOf({ reducedMotion: "reduce" })); const { page } = await open(ctx, { user: U1, seed: { cfg: { pass: OFF } } });
  await page.waitForTimeout(400); await page.mouse.move(50, 50); await page.mouse.move(60, 60); await page.waitForTimeout(100);
  const r = await page.evaluate(() => ({ anim: getComputedStyle(document.querySelector("#bot .bot-float")).animationName, ry: document.querySelector("#bot .bot-tilt").style.getPropertyValue("--ry") }));
  assert(r.anim === "none" && !r.ry, "movimento reduzido ignorado: " + JSON.stringify(r));
});
await test("19. Falha de rede: nenhuma confirmação falsa; avisa que ficou só no aparelho", async (keep) => {
  const ctx = keep(await ctxOf()); const { page } = await open(ctx, { user: U1, seed: { cfg: { pass: OFF }, vehicle: { brand: "X", model: "Y", custom: true } } });
  await page.waitForTimeout(300); await fast(page);
  await page.evaluate(() => { user.id = "u1"; Cloud.on = true; Cloud.push = async () => { throw new Error("Failed to fetch"); }; Bot.hide(); tab = "uber"; render(); });
  await page.fill("#reg form[data-form=inc] input[name=v]", "150"); await page.click("#reg form[data-form=inc] button.btn:not([type=button])");
  await page.waitForFunction(() => /ainda não chegaram à nuvem/.test(window.__said.join(" ")), null, { timeout: 4000 });
  assert(!/Primeiro lançamento salvo/.test(await said(page)), "confirmou salvamento mesmo com falha de rede");
});
await test("20. Usuários diferentes não compartilham preferências, pendências nem histórico de falas", async (keep) => {
  const ctx = keep(await ctxOf()); const { page } = await open(ctx, { user: U1, seed: { cfg: { pass: OFF } } });
  await page.waitForTimeout(300);
  await page.evaluate(() => { Bot.put({ muted: true, skip: { meta: 1 } }); Bot.markSeen("tab:desp"); });
  const r = await page.evaluate(([u2]) => { const a = Bot.st(); const prev = user; user = u2; const b = Bot.st(); user = prev; return { a, b, keys: Object.keys(localStorage).filter((k) => k.startsWith("nesc_bot_")) }; }, [U2]);
  assert(r.a.muted && !r.b.muted && !(r.b.skip || {}).meta && !((r.b.seen || {})["tab:desp"]), "estado vazou entre contas: " + JSON.stringify(r));
  assert(r.keys.includes("nesc_bot_" + U1.email), "chave por conta ausente: " + r.keys);
});

/* ---------- cabeça flutuante: 12 critérios de aceite ---------- */
const QUIET = { cfg: { pass: OFF }, tx: [tx(T, "in", "uber", 100)], vehicle: { brand: "X", model: "Y", custom: true } };
async function quiet(ctx, opts = {}) { // app aberto, dicas silenciadas e balão fechado: a cabeça fica livre para acompanhar
  const o = await open(ctx, { user: U1, seed: QUIET, ...opts });
  await o.page.evaluate(() => { Bot.put({ muted: true }); Bot.hide(); });
  await o.page.waitForTimeout(700); await o.page.evaluate(() => Bot.hide());
  await settled(o.page);
  return o;
}
const head = (page) => page.evaluate(() => { const e = document.querySelector("#bot .bot-head"), r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, r: r.right, b: r.bottom, cx: r.left + r.width / 2, cy: r.top + r.height / 2, can: e.classList.contains("can"), pe: getComputedStyle(e).pointerEvents }; });
const settled = (page) => page.waitForFunction(() => !Bot.mv.raf, null, { timeout: 6000 });
/* controles reais (botões, links, campos) que a cabeça cobre de verdade (margem de 12% da caixa, onde a imagem é transparente) */
const overControls = (page) => page.evaluate(() => { const h = document.querySelector("#bot .bot-head").getBoundingClientRect(), mx = h.width * .12, my = h.height * .12;
  return [...document.querySelectorAll("a,button,input,select,textarea,[role=button]")].filter((n) => !n.closest("#bot")).map((n) => [n, n.getBoundingClientRect()])
    .filter(([, r]) => r.width && r.height && r.left < h.right - mx && r.right > h.left + mx && r.top < h.bottom - my && r.bottom > h.top + my)
    .filter(([n, r]) => { const e = document.elementFromPoint((Math.max(r.left, h.left) + Math.min(r.right, h.right)) / 2, (Math.max(r.top, h.top) + Math.min(r.bottom, h.bottom)) / 2); return e && n.contains(e); }) // só o que está visível ali (ignora menu recolhido)
    .map(([n]) => (n.textContent || n.placeholder || n.tagName).trim().slice(0, 30)); });
const inHead = (h, x, y, pad = 0) => x > h.x - pad && x < h.r + pad && y > h.y - pad && y < h.b + pad;

await test("A1/A2. Sem medalhão: só a cabeça recortada (cantos transparentes, proporção da cabeça) e a piscada usa a mesma silhueta", async (keep) => {
  const ctx = keep(await ctxOf()); const { page } = await quiet(ctx);
  const r = await page.evaluate(async () => {
    const load = (src) => new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = src; });
    const out = {};
    for (const k of ["open", "closed"]) { const i = await load(`/cabeca-${k}-256.webp`), c = document.createElement("canvas"); c.width = i.naturalWidth; c.height = i.naturalHeight; const g = c.getContext("2d"); g.drawImage(i, 0, 0);
      const a = (x, y) => g.getImageData(x, y, 1, 1).data[3], W = c.width - 1, H = c.height - 1;
      out[k] = { w: c.width, h: c.height, corners: [a(0, 0), a(W, 0), a(0, H), a(W, H), a(W >> 1, 0), a(W >> 1, H)].reduce((s, v) => s + v, 0), center: a(W >> 1, H >> 1) }; }
    out.imgs = [...document.querySelectorAll("#bot .bot-tilt img")].map((i) => i.currentSrc.split("/").pop());
    out.legacy = !!document.querySelector('#bot [src*="mascote"],#bot [srcset*="mascote"]');
    return out; });
  assert(!r.legacy, "ainda referencia a imagem antiga com medalhão");
  assert(r.imgs.length === 2 && /cabeca-open/.test(r.imgs[0]) && /cabeca-closed/.test(r.imgs[1]), "imagens: " + r.imgs);
  for (const k of ["open", "closed"]) {
    assert(r[k].corners === 0, `${k}: bordas/cantos não são transparentes (sobrou fundo ou moeda)`);
    assert(r[k].center === 255, `${k}: o rosto deveria ser opaco`);
    assert(r[k].w / r[k].h > .75 && r[k].w / r[k].h < .95, `${k}: proporção ${r[k].w}x${r[k].h} não é a da cabeça (o medalhão era redondo)`);
  }
  assert(r.open.w === r.closed.w && r.open.h === r.closed.h, "olhos fechados com tamanho diferente: deformaria na piscada");
});
await test("A3. Computador: acompanha o cursor com atraso e inércia, sem saltos, sem alcançar o cursor e para quando chega", async (keep) => {
  const ctx = keep(await ctxOf()); const { page } = await quiet(ctx);
  const h0 = await head(page);
  await page.evaluate(() => { window.__tr = []; const f = () => { window.__tr.push([Bot.mv.x, Bot.mv.y]); if (window.__tr.length < 150) requestAnimationFrame(f); }; requestAnimationFrame(f); });
  await page.mouse.move(640, 430, { steps: 6 });
  await page.waitForTimeout(110);
  const h1 = await head(page);
  await settled(page); const h2 = await head(page);
  const tr = await page.evaluate(() => window.__tr);
  const total = Math.hypot(h2.cx - h0.cx, h2.cy - h0.cy), early = Math.hypot(h1.cx - h0.cx, h1.cy - h0.cy);
  assert(total > 250, "não acompanhou o cursor: " + JSON.stringify([h0, h2]));
  assert(early < total * .5, `chegou rápido demais (sem atraso): ${early.toFixed(0)} de ${total.toFixed(0)} px em ~110 ms`);
  let maxStep = 0; for (let i = 1; i < tr.length; i++) maxStep = Math.max(maxStep, Math.hypot(tr[i][0] - tr[i - 1][0], tr[i][1] - tr[i - 1][1]));
  assert(maxStep < 50, "salto entre quadros: " + maxStep.toFixed(1) + " px");
  assert(!inHead(h2, 640, 430, 12), "a cabeça ficou em cima do cursor: " + JSON.stringify(h2));
  assert(Math.hypot(h2.cx - 640, h2.cy - 430) < 260, "ficou longe demais do cursor: " + JSON.stringify(h2));
  assert(h2.can && h2.pe === "auto", "parada e em lugar livre, deveria aceitar clique");
  // chegar com o mouse na cabeça parada: ela espera (não foge) e a roda do mouse continua rolando o conteúdo
  await page.mouse.move(h2.cx, h2.cy, { steps: 4 }); await page.waitForTimeout(400);
  const h3 = await head(page); assert(Math.hypot(h3.x - h2.x, h3.y - h2.y) < 1, "fugiu do mouse que veio tocar nela");
  const s0 = await page.evaluate(() => document.querySelector("#app main").scrollTop);
  await page.mouse.wheel(0, 300); await page.waitForTimeout(300);
  assert((await page.evaluate(() => document.querySelector("#app main").scrollTop)) > s0 + 100, "a roda do mouse sobre a cabeça não rolou a página");
});
await test("A4. Não fica preso no canto: segue o cursor pela tela e, ocioso, volta a um lugar livre", async (keep) => {
  const ctx = keep(await ctxOf()); const { page } = await quiet(ctx);
  const spots = [];
  for (const [x, y] of [[420, 260], [900, 300], [700, 760]]) { await page.mouse.move(x, y, { steps: 5 }); await settled(page); spots.push(await head(page)); }
  const xs = spots.map((s) => Math.round(s.x)), ys = spots.map((s) => Math.round(s.y));
  assert(new Set(xs).size === 3 && Math.max(...ys) - Math.min(...ys) > 150, "não percorreu a tela: " + JSON.stringify([xs, ys]));
  await page.evaluate(() => { Bot.mv.lastIn = Date.now() - 9000; });
  await page.waitForFunction(() => Bot.mv.atRest, null, { timeout: 3000 }); await settled(page);
  const r = await page.evaluate(() => { const { w, h } = Bot.dims(), b = Bot.bounds(), m = Bot.mv; return { cost: Bot.cost(m.x, m.y, w, h), inside: m.x >= b.l && m.y >= b.t && m.x + w <= b.r && m.y + h <= b.b }; });
  assert(r.inside && r.cost < 6, "lugar de descanso inválido: " + JSON.stringify(r));
});
await test("A5. Mantém distância dos controles: passar o mouse em botões, campos e abas não coloca a cabeça sobre eles", async (keep) => {
  const ctx = keep(await ctxOf()); const { page } = await quiet(ctx);
  const targets = await page.evaluate(() => [...document.querySelectorAll("#app main button, #app main input, #app aside button, #app main a")].filter((n) => { const r = n.getBoundingClientRect(); return r.width > 20 && r.height > 14 && r.top > 0 && r.bottom < innerHeight; }).slice(0, 8).map((n) => { const r = n.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2, (n.textContent || n.placeholder || "").trim().slice(0, 20)]; }));
  assert(targets.length >= 5, "poucos controles para testar: " + targets.length);
  for (const [x, y, name] of targets) {
    await page.mouse.move(x, y, { steps: 4 }); await settled(page);
    const h = await head(page), over = await overControls(page);
    assert(!over.length, `com o mouse em "${name}" a cabeça cobriu: ${over.join(", ")}`);
    assert(!inHead(h, x, y, 12), `cabeça em cima do cursor em "${name}"`);
  }
});
await test("A6. Cliques e digitação funcionam mesmo com a cabeça em movimento por cima (a camada não captura o ponteiro)", async (keep) => {
  const ctx = keep(await ctxOf()); const { page } = await quiet(ctx);
  const lay = await page.evaluate(() => getComputedStyle(document.getElementById("bot")).pointerEvents);
  assert(lay === "none", "a camada do mascote captura o ponteiro: " + lay);
  const inp = await page.evaluate(() => { const i = [...document.querySelectorAll("#app main input")].find((n) => n.getBoundingClientRect().width > 100); i.id = i.id || "__alvo"; const r = i.getBoundingClientRect(); return { id: i.id, x: r.left + 30, y: r.top + r.height / 2 }; });
  // força a cabeça a atravessar o campo (como no meio de um movimento) e clica exatamente embaixo dela
  await page.evaluate(({ x, y }) => { const m = Bot.mv, { w, h } = Bot.dims(); m.x = x - w / 2; m.y = y - h / 2; Bot.paint(); Bot.go(x - w / 2 + 400, y - h / 2); }, inp);
  const st = await page.evaluate(({ x, y }) => ({ moving: !!Bot.mv.raf, under: document.elementFromPoint(x, y).closest("#bot") ? "bot" : document.elementFromPoint(x, y).tagName, pe: getComputedStyle(document.querySelector("#bot .bot-head")).pointerEvents }), inp);
  assert(st.moving && st.under !== "bot" && st.pe === "none", "em movimento a cabeça deveria deixar o clique passar: " + JSON.stringify(st));
  await page.mouse.click(inp.x, inp.y); await page.keyboard.type("Uber 99");
  assert((await page.evaluate((id) => document.activeElement.id === id && document.activeElement.value, inp.id)) === "Uber 99", "digitação no campo sob a cabeça falhou");
  await page.keyboard.press("Escape"); await settled(page);
  const btn = await page.evaluate(() => { const b = [...document.querySelectorAll("#app main button")].find((n) => /Adicionar registro/.test(n.textContent) && n.getBoundingClientRect().width); const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await page.evaluate(({ x, y }) => { const m = Bot.mv, { w, h } = Bot.dims(); m.x = x - w / 2; m.y = y - h / 2; Bot.paint(); Bot.go(m.x - 300, m.y + 200); }, btn);
  await page.mouse.click(btn.x, btn.y);
  assert(await page.evaluate(() => document.getElementById("modal").classList.contains("on")), "o botão sob a cabeça não respondeu ao clique");
});
await test("A7. Celular: reage ao toque com atraso, para perto (não em cima) do ponto tocado e não impede a rolagem", async (keep) => {
  const ctx = keep(await ctxOf({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })); const { page } = await quiet(ctx);
  const h0 = await head(page);
  const pt = await page.evaluate(() => { const e = [...document.querySelectorAll("#app main h1, #app main h2, #app main p")].find((n) => { const r = n.getBoundingClientRect(); return r.width > 80 && r.top > 120 && r.bottom < 500 && !n.closest("a,button"); }); const r = e.getBoundingClientRect(); return { x: Math.round(r.left + 40), y: Math.round(r.top + r.height / 2) }; });
  await page.touchscreen.tap(pt.x, pt.y); await page.waitForTimeout(120);
  const h1 = await head(page);
  assert(Math.hypot(h1.x - h0.x, h1.y - h0.y) < 25, "pulou para o toque sem atraso");
  await settled(page); const h2 = await head(page);
  const d0 = Math.hypot(h0.cx - pt.x, h0.cy - pt.y), d2 = Math.hypot(h2.cx - pt.x, h2.cy - pt.y);
  assert(d2 < d0 - 40, `não se aproximou do toque: ${d0.toFixed(0)} → ${d2.toFixed(0)}`);
  assert(!inHead(h2, pt.x, pt.y, 30), "parou em cima do ponto tocado");
  assert(!(await overControls(page)).length, "parou sobre um controle: " + (await overControls(page)));
  // arrastar o dedo começando em cima da cabeça rola a página normalmente
  const cdp = await ctx.newCDPSession(page);
  const top = () => page.evaluate(() => scrollY + (document.querySelector("#app main") || {}).scrollTop);
  await page.evaluate(() => { const m = document.querySelector("#app main"); m.scrollTop = 400; }); await page.waitForTimeout(400); await settled(page);
  const h3 = await head(page), x = Math.round(h3.cx), y = Math.round(h3.cy), dir = y < 422 ? 1 : -1, s0 = await top(); // dedo para baixo ou para cima, conforme o espaço
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  for (let i = 1; i <= 12; i++) { await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: y + dir * i * 25 }] }); await page.waitForTimeout(16); }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.waitForTimeout(300);
  const s1 = await top();
  await page.waitForTimeout(300); await settled(page);
  const h4 = await head(page); await page.touchscreen.tap(Math.round(h4.cx), Math.round(h4.cy)); await page.waitForTimeout(200);
  assert(await bubble(page), "tocar na cabeça parada deveria abrir uma dica");
  assert(Math.abs(s1 - s0) > 100, `a rolagem iniciada sobre a cabeça foi bloqueada: ${s0} → ${s1} ` + JSON.stringify([x, y, dir, await page.evaluate(([x, y]) => document.elementsFromPoint(x, y).slice(0, 4).map((e) => e.tagName + "." + e.className), [x, y])]));
});
await test("A8. Celular: com campo em edição e teclado aberto, nem a cabeça nem o balão cobrem o campo", async (keep) => {
  const ctx = keep(await ctxOf({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })); const { page } = await open(ctx, { hash: "#criar-conta" });
  await page.waitForTimeout(300);
  for (const id of ["re-email", "re-pass"]) {
    await page.tap("#" + id); await page.waitForTimeout(150);
    await page.setViewportSize({ width: 390, height: 430 }); // teclado virtual ocupando metade da tela
    await page.evaluate(() => document.activeElement.scrollIntoView({ block: "center" }));
    await page.waitForTimeout(500); await settled(page); await page.waitForTimeout(100);
    const r = await page.evaluate(() => { const f = document.activeElement.getBoundingClientRect(), h = document.querySelector("#bot .bot-head").getBoundingClientRect(), bb = document.querySelector("#bot .bot-bub"), b = bb.hidden ? null : bb.getBoundingClientRect();
      const hit = (a) => a && a.left < f.right && a.right > f.left && a.top < f.bottom && a.bottom > f.top;
      return { id: document.activeElement.id, head: hit(h), bub: hit(b), inView: h.top >= 0 && h.bottom <= innerHeight && h.right <= innerWidth && h.left >= 0, bubIn: !b || (b.top >= 0 && b.bottom <= innerHeight) }; });
    assert(r.id === id && !r.head && !r.bub && r.inView && r.bubIn, `${id}: ` + JSON.stringify(r));
    await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(200);
  }
});
await test("A9. Piscadas naturais: intervalos variáveis, troca curta para olhos fechados, sem deformar a cabeça", async (keep) => {
  const ctx = keep(await ctxOf()); const { page } = await quiet(ctx);
  await page.evaluate(() => { window.__bl = []; const el = document.getElementById("bot"), hd = el.querySelector(".bot-head"); new MutationObserver(() => { if (el.classList.contains("blink")) window.__bl.push({ t: performance.now(), w: hd.offsetWidth, h: hd.offsetHeight, op: getComputedStyle(el.querySelector("img.cl")).opacity }); }).observe(el, { attributes: true, attributeFilter: ["class"] }); });
  await page.waitForTimeout(7600);
  const r = await page.evaluate(() => ({ bl: window.__bl.filter((b, i, a) => !i || b.t - a[i - 1].t > 50), w: document.querySelector("#bot .bot-head").offsetWidth, h: document.querySelector("#bot .bot-head").offsetHeight, now: document.getElementById("bot").classList.contains("blink") }));
  assert(r.bl.length >= 1, "não piscou em 7,6 s");
  assert(r.bl.every((b) => b.w === r.w && b.h === r.h), "a cabeça mudou de tamanho ao piscar");
  await page.evaluate(() => Bot.blink());
  assert(await page.evaluate(() => getComputedStyle(document.querySelector("#bot img.cl")).opacity === "1"), "olhos fechados não apareceram");
  const t0 = Date.now(); await page.waitForFunction(() => !document.getElementById("bot").classList.contains("blink") && getComputedStyle(document.querySelector("#bot img.cl")).opacity === "0", null, { timeout: 1000, polling: 10 }).catch(() => { throw new Error("a piscada não terminou"); });
  assert(Date.now() - t0 < 400, "olhos fechados por tempo demais: " + (Date.now() - t0) + " ms");
  const gaps = await page.evaluate(() => { const g = []; const o = Bot.blink.bind(Bot); return new Promise((ok) => { let last = 0; Bot.blink = () => { const t = performance.now(); if (last) g.push(Math.round(t - last)); last = t; o(); if (g.length >= 2) { Bot.blink = o; ok(g); } }; setTimeout(() => { Bot.blink = o; ok(g); }, 15000); }); });
  assert(gaps.length >= 1 && gaps.every((g) => g > 200 && g < 7600), "intervalos fora da faixa natural: " + gaps);
});
await test("A10. Tamanhos de tela: dentro da área visível, sem rolagem horizontal e com tamanho proporcional", async (keep) => {
  for (const [w, hgt, mob] of [[320, 568, true], [768, 1024, true], [1024, 700, false], [1920, 1080, false]]) {
    const ctx = keep(await ctxOf({ viewport: { width: w, height: hgt }, isMobile: mob, hasTouch: mob })); const { page } = await quiet(ctx);
    if (!mob) { await page.mouse.move(w / 2, hgt / 2, { steps: 4 }); await settled(page); }
    else { await page.touchscreen.tap(Math.round(w / 2), 200); await page.waitForTimeout(150); await settled(page); }
    const r = await page.evaluate(() => { const h = document.querySelector("#bot .bot-head").getBoundingClientRect(); return { hw: h.width, l: h.left, t: h.top, r: h.right, b: h.bottom, vw: innerWidth, vh: innerHeight, sw: document.documentElement.scrollWidth }; });
    assert(r.l >= 0 && r.t >= 0 && r.r <= r.vw && r.b <= r.vh, `${w}x${hgt}: fora da tela ` + JSON.stringify(r));
    assert(r.sw <= r.vw, `${w}x${hgt}: rolagem horizontal`);
    assert(w <= 900 ? r.hw < 52 : r.hw > 60, `${w}x${hgt}: tamanho ${r.hw}`);
  }
});
await test("A11. Desempenho: mover o mouse não renderiza o app, o alvo é recalculado com limite e a animação para quando chega", async (keep) => {
  const ctx = keep(await ctxOf()); const { page } = await quiet(ctx);
  await page.evaluate(() => { window.__n = { render: 0, retarget: 0 }; const r = window.render; window.render = function () { __n.render++; return r.apply(this, arguments); }; const t = Bot.retarget.bind(Bot); Bot.retarget = (...a) => { __n.retarget++; return t(...a); }; });
  for (let i = 0; i < 60; i++) { await page.mouse.move(300 + i * 12, 200 + (i % 10) * 30); await page.waitForTimeout(20); }
  await settled(page);
  const n = await page.evaluate(() => window.__n);
  assert(n.render === 0, "o app foi renderizado durante o movimento do mouse: " + n.render);
  assert(n.retarget >= 2 && n.retarget <= 16, "recalculo do alvo sem limite: " + n.retarget + " para 60 movimentos");
  await page.waitForTimeout(500);
  assert(await page.evaluate(() => !Bot.mv.raf), "a animação continuou depois de chegar");
});
await test("A12. Minimizar e silenciar: minimizada não persegue o cursor e silenciada não abre balão sozinha", async (keep) => {
  const ctx = keep(await ctxOf()); const { page } = await quiet(ctx);
  await page.evaluate(() => Bot.show({ text: "teste" })); await page.click('#bot [data-bot="min"]');
  await page.waitForTimeout(300); await settled(page);
  const h0 = await head(page);
  await page.mouse.move(500, 300, { steps: 5 }); await page.waitForTimeout(900);
  const h1 = await head(page);
  assert(Math.hypot(h1.x - h0.x, h1.y - h0.y) < 1, "minimizada continuou seguindo o cursor");
  assert(h1.w < 50 && h1.can, "minimizada deveria ficar pequena e clicável: " + JSON.stringify(h1));
  await page.evaluate(() => { window.__said = []; tab = "despesas"; render(); }); await page.waitForTimeout(1200);
  assert(!(await bubble(page)), "silenciada abriu balão sozinha");
});

await browser.close(); server.close();
let fail = 0;
for (const r of results) { if (!r.ok) fail++; console.log(`${r.ok ? "✓" : "✗"} ${r.name}${r.info ? " — " + r.info : ""}`); }
console.log(`\n${results.length - fail}/${results.length} testes passaram.`);
process.exit(fail ? 1 : 0);
