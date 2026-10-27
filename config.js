// Configuração pública do NESC.
// A chave anon/publishable é própria para uso no navegador; nunca coloque service_role aqui.
window.NSC_CONFIG = Object.assign({}, window.NSC_CONFIG || {}, {
  supabaseUrl: 'https://pmjmmfmggjqtamoybobq.supabase.co',
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBtam1tZm1nZ2pxdGFtb3lib2JxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQwOTE5MjAsImV4cCI6MjA3OTY2NzkyMH0.m8p0MzlR_1_EZ5V1ALTG-w15ZW6vBzbig9rTXGyEBCk',

  // Endereço público OFICIAL de fallback dos links de recuperação/confirmação.
  // Durante a coexistência Vercel + Hostinger, mantemos o domínio atual da Vercel aqui para
  // NÃO quebrar a produção atual. publicUrl() usa a ORIGEM ATUAL quando ela está autorizada
  // (ver allowedOrigins), então cada hospedagem já usa o próprio endereço nos e-mails.
  // No corte final (domínio validado), trocar para: 'https://nescar.com.br'
  siteUrl: 'https://indexnscai.vercel.app',

  // Origens autorizadas a serem usadas como destino dos links de e-mail (além do siteUrl,
  // dos previews da Vercel e do ambiente local). Novo domínio na Hostinger + subdomínio de teste.
  allowedOrigins: [
    'https://nescar.com.br',
    'https://www.nescar.com.br',
    'https://teste.nescar.com.br'
  ]
});
