import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import express from 'express';
import cors from 'cors';
import { MarketRepository } from '../src/data/marketRepository.js';
import { JsonStateStore } from '../src/services/stateStore.js';
import { MarketSimulator } from '../src/services/marketSimulator.js';
import marketRoutes from '../src/routes/marketRoutes.js';
import { marketSimulator } from '../src/services/marketSimulator.js';
import { marketStateStore } from '../src/services/stateStore.js';
import { runMigration } from '../src/scripts/migrateDatabase.js';
import { apiErrorHandler, apiNotFound, createApiResponseMiddleware } from '../src/middleware/apiResponse.js';

describe('Testes de Integração HTTP da API', () => {
  let server;
  let port;
  let baseUrl;

  before(async () => {
    // Carrega o estado real da aplicação modular
    const state = await marketStateStore.load();
    marketSimulator.initialize(state);

    const app = express();
    app.use(cors());
    app.use('/api', createApiResponseMiddleware({
      name: 'test-market',
      version: '1.2.3',
      getRole: () => 'master',
    }));
    app.use(express.json());
    app.use('/api', marketRoutes);
    app.use('/api', apiNotFound);
    app.use('/api', apiErrorHandler);

    await new Promise((resolve) => {
      server = app.listen(0, () => {
        port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}/api`;
        resolve();
      });
    });
  });

  after(async () => {
    if (server) {
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(resolve));
    }
    // Restaura o banco oficial limpo a partir do backup para garantir isolamento
    await runMigration({
      sourceFile: path.resolve('data/backups/market-state.pre-migration.json'),
      dataDir: path.resolve('data'),
    });
  });

  test('GET /api/market/status retorna contrato público com dados do mercado', async () => {
    const res = await fetch(`${baseUrl}/market/status`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body.meta.server, { name: 'test-market', version: '1.2.3', role: 'master' });
    assert.equal(body.success, true);
    assert.ok(Number.isFinite(body.data.currentPrice));
    assert.ok(Number.isInteger(body.data.sequence));
    assert.ok(Array.isArray(body.data.history));
    assert.ok(Array.isArray(body.data.recentTrades));
    assert.ok(body.data.volume && typeof body.data.volume === 'object');
  });

  test('respostas de erro da API também incluem identidade do servidor', async () => {
    const notFound = await fetch(`${baseUrl}/rota-inexistente`);
    assert.equal(notFound.status, 404);
    const notFoundBody = await notFound.json();
    assert.equal(notFoundBody.success, false);
    assert.deepEqual(notFoundBody.meta.server, { name: 'test-market', version: '1.2.3', role: 'master' });

    const invalidJson = await fetch(`${baseUrl}/accounts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{',
    });
    assert.equal(invalidJson.status, 400);
    const invalidJsonBody = await invalidJson.json();
    assert.equal(invalidJsonBody.success, false);
    assert.deepEqual(invalidJsonBody.meta.server, { name: 'test-market', version: '1.2.3', role: 'master' });
  });

  test('GET /api/backup retorna snapshot para download', async () => {
    const res = await fetch(`${baseUrl}/backup`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') || '', /application\/json/);
    const body = await res.json();
    assert.ok(Array.isArray(body.accounts));
    assert.ok(Array.isArray(body.marketHistory));
    assert.ok(Array.isArray(body.recentTrades));
  });

  test('Fluxo completo: POST /api/accounts -> GET /api/account -> POST /api/orders/buy e /sell', async () => {
    // 1. Cria conta
    const username = `trader_${Date.now()}`;
    const createRes = await fetch(`${baseUrl}/accounts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username }),
    });
    assert.equal(createRes.status, 201);
    const createData = await createRes.json();
    assert.equal(createData.success, true);
    assert.ok(createData.data.apiKey);
    assert.equal(createData.data.account.username, username);
    assert.equal(createData.data.account.balance, 1000);
    assert.equal(createData.data.account.keyHash, undefined);

    const apiKey = createData.data.apiKey;

    // 2. Consulta conta autenticada
    const accountRes = await fetch(`${baseUrl}/account`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    assert.equal(accountRes.status, 200);
    const accountData = await accountRes.json();
    assert.equal(accountData.data.account.username, username);
    assert.equal(accountData.data.account.balance, 1000);
    assert.equal(accountData.data.account.keyHash, undefined);

    // 3. Envia ordem de compra
    const orderRes = await fetch(`${baseUrl}/orders/buy`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ amount: 150 }),
    });
    assert.equal(orderRes.status, 201);
    const orderData = await orderRes.json();
    assert.equal(orderData.success, true);
    assert.equal(orderData.data.order.total, 150);
    assert.equal(orderData.data.account.balance, 850);
    assert.ok(orderData.data.account.assetBalance > 0);

    const sellRes = await fetch(`${baseUrl}/orders/sell`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ amount: orderData.data.order.amount / 2 }),
    });
    assert.equal(sellRes.status, 201);
    const sellData = await sellRes.json();
    assert.equal(sellData.success, true);
    assert.equal(sellData.data.order.side, 'SELL');

    // 4. Consulta histórico
    const historyRes = await fetch(`${baseUrl}/account/history`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    assert.equal(historyRes.status, 200);
    const historyData = await historyRes.json();
    assert.ok(Array.isArray(historyData.data));
    assert.equal(historyData.data.length, 2);
    assert.equal(historyData.data[0].id, sellData.data.order.id);
  });
});
