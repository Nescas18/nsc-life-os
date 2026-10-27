// Aba Ranking no modo nuvem com cliente Supabase SIMULADO: confere que o app só CONSULTA nesc_ranking
// (nunca grava posição), envia período/critério corretos e mostra posição, apelido e destaque do usuário.
import http from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let chromium; try { ({ chromium } = createRequire(import.meta.url)("playwright")); } catch { console.error("Instale 'playwright'."); process.exit(2); }
const MOCK = `window.__rpc=[];window.__writes=[];
window.supabase={createClient(){const session={access_token:'t',user:{id:'u-me',email:'eu@teste.local',user_metadata:{name:'Eu'}}};
 const q=(t)=>{const o={select(){return o},eq(){return o},order(){return o},maybeSingle:async()=>({data:null,error:null}),limit:async()=>({data:[],error:null}),upsert:async(r)=>{__writes.push(t);return{error:null}}};return o};
 return{auth:{getSession:async()=>({data:{session}}),onAuthStateChange(){return{data:{subscription:{unsubscribe(){}}}}},signOut:async()=>({error:null})},
  from:q,rpc:async(fn,args)=>{__rpc.push({fn,args});return{data:[{pos:1,alias:'Motorista #A1B2',value:320.5,is_me:false,row_no:1,participants:3},{pos:2,alias:'Rei da Pista',value:210,is_me:true,row_no:2,participants:3},{pos:2,alias:'Motorista #77FF',value:210,is_me:false,row_no:3,participants:3}],error:null}}}}};`;
const server = http.createServer(async (req, res) => { const p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (p === "/config.js") return res.end("window.NSC_CONFIG={supabaseUrl:'https://falso.supabase.test',supabaseAnonKey:'anon-falsa'};");
  const f = path.join(ROOT, p === "/" ? "index.html" : p); if (!f.startsWith(ROOT) || !existsSync(f)) { res.writeHead(404); return res.end(); } res.end(await readFile(f)); });
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
const browser = await chromium.launch(); const results = []; const assert = (c, m) => { if (!c) throw new Error(m); };
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, timezoneId: "America/Sao_Paulo" });
await ctx.route(/cdnjs/, (r) => r.abort()); await ctx.route(/cdn\.jsdelivr\.net/, (r) => r.fulfill({ body: MOCK, contentType: "text/javascript" })); await ctx.route(/supabase\.test/, (r) => r.fulfill({ status: 201, body: "" }));
const page = await ctx.newPage(); const errs = []; page.on("pageerror", (e) => errs.push(e.message));
await page.addInitScript(() => { localStorage.setItem("sb-falso-auth-token", "1"); });
await page.clock.setFixedTime(new Date("2026-10-27T15:00:00-03:00"));
await page.goto(`http://127.0.0.1:${server.address().port}/`);
await page.waitForSelector("#app.on #view .grid", { timeout: 15000 });
try {
  await page.evaluate(() => { tab = "ranking"; render(); });
  await page.waitForSelector(".it.rk.me", { timeout: 5000 });
  let r = await page.evaluate(() => window.__rpc.at(-1));
  assert(r.fn === "nesc_ranking" && r.args.p_metric === "lucro" && r.args.p_from === "2026-10-01" && r.args.p_to === "2026-10-27", JSON.stringify(r));
  const t = await page.evaluate(() => [...document.querySelectorAll(".it.rk")].map((e) => e.textContent.replace(/\s+/g, " ").trim()));
  assert(t.length === 3 && /^2º ?Rei da Pista ?você/.test(t[1]) && /^2º ?Motorista #77FF/.test(t[2]), "lista: " + JSON.stringify(t));
  await page.click('[data-rper="w"]'); await page.click('[data-rmet="faturamento"]'); await page.waitForTimeout(300);
  r = await page.evaluate(() => window.__rpc.at(-1));
  assert(r.args.p_metric === "faturamento" && r.args.p_from === "2026-10-21", "filtros: " + JSON.stringify(r.args));
  await page.fill("#rk-nick", "Rei <b>da</b> Pista"); await page.click("form[data-form=rank] button.btn"); await page.waitForTimeout(300);
  const nick = await page.evaluate(() => db.cfg.rankNick);
  assert(nick === "Rei bda/b Pista", "apelido saneado: " + nick);
  const w = await page.evaluate(() => window.__writes);
  assert(!w.includes("driver_global_ranking"), "o app ainda grava na tabela de ranking: " + w);
  assert(!errs.length, errs.join(" | "));
  results.push({ ok: true, name: "Ranking no app: consulta o servidor, filtros, empate, destaque do usuário, apelido e nenhuma gravação de posição" });
} catch (e) { results.push({ ok: false, name: "Ranking no app", info: e.message }); }
await browser.close(); server.close();
for (const r of results) console.log(`${r.ok ? "✓" : "✗"} ${r.name}${r.info ? " — " + r.info : ""}`);
console.log(`\n${results.filter((r) => r.ok).length}/${results.length} testes passaram.`); process.exit(results.every((r) => r.ok) ? 0 : 1);
