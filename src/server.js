import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import marketRoutes from './routes/marketRoutes.js';
import { marketSimulator } from './services/marketSimulator.js';
import { marketStateStore } from './services/stateStore.js';
import { MarketSyncService } from './services/marketSyncService.js';
import { logger } from './utils/logger.js';
import { MAX_HTTP_TRANSFER_BYTES } from './utils/httpLimits.js';
import { rejectOversizedJsonRequest } from './middleware/requestSizeLimit.js';
import { createHttpRequestLogger } from './middleware/httpRequestLogger.js';
import { registerSyncService } from './services/clusterRegistry.js';
import { apiErrorHandler, apiNotFound, createApiResponseMiddleware } from './middleware/apiResponse.js';

const app = express();
const PORT = Number(process.env.MARKET_PORT || 3001);
const PUBLIC_DIRECTORY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public');
const syncService = new MarketSyncService({ store: marketStateStore, simulator: marketSimulator });
registerSyncService(syncService);

if (process.env.TRUST_PROXY) app.set('trust proxy', process.env.TRUST_PROXY);

app.use(createHttpRequestLogger());
app.use(cors());
app.use('/api', createApiResponseMiddleware({ getRole: () => syncService.role }));
app.use('/api', rejectOversizedJsonRequest);
app.use(express.json({ limit: MAX_HTTP_TRANSFER_BYTES }));
app.use('/api', marketRoutes);
app.use('/api', apiNotFound);
app.use('/api', apiErrorHandler);
app.get(['/dashboard.html', '/wallet.html', '/login.html', '/admin.html', '/cluster.html'], (req, res) => {
  res.redirect(301, req.path.replace(/\.html$/, ''));
});
app.use(express.static(PUBLIC_DIRECTORY, { index: 'index.html' }));

function formatInitialConfiguration(configuration) {
  const labels = {
    port: 'Porta HTTP',
    role: 'Papel',
    nodeId: 'ID do node',
    syncMode: 'Modo de sincronização',
    masterUrl: 'URL do master',
    syncIntervalMs: 'Intervalo de sincronização (ms)',
    syncTimeoutMs: 'Timeout de sincronização (ms)',
    maxJsonTransferBytes: 'Limite JSON (bytes)',
    stateFile: 'Arquivo de estado',
    dataDirectory: 'Diretório de dados',
    logDirectory: 'Diretório de logs',
    trustProxyEnabled: 'Proxy confiável ativo',
  };
  const entries = Object.entries(configuration)
    .map(([key, value]) => [labels[key] || key, value]);
  const labelWidth = Math.max(...entries.map(([label]) => label.length));
  const rows = entries.map(([label, value]) => {
    const formattedValue = value === null
      ? 'não aplicável'
      : String(value).replace(/[\r\n]/g, '\\n');
    return `  ${label.padEnd(labelWidth)} | ${formattedValue}`;
  });
  return ['=== Configuração inicial do servidor ===', ...rows, '========================================'].join('\n');
}

function getInitialConfiguration() {
  return {
    port: PORT,
    role: syncService.role,
    nodeId: syncService.nodeId,
    syncMode: syncService.role === 'node' ? syncService.syncMode : null,
    masterUrl: syncService.getMasterOrigin(),
    syncIntervalMs: syncService.intervalMs,
    syncTimeoutMs: syncService.timeoutMs,
    maxJsonTransferBytes: MAX_HTTP_TRANSFER_BYTES,
    stateFile: process.env.MARKET_STATE_FILE || 'data/market-state.json',
    dataDirectory: process.env.MARKET_DATA_DIR || 'data',
    logDirectory: process.env.MARKET_LOG_DIRECTORY || 'data/logs',
    trustProxyEnabled: Boolean(process.env.TRUST_PROXY),
  };
}

/**
 * Restaura o mercado antes de começar a publicar preços.
 * @returns {Promise<void>}
 */
async function startMarketServer() {
  const savedState = await marketStateStore.load();
  marketSimulator.initialize(savedState);
  await syncService.start();
  const adminSetup = syncService.role === 'node'
    ? null
    : await marketSimulator.ensureAdministrator(process.env.MARKET_ADMIN_TOKEN);
  marketSimulator.start();
  logger.info('market.state_restored', {
    historyEntries: Array.isArray(savedState.marketHistory) ? savedState.marketHistory.length : 0,
    accounts: Array.isArray(savedState.accounts) ? savedState.accounts.length : 0,
  });

  return new Promise((resolve, reject) => {
    const server = app.listen(PORT, () => {
      if (adminSetup) {
        console.log(`ADMIN API TOKEN (guarde em local seguro): ${adminSetup.apiKey}`);
        console.log(`Administrador pronto: ${adminSetup.accountId}. O token não é armazenado em texto puro.`);
      } else {
        logger.info('server.node_mode', { masterUrl: syncService.masterUrl });
      }
      logger.info('server.started', {
        port: PORT,
        marketStatusUrl: `http://localhost:${PORT}/api/market/status`,
        stateFile: process.env.MARKET_STATE_FILE || 'data/market-state.json',
      });
      resolve(server);
    });
    server.once('error', reject);
  });
}

async function startServerWithRetry() {
  const initialConfiguration = getInitialConfiguration();
  console.log(formatInitialConfiguration(initialConfiguration));
  logger.info('server.initial_configuration', initialConfiguration);

  let attempt = 0;
  const retryIntervalMs = Number(process.env.MARKET_START_RETRY_INTERVAL_MS || 5000);
  while (true) {
    attempt += 1;
    try {
      await startMarketServer();
      break;
    } catch (error) {
      logger.error('server.start_failed', {
        attempt,
        retryInMs: retryIntervalMs,
        message: error.message,
      });
      await new Promise((resolve) => setTimeout(resolve, retryIntervalMs));
    }
  }
}

startServerWithRetry();
