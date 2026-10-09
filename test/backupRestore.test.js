import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { MarketRepository } from '../src/data/marketRepository.js';
import { JsonStateStore } from '../src/services/stateStore.js';
import { MarketSimulator } from '../src/services/marketSimulator.js';

test('restauração substitui todas as coleções e remove atividade posterior ao backup', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'market-backup-'));
  try {
    const repository = new MarketRepository(dataDir);
    const stateStore = new JsonStateStore(path.join(dataDir, 'market-state.json'));
    const initialTick = { assetId: 'SIM', sequence: 0, price: 100, updatedAt: '2026-01-01T00:00:00.000Z' };
    await repository.replaceFullSnapshot({
      accounts: [],
      assets: [{ assetId: 'SIM', symbol: 'SIM', name: 'Ativo Simulado', currentPrice: 100, updatedAt: initialTick.updatedAt }],
      portfolios: [], orders: [], trades: [], marketHistory: [initialTick], marketEvents: [],
      marketState: { assetId: 'SIM', currentPrice: 100, sequence: 0, totalVolume: 0, buyVolume: 0, sellVolume: 0, latestMarketEvent: null, nextMarketEventAt: null, updatedAt: initialTick.updatedAt },
    });

    const simulator = new MarketSimulator(stateStore);
    simulator.initialize(await stateStore.load());
    const adminToken = 'x9cldk6m5QqJkY3RRRWI2wJW9rhKucdSDj0VPooCcrM';
    const admin = await simulator.ensureAdministrator(adminToken);
    assert.equal(simulator.authenticateApiKey(adminToken), admin.accountId);
    assert.equal(simulator.isAdministrator(admin.accountId), true);
    const preserved = await simulator.createAccount({ username: 'preserved_user' });
    const backup = await simulator.getBackupSnapshot();

    const later = await simulator.createAccount({ username: 'later_user' });
    await simulator.placeOrder(later.account.accountId, { side: 'BUY', quoteAmount: 100 });
    assert.ok((await repository.getTrades()).length > backup.trades.length);

    await simulator.restoreFromBackup(backup);

    assert.ok(simulator.getAccount(preserved.account.accountId));
    assert.equal(simulator.getAccount(later.account.accountId), null);
    assert.deepEqual(await repository.getTrades(), backup.trades);
    assert.deepEqual(await repository.getOrders(), backup.orders);
    assert.deepEqual(await repository.getMarketEvents(Infinity), backup.marketEvents);
    assert.deepEqual(await repository.getAccounts(), backup.accounts);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});
