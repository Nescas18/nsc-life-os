// Configuração pública do Supabase para o NESC.
// A chave anon/publishable é própria para uso no navegador; nunca coloque service_role aqui.
window.NSC_CONFIG = Object.assign({}, window.NSC_CONFIG || {}, {
  supabaseUrl: 'https://pmjmmfmggjqtamoybobq.supabase.co',
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBtam1tZm1nZ2pxdGFtb3lib2JxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQwOTE5MjAsImV4cCI6MjA3OTY2NzkyMH0.m8p0MzlR_1_EZ5V1ALTG-w15ZW6vBzbig9rTXGyEBCk',
  // Endereço público oficial do app publicado. É o destino padrão dos links de recuperação e de
  // confirmação de cadastro. O domínio personalizado ainda não foi comprado, então usamos o domínio
  // atual da Vercel. Os links do e-mail sempre apontam para cá (nunca para localhost:3000).
  // Importante: este endereço também precisa estar em Authentication → URL Configuration no Supabase
  // (Site URL + Redirect URLs); caso contrário o Supabase ignora o redirectTo e usa o Site URL dele.
  siteUrl: 'https://indexnscai.vercel.app'
});
