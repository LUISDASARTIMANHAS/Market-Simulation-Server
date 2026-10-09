import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import marketRoutes from './routes/marketRoutes.js';
import { marketSimulator } from './services/marketSimulator.js';
import { marketStateStore } from './services/stateStore.js';
import { logger } from './utils/logger.js';

const app = express();
const PORT = Number(process.env.MARKET_PORT || 3001);
const PUBLIC_DIRECTORY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public');

app.use((req, res, next) => {
  const startedAt = process.hrtime.bigint();
  const logRequest = (event, level = 'info') => {
    const durationMs = Number((Number(process.hrtime.bigint() - startedAt) / 1e6).toFixed(2));
    logger[level](event, {
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      durationMs,
    });
  };

  res.once('finish', () => logRequest('http.request'));
  res.once('close', () => {
    if (!res.writableFinished) logRequest('http.request_aborted', 'warn');
  });
  next();
});

app.use(cors());
app.use(express.json({ limit: '25mb' }));
if (process.env.TRUST_PROXY) app.set('trust proxy', process.env.TRUST_PROXY);
app.use('/api', marketRoutes);
app.use(express.static(PUBLIC_DIRECTORY, { index: 'index.html' }));

/**
 * Restaura o mercado antes de começar a publicar preços.
 * @returns {Promise<void>}
 */
async function startMarketServer() {
  const savedState = await marketStateStore.load();
  marketSimulator.initialize(savedState);
  const adminSetup = await marketSimulator.ensureAdministrator(process.env.MARKET_ADMIN_TOKEN);
  marketSimulator.start();
  logger.info('market.state_restored', {
    historyEntries: Array.isArray(savedState.marketHistory) ? savedState.marketHistory.length : 0,
    accounts: Array.isArray(savedState.accounts) ? savedState.accounts.length : 0,
  });

  app.listen(PORT, () => {
    if (adminSetup.apiKey) {
      console.log(`ADMIN API TOKEN (guarde em local seguro; será exibido apenas nesta criação): ${adminSetup.apiKey}`);
    } else {
      console.log(`Administrador pronto: ${adminSetup.accountId}. O token não é armazenado em texto puro.`);
    }
    logger.info('server.started', {
      port: PORT,
      marketStatusUrl: `http://localhost:${PORT}/api/market/status`,
      stateFile: process.env.MARKET_STATE_FILE || 'data/market-state.json',
    });
  });
}

startMarketServer().catch((error) => {
  logger.error('server.start_failed', { message: error.message });
  process.exitCode = 1;
});
