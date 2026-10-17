import { request, showFeedback, saveApiKey, clearApiKey, getApiKey, setConnectionState, updateAuthNavigation } from './common.js';

const elements = {
  feedback: document.querySelector('#feedback'),
  alreadyLoggedCard: document.querySelector('#already-logged-card'),
  loggedUsername: document.querySelector('#logged-username'),
  btnSwitchAccount: document.querySelector('#btn-switch-account'),
  authContainer: document.querySelector('#auth-container'),
  tabLogin: document.querySelector('#tab-login'),
  tabRegister: document.querySelector('#tab-register'),
  loginView: document.querySelector('#login-view'),
  registerView: document.querySelector('#register-view'),
  loginForm: document.querySelector('#login-form'),
  loginApiKey: document.querySelector('#login-api-key'),
  toggleKey: document.querySelector('#toggle-key'),
  pasteKey: document.querySelector('#paste-key'),
  btnSubmitLogin: document.querySelector('#btn-submit-login'),
  registerForm: document.querySelector('#register-form'),
  registerUsername: document.querySelector('#register-username'),
  btnSubmitRegister: document.querySelector('#btn-submit-register'),
  newKeyBox: document.querySelector('#new-key-box'),
  newKeyInput: document.querySelector('#new-key-input'),
  btnCopyNewKey: document.querySelector('#btn-copy-new-key'),
};

function switchTab(target) {
  const isLogin = target === 'login';
  elements.tabLogin.classList.toggle('active', isLogin);
  elements.tabRegister.classList.toggle('active', !isLogin);
  elements.loginView.hidden = !isLogin;
  elements.registerView.hidden = isLogin;
}

elements.tabLogin.addEventListener('click', () => switchTab('login'));
elements.tabRegister.addEventListener('click', () => switchTab('register'));

elements.toggleKey.addEventListener('click', () => {
  const isPassword = elements.loginApiKey.type === 'password';
  elements.loginApiKey.type = isPassword ? 'text' : 'password';
  elements.toggleKey.textContent = isPassword ? 'Ocultar' : 'Mostrar';
});

elements.pasteKey.addEventListener('click', async () => {
  try {
    const text = await navigator.clipboard.readText();
    if (text) {
      elements.loginApiKey.value = text.trim();
      showFeedback('Chave colada da área de transferência.');
    }
  } catch {
    showFeedback('Não foi possível acessar a área de transferência. Cole manualmente com Ctrl+V.', true);
  }
});

elements.loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const apiKey = elements.loginApiKey.value.trim();
  if (!apiKey) {
    showFeedback('Informe uma chave de API para conectar.', true);
    return;
  }

  elements.btnSubmitLogin.disabled = true;
  saveApiKey(apiKey);

  try {
    const data = await request('/account');
    setConnectionState(true, 'Carteira conectada');
    updateAuthNavigation();
    showFeedback(`Conectado como @${data.account?.username || 'usuário'}! Redirecionando para a carteira...`);
    window.setTimeout(() => {
      window.location.href = '/wallet.html';
    }, 700);
  } catch (error) {
    clearApiKey();
    setConnectionState(false, 'Chave inválida');
    showFeedback(`${error.message || 'Falha ao autenticar.'} Verifique a chave e tente novamente.`, true);
  } finally {
    elements.btnSubmitLogin.disabled = false;
  }
});

elements.registerForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const username = elements.registerUsername.value.trim();
  if (!username) {
    showFeedback('Informe um username antes de criar a carteira.', true);
    return;
  }

  elements.btnSubmitRegister.disabled = true;

  try {
    const data = await request('/accounts', {
      method: 'POST',
      body: JSON.stringify({ username }),
    });

    saveApiKey(data.apiKey);
    elements.newKeyInput.value = data.apiKey;
    elements.newKeyBox.hidden = false;
    elements.registerUsername.disabled = true;
    elements.btnSubmitRegister.hidden = true;
    updateAuthNavigation();
    showFeedback('Carteira criada com sucesso! Não se esqueça de salvar sua chave.');
  } catch (error) {
    showFeedback(error.message, true);
    elements.btnSubmitRegister.disabled = false;
  }
});

elements.btnCopyNewKey.addEventListener('click', async () => {
  if (!elements.newKeyInput.value) return;
  try {
    await navigator.clipboard.writeText(elements.newKeyInput.value);
    showFeedback('Chave copiada para a área de transferência!');
  } catch {
    elements.newKeyInput.select();
    document.execCommand('copy');
    showFeedback('Chave copiada!');
  }
});

elements.btnSwitchAccount.addEventListener('click', () => {
  clearApiKey();
  elements.alreadyLoggedCard.hidden = true;
  elements.authContainer.hidden = false;
  elements.loginApiKey.value = '';
  updateAuthNavigation();
  showFeedback('Você foi desconectado. Insira outra chave ou crie uma nova carteira.');
});

async function checkCurrentSession() {
  const currentKey = getApiKey();
  if (!currentKey) {
    setConnectionState(true, 'Pronto para conectar');
    return;
  }

  try {
    const data = await request('/account');
    if (data.account?.username) {
      elements.alreadyLoggedCard.hidden = false;
      elements.loggedUsername.textContent = `@${data.account.username}`;
      setConnectionState(true, 'Conectado');
    }
  } catch {
    clearApiKey();
    setConnectionState(true, 'Pronto para conectar');
  }
}

checkCurrentSession();

