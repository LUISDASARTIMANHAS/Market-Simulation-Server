import { money, formatTime, request, setConnectionState } from './common.js';

const content = document.querySelector('#admin-content');
const feedback = document.querySelector('#backup-feedback');
const fileInput = document.querySelector('#import-file');
const fileName = document.querySelector('#import-file-name');
const restoreButton = document.querySelector('#import-backup');
const accountsBody = document.querySelector('#accounts-table-body');
const accountsFeedback = document.querySelector('#accounts-feedback');
const accountKey = document.querySelector('#account-key');
const createUserForm = document.querySelector('#create-user-form');

function showAccountsFeedback(message, isError = false) {
  accountsFeedback.textContent = message;
  accountsFeedback.classList.toggle('error', isError);
  accountsFeedback.hidden = !message;
}

function showAccountKey(message) {
  accountKey.textContent = message;
  accountKey.hidden = !message;
}

function roleLabel(isAdmin) {
  return isAdmin ? 'Administrador' : 'Usuário';
}

function renderAccounts(accounts) {
  if (!accounts.length) {
    accountsBody.innerHTML = '<tr><td colspan="6" class="empty-cell">Nenhuma conta cadastrada.</td></tr>';
    return;
  }
  accountsBody.replaceChildren(...accounts.map((account) => {
    const row = document.createElement('tr');
    row.dataset.accountId = account.accountId;
    row.innerHTML = `
      <td><input class="account-username" value="${account.username.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}" aria-label="Nome de usuário de ${account.username}"></td>
      <td><label class="admin-role-label"><input class="account-is-admin" type="checkbox" ${account.isAdmin ? 'checked' : ''}> ${roleLabel(account.isAdmin)}</label></td>
      <td>${money(account.balance)}</td>
      <td>${account.assetBalance}</td>
      <td>${formatTime(account.createdAt)}</td>
      <td><div class="admin-actions"><button class="button button-secondary save-account" type="button">Salvar</button><button class="button button-danger delete-account" type="button">Excluir</button></div></td>`;
    return row;
  }));
}

async function loadAccounts() {
  const data = await request('/admin/accounts');
  renderAccounts(data.accounts || []);
}

function showFeedback(message, isError = false) {
  feedback.textContent = message;
  feedback.classList.toggle('error', isError);
  feedback.hidden = !message;
}

async function requireAdmin() {
  try {
    const data = await request('/account');
    if (!data.account?.isAdmin) throw new Error('Acesso administrativo necessário.');
    content.hidden = false;
    setConnectionState(true, 'Administrador conectado');
    await loadAccounts();
  } catch {
    window.location.replace('/wallet.html');
  }
}

createUserForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const submitButton = createUserForm.querySelector('button[type="submit"]');
  const username = document.querySelector('#new-username').value;
  const isAdmin = document.querySelector('#new-is-admin').checked;
  submitButton.disabled = true;
  showAccountsFeedback('');
  showAccountKey('');
  try {
    const data = await request('/admin/accounts', { method: 'POST', body: JSON.stringify({ username, isAdmin }) });
    createUserForm.reset();
    showAccountsFeedback(`Conta ${data.account.username} criada com sucesso.`);
    showAccountKey(`Chave de API de ${data.account.username} (mostrada apenas agora): ${data.apiKey}`);
    await loadAccounts();
  } catch (error) {
    showAccountsFeedback(error.message, true);
  } finally {
    submitButton.disabled = false;
  }
});

accountsBody.addEventListener('click', async (event) => {
  const button = event.target.closest('button');
  if (!button) return;
  const row = button.closest('tr');
  const accountId = row?.dataset.accountId;
  if (!accountId) return;

  if (button.classList.contains('delete-account')) {
    const username = row.querySelector('.account-username').value;
    if (!window.confirm(`Excluir a conta "${username}"? As negociações desta conta também serão removidas.`)) return;
    button.disabled = true;
    showAccountsFeedback('');
    try {
      await request(`/admin/accounts/${encodeURIComponent(accountId)}`, { method: 'DELETE' });
      showAccountsFeedback(`Conta ${username} excluída.`);
      await loadAccounts();
    } catch (error) {
      showAccountsFeedback(error.message, true);
      button.disabled = false;
    }
    return;
  }

  if (button.classList.contains('save-account')) {
    button.disabled = true;
    showAccountsFeedback('');
    try {
      const username = row.querySelector('.account-username').value;
      const isAdmin = row.querySelector('.account-is-admin').checked;
      await request(`/admin/accounts/${encodeURIComponent(accountId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ username, isAdmin }),
      });
      showAccountsFeedback(`Conta ${username} atualizada.`);
      await loadAccounts();
    } catch (error) {
      showAccountsFeedback(error.message, true);
      button.disabled = false;
    }
  }
});

document.querySelector('#export-backup').addEventListener('click', () => {
  window.location.assign('/api/backup');
});

fileInput.addEventListener('change', () => {
  const file = fileInput.files[0];
  fileName.hidden = !file;
  restoreButton.disabled = !file;
  fileName.textContent = file ? `Arquivo selecionado: ${file.name}` : '';
  showFeedback('');
});

restoreButton.addEventListener('click', async () => {
  const file = fileInput.files[0];
  if (!file) return;
  restoreButton.disabled = true;
  restoreButton.textContent = 'Restaurando…';
  try {
    let backup;
    try {
      backup = JSON.parse(await file.text());
    } catch {
      throw new Error('Arquivo inválido: não é um JSON válido.');
    }
    const result = await request('/backup/restore', { method: 'POST', body: JSON.stringify(backup) });
    showFeedback(`Restauração concluída: ${result.accountsCount} conta(s), ${result.historyTicksCount} ticks e preço atual de ${money(result.currentPrice)}.`);
    fileInput.value = '';
    fileName.hidden = true;
  } catch (error) {
    showFeedback(`Erro na restauração: ${error.message}`, true);
  } finally {
    restoreButton.disabled = !fileInput.files[0];
    restoreButton.textContent = 'Restaurar banco';
  }
});

requireAdmin();
