import {
  money,
  number,
  formatTime,
  request,
  showFeedback,
  setConnectionState,
  clearApiKey,
  getApiKey,
  updateAuthNavigation,
} from '/src/js/common.js';
import { renderSparkline } from '/src/js/chartEngine.js';

const elements = {
  feedback: document.querySelector('#feedback'),
  guestState: document.querySelector('#wallet-guest-state'),
  authState: document.querySelector('#wallet-auth-state'),
  username: document.querySelector('#account-username'),
  btnCopyKey: document.querySelector('#btn-copy-key'),
  btnDisconnect: document.querySelector('#btn-disconnect'),
  accountCash: document.querySelector('#account-cash'),
  accountAssets: document.querySelector('#account-assets'),
  accountEstimatedValue: document.querySelector('#account-estimated-value'),
  accountTotalEquity: document.querySelector('#account-total-equity'),
  allocCashPct: document.querySelector('#alloc-cash-pct'),
  allocAssetsPct: document.querySelector('#alloc-assets-pct'),
  allocCashBar: document.querySelector('#alloc-cash-bar'),
  allocAssetsBar: document.querySelector('#alloc-assets-bar'),
  tradeCurrentPrice: document.querySelector('#trade-current-price'),
  tradePriceDelta: document.querySelector('#trade-price-delta'),
  walletSparkline: document.querySelector('#wallet-sparkline'),
  tabBuy: document.querySelector('#tab-buy'),
  tabSell: document.querySelector('#tab-sell'),
  buyPanel: document.querySelector('#buy-panel'),
  sellPanel: document.querySelector('#sell-panel'),
  formBuy: document.querySelector('#form-buy'),
  buyAmount: document.querySelector('#buy-amount'),
  buyAvailableCash: document.querySelector('#buy-available-cash'),
  buyPreviewPrice: document.querySelector('#buy-preview-price'),
  buyPreviewQty: document.querySelector('#buy-preview-qty'),
  btnSubmitBuy: document.querySelector('#btn-submit-buy'),
  formSell: document.querySelector('#form-sell'),
  sellAmount: document.querySelector('#sell-amount'),
  sellAvailableAssets: document.querySelector('#sell-available-assets'),
  sellPreviewPrice: document.querySelector('#sell-preview-price'),
  sellPreviewUsd: document.querySelector('#sell-preview-usd'),
  btnSubmitSell: document.querySelector('#btn-submit-sell'),
  accountHistory: document.querySelector('#account-history'),
  filterAll: document.querySelector('#filter-all'),
  filterBuy: document.querySelector('#filter-buy'),
  filterSell: document.querySelector('#filter-sell'),
  countAll: document.querySelector('#count-all'),
  countBuy: document.querySelector('#count-buy'),
  countSell: document.querySelector('#count-sell'),
};

let currentAccount = null;
let currentPrice = 0;
let rawHistory = [];
let activeHistoryFilter = 'ALL';
let refreshInProgress = false;

function renderGuestState() {
  elements.guestState.hidden = false;
  elements.authState.hidden = true;
  setConnectionState(false, 'Nenhuma carteira conectada');
}

function renderAuthState() {
  elements.guestState.hidden = true;
  elements.authState.hidden = false;
}

function switchTradeTab(side) {
  const isBuy = side === 'BUY';
  elements.tabBuy.classList.toggle('active', isBuy);
  elements.tabBuy.setAttribute('aria-selected', String(isBuy));
  elements.tabSell.classList.toggle('active', !isBuy);
  elements.tabSell.setAttribute('aria-selected', String(!isBuy));
  elements.buyPanel.hidden = !isBuy;
  elements.sellPanel.hidden = isBuy;
}

elements.tabBuy.addEventListener('click', () => switchTradeTab('BUY'));
elements.tabSell.addEventListener('click', () => switchTradeTab('SELL'));

function updateBuyPreview() {
  const val = Number(elements.buyAmount.value) || 0;
  elements.buyPreviewPrice.textContent = currentPrice > 0 ? money(currentPrice) : '—';
  if (val > 0 && currentPrice > 0) {
    const estQty = val / currentPrice;
    elements.buyPreviewQty.textContent = `~ ${number(estQty, 6)} ativos`;
  } else {
    elements.buyPreviewQty.textContent = '0,000000 ativos';
  }
}

function updateSellPreview() {
  const qty = Number(elements.sellAmount.value) || 0;
  elements.sellPreviewPrice.textContent = currentPrice > 0 ? money(currentPrice) : '—';
  if (qty > 0 && currentPrice > 0) {
    const estUsd = qty * currentPrice;
    elements.sellPreviewUsd.textContent = `~ ${money(estUsd)} USD`;
  } else {
    elements.sellPreviewUsd.textContent = '$ 0,00 USD';
  }
}

elements.buyAmount.addEventListener('input', updateBuyPreview);
elements.sellAmount.addEventListener('input', updateSellPreview);

// Atalhos rápidos para COMPRA
document.querySelectorAll('[data-buy-val]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const addVal = Number(btn.dataset.buyVal) || 0;
    const current = Number(elements.buyAmount.value) || 0;
    const maxAllowed = Math.min(5000, currentAccount ? currentAccount.balance : 5000);
    const newVal = Math.min(maxAllowed, current + addVal);
    elements.buyAmount.value = newVal > 0 ? newVal.toFixed(2) : '';
    updateBuyPreview();
  });
});

document.querySelectorAll('[data-buy-pct]').forEach((btn) => {
  btn.addEventListener('click', () => {
    if (!currentAccount) return;
    const pct = Number(btn.dataset.buyPct) || 0;
    const maxVal = Math.min(5000, currentAccount.balance * pct);
    elements.buyAmount.value = maxVal > 0 ? maxVal.toFixed(2) : '';
    updateBuyPreview();
  });
});

// Atalhos rápidos para VENDA
document.querySelectorAll('[data-sell-pct]').forEach((btn) => {
  btn.addEventListener('click', () => {
    if (!currentAccount) return;
    const pct = Number(btn.dataset.sellPct) || 0;
    const maxAssets = currentAccount.assetBalance * pct;
    elements.sellAmount.value = maxAssets > 0 ? maxAssets.toFixed(6) : '';
    updateSellPreview();
  });
});

function renderAccount(account) {
  currentAccount = account;
  if (!account) {
    renderGuestState();
    return;
  }

  renderAuthState();
  elements.username.textContent = account.username || 'trader';
  elements.accountCash.textContent = money(account.balance);
  elements.accountAssets.textContent = number(account.assetBalance);
  elements.accountEstimatedValue.textContent = money(account.estimatedSaleValue);

  const cash = Number(account.balance) || 0;
  const assetsVal = Number(account.estimatedSaleValue) || 0;
  const totalEquity = cash + assetsVal;
  elements.accountTotalEquity.textContent = money(totalEquity);

  // Alocação de Patrimônio
  if (totalEquity > 0) {
    const cashPct = Math.round((cash / totalEquity) * 100);
    const assetsPct = 100 - cashPct;
    if (elements.allocCashPct) elements.allocCashPct.textContent = `${cashPct}% (${money(cash)})`;
    if (elements.allocAssetsPct) elements.allocAssetsPct.textContent = `${assetsPct}% (${money(assetsVal)})`;
    if (elements.allocCashBar) elements.allocCashBar.style.width = `${cashPct}%`;
    if (elements.allocAssetsBar) elements.allocAssetsBar.style.width = `${assetsPct}%`;
  } else {
    if (elements.allocCashPct) elements.allocCashPct.textContent = '100%';
    if (elements.allocAssetsPct) elements.allocAssetsPct.textContent = '0%';
    if (elements.allocCashBar) elements.allocCashBar.style.width = '100%';
    if (elements.allocAssetsBar) elements.allocAssetsBar.style.width = '0%';
  }

  elements.buyAvailableCash.textContent = money(account.balance);
  elements.sellAvailableAssets.textContent = `${number(account.assetBalance)} ativos`;

  updateBuyPreview();
  updateSellPreview();
}

function renderHistoryRows() {
  const filtered = rawHistory.filter((item) => {
    if (activeHistoryFilter === 'ALL') return true;
    return item.type === activeHistoryFilter;
  });

  elements.accountHistory.replaceChildren();

  if (!filtered.length) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 5;
    cell.className = 'empty-cell';
    cell.textContent = rawHistory.length === 0
      ? 'Nenhuma operação realizada nesta carteira ainda.'
      : 'Nenhuma movimentação corresponde ao filtro selecionado.';
    row.append(cell);
    elements.accountHistory.append(row);
    return;
  }

  for (const item of filtered.slice(0, 30)) {
    const row = document.createElement('tr');
    const isBuy = item.type === 'BUY';

    const tdType = document.createElement('td');
    const badge = document.createElement('span');
    badge.className = isBuy ? 'badge-buy' : 'badge-sell';
    badge.textContent = isBuy ? 'COMPRA' : 'VENDA';
    tdType.append(badge);

    const tdPrice = document.createElement('td');
    tdPrice.textContent = money(item.price);

    const tdAmount = document.createElement('td');
    tdAmount.textContent = number(item.amount);

    const tdTotal = document.createElement('td');
    tdTotal.textContent = money(item.total);
    tdTotal.className = isBuy ? 'side-buy' : 'side-sell';

    const tdTime = document.createElement('td');
    tdTime.textContent = formatTime(item.timestamp);

    row.append(tdType, tdPrice, tdAmount, tdTotal, tdTime);
    elements.accountHistory.append(row);
  }
}

function updateHistoryCounters() {
  const buys = rawHistory.filter((i) => i.type === 'BUY').length;
  const sells = rawHistory.filter((i) => i.type === 'SELL').length;
  elements.countAll.textContent = rawHistory.length;
  elements.countBuy.textContent = buys;
  elements.countSell.textContent = sells;
}

function setHistoryFilter(filter) {
  activeHistoryFilter = filter;
  elements.filterAll.classList.toggle('active', filter === 'ALL');
  elements.filterBuy.classList.toggle('active', filter === 'BUY');
  elements.filterSell.classList.toggle('active', filter === 'SELL');
  renderHistoryRows();
}

elements.filterAll.addEventListener('click', () => setHistoryFilter('ALL'));
elements.filterBuy.addEventListener('click', () => setHistoryFilter('BUY'));
elements.filterSell.addEventListener('click', () => setHistoryFilter('SELL'));

async function loadHistory() {
  try {
    const history = await request('/account/history');
    rawHistory = Array.isArray(history) ? history : [];
    updateHistoryCounters();
    renderHistoryRows();
  } catch {
    // Falha silenciosa no refresh contínuo
  }
}

async function loadMarketPrice() {
  try {
    const market = await request('/market/status');
    if (market?.currentPrice) {
      currentPrice = market.currentPrice;
      elements.tradeCurrentPrice.textContent = money(currentPrice);

      // Indicadores pré-processados do servidor
      const ind = market.indicators;
      if (ind) {
        const isUp = ind.changePercent >= 0;

        if (elements.tradePriceDelta) {
          elements.tradePriceDelta.textContent = `${isUp ? '+' : ''}${ind.changePercent}%`;
          elements.tradePriceDelta.className = `trade-price-delta ${isUp ? 'positive' : 'negative'}`;
        }

        // Sparkline usando dados crus do histórico para renderização visual
        if (elements.walletSparkline && Array.isArray(market.history) && market.history.length >= 2) {
          const prices = market.history.slice(-20).map((t) => t.price);
          renderSparkline(elements.walletSparkline, prices, isUp);
        }
      }

      updateBuyPreview();
      updateSellPreview();
    }
  } catch {
    // Falha silenciosa no mercado
  }
}

async function refreshAll() {
  if (refreshInProgress) return;
  const key = getApiKey();
  if (!key) {
    renderGuestState();
    return;
  }

  refreshInProgress = true;
  try {
    const data = await request('/account');
    renderAccount(data.account);
    await Promise.all([loadHistory(), loadMarketPrice()]);
    setConnectionState(true, 'Carteira conectada');
  } catch (error) {
    clearApiKey();
    renderGuestState();
    updateAuthNavigation();
    showFeedback(`${error.message || 'Sessão expirada.'} Por favor, reconecte-se.`, true);
  } finally {
    refreshInProgress = false;
  }
}

// Envio de ordem de COMPRA
elements.formBuy.addEventListener('submit', async (event) => {
  event.preventDefault();
  const amount = Number(elements.buyAmount.value);
  if (!Number.isFinite(amount) || amount <= 0) {
    showFeedback('Informe um valor de compra válido maior que zero.', true);
    return;
  }

  elements.btnSubmitBuy.disabled = true;
  try {
    const data = await request('/orders/buy', {
      method: 'POST',
      body: JSON.stringify({ amount }),
    });
    renderAccount(data.account);
    await loadHistory();
    elements.buyAmount.value = '';
    updateBuyPreview();
    showFeedback(`Compra concluída com sucesso! ${number(data.order.amount)} ativo(s) por ${money(data.order.total)}.`);
  } catch (error) {
    showFeedback(error.message, true);
  } finally {
    elements.btnSubmitBuy.disabled = false;
  }
});

// Envio de ordem de VENDA
elements.formSell.addEventListener('submit', async (event) => {
  event.preventDefault();
  const amount = Number(elements.sellAmount.value);
  if (!Number.isFinite(amount) || amount <= 0) {
    showFeedback('Informe uma quantidade de venda válida maior que zero.', true);
    return;
  }

  elements.btnSubmitSell.disabled = true;
  try {
    const data = await request('/orders/sell', {
      method: 'POST',
      body: JSON.stringify({ amount }),
    });
    renderAccount(data.account);
    await loadHistory();
    elements.sellAmount.value = '';
    updateSellPreview();
    showFeedback(`Venda concluída com sucesso! ${number(data.order.amount)} ativo(s) por ${money(data.order.total)}.`);
  } catch (error) {
    showFeedback(error.message, true);
  } finally {
    elements.btnSubmitSell.disabled = false;
  }
});

// Botão Copiar Chave
elements.btnCopyKey.addEventListener('click', async () => {
  const key = getApiKey();
  if (!key) {
    showFeedback('Nenhuma chave ativa para copiar.', true);
    return;
  }
  try {
    await navigator.clipboard.writeText(key);
    showFeedback('Chave de API copiada para a área de transferência.');
  } catch {
    showFeedback('Não foi possível copiar automaticamente.', true);
  }
});

// Botão Desconectar
elements.btnDisconnect.addEventListener('click', () => {
  clearApiKey();
  renderGuestState();
  updateAuthNavigation();
  showFeedback('Carteira desconectada com sucesso.');
});

// Inicialização
refreshAll();
window.setInterval(refreshAll, 3000);

