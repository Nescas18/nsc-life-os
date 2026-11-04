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
  assert(await page.evaluate(() => !!document.querySelector("#view .shhero [data-shopsale]")), "a aba Lojinha não renderizou");
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
  await page.click("[data-shopsale]"); await page.waitForSelector("form[data-form=shopsale]"); await page.waitForTimeout(90);
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

await test("Estoque baixa ao vender e volta ao desfazer; produtos sem estoque não são afetados", async (keep) => {
  const { page } = await appPage(keep);
  await page.evaluate(() => { db.shop.products.push({ id: "p1", name: "Perfume", cost: 12, price: 30, cat: "", stock: 5, at: 1 }); db.shop.products.push({ id: "p2", name: "Avulso", cost: 1, price: 3, cat: "", at: 2 }); mark(); Store.save(); });
  await goLoja(page);
  await page.click('[data-shopsell="p1"]'); await page.waitForTimeout(200);
  let st = await page.evaluate(() => db.shop.products.find((x) => x.id === "p1").stock);
  assert(st === 4, "venda deveria baixar o estoque para 4: " + st);
  // desfazer pela ação do toast
  await page.click("#toast [data-undo], #toast button"); await page.waitForTimeout(200);
  st = await page.evaluate(() => ({ stock: db.shop.products.find((x) => x.id === "p1").stock, sales: db.shop.sales.length }));
  assert(st.stock === 5 && st.sales === 0, "desfazer deveria devolver o estoque e remover a venda: " + JSON.stringify(st));
  // produto sem estoque controlado continua sem a propriedade após vender
  await page.click('[data-shopsell="p2"]'); await page.waitForTimeout(200);
  const p2 = await page.evaluate(() => ({ hasStock: typeof db.shop.products.find((x) => x.id === "p2").stock }));
  assert(p2.hasStock === "undefined", "produto sem estoque não deveria ganhar controle de estoque: " + JSON.stringify(p2));
  return "estoque 5→4→5; avulso sem estoque";
});

await test("Parados: produtos cadastrados que menos saíram aparecem no topo, com os de 0 venda marcados", async (keep) => {
  const { page } = await appPage(keep);
  const t = await page.evaluate(() => TODAY());
  await page.evaluate((t) => {
    db.shop.products.push({ id: "a", name: "Campeão", cost: 1, price: 5, cat: "", stock: 10, at: 1 });
    db.shop.products.push({ id: "b", name: "Encalhado", cost: 2, price: 8, cat: "", stock: 4, at: 2 });
    for (let i = 0; i < 3; i++) db.shop.sales.push({ id: "v" + i, d: t, pid: "a", name: "Campeão", cat: "", qty: 1, unit: 5, cost: 1, at: 10 + i });
    mark(); Store.save();
  }, t);
  const slow = await page.evaluate((t) => shopSlow(t.slice(0, 8) + "01", t).map((x) => ({ name: x.name, qty: x.qty })), t);
  assert(slow[0].name === "Encalhado" && slow[0].qty === 0, "o mais parado deveria ser Encalhado com 0: " + JSON.stringify(slow));
  assert(slow[1].name === "Campeão" && slow[1].qty === 3, "o campeão deveria vir depois com 3: " + JSON.stringify(slow));
  const stk = await page.evaluate(() => shopStock());
  assert(stk.un === 14 && stk.tracked === 2, "resumo de estoque: 14 unidades em 2 produtos: " + JSON.stringify(stk));
  // limiar: só conta 'última unidade' quando sobra 1; 2 ou mais não alarma
  const thr = await page.evaluate(() => {
    db.shop.products = [{ id: "c2", name: "Dois", cost: 1, price: 2, stock: 2, at: 1 }, { id: "c1", name: "Um", cost: 1, price: 2, stock: 1, at: 2 }, { id: "c0", name: "Zero", cost: 1, price: 2, stock: 0, at: 3 }];
    return shopStock();
  });
  assert(thr.low === 1 && thr.out === 1, "com estoques 2,1,0 → última unidade=1 e esgotados=1 (2 não alarma): " + JSON.stringify(thr));
  return "parados ok · última unidade só com 1";
});

await browser.close();
server.close();
let fail = 0;
for (const r of results) { if (!r.ok) fail++; console.log(`${r.ok ? "✓" : "✗"} ${r.name}${r.info ? " — " + r.info : ""}`); }
console.log(`\n${results.length - fail}/${results.length} testes passaram.`);
process.exit(fail ? 1 : 0);
