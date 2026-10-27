# Migração do NESC para a Hostinger — domínio nescar.com.br

## Resumo da auditoria
- **Site estático**: `index.html` (HTML/CSS/JS embutido) + `config.js` + imagens/ícones.
- **Sem framework e sem Node.js no servidor.** Supabase (banco + auth) é acessado do navegador;
  bibliotecas externas (Supabase JS, three.js) vêm de CDN. **Nada muda no Supabase.**
- `npm run build` só copia arquivos para `www/` (app Android). **A web não precisa de build.**
- Compatível com qualquer plano de hospedagem de sites da Hostinger (não precisa de Node/PHP/MySQL).

## Estratégia de migração (sem quebrar a Vercel)
`publicUrl()` usa a **origem atual** quando ela está autorizada. Com Vercel e Hostinger em
`allowedOrigins`/`siteUrl`, cada ambiente usa o próprio endereço nos links de e-mail. A Vercel
continua no ar até o corte final de DNS.

## Deploy via Git no hPanel (escolhido)
**Branch de deploy:** `chore/hostinger-migracao-prep`
**Repositório:** `git@github.com:Nescas18/nsc-life-os.git` (privado → usar Deploy Key)

1. **hPanel → Avançado → GIT → Criar um novo repositório:**
   - Repositório: `git@github.com:Nescas18/nsc-life-os.git`
   - Branch: `chore/hostinger-migracao-prep`
   - Diretório de instalação: a pasta do **subdomínio de teste** (ver abaixo), ex.: `teste.nescar.com.br`
2. A Hostinger mostra uma **chave SSH de deploy**. Em GitHub → repo → **Settings → Deploy keys →
   Add deploy key** (somente leitura). Depois clique em **Deploy/Atualizar** no hPanel.
3. Observação: o repositório tem pastas que não são do site (`tests/`, `scripts/`, `docs/`, `www/`).
   Elas são inertes (não referenciadas). O site é servido pelo `index.html` na raiz.

### Site de teste (validar antes de tocar no domínio principal)
- **hPanel → Domínios → Subdomínios → Criar:** `teste.nescar.com.br`.
- Faça o Git deploy apontando para a pasta desse subdomínio.
- **hPanel → SSL:** garanta o certificado para `teste.nescar.com.br` (HTTPS). O `.htaccess` força HTTPS.
- Endereço de teste: `https://teste.nescar.com.br`.

## Supabase → Authentication → URL Configuration (fazer antes de testar recuperação)
- **Site URL:** manter `https://indexnscai.vercel.app` por enquanto (fallback; preserva a Vercel).
- **Redirect URLs:** ADICIONAR (mantendo os da Vercel):
  - `https://teste.nescar.com.br/**`
  - `https://nescar.com.br/**`
  - `https://www.nescar.com.br/**`
Sem isso, os links de recuperação/confirmação não voltam para o novo endereço.

## Corte final (somente após validar o teste e com sua confirmação)
1. `config.js`: trocar `siteUrl` para `https://nescar.com.br`.
2. `index.html`: atualizar `canonical`, `og:url`, `og:image`, `twitter:image` para `https://nescar.com.br`.
3. Supabase: trocar **Site URL** para `https://nescar.com.br` (manter os Redirect URLs).
4. **Apontar o domínio principal** `nescar.com.br` para a Hostinger (hPanel → Domínios); como o domínio
   já está na Hostinger, normalmente é associar o domínio ao site/pasta. Usar SOMENTE os valores que o
   hPanel indicar — não há IP/registro a inventar. Emitir SSL para o apex e o www.
5. Validar de novo no domínio final; só então desativar a Vercel, se desejar.

## O que NÃO muda
Supabase (banco + auth), contas e dados; a chave do frontend é a **anon pública** (segura com RLS).

## Rollback
Enquanto o DNS do apex não mudar, a Vercel permanece no ar.
