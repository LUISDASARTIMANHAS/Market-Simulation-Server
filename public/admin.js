import { money, request, setConnectionState } from './common.js';

const content = document.querySelector('#admin-content');
const feedback = document.querySelector('#backup-feedback');
const fileInput = document.querySelector('#import-file');
const fileName = document.querySelector('#import-file-name');
const restoreButton = document.querySelector('#import-backup');

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
  } catch {
    window.location.replace('/wallet.html');
  }
}

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
