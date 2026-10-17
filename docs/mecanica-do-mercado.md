# Mecânica de Simulação do Mercado

Este documento explica em detalhes a modelagem matemática, o comportamento de preços, a dinâmica de ordens, a reversão à média e o sistema de eventos macroeconômicos do **Market Simulation Server**.

---

## 1. Princípios e Natureza do Simulador

O **Market Simulation Server** é um ambiente autônomo projetado para **paper trading**, testes de estratégias automatizadas, backtests e desenvolvimento de bots de trading.

> [!NOTE]
> Este projeto **não** possui conexão com bolsas de valores, corretoras ou plataformas de liquidação reais. Todos os preços, ativos, eventos, contas e saldos são simulados e estritamente fictícios.

### O Ativo Padrão (`SIM`)

O simulador opera nativamente com o ativo de teste:
- **ID / Símbolo**: `SIM`
- **Nome**: *Simulation Asset*
- **Moeda de Cotação**: Dólares Americanos Virtuais (USD)
- **Preço de Referência Base**: **US$ 100,00**
- **Saldo Inicial de Novas Contas**: **US$ 1.000,00**

---

## 2. Dinâmica de Preços e Formação de Cotação

O preço do ativo evolui continuamente através de três forças combinadas:
1. **Ordens de Mercado dos Usuários** (pressão de compra e venda).
2. **Reversão à Média (*Mean Reversion*)**.
3. **Eventos Macroeconômicos Periódicos** (choques de volatilidade).

A cotação é atualizada em ciclos contínuos através de um ticker em intervalos de **2 segundos** (`TICKER_INTERVAL_SECONDS = 2`).

### 2.1 Impacto no Preço por Ordens de Mercado

Quando um participante envia uma ordem, a execução ocorre a mercado e causa impacto direto no preço global do ativo:

| Tipo de Ordem | Parâmetro de Entrada | Sentido no Preço | Efeito na Carteira |
| --- | --- | --- | --- |
| **BUY** (Compra) | `amount` (em USD) | **Sobe** (+) | Debita saldo em USD; Credita unidades do ativo. |
| **SELL** (Venda) | `amount` (unidades do ativo) | **Desce** (-) | Debita unidades do ativo; Credita saldo em USD. |

#### Modelo Matemático de Impacto:
- **Liquidez de Referência**: `REFERENCE_LIQUIDITY_USD = 250,00`
- **Impacto Máximo por Ordem**: `MAX_ORDER_IMPACT_PERCENT = 2%` (0.02)
- **Volume Máximo Nocional**: `MAX_ORDER_NOTIONAL_USD = US$ 5.000,00` por ordem

O impacto percentual de uma ordem com valor financeiro $V$ é dado por:

$$\text{impacto} = \min\left(\frac{V}{\text{REFERENCE\_LIQUIDITY\_USD}}, 2.0\right)\%$$

- Em compras, o novo preço é:
  $$P_{\text{novo}} = P_{\text{atual}} \times \left(1 + \frac{\text{impacto}}{100}\right)$$
- Em vendas, o novo preço é:
  $$P_{\text{novo}} = P_{\text{atual}} \times \left(1 - \frac{\text{impacto}}{100}\right)$$

Essa mecânica garante que grandes ordens movam o mercado de forma realista, sem permitir que uma única ordem desestruture completamente a cotação.

---

## 3. Reversão à Média (*Mean Reversion*)

Para impedir que sequências acumuladas de compras ou vendas levem o preço a valores absurdamente altos ou colapsem o ativo próximo de zero, o simulador implementa uma força gravitacional de reversão à média:

- **Preço de Equilíbrio**: `MARKET_REFERENCE_PRICE = 100.00`
- **Taxa de Reversão**: `MARKET_MEAN_REVERSION_RATE = 0.05` (5%)

A cada ciclo de evento ou ajuste do ticker, uma fração da diferença entre a cotação atual e o preço de referência é atenuada:

$$\Delta P_{\text{reversão}} = - (\text{Preço Atual} - 100.00) \times 0.05$$

Isso cria ciclos orgânicos de oscilação e canais de preço nos quais estratégias quantitativas (como *mean reversion* e arbitragem estatística) podem operar.

---

## 4. Sistema de Eventos Macroeconômicos

Periodicamente, o simulador dispara notícias e fatos relevantes simulados que afetam a volatilidade do mercado.

### 4.1 Categorias de Eventos
O arquivo de configuração `src/config/market-events.json` define cenários distribuídos em 6 categorias:

1. **Inflação**: Dados de CPI, índices de preços ao consumidor e políticas monetárias.
2. **Guerra / Geopolítica**: Tensões internacionais, acordos de paz e sanções comerciais.
3. **Política**: Eleições, medidas fiscais e reformas governamentais.
4. **Juros**: Decisões de taxas básicas de bancos centrais.
5. **Tecnologia**: Inovações disruptivas, investimentos em IA e avanços computacionais.
6. **Emprego**: Relatórios de criação de vagas e índices de desemprego.

Cada categoria possui uma quantidade equivalente de cenários com impactos **positivos** e **negativos**, garantindo equilíbrio estatístico.

### 4.2 Frequência e Agendamento
- Os eventos ocorrem em intervalos aleatórios entre **60 e 120 segundos** (configuráveis através de `MARKET_EVENT_MIN_INTERVAL_MS` e `MARKET_EVENT_MAX_INTERVAL_MS`).
- A cada evento disparado, o simulador agenda o próximo horário (`nextEventAt`) e disponibiliza essa previsão na rota pública `GET /api/market/status`.

---

## 5. Consistência e Precisão Financeira

Para evitar erros comuns de arredondamento inerentes ao ponto flutuante binário do JavaScript (`0.1 + 0.2 !== 0.3`):
- O módulo `src/utils/money.js` gerencia a normalização matemática de valores monetários.
- Valores monetários em USD são estritamente truncados/arredondados com precisão de duas casas decimais (centavos).
- Posições de ativos fracionários mantêm precisão calibrada em até 4 casas decimais.
- Antes da execução de qualquer ordem, a carteira do usuário é verificada contra saldo negativo ou insuficiência de custódia, retornando `HTTP 400 Bad Request` caso não haja fundos.
- Operações de leitura e escrita nos dados financeiros são enfileiradas e executadas de forma atômica, prevenindo condições de corrida (*race conditions*).

