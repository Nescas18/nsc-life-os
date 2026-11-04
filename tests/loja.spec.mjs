// Aba Lojinha: cadastro de produto, venda em 1 toque, cálculos de lucro e SEPARAÇÃO do faturamento de Uber/99.
// Uso: node tests/loja.spec.mjs   (Playwright; modo local/offline)
import http from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let chromium;
try { ({ chromium } = createRequire(import.meta.url)("playwright")); } catch { console.error("Instale o pacote 'playwright'."); process.exit(2); }
const server = http.createServer(async (req, res) => {
  const p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (p === "/config.js") return res.end("window.NSC_CONFIG={};");
  const f = path.join(ROOT, p === "/" ? "index.html" : p);
  if (!f.startsWith(ROOT) || !existsSync(f)) { res.writeHead(404); return res.end(); }
  res.end(await readFile(f));
});
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
const BASE = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch();
const results = [];
const assert = (c, m) => { if (!c) throw new Error(m); };
const near = (a, b, e = 0.001) => Math.abs(a - b) <= e;
async function test(name, fn) { const ctxs = []; try { results.push({ name, ok: true, info: (await fn((c) => ctxs.push(c))) || "" }); } catch (e) { results.push({ name, ok: false, info: e.message.split("\n")[0] }); } finally { for (const c of ctxs) await c.close(); } }
async function appPage(keep) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "pt-BR" }); keep(ctx);
  await ctx.route(/cdnjs|cdn\.jsdelivr\.net|googleapis|gstatic|unpkg/, (r) => r.abort());
  const page = await ctx.newPage(); const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  await page.goto(BASE + "#criar-conta"); await page.waitForTimeout(500);
  await page.fill("#re-name", "Lojista"); await page.fill("#re-email", "loja@nesc.local"); await page.fill("#re-pass", "segredo123");
  await page.click("#form-register .btn-submit");
  await page.waitForSelector("#app.on #view .grid", { timeout: 8000 });
  return { page, errs };
}
const goLoja = (page) => page.evaluate(() => { tab = "loja"; render(); });
const shop = (page, f, t) => page.evaluate(([f, t]) => shopStats(f, t), [f, t]);

await test("Aba Lojinha existe e abre sem erro", async (keep) => {
  const { page, errs } = await appPage(keep);
  assert(await page.evaluate(() => TABS.some((t) => t[0] === "loja")), "aba loja não está nas TABS");
  await goLoja(page);
  assert(await page.evaluate(() => !!document.querySelector("#view .shop-note")), "a aba Lojinha não renderizou");
  assert(!errs.length, errs.join(" | "));
});

await test("Cadastra produto e vende em 1 toque: lucro = venda − custo", async (keep) => {
  const { page } = await appPage(keep);
  await goLoja(page);
  await page.click("[data-shopnew]"); await page.waitForSelector("form[data-form=shopprod]"); await page.waitForTimeout(90);
  await page.fill("form[data-form=shopprod] [name=name]", "Perfume");
  await page.fill("form[data-form=shopprod] [name=cost]", "12");
  await page.fill("form[data-form=shopprod] [name=price]", "30");
  await page.click("form[data-form=shopprod] button.btn");
  await page.waitForSelector("[data-shopsell]");
  await page.click("[data-shopsell]"); await page.waitForTimeout(200);
  const t = await page.evaluate(() => TODAY());
  const d = await shop(page, t, t);
  assert(near(d.inc, 30) && near(d.cst, 12) && near(d.profit, 18) && d.qty === 1, "venda 1×: " + JSON.stringify(d));
  await page.click("[data-shopsell]"); await page.waitForTimeout(200);
  const d2 = await shop(page, t, t);
  assert(near(d2.inc, 60) && near(d2.profit, 36) && d2.qty === 2, "venda 2×: " + JSON.stringify(d2));
  return `2 vendas → fat ${d2.inc}, lucro ${d2.profit}`;
});

await test("Lojinha é SEPARADA: vender não mexe no faturamento de Uber/99", async (keep) => {
  const { page } = await appPage(keep);
  const t = await page.evaluate(() => TODAY());
  await goLoja(page);
  await page.click("[data-shopnew]"); await page.waitForSelector("form[data-form=shopprod]"); await page.waitForTimeout(90);
  await page.fill("form[data-form=shopprod] [name=name]", "Chaveiro");
  await page.fill("form[data-form=shopprod] [name=cost]", "3");
  await page.fill("form[data-form=shopprod] [name=price]", "10");
  await page.click("form[data-form=shopprod] button.btn"); await page.waitForSelector("[data-shopsell]");
  await page.click("[data-shopsell]"); await page.waitForTimeout(200);
  const fin = await page.evaluate((t) => { const c = CS(t, t); return { appInc: c.inc, appOp: c.op, shopInc: shopStats(t, t).inc }; }, t);
  assert(fin.appInc === 0 && fin.shopInc === 10, "faturamento do app deveria ficar 0 e a lojinha 10: " + JSON.stringify(fin));
  return "app R$ 0 · lojinha R$ 10";
});

await test("Venda avulsa (sem cadastrar produto) entra com nome e valor", async (keep) => {
  const { page } = await appPage(keep);
  await goLoja(page);
  await page.click("[data-shopsale]"); await page.waitForSelector("form[data-form=shopsale]");
  // sem produtos cadastrados, o form já está em modo avulso (pid hidden)
  await page.fill("form[data-form=shopsale] [name=aname]", "Bala");
  await page.fill("form[data-form=shopsale] [name=aval]", "2");
  await page.fill("form[data-form=shopsale] [name=acost]", "0,50");
  await page.click("form[data-form=shopsale] button.btn"); await page.waitForTimeout(200);
  const t = await page.evaluate(() => TODAY());
  const d = await shop(page, t, t);
  assert(near(d.inc, 2) && near(d.profit, 1.5), "avulsa: " + JSON.stringify(d));
});

await test("Dados da Lojinha persistem ao recarregar (mesmo armazenamento do app)", async (keep) => {
  const { page } = await appPage(keep);
  await page.evaluate(() => { db.shop.products.push({ id: "x", name: "Água", cost: 0, price: 5, cat: "", at: 1 }); db.shop.sales.push({ id: "s", d: TODAY(), pid: "x", name: "Água", cat: "", qty: 1, unit: 5, cost: 0, at: 2 }); mark(); Store.save(); });
  await page.reload(); await page.waitForSelector("#app.on #view .grid", { timeout: 8000 });
  const n = await page.evaluate(() => db.shop.products.length + "/" + db.shop.sales.length);
  assert(n === "1/1", "após recarregar deveria ter 1 produto e 1 venda: " + n);
});

await browser.close();
server.close();
let fail = 0;
for (const r of results) { if (!r.ok) fail++; console.log(`${r.ok ? "✓" : "✗"} ${r.name}${r.info ? " — " + r.info : ""}`); }
console.log(`\n${results.length - fail}/${results.length} testes passaram.`);
process.exit(fail ? 1 : 0);
