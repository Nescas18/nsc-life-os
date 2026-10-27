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

## Energia (combustível ou recarga)

Calculada dia a dia: no dia com abastecimento/recarga registrado vale o valor real; nos demais dias com km
informado, estimativa `km × custo por km` (consumo e preço configurados). Real e estimativa nunca se somam no
mesmo dia. Entre Uber e 99, o gasto do dia é dividido por km (ou por faturamento quando falta km).

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
`node tests/recovery.spec.mjs` (recuperação de senha com Supabase simulado).

`tests/finance.spec.mjs` abre o `index.html` num Chromium em modo local — o `config.js` é
substituído por uma configuração vazia, então nada toca o banco de produção — e verifica os cenários: sem
registros, só ganhos, só despesas, ambos, custos fixos, Uber e 99 no mesmo dia, hoje/7 dias/mês, virada da
meia-noite, decimais, meta diária, editar/excluir, atualização da tela, períodos entre meses, conta sem histórico
e a regressão do passe. Requer `playwright` instalado.
