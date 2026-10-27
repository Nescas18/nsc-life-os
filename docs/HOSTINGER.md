# Migração do NESC para a Hostinger

## O que o NESC é (resumo da auditoria)
- **Site estático**: um `index.html` (todo o HTML/CSS/JS embutido) + `config.js` + imagens/ícones.
- **Sem framework e sem Node.js no servidor**. As bibliotecas externas (Supabase JS, three.js)
  são carregadas de CDN em tempo de execução. O banco e a autenticação são do **Supabase**,
  acessados direto do navegador — **nada muda no Supabase** nesta migração.
- `npm run build` só copia os arquivos para `www/` (usado pelo app Android). **Para a web não é
  necessário build**: os arquivos a publicar são os do próprio repositório.

## Plano da Hostinger
Qualquer plano que sirva arquivos estáticos funciona (Hospedagem/Website/Cloud). **Não precisa de
Node.js, banco MySQL nem PHP.** Basta enviar os arquivos para `public_html` e ativar o SSL gratuito.

## Arquivos a enviar para `public_html`
```
index.html
config.js
.htaccess
manifest.webmanifest
favicon.ico
favicon-32.png
icon-192.png
icon-512.png
icon-maskable-512.png
apple-touch-icon.png
og-image.png
cabeca-open-160.webp
cabeca-open-256.webp
cabeca-closed-160.webp
cabeca-closed-256.webp
cabeca-open-256.png
cabeca-closed-256.png
```
**Não** envie: `node_modules/`, `tests/`, `scripts/`, `android/`, `www/`, `vercel.json`.

## Passo a passo
1. **hPanel → Hospedagem → Gerenciador de arquivos** (ou FTP) → entre em `public_html`.
2. Envie os arquivos da lista acima (ou o `.zip` preparado e extraia lá dentro).
3. **hPanel → SSL**: garanta o certificado gratuito ativo (HTTPS). O `.htaccess` já força HTTPS.
4. **Domínio**: aponte o domínio para a Hostinger (ver "Domínio e DNS" abaixo) — só depois da validação.

## Ajustes de domínio (feitos quando o domínio for confirmado)
1. **`config.js`**: trocar `siteUrl` para `https://SEU_DOMINIO` e preencher
   `allowedOrigins: ['https://SEU_DOMINIO','https://www.SEU_DOMINIO']`.
2. **`index.html`** (SEO/preview social): atualizar `canonical`, `og:url`, `og:image`, `twitter:image`
   do domínio da Vercel para o novo domínio.
3. **Supabase → Authentication → URL Configuration**:
   - **Site URL**: `https://SEU_DOMINIO`
   - **Redirect URLs**: adicionar `https://SEU_DOMINIO/**` e `https://www.SEU_DOMINIO/**`
     (mantenha o domínio da Vercel enquanto os dois ambientes coexistirem).
   Sem isso, os links de recuperação/confirmação de e-mail continuam indo para o endereço antigo.

## Domínio e DNS (somente após validar o site de teste)
- Opção A — **domínio na Hostinger**: use o site de teste no subdomínio/preview da Hostinger até validar;
  depois conecte o domínio ao site em hPanel → Domínios.
- Opção B — **domínio em outro registrador**: apontar os **nameservers** para a Hostinger OU criar
  registros **A/CNAME** conforme o painel da Hostinger indicar. Use **somente** os valores reais
  mostrados no hPanel (não há IP/registro fixo a inventar).
- Propagação de DNS pode levar de minutos a 24–48 h. O SSL é reemitido para o domínio após apontar.

## O que NÃO muda
- Supabase (banco + auth), contas e dados dos usuários atuais.
- A chave usada no frontend é a **anon pública** (segura com RLS). Nenhuma chave secreta vai para o
  código ou para o host.

## Rollback
Enquanto o DNS do domínio não for alterado, a Vercel continua no ar e atendendo normalmente.
