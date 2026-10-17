const API_BASE = '/api';
const API_KEY_STORAGE = 'market-test-client-api-key';

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
  const headers = new Headers(options.headers || {});
  const apiKey = getApiKey();
  if (apiKey) headers.set('Authorization', `Bearer ${apiKey}`);
  if (options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(`${API_BASE}${path}`, { ...options, headers });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result?.success) {
    throw new Error(result?.message || `A solicitação falhou (HTTP ${response.status}).`);
  }
  return result.data;
}

function showFeedback(message, isError = false) {
  const feedback = document.querySelector('#feedback');
  if (!feedback) return;
  feedback.textContent = message;
  feedback.classList.toggle('error', isError);
  feedback.hidden = !message;
}

function saveApiKey(apiKey) {
  try {
    localStorage.setItem(API_KEY_STORAGE, apiKey);
    sessionStorage.removeItem(API_KEY_STORAGE);
  } catch {
    // Fallback caso localStorage esteja inacessível
    sessionStorage.setItem(API_KEY_STORAGE, apiKey);
  }
}

function clearApiKey() {
  try {
    localStorage.removeItem(API_KEY_STORAGE);
  } catch {}
  try {
    sessionStorage.removeItem(API_KEY_STORAGE);
  } catch {}
}

function getApiKey() {
  try {
    const key = localStorage.getItem(API_KEY_STORAGE);
    if (key) return key;
    const sessionKey = sessionStorage.getItem(API_KEY_STORAGE);
    if (sessionKey) {
      localStorage.setItem(API_KEY_STORAGE, sessionKey);
      sessionStorage.removeItem(API_KEY_STORAGE);
      return sessionKey;
    }
  } catch {
    return sessionStorage.getItem(API_KEY_STORAGE) || '';
  }
  return '';
}

function setConnectionState(isConnected, message = 'Mercado conectado') {
  const statusNode = document.querySelector('#connection-status');
  const statusDot = document.querySelector('#connection-dot');
  if (statusNode) statusNode.textContent = isConnected ? message : 'Sem conexão com o mercado';
  if (statusDot) {
    statusDot.classList.toggle('online', isConnected);
    statusDot.classList.toggle('offline', !isConnected);
  }
}

async function updateAdminNavigation() {
  const adminLinks = document.querySelectorAll('[data-admin-link]');
  if (!adminLinks.length || !getApiKey()) return;
  try {
    const data = await request('/account');
    if (data.account?.isAdmin) adminLinks.forEach((link) => { link.hidden = false; });
  } catch {
    // A navegação administrativa fica oculta para tokens inválidos ou usuários comuns.
  }
}

async function updateAuthNavigation() {
  const authLinks = document.querySelectorAll('[data-auth-link]');
  if (!authLinks.length) return;
  const key = getApiKey();
  if (!key) {
    authLinks.forEach((link) => {
      link.textContent = 'Entrar / Cadastro';
      link.href = '/login';
      link.classList.remove('logged-in');
    });
    return;
  }
  try {
    const data = await request('/account');
    if (data.account?.username) {
      authLinks.forEach((link) => {
        link.textContent = `@${data.account.username}`;
        link.href = '/wallet';
        link.classList.add('logged-in');
      });
    }
  } catch {
    authLinks.forEach((link) => {
      link.textContent = 'Entrar / Cadastro';
      link.href = '/login';
      link.classList.remove('logged-in');
    });
  }
}

updateAdminNavigation();
updateAuthNavigation();

export {
  API_BASE,
  API_KEY_STORAGE,
  money,
  number,
  formatTime,
  request,
  showFeedback,
  saveApiKey,
  clearApiKey,
  getApiKey,
  setConnectionState,
  updateAdminNavigation,
  updateAuthNavigation,
};

