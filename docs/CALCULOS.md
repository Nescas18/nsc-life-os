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

`npm test` (ou `node tests/finance.spec.mjs`) abre o `index.html` num Chromium em modo local — o `config.js` é
substituído por uma configuração vazia, então nada toca o banco de produção — e verifica os cenários: sem
registros, só ganhos, só despesas, ambos, custos fixos, Uber e 99 no mesmo dia, hoje/7 dias/mês, virada da
meia-noite, decimais, meta diária, editar/excluir, atualização da tela, períodos entre meses, conta sem histórico
e a regressão do passe. Requer `playwright` instalado.
