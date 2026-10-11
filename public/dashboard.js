import { money, number, formatTime, request, showFeedback, setConnectionState } from './common.js';

const elements = {
  connectionDot: document.querySelector('#connection-dot'),
  connectionStatus: document.querySelector('#connection-status'),
  feedback: document.querySelector('#feedback'),
  price: document.querySelector('#current-price'),
  sequence: document.querySelector('#sequence'),
  updatedAt: document.querySelector('#updated-at'),
  volumeTotal: document.querySelector('#volume-total'),
  volumeBuys: document.querySelector('#volume-buys'),
  volumeSells: document.querySelector('#volume-sells'),
  eventTitle: document.querySelector('#event-title'),
  eventCategory: document.querySelector('#event-category'),
  eventDescription: document.querySelector('#event-description'),
  nextEvent: document.querySelector('#next-event'),
  chart: document.querySelector('#price-chart'),
  trades: document.querySelector('#trades-body'),
};

let refreshInProgress = false;
let latestMarket = null;

function drawChart(history) {
  const canvas = elements.chart;
  if (!canvas) return;
  const bounds = canvas.getBoundingClientRect();
  const pixelRatio = window.devicePixelRatio || 1;
  const width = Math.max(bounds.width, 1);
  const height = Math.max(bounds.height, 1);
  canvas.width = Math.round(width * pixelRatio);
  canvas.height = Math.round(height * pixelRatio);
  const context = canvas.getContext('2d');
  context.scale(pixelRatio, pixelRatio);
  context.clearRect(0, 0, width, height);

  if (!history.length) return;
  const prices = history.map((tick) => tick.price);
  const minimum = Math.min(...prices);
  const maximum = Math.max(...prices);
  const spread = maximum - minimum || Math.max(maximum * 0.001, 0.01);
  const points = history.map((tick, index) => ({
    x: history.length === 1 ? width / 2 : (index / (history.length - 1)) * width,
    y: height - 12 - ((tick.price - minimum) / spread) * (height - 24),
  }));

  context.beginPath();
  points.forEach((point, index) => {
    if (index === 0) context.moveTo(point.x, point.y);
    else context.lineTo(point.x, point.y);
  });
  context.strokeStyle = '#61dfb2';
  context.lineWidth = 2;
  context.stroke();
}

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

function renderMarket(market) {
  latestMarket = market;
  elements.price.textContent = money(market.currentPrice);
  elements.sequence.textContent = `Tick #${market.sequence}`;
  elements.updatedAt.textContent = formatTime(market.updatedAt);
  elements.updatedAt.dateTime = market.updatedAt;
  elements.volumeTotal.textContent = money(market.volume.total);
  elements.volumeBuys.textContent = money(market.volume.buys);
  elements.volumeSells.textContent = money(market.volume.sells);
  elements.eventTitle.textContent = market.latestEvent?.title || 'Nenhum evento registrado';
  elements.eventCategory.textContent = market.latestEvent?.category || '—';
  elements.eventDescription.textContent = market.latestEvent?.description || 'Os eventos simulados aparecerão aqui.';
  elements.nextEvent.textContent = formatTime(market.nextEventAt);
  drawChart(market.history);
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
  if (latestMarket) drawChart(latestMarket.history);
});

refreshMarket();
window.setInterval(refreshMarket, 3000);

// ── Backup & Restore ───────────────────────────────────────────────────────────
const backupFeedback = document.querySelector('#backup-feedback');
const importFileInput = document.querySelector('#import-file');
const importFileName = document.querySelector('#import-file-name');
const importBtn = document.querySelector('#import-backup');

function showBackupFeedback(message, isError = false) {
  if (!backupFeedback) return;
  backupFeedback.textContent = message;
  backupFeedback.classList.toggle('error', isError);
  backupFeedback.hidden = !message;
}

document.querySelector('#export-backup')?.addEventListener('click', () => {
  window.location.href = '/api/backup';
});

importFileInput?.addEventListener('change', () => {
  const file = importFileInput.files[0];
  if (file) {
    importFileName.textContent = `Arquivo selecionado: ${file.name}`;
    importFileName.hidden = false;
    importBtn.disabled = false;
    showBackupFeedback('');
  } else {
    importFileName.hidden = true;
    importBtn.disabled = true;
  }
});

importBtn?.addEventListener('click', async () => {
  const file = importFileInput.files[0];
  if (!file) {
    showBackupFeedback('Selecione um arquivo de backup .json primeiro.', true);
    return;
  }
  importBtn.disabled = true;
  importBtn.textContent = 'Restaurando…';
  showBackupFeedback('');
  try {
    const text = await file.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error('Arquivo inválido: não é um JSON válido.');
    }
    const result = await request('/backup/restore', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    showBackupFeedback(
      `✅ Restauração concluída! ${result.accountsCount} conta(s), ${result.historyTicksCount} ticks de histórico, preço atual: ${money(result.currentPrice)}.`
    );
    // Reset file input after successful restore
    importFileInput.value = '';
    importFileName.hidden = true;
    importBtn.disabled = true;
    // Refresh market data immediately
    refreshMarket();
  } catch (error) {
    showBackupFeedback(`❌ Erro na restauração: ${error.message}`, true);
    importBtn.disabled = false;
  } finally {
    importBtn.textContent = '↩ Restaurar banco';
  }
});
