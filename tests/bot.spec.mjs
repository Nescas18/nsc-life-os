// Mascote/copiloto do NESC: 20 cenários do copiloto + critérios do mascote ancorado por aba (posição, animações, dicas), executados no index.html real em um Chromium (Playwright).
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
  const r = await page.evaluate(() => { const img = document.querySelector(".bot-head img"), h = document.querySelector(".bot-head").getBoundingClientRect(); return { src: img.currentSrc, w: img.naturalWidth, inView: h.right <= innerWidth && h.bottom <= innerHeight && h.left >= 0 }; });
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
  await page.waitForFunction(() => /Bora criar sua conta/.test(window.__said.join(" ") + " " + ((Bot.cur && Bot.cur.text) || "")), null, { timeout: 4000 }); // a fala sai já na abertura; o gancho de registro pode chegar depois
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
  await page.waitForFunction(() => /Data de nascimento inválida/.test(document.querySelector("#bot .bot-msg")?.textContent || ""), null, { timeout: 3000 });
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
  await p2.waitForFunction(() => /Confirme o e-mail para entrar/.test(document.querySelector("#bot .bot-msg")?.textContent || ""), null, { timeout: 3000 });
  assert(!/Sua conta foi criada\. Agora/.test(await said(p2)), "boas-vindas do app antes de existir sessão");
});
await test("6. Usuário entra: checklist de configuração com etapas reais e níveis", async (keep) => {
  const ctx = keep(await ctxOf()); const { page } = await open(ctx, { user: U1, seed: { cfg: { pass: OFF } } });
  await page.waitForFunction(() => /configuração rápida/.test(window.__said.join(" ")), null, { timeout: 5000 });
  const ck = await page.evaluate(() => [...document.querySelectorAll("#bot .bot-ck li")].map((li) => li.innerText.replace(/\s+/g, " ")));
  assert(ck.length === 5 && /Primeiro lançamento\s*essencial/i.test(ck[1]) && /Veículo\s*recomendada/i.test(ck[2]) && /Meta do dia\s*opcional/i.test(ck[4]), "checklist: " + JSON.stringify(ck));
  assert(await page.evaluate(() => document.querySelector(".bot-head").classList.contains("alert")), "sem estado de atenção com pendência essencial");
});
await test("7/8. Cadastrar veículo atualiza o checklist; com o essencial pronto, avisa que a configuração básica fechou (uma vez)", async (keep) => {
  const ctx = keep(await ctxOf()); const { page } = await open(ctx, { user: U1, seed: { cfg: { pass: OFF }, tx: [tx(T, "in", "uber", 200)] } });
  await page.waitForTimeout(400); await fast(page);
  await page.evaluate(() => { db.vehicle = { brand: "Fiat", model: "Argo", custom: true, energy: "flex", body: "hatch" }; Bot.lastForm = "ob"; Store.save(); });
  await page.waitForFunction(() => /Boa! Veículo cadastrado\./.test(window.__said.join(" ")), null, { timeout: 3000 });
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
  const ok9 = await page.waitForFunction(() => /Registre o primeiro ganho da Uber/.test(window.__said.join(" ") + " " + ((Bot.queue && Bot.queue.text) || "") + " " + ((Bot.cur && Bot.cur.text) || "")), null, { timeout: 4000 }).then(() => true, () => false);
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
  const ok12 = await page.waitForFunction(() => /(dias|dia) sem registro.*Não trabalhei/.test(window.__said.join(" ")), null, { timeout: 3000 }).then(() => true, () => false);
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
  assert(/Meta de faturamento batida.*107,03%/.test(r.goal.t), "meta superada: " + r.goal.t);
  assert(/Faltam .*200,00 para a meta/.test(r.miss.t), "meta não atingida: " + r.miss.t);
});
await test("15. Navegar entre abas não repete a mesma fala", async (keep) => {
  const ctx = keep(await ctxOf()); const { page } = await open(ctx, { user: U1, seed: { cfg: { pass: OFF }, tx: [tx(T, "in", "uber", 100)], vehicle: { brand: "X", model: "Y", custom: true } } });
  await page.waitForTimeout(300); await fast(page);
  for (const t of ["uber", "despesas", "uber", "despesas", "uber"]) { await page.evaluate((t) => { Bot.hide(); tab = t; render(); }, t); await page.waitForTimeout(1100); }
  const s = await said(page);
  assert((s.match(/Faturamento é o que a Uber pagou/g) || []).length === 1, "fala da Uber repetida: " + s);
  assert((s.match(/Lance combustível, manutenção/g) || []).length === 1, "fala de Despesas repetida");
});
await test("16. Celular: mascote menor, dentro da tela, sem rolagem horizontal; balão não sai da tela", async (keep) => {
  const ctx = keep(await ctxOf({ viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true })); const { page } = await open(ctx, { user: U1, seed: { cfg: { pass: OFF } } });
  await page.waitForFunction(() => !document.querySelector("#bot .bot-bub").hidden, null, { timeout: 5000 });
  const r = await page.evaluate(() => { const hd = document.querySelector(".bot-head"), h = hd.getBoundingClientRect(), b = document.querySelector("#bot .bot-bub").getBoundingClientRect(); return { hw: hd.offsetWidth, h: [h.left, h.right, h.bottom], b: [b.left, b.right, b.top, b.bottom], vw: innerWidth, vh: innerHeight, sw: document.documentElement.scrollWidth }; });
  assert(r.hw <= 60, "mascote grande demais no celular: " + r.hw);
  assert(r.h[0] >= 0 && r.h[1] <= r.vw && r.h[2] <= r.vh && r.b[0] >= 0 && r.b[1] <= r.vw && r.b[2] >= 0 && r.b[3] <= r.vh, "fora da tela: " + JSON.stringify(r));
  assert(r.sw <= r.vw, "rolagem horizontal");
  const ctx2 = keep(await ctxOf()); const p2 = (await open(ctx2, { user: U1, seed: { cfg: { pass: OFF } } })).page;
  assert((await p2.evaluate(() => document.querySelector(".bot-head").offsetWidth)) > r.hw, "no computador o mascote deveria ser maior");
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
  await page.click(".bot-head"); assert(await bubble(page), "toque no mascote silenciado deveria dar dica");
  await page.click('#bot [data-bot="min"]');
  assert(await page.evaluate(() => document.querySelector(".bot-head").classList.contains("min") && Bot.st().min), "não minimizou");
  await page.reload(); await page.waitForTimeout(400);
  assert(await page.evaluate(() => document.querySelector(".bot-head").classList.contains("min")), "preferência não persistiu");
});
await test("18. Movimento reduzido: sem piscadas nem balanços automáticos e sem animação contínua", async (keep) => {
  const ctx = keep(await ctxOf({ reducedMotion: "reduce" })); const { page } = await open(ctx, { user: U1, seed: { cfg: { pass: OFF } } });
  await page.waitForTimeout(300);
  await page.evaluate(() => { window.__an = 0; const hd = document.querySelector(".bot-head"); new MutationObserver(() => { if (/\b(blink|turn)\b/.test(hd.className)) window.__an++; }).observe(hd, { attributes: true, attributeFilter: ["class"] }); });
  await page.waitForTimeout(8000);
  const r = await page.evaluate(() => ({ an: window.__an, fl: getComputedStyle(document.querySelector(".bot-head .bot-float")).animationName }));
  assert(r.an === 0 && r.fl === "none", "movimento reduzido ignorado: " + JSON.stringify(r));
});
await test("19. Falha de rede: nenhuma confirmação falsa; avisa que ficou só no aparelho", async (keep) => {
  const ctx = keep(await ctxOf()); const { page } = await open(ctx, { user: U1, seed: { cfg: { pass: OFF }, vehicle: { brand: "X", model: "Y", custom: true } } });
  await page.waitForTimeout(300); await fast(page);
  await page.evaluate(() => { user.id = "u1"; Cloud.on = true; Cloud.push = async () => { throw new Error("Failed to fetch"); }; Bot.hide(); tab = "uber"; render(); });
  await page.fill("#reg form[data-form=inc] input[name=v]", "150"); await page.click("#reg form[data-form=inc] button.btn:not([type=button])");
  await page.waitForFunction(() => /ainda não chegou à nuvem/.test(window.__said.join(" ")), null, { timeout: 4000 });
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

/* ---------- mascote ancorado por aba: posição, animações e dicas curtas ---------- */
const QUIET = { cfg: { pass: OFF }, tx: [tx(T, "in", "uber", 100)], vehicle: { brand: "X", model: "Y", custom: true } };
async function quiet(ctx, opts = {}) { // app aberto, dicas silenciadas e balão fechado
  const o = await open(ctx, { user: U1, seed: QUIET, ...opts });
  await o.page.evaluate(() => { Bot.put({ muted: true }); Bot.hide(); });
  await o.page.waitForTimeout(700); await o.page.evaluate(() => Bot.hide());
  return o;
}
const TABS = ["hoje", "uber", "n99", "historico", "despesas", "manutencao", "metas", "financas", "config", "produtividade", "ia", "conquistas", "ranking"];
/* o que a cabeça cobre de verdade: linhas de texto visíveis e controles da tela (não a caixa inteira dos blocos) */
const covers = (page) => page.evaluate(() => { const hd = document.querySelector(".bot-head"); if (!hd || hd.hidden || hd.classList.contains("away")) return { shown: false };
  const R = hd.getBoundingClientRect(), hit = [], rg = document.createRange(), ov = (q) => q.left < R.right - 1 && q.right > R.left + 1 && q.top < R.bottom - 1 && q.bottom > R.top + 1;
  const tw = document.createTreeWalker(document.getElementById("view"), NodeFilter.SHOW_TEXT, { acceptNode: (n) => n.nodeValue.trim() && !n.parentElement.closest(".bot-head") ? 1 : 3 }); let n;
  while ((n = tw.nextNode())) { rg.selectNodeContents(n); for (const q of rg.getClientRects()) if (q.width && ov(q)) hit.push("texto: " + n.nodeValue.trim().slice(0, 20)); }
  document.querySelectorAll("#view a,#view button,#view input,#view select,#view textarea,#view .btn,#view svg,#view canvas").forEach((e) => { if (e.closest(".bot-head")) return; const q = e.getBoundingClientRect(); if (q.width && ov(q)) hit.push("controle: " + (e.textContent || e.placeholder || e.tagName).trim().slice(0, 20)); });
  const bar = document.querySelector("#app.on aside"), br = bar && innerWidth <= 900 ? bar.getBoundingClientRect().bottom : 0;
  return { shown: true, hit, x: R.left, r: R.right, y: R.top, w: R.width, inView: R.left >= 0 && R.right <= innerWidth, belowBar: R.top >= br - 1, sw: document.documentElement.scrollWidth, vw: innerWidth }; });
const plain = (h) => String(h || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

await test("A1/A2. Sem medalhão: só a cabeça recortada (cantos transparentes, proporção da cabeça) e a piscada usa a mesma silhueta", async (keep) => {
  const ctx = keep(await ctxOf()); const { page } = await quiet(ctx);
  const r = await page.evaluate(async () => {
    const load = (src) => new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = src; });
    const out = {};
    for (const k of ["open", "closed"]) { const i = await load(`/cabeca-${k}-256.webp`), c = document.createElement("canvas"); c.width = i.naturalWidth; c.height = i.naturalHeight; const g = c.getContext("2d"); g.drawImage(i, 0, 0);
      const a = (x, y) => g.getImageData(x, y, 1, 1).data[3], W = c.width - 1, H = c.height - 1;
      out[k] = { w: c.width, h: c.height, corners: [a(0, 0), a(W, 0), a(0, H), a(W, H), a(W >> 1, 0), a(W >> 1, H)].reduce((s, v) => s + v, 0), center: a(W >> 1, H >> 1) }; }
    out.imgs = [...document.querySelectorAll(".bot-head .bot-tilt img")].map((i) => i.currentSrc.split("/").pop());
    out.legacy = !!document.querySelector('[src*="mascote-"],[srcset*="mascote-"]');
    return out; });
  assert(!r.legacy, "ainda referencia a imagem antiga com medalhão");
  assert(r.imgs.length === 2 && /cabeca-open/.test(r.imgs[0]) && /cabeca-closed/.test(r.imgs[1]), "imagens: " + r.imgs);
  for (const k of ["open", "closed"]) {
    assert(r[k].corners === 0, `${k}: bordas/cantos não são transparentes`);
    assert(r[k].center === 255, `${k}: o rosto deveria ser opaco`);
    assert(r[k].w / r[k].h > .75 && r[k].w / r[k].h < .95, `${k}: proporção ${r[k].w}x${r[k].h} não é a da cabeça`);
  }
  assert(r.open.w === r.closed.w && r.open.h === r.closed.h, "olhos fechados com tamanho diferente: deformaria na piscada");
});
await test("M1. Em cada aba e largura (1280, 430, 390, 375, 320): no topo da aba, sem cobrir texto nem controles, abaixo da barra fixa e sem empurrar o conteúdo", async (keep) => {
  const fails = [];
  for (const [w, h, mob] of [[1280, 860, false], [430, 932, true], [390, 844, true], [375, 812, true], [320, 640, true]]) {
    const ctx = keep(await ctxOf({ viewport: { width: w, height: h }, isMobile: mob, hasTouch: mob })); const { page } = await quiet(ctx);
    for (const t of TABS) {
      await page.evaluate((t) => { tab = t; render(); document.querySelector("main").scrollTop = 0; }, t); await page.waitForTimeout(60);
      const c = await covers(page);
      // mesmo layout do cabeçalho com e sem a cabeça (ela não ocupa espaço no fluxo)
      const same = await page.evaluate(() => { const hd = document.querySelector(".bot-head"), H = document.querySelector("#view>.head"), snap = () => [...H.children].filter((e) => e !== hd).map((e) => { const r = e.getBoundingClientRect(); return [r.left, r.top, r.width, r.height].map(Math.round).join(","); }).join("|") + "#" + H.offsetHeight + "#" + document.getElementById("view").scrollWidth;
        const a = snap(); const p = hd.parentNode, nx = hd.nextSibling; hd.remove(); const b = snap(); p.insertBefore(hd, nx); return a === b; });
      if (!c.shown) fails.push(`${w} ${t}: mascote não aparece`);
      else if (c.hit.length || !c.inView || !c.belowBar || c.sw > c.vw || !same) fails.push(`${w} ${t}: ` + JSON.stringify({ hit: c.hit, inView: c.inView, belowBar: c.belowBar, sw: c.sw, same }));
    }
  }
  assert(!fails.length, fails.slice(0, 6).join(" ; "));
});
await test("M2. Rola junto com o cabeçalho (nunca fica parado sobre os cartões) e arrastar o dedo sobre ela rola a página", async (keep) => {
  const ctx = keep(await ctxOf({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })); const { page } = await quiet(ctx, { seed: { ...QUIET, tx: Array.from({ length: 40 }, (_, i) => tx(T, "in", "uber", 10 + i)) } });
  await page.evaluate(() => { tab = "historico"; render(); });
  const a = await page.evaluate(() => [document.querySelector(".bot-head").getBoundingClientRect().top, document.querySelector("#view>.head h1").getBoundingClientRect().top]);
  await page.evaluate(() => { document.querySelector("main").scrollTop = 220; }); await page.waitForTimeout(100);
  const b = await page.evaluate(() => [document.querySelector(".bot-head").getBoundingClientRect().top, document.querySelector("#view>.head h1").getBoundingClientRect().top]);
  assert(Math.abs((a[0] - b[0]) - (a[1] - b[1])) < 1 && a[0] - b[0] > 150, "não acompanhou o cabeçalho: " + JSON.stringify([a, b]));
  await page.evaluate(() => { document.querySelector("main").scrollTop = 0; }); await page.waitForTimeout(100);
  const h = await page.evaluate(() => { const r = document.querySelector(".bot-head").getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; });
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [h] });
  for (let i = 1; i <= 12; i++) { await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: h.x, y: h.y - i * 30 }] }); await page.waitForTimeout(16); }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }); await page.waitForTimeout(300);
  assert((await page.evaluate(() => document.querySelector("main").scrollTop)) > 100, "a rolagem iniciada sobre a cabeça foi bloqueada");
});
await test("M3. Animações: piscadas ocasionais e um leve balanço de vez em quando, nunca duas ao mesmo tempo e nada contínuo", async (keep) => {
  const ctx = keep(await ctxOf()); const { page } = await quiet(ctx);
  await page.evaluate(() => { window.__ov = []; window.__ev = { blink: 0, turn: 0 }; const hd = document.querySelector(".bot-head"); let prev = "";
    new MutationObserver(() => { const on = ["blink", "turn", "talk", "happy", "enter"].filter((k) => hd.classList.contains(k)); if (on.length > 1) window.__ov.push(on.join("+")); for (const k of ["blink", "turn"]) if (on.includes(k) && !prev.includes(k)) window.__ev[k]++; prev = on.join(" "); }).observe(hd, { attributes: true, attributeFilter: ["class"] });
    Bot.turnAt = 0; });
  const idle = await page.evaluate(() => getComputedStyle(document.querySelector(".bot-head .bot-float")).animationName);
  assert(idle === "none", "animação contínua no repouso: " + idle);
  await page.waitForTimeout(14000);
  const r = await page.evaluate(() => ({ ov: window.__ov, ev: window.__ev }));
  assert(!r.ov.length, "animações simultâneas: " + r.ov.join(", "));
  assert(r.ev.blink >= 1, "não piscou em 14 s");
  // balanço: suave (≤ 10°), curto e bloqueia outras animações enquanto dura
  const t = await page.evaluate(async () => { Bot.turn(); const hd = document.querySelector(".bot-head"), a = getComputedStyle(hd.querySelector(".bot-float")).animationName, busy = Bot.busy(); await new Promise((ok) => setTimeout(ok, 1600)); return { a, busy, after: hd.classList.contains("turn") }; });
  assert(t.a === "botturn" && t.busy && !t.after, "balanço: " + JSON.stringify(t));
  const deg = await page.evaluate(() => { for (const sh of document.styleSheets) for (const ru of sh.cssRules) if (ru.name === "botturn") return [...ru.cssRules].map((k) => k.style.transform).join(" "); return ""; });
  const max = Math.max(...[...deg.matchAll(/rotate\((-?\d+(?:\.\d+)?)deg\)/g)].map((m) => Math.abs(+m[1])));
  assert(max <= 10, "rotação exagerada: " + deg);
});
await test("M4. Dicas curtas (uma frase, adaptadas à aba), balão estreito e dentro da tela em 320 px sem cobrir o campo em edição", async (keep) => {
  const ctx = keep(await ctxOf({ viewport: { width: 320, height: 640 }, isMobile: true, hasTouch: true })); const { page } = await open(ctx, { user: U1, seed: QUIET });
  await page.waitForTimeout(300);
  const tips = await page.evaluate((TABS) => { const out = []; for (const t of TABS) { const m = Bot.tabMsg(t, true); if (m) out.push([t, m.text]); }
    const keep = db; for (const [inc, exp, goal] of [[350, 120, 0], [100, 130, 0], [150, 149, 0], [321.1, 0, 300], [100, 0, 300]]) { db = Object.assign(empty(), { cfg: { pass: { uber: { on: false }, n99: { on: false } }, goal }, tx: [{ id: "a", d: TODAY(), type: "in", app: "uber", v: inc, at: 1 }].concat(exp ? [{ id: "b", d: TODAY(), type: "other", app: "veic", v: exp, at: 1 }] : []) }); migrate(); out.push(["resumo", Bot.finMsg().text]); } db = keep; return out; }, TABS);
  const long = tips.filter(([, t]) => plain(t).length > 90);
  assert(!long.length, "dicas longas: " + long.map(([t, x]) => t + ": " + plain(x)).join(" | "));
  // dicas diferentes por aba (nada de frase genérica repetida)
  const tabTips = tips.filter(([t]) => t !== "resumo").map(([, x]) => plain(x));
  assert(new Set(tabTips).size >= tabTips.length - 3, "dicas repetidas entre abas: " + tabTips.join(" | "));
  // balão estreito, dentro da tela e fora do campo em edição
  await page.evaluate(() => { tab = "despesas"; render(); }); await page.waitForTimeout(100);
  await page.evaluate(() => { const i = [...document.querySelectorAll("#view input")].find((n) => n.getBoundingClientRect().width > 100 && n.type !== "search") || document.getElementById("q"); i.focus(); Bot.show({ text: "Lance combustível, manutenção e outros gastos." }); });
  await page.waitForTimeout(100);
  const b = await page.evaluate(() => { const bb = document.querySelector("#bot .bot-bub").getBoundingClientRect(), f = document.activeElement.getBoundingClientRect(); return { w: bb.width, inView: bb.left >= 0 && bb.right <= innerWidth && bb.top >= 0 && bb.bottom <= innerHeight, overField: bb.left < f.right && bb.right > f.left && bb.top < f.bottom && bb.bottom > f.top }; });
  assert(b.w <= 272.5 && b.inView && !b.overField, "balão: " + JSON.stringify(b));
});
await test("M5. Dicas não reaparecem nem aparecem fora de hora: uma dica de aba nunca surge depois, em outra aba; intervalo entre dicas automáticas", async (keep) => {
  const ctx = keep(await ctxOf()); const { page } = await open(ctx, { user: U1, seed: QUIET });
  await page.waitForTimeout(400); await page.evaluate(() => Bot.hide());
  const r = await page.evaluate(() => { tab = "despesas"; render(); Bot.hide(); window.__said = []; Bot.last = Date.now(); // dentro do intervalo: a dica vai para a fila
    Bot.say({ id: "tab:teste", tab: "despesas", text: "Lance combustível, manutenção e outros gastos." }); const queued = !!Bot.queue;
    tab = "metas"; render(); Bot.last = 0; Bot.flush(); return { queued, said: window.__said.slice(), gap: Bot.GAP }; });
  assert(r.queued && !r.said.length, "dica de outra aba apareceu depois da troca de aba: " + JSON.stringify(r));
  assert(r.gap >= 30000, "intervalo entre dicas automáticas curto demais: " + r.gap);
});
await test("M6. Tocar na cabeça abre a dica; ✕ e toque fora fecham (celular)", async (keep) => {
  const ctx = keep(await ctxOf({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true })); const { page } = await quiet(ctx);
  await page.tap(".bot-head"); await page.waitForTimeout(100); assert(await bubble(page), "toque na cabeça não abriu a dica");
  await page.tap("#bot .bot-x"); assert(!(await bubble(page)), "✕ não fechou");
  await page.tap(".bot-head"); await page.waitForTimeout(100); await page.touchscreen.tap(30, 500); assert(!(await bubble(page)), "toque fora não fechou");
});

await browser.close(); server.close();
let fail = 0;
for (const r of results) { if (!r.ok) fail++; console.log(`${r.ok ? "✓" : "✗"} ${r.name}${r.info ? " — " + r.info : ""}`); }
console.log(`\n${results.length - fail}/${results.length} testes passaram.`);
process.exit(fail ? 1 : 0);
