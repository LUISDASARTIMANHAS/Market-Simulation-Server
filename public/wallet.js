import { money, number, formatTime, request, showFeedback, setConnectionState, saveApiKey, clearApiKey, getApiKey } from './common.js';

const elements = {
  connectionDot: document.querySelector('#connection-dot'),
  connectionStatus: document.querySelector('#connection-status'),
  feedback: document.querySelector('#feedback'),
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
  accountHistory: document.querySelector('#account-history'),
};

let accountRequestInProgress = false;

function renderAccount(account) {
  if (!account) {
    elements.accountState.textContent = 'Sem conta';
    elements.accountState.classList.remove('connected');
    elements.accountCash.textContent = '—';
    elements.accountAssets.textContent = '—';
    elements.submitOrder.disabled = true;
    elements.submitOrder.textContent = 'Conecte uma carteira para operar';
    elements.disconnect.hidden = true;
    return;
  }

  elements.accountState.textContent = `@${account.username || 'conta'}`;
  elements.accountState.classList.add('connected');
  elements.accountCash.textContent = money(account.balance);
  elements.accountAssets.textContent = number(account.assetBalance);
  elements.submitOrder.disabled = false;
  elements.submitOrder.textContent = 'Enviar ordem simulada';
  elements.disconnect.hidden = false;

  renderHistory(account.history || []);
}

function renderHistory(history) {
  elements.accountHistory.replaceChildren();
  if (!history.length) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 5;
    cell.className = 'empty-cell';
    cell.textContent = 'Sem histórico disponível.';
    row.append(cell);
    elements.accountHistory.append(row);
    return;
  }

  for (const item of history.slice(0, 10)) {
    const row = document.createElement('tr');
    const values = [
      { text: item.type === 'BUY' ? 'Compra' : 'Venda', className: item.type === 'BUY' ? 'side-buy' : 'side-sell' },
      { text: item.username || '—' },
      { text: money(item.price) },
      { text: number(item.amount) },
      { text: money(item.total) },
      { text: formatTime(item.timestamp) },
    ];
    for (const value of values) {
      const cell = document.createElement('td');
      cell.textContent = value.text;
      if (value.className) cell.className = value.className;
      row.append(cell);
    }
    elements.accountHistory.append(row);
  }
}

function clearAccount() {
  clearApiKey();
  elements.apiKey.value = '';
  renderAccount(null);
}

async function refreshAccount() {
  const apiKey = getApiKey();
  if (!apiKey || accountRequestInProgress) return;
  accountRequestInProgress = true;
  try {
    const data = await request('/account');
    renderAccount(data.account);
    setConnectionState(true, 'Carteira conectada');
  } catch (error) {
    clearAccount();
    showFeedback(`${error.message} Informe uma chave válida para reconectar.`, true);
  } finally {
    accountRequestInProgress = false;
  }
}

elements.createAccountForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const username = elements.username.value.trim();
  if (!username) {
    showFeedback('Informe um username antes de criar a carteira.', true);
    return;
  }

  elements.createAccount.disabled = true;
  try {
    const data = await request('/accounts', {
      method: 'POST',
      body: JSON.stringify({ username }),
    });
    saveApiKey(data.apiKey);
    elements.apiKey.value = data.apiKey;
    renderAccount(data.account);
    showFeedback('Carteira criada. Copie e guarde sua chave agora; ela só é exibida nesta resposta.');
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
  saveApiKey(submittedKey);
  await refreshAccount();
  if (getApiKey()) showFeedback('Carteira conectada com sucesso.');
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
  if (!getApiKey()) {
    showFeedback('Conecte uma carteira antes de enviar ordens.', true);
    return;
  }

  const side = elements.orderSide.value;
  const amount = Number(elements.orderAmount.value);
  if (!Number.isFinite(amount) || amount <= 0) {
    showFeedback('Informe um valor maior que zero.', true);
    return;
  }
  const body = side === 'BUY' ? { side, quoteAmount: amount } : { side, assetAmount: amount };

  elements.submitOrder.disabled = true;
  try {
    const data = await request('/orders', { method: 'POST', body: JSON.stringify(body) });
    renderAccount(data.account);
    elements.orderAmount.value = '';
    showFeedback(`${side === 'BUY' ? 'Compra' : 'Venda'} executada. ${number(data.order.amount)} ativo(s) por ${money(data.order.total)}.`);
  } catch (error) {
    showFeedback(error.message, true);
  } finally {
    elements.submitOrder.disabled = !getApiKey();
  }
});

const storedKey = getApiKey();
if (storedKey) {
  elements.apiKey.value = storedKey;
  refreshAccount();
}

window.setInterval(refreshAccount, 3000);
