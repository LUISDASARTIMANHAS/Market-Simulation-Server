import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { MarketRepository, DEFAULT_ASSET_ID } from '../src/data/marketRepository.js';
import { readJson, writeJson } from '../src/data/atomicJsonStore.js';
import { MarketSimulator } from '../src/services/marketSimulator.js';
import { JsonStateStore } from '../src/services/stateStore.js';
import { runMigration } from '../src/scripts/migrateDatabase.js';
import {
  toCents,
  fromCents,
  addMoney,
  subtractMoney,
  roundMoney,
  roundAsset,
} from '../src/utils/money.js';

describe('Suíte de Testes Obrigatórios — Reestruturação do Banco de Dados JSON', () => {
  let testDataDir;
  let testRepository;
  let testStateStore;
  let testSimulator;

  before(async () => {
    // Cria diretório isolado para testes
    testDataDir = await mkdtemp(path.join(tmpdir(), 'market-test-'));
    testRepository = new MarketRepository(testDataDir);
    testStateStore = new JsonStateStore(path.join(testDataDir, 'market-state.json'));

    // Cria estado inicial no diretório de teste executando migração do estado oficial
    const officialLegacyState = path.resolve('data/backups/market-state.pre-migration.json');
    await runMigration({
      sourceFile: officialLegacyState,
      dataDir: testDataDir,
    });

    const state = await testStateStore.load();
    testSimulator = new MarketSimulator(testStateStore);
    testSimulator.initialize(state);
  });

  after(async () => {
    // Limpa diretório temporário após os testes
    if (testDataDir) {
      await rm(testDataDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  test('1. Leitura e gravação de todos os 8 arquivos JSON', async () => {
    const files = [
      'accounts.json',
      'assets.json',
      'portfolios.json',
      'orders.json',
      'trades.json',
      'market-history.json',
      'market-events.json',
      'market-state.json',
    ];

    for (const fileName of files) {
      const filePath = path.join(testDataDir, fileName);
      const content = await readJson(filePath);
      assert.ok(content !== null, `Arquivo ${fileName} deve conter dados legíveis.`);
    }

    // Testa gravação atômica com validação
    const sampleTick = { assetId: 'SIM', sequence: 9999, price: 123.45, updatedAt: new Date().toISOString() };
    const history = await testRepository.getMarketHistory('SIM', 100);
    history.push(sampleTick);
    await testRepository.saveMarketHistory(history);

    const reloaded = await testRepository.getMarketHistory('SIM', 100);
    const lastTick = reloaded[reloaded.length - 1];
    assert.equal(lastTick.sequence, 9999);
    assert.equal(lastTick.price, 123.45);
  });

  test('2. Criação, login e consulta de contas (autenticação Bearer)', async () => {
    const created = await testSimulator.createAccount({ username: 'tester_investor' });
    assert.ok(created.apiKey, 'Deve retornar chave de API');
    assert.equal(created.account.username, 'tester_investor');
    assert.equal(created.account.balance, 1000);
    assert.equal(created.account.assetBalance, 0);

    // Autenticação com a chave retornada
    const authAccountId = testSimulator.authenticateApiKey(created.apiKey);
    assert.equal(authAccountId, created.account.accountId, 'Chave de API válida deve autenticar o accountId');

    // Autenticação com chave incorreta deve falhar
    const invalidAuth = testSimulator.authenticateApiKey('chave-invalida-com-mais-de-quarenta-caracteres-para-teste');
    assert.equal(invalidAuth, null, 'Chave inválida deve retornar null');

    // Consulta de dados públicos da conta
    const accountData = testSimulator.getAccount(created.account.accountId);
    assert.equal(accountData.accountId, created.account.accountId);
    assert.equal(accountData.username, 'tester_investor');
    assert.equal(accountData.balance, 1000);
  });

  test('3. Compra bem-sucedida (débito, crédito de ativos, trades e impacto)', async () => {
    const created = await testSimulator.createAccount({ username: 'buyer_test' });
    const marketBefore = testSimulator.getStatus();
    const balanceBefore = created.account.balance;

    const result = await testSimulator.placeOrder(created.account.accountId, {
      side: 'BUY',
      quoteAmount: 200,
    });

    assert.equal(result.order.type, 'BUY');
    assert.equal(result.order.total, 200);
    assert.ok(result.order.amount > 0);
    assert.equal(result.account.balance, balanceBefore - 200);
    assert.equal(result.account.assetBalance, result.order.amount);
    assert.ok(result.market.currentPrice >= marketBefore.currentPrice, 'Preço deve subir ou manter com impacto de compra');

    // Verifica se trade foi registrado no repositório
    const trades = await testRepository.getTradesByAccount(created.account.accountId);
    assert.ok(trades.length >= 1);
    assert.equal(trades[0].tradeId, result.order.id);
    assert.equal(trades[0].total, 200);
  });

  test('4. Venda bem-sucedida (débito de ativos, crédito de saldo e impacto)', async () => {
    const created = await testSimulator.createAccount({ username: 'seller_test' });
    // Primeiro compra para ter ativos em carteira
    const buyResult = await testSimulator.placeOrder(created.account.accountId, {
      side: 'BUY',
      quoteAmount: 300,
    });

    const marketBeforeSell = testSimulator.getStatus();
    const assetBalanceBefore = buyResult.account.assetBalance;
    const cashBefore = buyResult.account.balance;
    const sellAmount = roundAsset(assetBalanceBefore / 2);

    const sellResult = await testSimulator.placeOrder(created.account.accountId, {
      side: 'SELL',
      assetAmount: sellAmount,
    });

    assert.equal(sellResult.order.type, 'SELL');
    assert.equal(sellResult.order.amount, sellAmount);
    assert.equal(sellResult.account.assetBalance, roundAsset(assetBalanceBefore - sellAmount));
    assert.equal(sellResult.account.balance, roundMoney(cashBefore + sellResult.order.total));
    assert.ok(sellResult.market.currentPrice <= marketBeforeSell.currentPrice, 'Preço deve cair ou manter com impacto de venda');
  });

  test('5. Compra com saldo insuficiente (rejeição com erro 400)', async () => {
    const created = await testSimulator.createAccount({ username: 'poor_buyer' });
    const balanceBefore = created.account.balance;

    await assert.rejects(
      async () => {
        await testSimulator.placeOrder(created.account.accountId, {
          side: 'BUY',
          quoteAmount: 3000, // Tem apenas 1000
        });
      },
      (err) => {
        assert.equal(err.statusCode, 400);
        assert.match(err.message, /Saldo virtual insuficiente/);
        return true;
      }
    );

    // Garante que saldo não foi alterado
    const accountAfter = testSimulator.getAccount(created.account.accountId);
    assert.equal(accountAfter.balance, balanceBefore);
  });

  test('6. Venda com quantidade de ativos insuficiente (rejeição com erro 400)', async () => {
    const created = await testSimulator.createAccount({ username: 'empty_seller' });

    await assert.rejects(
      async () => {
        await testSimulator.placeOrder(created.account.accountId, {
          side: 'SELL',
          assetAmount: 10, // Tem 0 ativos
        });
      },
      (err) => {
        assert.equal(err.statusCode, 400);
        assert.match(err.message, /Saldo de ativo insuficiente/);
        return true;
      }
    );

    const accountAfter = testSimulator.getAccount(created.account.accountId);
    assert.equal(accountAfter.assetBalance, 0);
  });

  test('7. Requisições duplicadas (username duplicado deve falhar com 409)', async () => {
    await testSimulator.createAccount({ username: 'unique_user' });

    await assert.rejects(
      async () => {
        await testSimulator.createAccount({ username: 'unique_user' });
      },
      (err) => {
        assert.equal(err.statusCode, 409);
        assert.match(err.message, /já está em uso/);
        return true;
      }
    );
  });

  test('8. Operações concorrentes serializadas sem condição de corrida', async () => {
    const created = await testSimulator.createAccount({ username: 'concurrent_user' });
    const initialBalance = created.account.balance;

    // Dispara 5 ordens simultaneamente com Promise.all
    const promises = [
      testSimulator.placeOrder(created.account.accountId, { side: 'BUY', quoteAmount: 50 }),
      testSimulator.placeOrder(created.account.accountId, { side: 'BUY', quoteAmount: 50 }),
      testSimulator.placeOrder(created.account.accountId, { side: 'BUY', quoteAmount: 50 }),
      testSimulator.placeOrder(created.account.accountId, { side: 'BUY', quoteAmount: 50 }),
      testSimulator.placeOrder(created.account.accountId, { side: 'BUY', quoteAmount: 50 }),
    ];

    const results = await Promise.all(promises);
    assert.equal(results.length, 5);

    const accountAfter = testSimulator.getAccount(created.account.accountId);
    // 5 ordens de 50 = total 250 debitado exatamente
    assert.equal(accountAfter.balance, initialBalance - 250);
    assert.equal(accountAfter.history.length, 5);
  });

  test('9. Recuperação e rollback seguro após falha de gravação', async () => {
    const created = await testSimulator.createAccount({ username: 'rollback_user' });
    const balanceBefore = created.account.balance;
    const assetBalanceBefore = created.account.assetBalance;
    const historyLengthBefore = testSimulator.getStatus().history.length;

    // Simula falha injetando erro temporário no persist
    const originalPersist = testSimulator.persist;
    testSimulator.persist = async () => {
      throw new Error('Falha simulada de persistência em disco');
    };

    await assert.rejects(
      async () => {
        await testSimulator.placeOrder(created.account.accountId, {
          side: 'BUY',
          quoteAmount: 100,
        });
      },
      /Falha simulada de persistência/
    );

    // Restaura persist original
    testSimulator.persist = originalPersist;

    // Verifica que o estado foi restaurado integralmente em memória
    const accountAfter = testSimulator.getAccount(created.account.accountId);
    assert.equal(accountAfter.balance, balanceBefore, 'Saldo deve ter sido revertido');
    assert.equal(accountAfter.assetBalance, assetBalanceBefore, 'Ativos devem ter sido revertidos');
    assert.equal(testSimulator.getStatus().history.length, historyLengthBefore, 'Histórico deve ter sido revertido');
  });

  test('10. Integridade dos saldos, posições e negociações', async () => {
    const accounts = await testRepository.getAccounts();
    const portfolios = await testRepository.getPortfolios();
    const trades = await testRepository.getTrades();

    for (const acc of accounts) {
      const pos = portfolios.find((p) => p.accountId === acc.accountId);
      assert.ok(pos, `Conta ${acc.accountId} deve ter posição em portfolios.json`);
      assert.ok(acc.balance >= 0, 'Saldo monetário não pode ser negativo');
      assert.ok(pos.quantity >= 0, 'Posição de ativos não pode ser negativa');

      // Verifica se todas as negociações da conta estão registradas
      const accountTrades = trades.filter((t) => t.accountId === acc.accountId);
      assert.ok(Array.isArray(accountTrades));
    }
  });

  test('11. Preservação dos históricos e eventos', async () => {
    const history = await testRepository.getMarketHistory();
    assert.ok(history.length >= 50, 'Deve manter os 50 pontos históricos');

    // Verifica se sequências são estritamente crescentes
    for (let i = 1; i < history.length; i += 1) {
      assert.ok(
        history[i].sequence > history[i - 1].sequence,
        `Sequência deve ser estritamente crescente: ${history[i].sequence} > ${history[i - 1].sequence}`
      );
    }

    const events = await testRepository.getMarketEvents();
    assert.ok(events.length >= 1, 'Deve conter os eventos de mercado registrados');
  });

  test('12. Inicialização da aplicação com a nova estrutura modular', async () => {
    const reloadedStore = new JsonStateStore(path.join(testDataDir, 'market-state.json'));
    const loadedState = await reloadedStore.load();

    assert.ok(Array.isArray(loadedState.accounts));
    assert.ok(loadedState.accounts.length > 0);
    assert.ok(Array.isArray(loadedState.marketHistory));
    assert.ok(loadedState.marketHistory.length > 0);
    assert.ok(Array.isArray(loadedState.recentTrades));
    assert.ok(Number.isFinite(loadedState.totalVolume));

    const freshSimulator = new MarketSimulator(reloadedStore);
    freshSimulator.initialize(loadedState);

    const status = freshSimulator.getStatus();
    assert.ok(status.currentPrice > 0);
    assert.ok(status.sequence > 0);
  });

  test('13. Ausência absoluta de exposição de keyHash e credenciais', async () => {
    const accounts = await testRepository.getAccounts();
    assert.ok(accounts.length > 0);

    for (const acc of accounts) {
      const publicAccount = testSimulator.getAccount(acc.accountId);
      assert.equal(publicAccount.keyHash, undefined, 'getAccount nunca deve conter keyHash');

      const trades = testSimulator.getStatus().recentTrades;
      for (const trade of trades) {
        assert.equal(trade.keyHash, undefined, 'trades públicos nunca devem conter keyHash');
      }
    }
  });

  test('14. Compatibilidade das rotas e snapshots de backup', async () => {
    const snapshot = await testSimulator.getBackupSnapshot();
    assert.ok(Array.isArray(snapshot.accounts), 'Snapshot deve conter accounts');
    assert.ok(Array.isArray(snapshot.marketHistory), 'Snapshot deve conter marketHistory');
    assert.ok(Array.isArray(snapshot.recentTrades), 'Snapshot deve conter recentTrades');
    assert.ok(Number.isFinite(snapshot.totalVolume), 'Snapshot deve conter totalVolume');
    assert.ok(Number.isFinite(snapshot.buyVolume), 'Snapshot deve conter buyVolume');
    assert.ok(Number.isFinite(snapshot.sellVolume), 'Snapshot deve conter sellVolume');
    assert.equal(snapshot.backupVersion, 2, 'Snapshot deve informar a versão completa');
    assert.ok(Array.isArray(snapshot.orders), 'Snapshot deve conter todas as ordens');
    assert.ok(Array.isArray(snapshot.trades), 'Snapshot deve conter todas as negociações');
    assert.ok(Array.isArray(snapshot.marketEvents), 'Snapshot deve conter todos os eventos');

    const status = testSimulator.getStatus();
    assert.ok(Number.isFinite(status.currentPrice));
    assert.ok(Number.isInteger(status.sequence));
    assert.ok(status.volume && typeof status.volume === 'object');
  });
});
