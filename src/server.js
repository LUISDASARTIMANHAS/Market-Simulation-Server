import express from 'express';
import cors from 'cors';
import marketRoutes from './routes/marketRoutes.js';
import { marketSimulator } from './services/marketSimulator.js';
import { marketStateStore } from './services/stateStore.js';

const app = express();
const PORT = Number(process.env.MARKET_PORT || 3001);

app.use(cors());
app.use(express.json({ limit: '10kb' }));
if (process.env.TRUST_PROXY) app.set('trust proxy', process.env.TRUST_PROXY);
app.use('/api', marketRoutes);

/**
 * Restaura o mercado antes de começar a publicar preços.
 * @returns {Promise<void>}
 */
async function startMarketServer() {
  const savedState = await marketStateStore.load();
  marketSimulator.initialize(savedState);
  marketSimulator.start();

  app.listen(PORT, () => {
    console.log(`[SERVIDOR DE MERCADO] Escutando na porta ${PORT}`);
    console.log(`[SERVIDOR DE MERCADO] API: http://localhost:${PORT}/api/market/status`);
    console.log(`[SERVIDOR DE MERCADO] Estado local salvo em ${process.env.MARKET_STATE_FILE || 'data/market-state.json'}`);
  });
}

startMarketServer().catch((error) => {
  console.error(`[SERVIDOR DE MERCADO] Falha ao iniciar: ${error.message}`);
  process.exitCode = 1;
});
