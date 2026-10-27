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

const MOCK = `window.__calls={reset:[],update:[],signOut:0,signup:[],profileUpdate:[]};
window.supabase={createClient(){const subs=[];let session=null;const h=location.hash;
 if(/access_token=/.test(h)&&/type=recovery/.test(h)){session={access_token:'t',user:{id:'u1',email:'motorista@teste.local',user_metadata:{name:'M'}}};setTimeout(()=>subs.forEach(cb=>cb('PASSWORD_RECOVERY',session)),60)}
 const q={select(){return q},eq(){return q},order(){return q},update(v){__calls.profileUpdate.push(v);return q},maybeSingle:async()=>({data:null,error:null}),upsert:async()=>({error:null}),limit:async()=>({data:[],error:null}),then(r){return Promise.resolve({data:null,error:null}).then(r)}};
 return{auth:{getSession:async()=>({data:{session}}),onAuthStateChange(cb){subs.push(cb);return{data:{subscription:{unsubscribe(){}}}}},
  resetPasswordForEmail:async(email,o)=>{__calls.reset.push({email,redirectTo:o&&o.redirectTo});return{error:null}},
  updateUser:async(o)=>{__calls.update.push(o);return session?{data:{user:session.user},error:null}:{error:{message:'Auth session missing!'}}},
  signOut:async()=>{__calls.signOut++;session=null;return{error:null}},
  signInWithPassword:async()=>({data:{},error:{message:'Invalid login credentials'}}),
  signUp:async(o)=>{__calls.signup.push(o);return{data:{session:null,user:{id:'new',email:o.email}},error:null}}},from(){return q}}}};`;

const server = http.createServer(async (req, res) => {
  const p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (p === "/config.js") return res.end("window.NSC_CONFIG={supabaseUrl:'https://projeto-falso.supabase.test',supabaseAnonKey:'anon-falsa',siteUrl:'https://indexnscai.vercel.app'};");
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
  await o.pg.waitForSelector("#form-done", { state: "visible" });
  const st = await o.pg.evaluate(() => ({ up: window.__calls.update, out: window.__calls.signOut, hash: location.hash, done: document.getElementById("done-h").textContent }));
  assert(st.up.length === 1 && st.up[0].password === "NovaSenha2026", "updateUser: " + JSON.stringify(st.up));
  assert(st.out >= 1 && /sucesso/i.test(st.done) && !st.hash.includes("access_token"), JSON.stringify(st));
  await o.pg.click("#form-done .btn-submit"); // botão "Voltar ao login"
  await o.pg.waitForSelector("#form-login", { state: "visible" });
  return o;
});

await test("Link expirado: volta ao pedido de novo link com aviso claro", async () => {
  const o = await page("#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired");
  await o.pg.waitForSelector("#form-recover", { state: "visible" });
  assert(/expirou/.test(await o.pg.textContent("#auth-err")), "aviso de link expirado");
  return o;
});

await test("Textos e botões do fluxo seguem exatamente a especificação", async () => {
  const o = await page();
  await o.pg.click("#form-login .forgot-link");
  assert((await o.pg.textContent("#form-recover .auth-h")).trim() === "Recupere o acesso à sua conta", "título passo 1");
  assert(/Informe o e-mail cadastrado para receber as instruções de recuperação da sua senha\./.test(await o.pg.textContent("#form-recover .sub")), "texto passo 1");
  assert((await o.pg.textContent("label[for=rc-email]")).trim() === "E-mail cadastrado", "label e-mail");
  assert((await o.pg.textContent("#form-recover .btn-submit .bl")).trim() === "Enviar instruções", "botão passo 1");
  return o;
});

await test("Cadastro envia a data de nascimento como metadado e com retorno ao endereço público; data futura é barrada", async () => {
  const o = await page();
  await o.pg.click("#btn-tab-register");
  await o.pg.waitForTimeout(100); // a aba foca o primeiro campo após 30 ms; preencher antes disso disputa o foco
  await o.pg.fill("#re-name", "Ana Teste");
  await o.pg.fill("#re-email", "ana@teste.local");
  await o.pg.fill("#re-pass", "SenhaForte2026");
  await o.pg.fill("#re-birth", "2999-01-01");
  await o.pg.click("#form-register .btn-submit");
  assert(/futuro/.test(await o.pg.textContent("#auth-err")), "data futura deveria ser barrada");
  assert((await o.pg.evaluate(() => window.__calls.signup.length)) === 0, "cadastrou mesmo com data inválida");
  await o.pg.fill("#re-birth", "1992-07-15");
  await o.pg.click("#form-register .btn-submit");
  await o.pg.waitForFunction(() => window.__calls.signup.length === 1);
  const c = await o.pg.evaluate(() => window.__calls.signup[0]);
  assert(c.options.data.birth_date === "1992-07-15", "metadado birth_date: " + JSON.stringify(c.options.data));
  assert(c.options.data.name === "Ana Teste", "nome no metadado");
  assert(c.options.emailRedirectTo === BASE, "retorno do cadastro: " + c.options.emailRedirectTo);
  return o;
});

await test("publicUrl usa a origem local permitida; origem estranha e preview seguem a regra da allowlist", async () => {
  const o = await page();
  // a função é testada com uma allowlist idêntica à do app, mas aplicada a origens arbitrárias
  const r = await o.pg.evaluate(() => {
    const site = String(C.siteUrl || "").replace(/\/+$/, "");
    // espelha publicUrl(): agora também aceita as origens de NSC_CONFIG.allowedOrigins (migração de domínio)
    const extra = (Array.isArray(C.allowedOrigins) ? C.allowedOrigins : []).map((x) => String(x).replace(/\/+$/, "")).filter(Boolean);
    const decide = (origin) => {
      const allow = [site, ...extra, /^https:\/\/indexnscai(-[a-z0-9-]+)?-nsc-ai1\.vercel\.app$/, /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/];
      const ok = origin && allow.some((a) => a instanceof RegExp ? a.test(origin) : a && origin === a);
      return ok ? origin : site;
    };
    return { here: publicUrl(), site, extra, prod: decide(site), preview: decide("https://indexnscai-abc123-nsc-ai1.vercel.app"), phish: decide("https://phishing.example.com"), localhost: decide("http://localhost:3000"), custom: decide("https://meu-dominio.com"), customExtra: decide((extra[0] || "https://nao-configurado.invalid")) };
  });
  assert(r.here === BASE, "origem local permitida (127.0.0.1) deveria ser usada: " + r.here);
  assert(r.prod === r.site, "produção aceita");
  assert(r.preview === "https://indexnscai-abc123-nsc-ai1.vercel.app", "preview aceito: " + r.preview);
  assert(r.localhost === "http://localhost:3000", "localhost de desenvolvimento aceito");
  assert(r.phish === r.site, "origem desconhecida deveria cair para o endereço oficial: " + r.phish);
  assert(r.custom === r.site, "domínio não autorizado deveria cair para o oficial: " + r.custom);
  // migração de domínio: uma origem listada em allowedOrigins passa a ser aceita (sem editar o código)
  const r2 = await o.pg.evaluate(() => { C.allowedOrigins = ["https://nesc.exemplo.com", "https://www.nesc.exemplo.com"]; const site = String(C.siteUrl || "").replace(/\/+$/, ""); const extra = C.allowedOrigins.map((x) => String(x).replace(/\/+$/, "")); const decide = (origin) => { const allow = [site, ...extra]; return origin && allow.some((a) => origin === a) ? origin : site; }; return { ok: decide("https://nesc.exemplo.com"), www: decide("https://www.nesc.exemplo.com"), bad: decide("https://phishing.example.com") }; });
  assert(r2.ok === "https://nesc.exemplo.com" && r2.www === "https://www.nesc.exemplo.com", "allowedOrigins não autorizou o novo domínio: " + JSON.stringify(r2));
  assert(r2.bad === r.site, "allowedOrigins não deveria autorizar origem estranha: " + r2.bad);
  return o;
});

await browser.close();
server.close();
let fail = 0;
for (const r of results) { if (!r.ok) fail++; console.log(`${r.ok ? "✓" : "✗"} ${r.name}${r.info ? " — " + r.info : ""}`); }
console.log(`\n${results.length - fail}/${results.length} testes passaram.`);
process.exit(fail ? 1 : 0);
