import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import express from 'express';
import { JsonStateStore } from '../src/services/stateStore.js';
import { MarketSimulator } from '../src/services/marketSimulator.js';
import { MarketSyncService } from '../src/services/marketSyncService.js';
import { createMarketSyncRouter } from '../src/routes/sync.routes.js';

test('master aceita a primeira revisão e node atrasado aplica o snapshot vencedor', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'market-sync-flow-'));
  const previousRole = process.env.MARKET_SYNC_ROLE;
  let server;
  const syncServices = [];

  try {
    process.env.MARKET_SYNC_ROLE = 'master';
    const masterStore = new JsonStateStore(path.join(dataDir, 'master', 'market-state.json'));
    const masterSimulator = new MarketSimulator(masterStore);
    await masterStore.save({ accounts: [], marketHistory: [] });
    masterSimulator.initialize(await masterStore.load());

    const app = express();
    app.use(express.json({ limit: '25mb' }));
    app.use('/api/sync', createMarketSyncRouter({
      role: 'master', token: 'test-sync-token', simulator: masterSimulator, store: masterStore,
    }));
    await new Promise((resolve) => {
      server = app.listen(0, '127.0.0.1', resolve);
    });
    const masterUrl = `http://127.0.0.1:${server.address().port}`;

    const createNode = async (name) => {
      const store = new JsonStateStore(path.join(dataDir, name, 'market-state.json'));
      const simulator = new MarketSimulator(store);
      simulator.initialize(await store.load());
      const syncService = new MarketSyncService({
        role: 'node', masterUrl, token: 'test-sync-token', store, simulator, intervalMs: 60000,
      });
      syncServices.push(syncService);
      await syncService.start();
      return { store, simulator };
    };

    const firstNode = await createNode('node-a');
    const secondNode = await createNode('node-b');
    const winner = await firstNode.simulator.createAccount({ username: 'winner_node' });
    assert.ok(await masterStore.repository.getAccount(winner.account.accountId));

    await assert.rejects(
      secondNode.simulator.createAccount({ username: 'stale_node' }),
      (error) => error.syncConflict === true,
    );
    assert.equal(await masterStore.repository.getAccountByUsername('stale_node'), null);
    assert.ok(await secondNode.store.repository.getAccount(winner.account.accountId));
    assert.equal(
      secondNode.store.state.syncRevision,
      (await masterStore.repository.getMarketState()).syncRevision,
    );
  } finally {
    for (const syncService of syncServices) syncService.stop();
    if (server) await new Promise((resolve) => server.close(resolve));
    if (previousRole === undefined) delete process.env.MARKET_SYNC_ROLE;
    else process.env.MARKET_SYNC_ROLE = previousRole;
    await rm(dataDir, { recursive: true, force: true });
  }
});