# Regras de cálculo do NESC

Fonte única: o motor em `index.html` (seção "MOTOR DE CÁLCULOS"). Todas as telas — Hoje, Uber, 99, Finanças,
Ranking, Conquistas e Assistente — chamam as mesmas funções (`stats`, `AS`, `CS`). Datas são sempre a **data local**
do aparelho (`YYYY-MM-DD`), nunca UTC.

| Termo | Definição |
| --- | --- |
| **Faturamento** | Soma dos ganhos (`type: 'in'`) da Uber e/ou da 99 com data dentro do período. |
| **Despesas registradas** | Soma de todos os gastos lançados no período (combustível/energia, manutenção, outros e passes), na data em que foram lançados. É a visão de caixa. |
| **Custos operacionais** | Energia + passes atribuídos ao período + outros gastos. |
| **Lucro operacional** | Faturamento − custos operacionais do mesmo período. |
| **Resultado completo** | Lucro operacional − manutenção − custos fixos do veículo rateados. |
| **Resultado financeiro (caixa)** | Entradas − saídas lançadas no dia (card "Resultado financeiro" da aba Hoje). |
| **Dia trabalhado** | Dia com faturamento ou jornada com atividade. Uber e 99 no mesmo dia contam uma vez; dia só com despesa não conta. |

## O que entra em cada indicador

| Gasto | Lucro operacional | Resultado completo | Despesas lançadas | Observação |
| --- | --- | --- | --- | --- |
| Combustível/energia | sim (real no dia registrado, senão estimativa por km) | sim | sim (valor lançado) | |
| Outros gastos (alimentação, lavagem, taxas…) | sim | sim | sim | |
| Passes e pacotes | sim (rateados pelos dias trabalhados) | sim | sim (na data da compra) | |
| Manutenção | **não** | sim | sim | só entra uma vez: o registro de manutenção vinculado a uma despesa não é somado de novo |
| Parcela, seguro, IPVA, depreciação | **não** | sim (custos fixos rateados) | não | a parcela do financiamento mistura amortização e juros; por isso fica fora do lucro operacional |
| Pagamento de contas a pagar | não | não | não | saída de caixa, aparece em Contas e no Histórico |
| Reservas | não | não | não | dinheiro separado, não é receita nem despesa |

Lucro operacional **não é** lucro líquido contábil.

## Valores monetários

Os valores são guardados com 2 casas. Somas são feitas em centavos inteiros (`sum`) e cada componente do resultado
(energia, passes, outros, manutenção, custos fixos) é arredondado para centavos antes de compor o lucro (`r2`), então
os números exibidos sempre fecham a conta. A formatação `R$ 1.234,56` é só visual.

## Metas

`atingimento = realizado ÷ meta × 100`, sem teto: R$ 546,00 com meta de R$ 220,00 = **248,18%**. A barra para em 100%
e mostra o selo "superada". Meta ausente ou zero não gera percentual.

| Tipo | Compara | Período |
| --- | --- | --- |
| Faturamento | faturamento bruto Uber + 99 | dia ou semana (segunda a domingo) |
| Lucro operacional | lucro operacional | dia ou semana |
| Limite de despesas | despesas lançadas (dentro do limite = ok) | dia ou semana |
| Economia / reserva | saldo da reserva vinculada (ou o que foi guardado hoje) | total ou dia |
| Pagamento de obrigação | valor separado na reserva da conta ou já pago | próxima parcela em aberto |
| Personalizada | marcada por você | rotina diária ou porcentagem manual |

## Dias sem registro

Nenhum dia sem registro vira faturamento zero. Lembretes só aparecem para dias **passados** que estão nos dias
habituais (configurados em Configurações ou detectados quando houve trabalho em pelo menos 3 das últimas 6 semanas
naquele dia da semana). "Não trabalhei" grava uma confirmação em `db.off` (separada dos lançamentos); "Lembrar
depois" esconde o aviso até o dia seguinte. No gráfico: ponto = registro real; lacuna com círculo vazado = sem
registro; quadrado cinza = folga confirmada.

## Histórico

É uma visão sobre os registros originais (`tx`, `maint`, `jr`, pagamentos de contas, reservas e folgas); nada é
copiado. Os totais do Histórico somam só lançamentos financeiros (`tx`) e batem com o motor.

## Ranking

Calculado **no servidor** pela função `nesc_ranking` (migração `supabase/migrations/20261027150000_nesc_ranking_servidor.sql`),
a partir dos registros salvos de cada conta, com a mesma regra do app (testado em 900 comparações aleatórias contra o
motor do `index.html`).

- Critérios: lucro operacional do período (padrão) ou faturamento. Períodos: hoje, últimos 7 dias, mês atual.
- Empates dividem a posição (1, 1, 3). Participa quem teve faturamento ou jornada no período.
- Mostra só posição, apelido (escolhido ou "Motorista #XXXX") e o valor do critério. Nunca nome, e-mail, veículo,
  despesas, lançamentos ou identificadores. "Participar da classificação" desmarcado = fica fora.
- O navegador não grava posição nem valor; a tabela antiga `driver_global_ranking` ficou sem acesso pelo app.
- Valores são os declarados por cada motorista (o NESC não confere com as plataformas).

## Energia (combustível ou recarga)

**Regra de 27/10/2026 — só o registrado entra no lucro.** O lucro operacional usa apenas o combustível/energia
**efetivamente registrado** (abastecimentos e recargas lançados) no período. A estimativa por km (`km × custo por
km`, com consumo e preço configurados) passou a ser **apenas informativa**, mostrada à parte, e nunca é somada ao
lucro. Antes, somar a estimativa dos dias sem abastecimento ao valor de um abastecimento registrado em outro dia
podia **contar o combustível duas vezes**. Quando há qualquer abastecimento registrado no período, nenhuma
estimativa é calculada. A mesma regra vale no app, nos relatórios, na produtividade e no ranking (servidor).
Entre Uber e 99, o gasto registrado do período é dividido por km (ou por faturamento quando falta km).

## Horas trabalhadas

A duração da jornada é informada em dois campos inteiros, **Horas** e **Minutos** (teclado numérico). Minutos vão
de 0 a 59; `6h75` é recusado (nunca arredondado em silêncio). Mais de 9 horas é permitido. Os dois campos vazios =
"não informado" (não vira zero). Internamente guardamos **minutos inteiros** (6h30min = 390) e exibimos `6h30min`.

- **Uber + 99 no mesmo dia:** se você marca que trabalhou nos dois ao mesmo tempo (sobreposição), as horas **não**
  são somadas duas vezes — vale o maior bloco do dia. Sem essa marca, somam-se normalmente.
- **Lucro operacional por hora** = lucro operacional dos dias **com horas informadas** ÷ horas desses dias. Ex.:
  R$ 300 − R$ 80 = R$ 220 em 5h → R$ 44/h. Dias sem horas ficam fora dessa média; sem nenhuma hora, mostramos
  "Sem dados de horas" (nunca divisão por zero).
- **Revisão de dados antigos:** o campo único anterior aceitava "6,30", lido como 6,3 h (6h18min). A Produtividade
  sugere a correção **só** quando os minutos batem exatamente com essa leitura decimal (18 → 30, 9 → 15, 27 → 45…).
  Nada é convertido automaticamente: cada caso é confirmado por você, e o valor anterior fica guardado em `minOrig`.

## Data de nascimento (perfil)

Opcional, informada no cadastro ou em Ajustes → Perfil. Fica em `public.profiles.birth_date`, protegida por RLS
(só o próprio dono e administradores leem/editam). Datas impossíveis, futuras ou anteriores a 1900 são recusadas e
**não** bloqueiam o cadastro (viram vazio no servidor). É apenas complementar para apoio de identificação no
suporte: **nunca** autentica, gera sessão, redefine senha, aparece em ranking ou em qualquer consulta pública.

## Passes e pacotes

O preço do pacote é dividido igualmente entre os **dias da validade em que o app teve atividade** (faturamento ou
jornada). Dia sem registro não recebe custo de passe. A divisão é feita em centavos exatos, com o centavo restante
nos primeiros dias, para que a soma dos dias seja sempre o preço pago. Se nenhum dia da validade teve atividade, o
valor inteiro fica na data de início.

Exemplo: pacote 99 de 3 dias por R$ 74,99, válido de 24 a 26/10, com trabalho apenas em 24/10 → R$ 74,99 em 24/10
e R$ 0,00 em 25 e 26/10. Com trabalho em 24 e 25/10 → R$ 37,50 + R$ 37,49.

> Correção de 26/10/2026: antes o passe era dividido por **todos** os dias de validade (R$ 25,00/dia), o que
> fazia um dia sem nenhum registro mostrar lucro operacional de −R$ 25,00. A tela do passe já descrevia a regra
> "pelos dias com atividade"; o motor passou a seguir essa regra.

## Custos fixos do veículo

Parcela, seguro, depreciação e outros fixos são mensais: `valor mensal × dias do período no mês ÷ dias reais do
mês` (mês completo = valor cadastrado). IPVA/licenciamento é anual: `valor × dias ÷ 365`. Entram só no resultado
completo, nunca no lucro operacional.

## Testes

`npm test` (ou `node tests/finance.spec.mjs`, 28 cenários), `npm run test:ui` (13 testes de interface) e
`node tests/recovery.spec.mjs` (recuperação de senha com Supabase simulado), `npm run test:landing` (landing page)
e `npm run test:ranking` (ranking em Postgres local, requer `@electric-sql/pglite`).

`tests/finance.spec.mjs` abre o `index.html` num Chromium em modo local — o `config.js` é
substituído por uma configuração vazia, então nada toca o banco de produção — e verifica os cenários: sem
registros, só ganhos, só despesas, ambos, custos fixos, Uber e 99 no mesmo dia, hoje/7 dias/mês, virada da
meia-noite, decimais, meta diária, editar/excluir, atualização da tela, períodos entre meses, conta sem histórico
e a regressão do passe. Requer `playwright` instalado.
