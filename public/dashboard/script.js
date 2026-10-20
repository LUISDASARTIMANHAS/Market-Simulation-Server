import { money, number, formatTime, request, showFeedback, setConnectionState } from '/src/js/common.js';
import { AdvancedMarketChart } from '/src/js/chartEngine.js';

const elements = {
  connectionDot: document.querySelector('#connection-dot'),
  connectionStatus: document.querySelector('#connection-status'),
  feedback: document.querySelector('#feedback'),
  price: document.querySelector('#current-price'),
  priceChange: document.querySelector('#price-change'),
  sequence: document.querySelector('#sequence'),
  updatedAt: document.querySelector('#updated-at'),
  statLow: document.querySelector('#stat-low'),
  statHigh: document.querySelector('#stat-high'),
  statVolatility: document.querySelector('#stat-volatility'),
  statRsi: document.querySelector('#stat-rsi'),
  statTrend: document.querySelector('#stat-trend'),
  chartCanvas: document.querySelector('#price-chart'),
  chartTooltip: document.querySelector('#chart-tooltip'),
  legendSma9: document.querySelector('#legend-sma9'),
  legendSma21: document.querySelector('#legend-sma21'),
  legendBollinger: document.querySelector('#legend-bollinger'),
  legendRsi: document.querySelector('#legend-rsi'),
  volumeTotal: document.querySelector('#volume-total'),
  volumeBuys: document.querySelector('#volume-buys'),
  volumeSells: document.querySelector('#volume-sells'),
  pressureRatio: document.querySelector('#pressure-ratio'),
  pressureBuysBar: document.querySelector('#pressure-buys-bar'),
  pressureSellsBar: document.querySelector('#pressure-sells-bar'),
  nextEvent: document.querySelector('#next-event'),
  eventsCount: document.querySelector('#events-count'),
  eventsList: document.querySelector('#events-list'),
  trades: document.querySelector('#trades-body'),
};

let refreshInProgress = false;
let latestMarket = null;
let chartInstance = null;

// Inicializa motor de gráfico (apenas renderização visual, sem cálculo de indicadores)
if (elements.chartCanvas) {
  chartInstance = new AdvancedMarketChart(elements.chartCanvas, elements.chartTooltip);
}

// ── Toolbar Events ──────────────────────────────────────────────────────────────
function setupToolbarEvents() {
  document.querySelectorAll('#timeframe-buttons .btn-tool').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#timeframe-buttons .btn-tool').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      const tf = btn.getAttribute('data-tf');
      if (chartInstance) chartInstance.setTimeframe(tf);
    });
  });

  document.querySelectorAll('#chart-type-buttons .btn-tool').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#chart-type-buttons .btn-tool').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      const type = btn.getAttribute('data-type');
      if (chartInstance) chartInstance.setChartType(type);
    });
  });

  document.querySelectorAll('#indicator-buttons .btn-tool').forEach((btn) => {
    btn.addEventListener('click', () => {
      const ind = btn.getAttribute('data-indicator');
      btn.classList.toggle('active');
      if (chartInstance) {
        chartInstance.toggleIndicator(ind);
        updateLegendVisibility();
      }
    });
  });
}

function updateLegendVisibility() {
  if (!chartInstance) return;
  const ind = chartInstance.indicators;
  if (elements.legendSma9) elements.legendSma9.hidden = !ind.sma;
  if (elements.legendSma21) elements.legendSma21.hidden = !ind.sma;
  if (elements.legendBollinger) elements.legendBollinger.hidden = !ind.bollinger;
  if (elements.legendRsi) elements.legendRsi.hidden = !ind.rsi;
}

// ── Renderizar indicadores vindos do servidor ───────────────────────────────────
function renderServerIndicators(indicators) {
  if (!indicators) return;

  // Variação de Preço
  if (elements.priceChange) {
    const isUp = indicators.change >= 0;
    elements.priceChange.className = `price-change-pill ${isUp ? 'positive' : 'negative'}`;
    elements.priceChange.textContent = `${isUp ? '▲ +' : '▼ '}${money(indicators.change)} (${isUp ? '+' : ''}${indicators.changePercent}%)`;
  }

  // KPIs
  if (elements.statLow) elements.statLow.textContent = money(indicators.low);
  if (elements.statHigh) elements.statHigh.textContent = money(indicators.high);
  if (elements.statVolatility) elements.statVolatility.textContent = `${indicators.volatility}%`;

  // RSI
  if (elements.statRsi) {
    const rsi = indicators.rsi;
    if (rsi && rsi.value !== null) {
      elements.statRsi.textContent = `${rsi.value} (${rsi.status})`;
    } else {
      elements.statRsi.textContent = '—';
    }
  }

  // Tendência
  if (elements.statTrend) {
    const trend = indicators.trend;
    if (trend) {
      elements.statTrend.textContent = trend.label;
      const classMap = { bullish: 'trend-bullish', bearish: 'trend-bearish', neutral: 'trend-neutral' };
      elements.statTrend.className = `stat-pill-val ${classMap[trend.sentiment] || 'trend-neutral'}`;
    }
  }

  // Pressão de Ordens
  if (indicators.orderPressure) {
    const op = indicators.orderPressure;
    if (elements.pressureRatio) elements.pressureRatio.textContent = op.ratioText;
    if (elements.pressureBuysBar) elements.pressureBuysBar.style.width = `${op.buyPercent}%`;
    if (elements.pressureSellsBar) elements.pressureSellsBar.style.width = `${op.sellPercent}%`;
  }
}

// ── Renderização ────────────────────────────────────────────────────────────────
function renderTrades(trades) {
  elements.trades.replaceChildren();
  if (!trades.length) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 6;
    cell.className = 'empty-cell';
    cell.textContent = 'Ainda não há ordens neste mercado.';
    row.append(cell);
    elements.trades.append(row);
    return;
  }

  for (const trade of trades.slice(0, 10)) {
    const row = document.createElement('tr');
    const values = [
      { text: trade.side === 'BUY' ? 'Compra' : 'Venda', className: trade.side === 'BUY' ? 'side-buy' : 'side-sell' },
      { text: trade.username || '—' },
      { text: money(trade.price) },
      { text: number(trade.amount) },
      { text: money(trade.total) },
      { text: formatTime(trade.timestamp) },
    ];
    for (const value of values) {
      const cell = document.createElement('td');
      cell.textContent = value.text;
      if (value.className) cell.className = value.className;
      row.append(cell);
    }
    elements.trades.append(row);
  }
}

function renderEvents(events = [], nextEventAt = null) {
  if (elements.nextEvent) {
    elements.nextEvent.textContent = formatTime(nextEventAt);
  }
  if (elements.eventsCount) {
    elements.eventsCount.textContent = `${events.length} evento${events.length === 1 ? '' : 's'}`;
  }

  if (!elements.eventsList) return;

  elements.eventsList.replaceChildren();

  if (!events.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-cell';
    empty.textContent = 'Nenhum evento decorrido até o momento.';
    elements.eventsList.append(empty);
    return;
  }

  for (const ev of events) {
    const item = document.createElement('article');
    item.className = 'event-item';

    const top = document.createElement('div');
    top.className = 'event-item-top';

    const badgeGroup = document.createElement('div');
    badgeGroup.className = 'event-badge-group';

    if (ev.category) {
      const category = document.createElement('span');
      category.className = 'event-category-badge';
      category.textContent = ev.category;
      badgeGroup.append(category);
    }

    if (Number.isFinite(ev.impactPercent)) {
      const impact = document.createElement('span');
      const isPos = ev.impactPercent >= 0;
      impact.className = `event-impact-badge ${isPos ? 'event-impact-positive' : 'event-impact-negative'}`;
      impact.textContent = `${isPos ? '+' : ''}${ev.impactPercent.toFixed(2)}%`;
      badgeGroup.append(impact);
    }

    top.append(badgeGroup);

    if (ev.occurredAt) {
      const time = document.createElement('time');
      time.className = 'event-time';
      time.dateTime = ev.occurredAt;
      time.textContent = formatTime(ev.occurredAt);
      top.append(time);
    }

    const title = document.createElement('h3');
    title.textContent = ev.title || 'Evento de mercado';

    const desc = document.createElement('p');
    desc.textContent = ev.description || '';

    item.append(top, title, desc);
    elements.eventsList.append(item);
  }
}

function renderMarket(market) {
  latestMarket = market;
  elements.price.textContent = money(market.currentPrice);
  elements.sequence.textContent = `Tick #${market.sequence}`;
  elements.updatedAt.textContent = formatTime(market.updatedAt);
  elements.updatedAt.dateTime = market.updatedAt;
  elements.volumeTotal.textContent = money(market.volume.total);
  elements.volumeBuys.textContent = money(market.volume.buys);
  elements.volumeSells.textContent = money(market.volume.sells);

  // Indicadores pré-processados no servidor
  renderServerIndicators(market.indicators);

  const events = Array.isArray(market.events)
    ? market.events
    : (market.latestEvent ? [market.latestEvent] : []);
  renderEvents(events, market.nextEventAt);

  // Atualiza gráfico visual (o canvas usa os dados crus para renderização interativa)
  if (chartInstance) {
    chartInstance.setHistory(market.history);
  }

  renderTrades(market.recentTrades);
}

async function refreshMarket() {
  if (refreshInProgress) return;
  refreshInProgress = true;
  try {
    const market = await request('/market/status');
    renderMarket(market);
    setConnectionState(true, 'Mercado conectado');
  } catch (error) {
    setConnectionState(false, 'Sem conexão com o mercado');
    showFeedback(error.message, true);
  } finally {
    refreshInProgress = false;
  }
}

window.addEventListener('resize', () => {
  if (chartInstance) {
    chartInstance.render();
  }
});

setupToolbarEvents();
updateLegendVisibility();
refreshMarket();
window.setInterval(refreshMarket, 3000);
