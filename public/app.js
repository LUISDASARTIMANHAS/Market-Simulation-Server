const API_BASE = '/api';
const API_KEY_STORAGE = 'market-test-client-api-key';
const REFRESH_INTERVAL_MS = 3000;

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
  createAccountForm: document.querySelector('#create-account-form'),
  username: document.querySelector('#username'),
  createAccount: document.querySelector('#create-account'),
  keyForm: document.querySelector('#key-form'),
  apiKey: document.querySelector('#api-key'),
  toggleKey: document.querySelector('#toggle-key'),
  copyKey: document.querySelector('#copy-key'),
  accountState: document.querySelector('#account-state'),
  accountCash: document.querySelector('#account-cash'),
  accountAssets: document.querySelector('#account-assets'),
  disconnect: document.querySelector('#disconnect-account'),
  orderForm: document.querySelector('#order-form'),
  orderSide: document.querySelector('#order-side'),
  orderAmount: document.querySelector('#order-amount'),
  amountLabel: document.querySelector('#amount-label'),
  amountHint: document.querySelector('#amount-hint'),
  submitOrder: document.querySelector('#submit-order'),
};

let apiKey = sessionStorage.getItem(API_KEY_STORAGE) || '';
let refreshInProgress = false;
let accountRequestInProgress = false;
let latestMarket = null;

const money = (value) => new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'USD',
}).format(value);

const number = (value, maximumFractionDigits = 6) => new Intl.NumberFormat('pt-BR', {
  maximumFractionDigits,
}).format(value);

const formatTime = (value) => value
  ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'medium' }).format(new Date(value))
  : '—';

async function request(path, options = {}) {
  const headers = new Headers(options.headers);
  if (apiKey) headers.set('Authorization', `Bearer ${apiKey}`);
  if (options.body) headers.set('Content-Type', 'application/json');

  const response = await fetch(`${API_BASE}${path}`, { ...options, headers });
  const result = await response.json();
  if (!response.ok || !result?.success) {
    throw new Error(result?.message || `A solicitação falhou (HTTP ${response.status}).`);
  }
  return result.data;
}

function showFeedback(message, isError = false) {
  elements.feedback.textContent = message;
  elements.feedback.classList.toggle('error', isError);
  elements.feedback.hidden = !message;
}

function setConnection(isConnected) {
  elements.connectionDot.classList.toggle('online', isConnected);
  elements.connectionDot.classList.toggle('offline', !isConnected);
  elements.connectionStatus.textContent = isConnected ? 'Mercado conectado' : 'Sem conexão com o mercado';
}

function drawChart(history) {
  const canvas = elements.chart;
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
    cell.colSpan = 5;
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

function renderAccount(account) {
  elements.accountState.textContent = 'Conectada';
  elements.accountState.classList.add('connected');
  elements.accountCash.textContent = money(account.balance);
  elements.accountAssets.textContent = number(account.assetBalance);
  elements.submitOrder.disabled = false;
  elements.submitOrder.textContent = 'Enviar ordem simulada';
  elements.disconnect.hidden = false;
}

function clearAccount() {
  apiKey = '';
  sessionStorage.removeItem(API_KEY_STORAGE);
  elements.apiKey.value = '';
  elements.accountState.textContent = 'Sem conta';
  elements.accountState.classList.remove('connected');
  elements.accountCash.textContent = '—';
  elements.accountAssets.textContent = '—';
  elements.submitOrder.disabled = true;
  elements.submitOrder.textContent = 'Conecte uma carteira para operar';
  elements.disconnect.hidden = true;
}

async function refreshMarket() {
  if (refreshInProgress) return;
  refreshInProgress = true;
  try {
    const market = await request('/market/status');
    renderMarket(market);
    setConnection(true);
  } catch (error) {
    setConnection(false);
    showFeedback(error.message, true);
  } finally {
    refreshInProgress = false;
  }
}

async function refreshAccount() {
  if (!apiKey || accountRequestInProgress) return;
  accountRequestInProgress = true;
  try {
    const data = await request('/account');
    renderAccount(data.account);
  } catch (error) {
    clearAccount();
    showFeedback(`${error.message} Informe uma chave válida para reconectar.`, true);
  } finally {
    accountRequestInProgress = false;
  }
}

elements.createAccountForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  elements.createAccount.disabled = true;
  try {
    const data = await request('/accounts', {
      method: 'POST',
      body: JSON.stringify({ username: elements.username.value.trim() }),
    });
    apiKey = data.apiKey;
    sessionStorage.setItem(API_KEY_STORAGE, apiKey);
    elements.apiKey.value = apiKey;
    renderAccount(data.account);
    showFeedback('Carteira criada. Copie e guarde sua chave agora; ela só é exibida nesta resposta. A chave permanecerá nesta sessão do navegador.');
  } catch (error) {
    showFeedback(error.message, true);
  } finally {
    elements.createAccount.disabled = false;
  }
});

elements.keyForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const submittedKey = elements.apiKey.value.trim();
  if (!submittedKey) {
    showFeedback('Informe uma chave de API para conectar.', true);
    return;
  }
  apiKey = submittedKey;
  sessionStorage.setItem(API_KEY_STORAGE, apiKey);
  await refreshAccount();
  if (apiKey) showFeedback('Carteira conectada com sucesso.');
});

elements.disconnect.addEventListener('click', () => {
  clearAccount();
  showFeedback('Carteira desconectada deste navegador.');
});

elements.toggleKey.addEventListener('click', () => {
  const showingKey = elements.apiKey.type === 'password';
  elements.apiKey.type = showingKey ? 'text' : 'password';
  elements.toggleKey.textContent = showingKey ? 'Ocultar' : 'Mostrar';
  elements.toggleKey.setAttribute('aria-pressed', String(showingKey));
});

elements.copyKey.addEventListener('click', async () => {
  if (!elements.apiKey.value) {
    showFeedback('Não há chave para copiar.', true);
    return;
  }
  try {
    await navigator.clipboard.writeText(elements.apiKey.value);
    showFeedback('Chave copiada. Guarde-a em local seguro.');
  } catch (error) {
    showFeedback(`Não foi possível copiar automaticamente: ${error.message}`, true);
  }
});

elements.orderSide.addEventListener('change', () => {
  const buying = elements.orderSide.value === 'BUY';
  elements.amountLabel.textContent = buying ? 'Valor da compra (USD)' : 'Quantidade para venda (ativos)';
  elements.orderAmount.max = buying ? '5000' : '';
  elements.orderAmount.placeholder = buying ? 'Ex.: 100' : 'Ex.: 0,5';
  elements.amountHint.textContent = buying
    ? 'Máximo de US$ 5.000 por ordem. O saldo da carteira é validado pelo servidor.'
    : 'Informe a quantidade de ativos. O saldo da carteira é validado pelo servidor.';
});

elements.orderForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!apiKey) {
    showFeedback('Conecte uma carteira antes de enviar ordens.', true);
    return;
  }

  const side = elements.orderSide.value;
  const amount = Number(elements.orderAmount.value);
  if (!Number.isFinite(amount) || amount <= 0) {
    showFeedback('Informe um valor maior que zero.', true);
    return;
  }
  const body = side === 'BUY'
    ? { side, quoteAmount: amount }
    : { side, assetAmount: amount };

  elements.submitOrder.disabled = true;
  try {
    const data = await request('/orders', { method: 'POST', body: JSON.stringify(body) });
    renderAccount(data.account);
    renderMarket(data.market);
    elements.orderAmount.value = '';
    showFeedback(`${side === 'BUY' ? 'Compra' : 'Venda'} executada. ${number(data.order.amount)} ativo(s) por ${money(data.order.total)}.`);
  } catch (error) {
    showFeedback(error.message, true);
  } finally {
    elements.submitOrder.disabled = !apiKey;
  }
});

window.addEventListener('resize', () => {
  if (latestMarket) drawChart(latestMarket.history);
});

refreshMarket();
refreshAccount();
window.setInterval(refreshMarket, REFRESH_INTERVAL_MS);
window.setInterval(refreshAccount, REFRESH_INTERVAL_MS * 2);
