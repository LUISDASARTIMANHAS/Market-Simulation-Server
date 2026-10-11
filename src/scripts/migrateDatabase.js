import { readFile, mkdir, copyFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import {
  DEFAULT_ASSET_ID,
  DEFAULT_ASSET_NAME,
  DEFAULT_ASSET_SYMBOL,
} from '../data/marketRepository.js';
import { writeJson } from '../data/atomicJsonStore.js';
import { roundMoney, roundAsset } from '../utils/money.js';

const DATA_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../data');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');

/**
 * Executa a migração do estado legado monolítico para a estrutura modular de 8 arquivos JSON.
 * @param {object} [options]
 * @param {string} [options.sourceFile]
 * @param {string} [options.dataDir]
 * @param {boolean} [options.dryRun]
 * @returns {Promise<object>}
 */
export async function runMigration(options = {}) {
  const dataDir = options.dataDir || DATA_DIR;
  const sourcePath = options.sourceFile || path.join(dataDir, 'market-state.json');
  const backupDir = path.join(dataDir, 'backups');

  // 1. Carrega dados de origem
  let rawSource;
  try {
    rawSource = await readFile(sourcePath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      // Se market-state.json não existir, tenta backup
      const backupPath = path.join(backupDir, 'market-state.pre-migration.json');
      rawSource = await readFile(backupPath, 'utf8');
    } else {
      throw error;
    }
  }

  const legacyState = JSON.parse(rawSource);
  if (!legacyState || typeof legacyState !== 'object') {
    throw new Error('Estado de origem inválido: deve ser um objeto JSON.');
  }

  // Se já estiver migrado (market-state modular não possui campo accounts na raiz)
  const isAlreadyModular = !Array.isArray(legacyState.accounts)
    && Number.isFinite(legacyState.currentPrice)
    && typeof legacyState.assetId === 'string';

  if (isAlreadyModular) {
    return {
      migrated: false,
      message: 'O banco de dados já está na estrutura modular.',
    };
  }

  // 2. Garante backup pré-migração
  await mkdir(backupDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const preMigrationBackupPath = path.join(backupDir, `market-state.pre-migration-${timestamp}.json`);
  const fixedBackupPath = path.join(backupDir, 'market-state.pre-migration.json');

  await writeJson(preMigrationBackupPath, legacyState);
  try {
    await access(fixedBackupPath);
  } catch {
    await writeJson(fixedBackupPath, legacyState);
  }

  // 3. Processamento de Histórico de Preços
  const historyList = Array.isArray(legacyState.marketHistory) ? legacyState.marketHistory : [];
  const validHistory = historyList
    .filter((tick) => Number.isInteger(tick.sequence) && Number.isFinite(tick.price) && tick.price > 0)
    .sort((a, b) => a.sequence - b.sequence);

  const lastTick = validHistory[validHistory.length - 1] || {
    sequence: 0,
    price: 100,
    updatedAt: new Date().toISOString(),
  };

  const marketHistoryModular = validHistory.map((tick) => ({
    assetId: DEFAULT_ASSET_ID,
    sequence: tick.sequence,
    price: roundMoney(tick.price),
    updatedAt: tick.updatedAt,
  }));

  // 4. Processamento do Ativo Único
  const assetsModular = [
    {
      assetId: DEFAULT_ASSET_ID,
      symbol: DEFAULT_ASSET_SYMBOL,
      name: DEFAULT_ASSET_NAME,
      currentPrice: roundMoney(lastTick.price),
      updatedAt: lastTick.updatedAt,
    },
  ];

  // 5. Coleta e consolidação de Negociações (Trades) e Ordens
  // Mapeia todas as transações das contas e de recentTrades evitando duplicação
  const tradesMap = new Map();

  const registerTrade = (raw) => {
    if (!raw) return;
    const id = raw.id || raw.tradeId || raw.orderId;
    if (!id || tradesMap.has(id)) return;

    const side = raw.side || raw.type;
    const quantity = roundAsset(raw.amount ?? raw.quantity ?? 0);
    const price = roundMoney(raw.price ?? 0);
    const total = roundMoney(raw.total ?? (quantity * price));
    const impactPercent = Number(Number(raw.impactPercent || 0).toFixed(4));
    const createdAt = raw.timestamp || raw.createdAt || new Date().toISOString();

    tradesMap.set(id, {
      tradeId: id,
      orderId: id,
      accountId: raw.accountId,
      username: raw.username,
      assetId: DEFAULT_ASSET_ID,
      side,
      quantity,
      price,
      total,
      impactPercent,
      createdAt,
    });
  };

  // Coleta das contas
  const rawAccounts = Array.isArray(legacyState.accounts) ? legacyState.accounts : [];
  for (const acc of rawAccounts) {
    if (Array.isArray(acc.history)) {
      for (const item of acc.history) {
        registerTrade({ ...item, accountId: acc.accountId, username: acc.username });
      }
    }
  }

  // Coleta de recentTrades
  const rawRecentTrades = Array.isArray(legacyState.recentTrades) ? legacyState.recentTrades : [];
  for (const item of rawRecentTrades) {
    registerTrade(item);
  }

  // Ordena trades por data decrescente
  const tradesModular = [...tradesMap.values()].sort((a, b) =>
    Date.parse(b.createdAt) - Date.parse(a.createdAt)
  );

  // Gera orders.json a partir dos trades registrados
  const ordersModular = tradesModular.map((t) => ({
    orderId: t.orderId,
    accountId: t.accountId,
    assetId: t.assetId,
    side: t.side,
    quantity: t.quantity,
    price: t.price,
    limitPrice: null,
    total: t.total,
    impactPercent: t.impactPercent,
    status: 'FILLED',
    createdAt: t.createdAt,
    updatedAt: t.createdAt,
  }));

  // 6. Processamento de Contas e Portfólios
  const accountsModular = [];
  const portfoliosModular = [];

  for (const acc of rawAccounts) {
    const accountId = acc.accountId;
    const username = typeof acc.username === 'string' && acc.username.trim()
      ? acc.username.trim()
      : accountId;
    const balance = roundMoney(acc.balance ?? 0);
    const assetBalance = roundAsset(acc.assetBalance ?? 0);

    // Calcula preço médio ponderado a partir dos trades de compra da conta
    const accountBuys = tradesModular.filter((t) => t.accountId === accountId && t.side === 'BUY');
    const totalBuyCost = accountBuys.reduce((sum, t) => sum + t.total, 0);
    const totalBuyQuantity = accountBuys.reduce((sum, t) => sum + t.quantity, 0);
    const averagePrice = totalBuyQuantity > 0 ? roundMoney(totalBuyCost / totalBuyQuantity) : 0;

    const lastAccountTrade = tradesModular.find((t) => t.accountId === accountId);
    const updatedAt = lastAccountTrade?.createdAt || acc.createdAt || new Date().toISOString();

    accountsModular.push({
      accountId,
      username,
      keyHash: acc.keyHash,
      balance,
      createdAt: acc.createdAt || new Date().toISOString(),
      updatedAt,
    });

    portfoliosModular.push({
      accountId,
      assetId: DEFAULT_ASSET_ID,
      quantity: assetBalance,
      averagePrice,
      updatedAt,
    });
  }

  // 7. Processamento de Eventos de Mercado
  const marketEventsModular = [];
  if (legacyState.latestMarketEvent && typeof legacyState.latestMarketEvent === 'object') {
    const ev = legacyState.latestMarketEvent;
    marketEventsModular.push({
      eventId: randomUUID(),
      assetId: DEFAULT_ASSET_ID,
      category: ev.category || 'Geral',
      title: ev.title || 'Evento inicial',
      description: ev.description || '',
      impactPercent: Number(Number(ev.impactPercent || 0).toFixed(4)),
      occurredAt: ev.occurredAt || new Date().toISOString(),
    });
  }

  // 8. Processamento do Estado Operacional do Mercado
  const marketStateModular = {
    assetId: DEFAULT_ASSET_ID,
    currentPrice: roundMoney(lastTick.price),
    sequence: lastTick.sequence,
    totalVolume: roundMoney(legacyState.totalVolume ?? 0),
    buyVolume: roundMoney(legacyState.buyVolume ?? 0),
    sellVolume: roundMoney(legacyState.sellVolume ?? 0),
    latestMarketEvent: legacyState.latestMarketEvent || null,
    nextMarketEventAt: legacyState.nextMarketEventAt || null,
    updatedAt: lastTick.updatedAt,
  };

  // 9. Auditoria e Reconciliação
  const audit = {
    accountsCount: accountsModular.length,
    assetsCount: assetsModular.length,
    portfoliosCount: portfoliosModular.length,
    ordersCount: ordersModular.length,
    tradesCount: tradesModular.length,
    historyTicksCount: marketHistoryModular.length,
    eventsCount: marketEventsModular.length,
    totalCashBalance: roundMoney(accountsModular.reduce((acc, a) => acc + a.balance, 0)),
    totalAssetBalance: roundAsset(portfoliosModular.reduce((acc, p) => acc + p.quantity, 0)),
    originalTotalCash: roundMoney(rawAccounts.reduce((acc, a) => acc + a.balance, 0)),
    originalTotalAsset: roundAsset(rawAccounts.reduce((acc, a) => acc + a.assetBalance, 0)),
    totalVolume: marketStateModular.totalVolume,
    buyVolume: marketStateModular.buyVolume,
    sellVolume: marketStateModular.sellVolume,
  };

  if (audit.totalCashBalance !== audit.originalTotalCash) {
    throw new Error(`Divergência financeira em saldo caixa: migrado ${audit.totalCashBalance} != original ${audit.originalTotalCash}`);
  }
  if (audit.totalAssetBalance !== audit.originalTotalAsset) {
    throw new Error(`Divergência financeira em quantidade de ativos: migrado ${audit.totalAssetBalance} != original ${audit.originalTotalAsset}`);
  }

  if (options.dryRun) {
    return { migrated: true, dryRun: true, audit };
  }

  // 10. Gravação Atômica nos 8 Arquivos
  await writeJson(path.join(dataDir, 'accounts.json'), accountsModular);
  await writeJson(path.join(dataDir, 'assets.json'), assetsModular);
  await writeJson(path.join(dataDir, 'portfolios.json'), portfoliosModular);
  await writeJson(path.join(dataDir, 'orders.json'), ordersModular);
  await writeJson(path.join(dataDir, 'trades.json'), tradesModular);
  await writeJson(path.join(dataDir, 'market-history.json'), marketHistoryModular);
  await writeJson(path.join(dataDir, 'market-events.json'), marketEventsModular);
  await writeJson(path.join(dataDir, 'market-state.json'), marketStateModular);

  return {
    migrated: true,
    backupFile: preMigrationBackupPath,
    audit,
  };
}

// Execução via linha de comando
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  runMigration()
    .then((result) => {
      console.log('Migração concluída com sucesso!');
      console.log(JSON.stringify(result, null, 2));
    })
    .catch((error) => {
      console.error('Falha na migração:', error);
      process.exitCode = 1;
    });
}

