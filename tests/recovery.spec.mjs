// Fluxo de recuperação de senha com um cliente Supabase SIMULADO (nenhuma chamada real, nenhum e-mail enviado).
// Uso: node tests/recovery.spec.mjs
import http from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let chromium;
try { ({ chromium } = createRequire(import.meta.url)("playwright")); } catch { console.error("Instale o pacote 'playwright'."); process.exit(2); }

const MOCK = `window.__calls={reset:[],update:[],signOut:0};
window.supabase={createClient(){const subs=[];let session=null;const h=location.hash;
 if(/access_token=/.test(h)&&/type=recovery/.test(h)){session={access_token:'t',user:{id:'u1',email:'motorista@teste.local',user_metadata:{name:'M'}}};setTimeout(()=>subs.forEach(cb=>cb('PASSWORD_RECOVERY',session)),60)}
 const q={select(){return q},eq(){return q},order(){return q},maybeSingle:async()=>({data:null,error:null}),upsert:async()=>({error:null}),limit:async()=>({data:[],error:null})};
 return{auth:{getSession:async()=>({data:{session}}),onAuthStateChange(cb){subs.push(cb);return{data:{subscription:{unsubscribe(){}}}}},
  resetPasswordForEmail:async(email,o)=>{__calls.reset.push({email,redirectTo:o&&o.redirectTo});return{error:null}},
  updateUser:async(o)=>{__calls.update.push(o);return session?{data:{user:session.user},error:null}:{error:{message:'Auth session missing!'}}},
  signOut:async()=>{__calls.signOut++;session=null;return{error:null}},
  signInWithPassword:async()=>({data:{},error:{message:'Invalid login credentials'}}),signUp:async()=>({data:{},error:{message:'x'}})},from(){return q}}}};`;

const server = http.createServer(async (req, res) => {
  const p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (p === "/config.js") return res.end("window.NSC_CONFIG={supabaseUrl:'https://projeto-falso.supabase.test',supabaseAnonKey:'anon-falsa'};");
  const f = path.join(ROOT, p === "/" ? "index.html" : p);
  if (!f.startsWith(ROOT) || !existsSync(f)) { res.writeHead(404); return res.end(); }
  res.end(await readFile(f));
});
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
const BASE = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch();
const results = [];
const assert = (c, m) => { if (!c) throw new Error(m); };
async function page(hash = "#entrar") {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.route(/cdnjs\.cloudflare\.com/, (r) => r.abort());
  await ctx.route(/cdn\.jsdelivr\.net/, (r) => r.fulfill({ body: MOCK, contentType: "text/javascript" }));
  await ctx.route(/supabase\.test/, (r) => r.abort());
  const pg = await ctx.newPage();
  const errs = [];
  pg.on("pageerror", (e) => errs.push(e.message));
  await pg.goto(BASE + hash);
  await pg.waitForTimeout(400);
  return { ctx, pg, errs };
}
async function test(name, fn) {
  let o;
  try { o = await fn(); results.push({ name, ok: true }); }
  catch (e) { results.push({ name, ok: false, info: e.message }); }
  finally { if (o && o.ctx) await o.ctx.close(); }
}

await test("Esqueceu a senha: valida e-mail, pede o link com retorno ao app e responde sem revelar se a conta existe", async () => {
  const o = await page();
  await o.pg.click("#form-login .forgot-link");
  assert(await o.pg.isVisible("#form-recover"), "formulário de recuperação não abriu");
  await o.pg.fill("#rc-email", "invalido");
  await o.pg.click("#form-recover .btn-submit");
  assert(/e-mail válido/.test(await o.pg.textContent("#auth-err")), "validação do e-mail");
  await o.pg.fill("#rc-email", "Motorista@Teste.local");
  await o.pg.click("#form-recover .btn-submit");
  await o.pg.waitForFunction(() => window.__calls.reset.length === 1);
  const c = await o.pg.evaluate(() => window.__calls.reset[0]);
  assert(c.email === "motorista@teste.local" && c.redirectTo === BASE, JSON.stringify(c));
  const msg = await o.pg.textContent("#auth-err");
  assert(/Se houver uma conta/.test(msg), "mensagem neutra: " + msg);
  assert(await o.pg.isDisabled("#form-recover .btn-submit"), "botão continuou ativo após o pedido");
  await o.pg.evaluate(() => document.getElementById("form-recover").requestSubmit()); // tenta de novo mesmo assim
  await o.pg.waitForTimeout(200);
  assert((await o.pg.evaluate(() => window.__calls.reset.length)) === 1, "permitiu pedidos repetidos em sequência");
  assert(!o.errs.length, o.errs.join(" | "));
  return o;
});

await test("Cadastro também oferece recuperação", async () => {
  const o = await page();
  await o.pg.click("#btn-tab-register");
  await o.pg.click("#form-register .forgot-link");
  assert(await o.pg.isVisible("#form-recover"), "link do cadastro não abriu a recuperação");
  return o;
});

await test("Link do e-mail: pede nova senha (não entra direto), valida, grava, encerra a sessão e volta ao login", async () => {
  const o = await page("#access_token=t&refresh_token=r&type=recovery");
  await o.pg.waitForSelector("#form-newpass", { state: "visible" });
  await o.pg.waitForFunction(() => /motorista@teste\.local/.test(document.getElementById("np-who").textContent));
  assert(!(await o.pg.evaluate(() => document.getElementById("app").classList.contains("on"))), "entrou no app sem trocar a senha");
  await o.pg.fill("#np-pass", "curta1");
  await o.pg.fill("#np-pass2", "curta1");
  await o.pg.click("#form-newpass .btn-submit");
  assert(/8 caracteres/.test(await o.pg.textContent("#auth-err")), "política de tamanho");
  await o.pg.fill("#np-pass", "NovaSenha2026");
  await o.pg.fill("#np-pass2", "NovaSenha2025");
  await o.pg.click("#form-newpass .btn-submit");
  assert(/não são iguais/.test(await o.pg.textContent("#auth-err")), "confirmação diferente");
  await o.pg.fill("#np-pass2", "NovaSenha2026");
  await o.pg.click("#form-newpass .btn-submit");
  await o.pg.waitForSelector("#form-login", { state: "visible" });
  const st = await o.pg.evaluate(() => ({ up: window.__calls.update, out: window.__calls.signOut, msg: document.getElementById("auth-err").textContent, hash: location.hash }));
  assert(st.up.length === 1 && st.up[0].password === "NovaSenha2026", "updateUser: " + JSON.stringify(st.up));
  assert(st.out >= 1 && /redefinida/.test(st.msg) && !st.hash.includes("access_token"), JSON.stringify(st));
  return o;
});

await test("Link expirado: volta ao pedido de novo link com aviso claro", async () => {
  const o = await page("#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired");
  await o.pg.waitForSelector("#form-recover", { state: "visible" });
  assert(/expirou/.test(await o.pg.textContent("#auth-err")), "aviso de link expirado");
  return o;
});

await browser.close();
server.close();
let fail = 0;
for (const r of results) { if (!r.ok) fail++; console.log(`${r.ok ? "✓" : "✗"} ${r.name}${r.info ? " — " + r.info : ""}`); }
console.log(`\n${results.length - fail}/${results.length} testes passaram.`);
process.exit(fail ? 1 : 0);
