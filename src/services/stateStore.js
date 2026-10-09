import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { access } from 'node:fs/promises';
import { MarketRepository, DEFAULT_ASSET_ID } from '../data/marketRepository.js';
import { runMigration } from '../scripts/migrateDatabase.js';
import { roundMoney, roundAsset } from '../utils/money.js';
import { logger } from '../utils/logger.js';

const DEFAULT_STATE_FILE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../data/market-state.json'
);
const LEGACY_STATE_FILE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../data/market-state.json'
);

/**
 * Persiste e restaura o estado do mercado através da camada central MarketRepository,
 * garantindo compatibilidade com o formato agregado em memória e arquivos modulares em disco.
 */
export class JsonStateStore {
  constructor(filePath = process.env.MARKET_STATE_FILE || DEFAULT_STATE_FILE) {
    this.filePath = filePath;
    this.dataDir = path.dirname(filePath);
    this.legacyFilePath = process.env.MARKET_STATE_FILE ? null : LEGACY_STATE_FILE;
    this.repository = new MarketRepository(this.dataDir);
    this.state = {};
  }

  /**
   * Carrega o estado persistido do mercado a partir dos arquivos modulares.
   * Executa auto-migração se apenas a estrutura legada monolítica existir.
   * @returns {Promise<Record<string, unknown>>}
   */
  async load() {
    const accountsFile = path.join(this.dataDir, 'accounts.json');

    let modularExists = false;
    try {
      await access(accountsFile);
      modularExists = true;
    } catch {
      modularExists = false;
    }

    // Se a estrutura modular ainda não existir, tenta auto-migrar
    if (!modularExists) {
      let legacyExists = false;
      try {
        await access(this.filePath);
        legacyExists = true;
      } catch {
        if (this.legacyFilePath) {
          try {
            await access(this.legacyFilePath);
            legacyExists = true;
          } catch {}
        }
      }

      if (legacyExists) {
        try {
          const migrationSource = this.legacyFilePath && this.filePath === DEFAULT_STATE_FILE
            ? this.legacyFilePath
            : this.filePath;
          logger.info('state.migrating_to_modular', { source: migrationSource });
          await runMigration({ sourceFile: migrationSource, dataDir: this.dataDir });
        } catch (migrationError) {
          logger.error('state.migration_failed', { message: migrationError.message });
          throw migrationError;
        }
      }
    }

    // Carrega o estado através do repositório
    try {
      const fullState = await this.repository.loadFullMarketState();
      const accountsList = fullState.accounts || [];
      const portfoliosList = fullState.portfolios || [];
      const tradesList = fullState.trades || [];
      const historyList = fullState.marketHistory || [];
      const marketState = fullState.marketState || {};

      // Combina contas com suas posições em portfolios e históricos de trades
      const accounts = accountsList.map((acc) => {
        const portfolio = portfoliosList.find((p) => p.accountId === acc.accountId && p.assetId === DEFAULT_ASSET_ID);
        const accountTrades = tradesList
          .filter((t) => t.accountId === acc.accountId)
          .slice(0, 100)
          .map((t) => ({
            id: t.tradeId || t.orderId,
            timestamp: t.createdAt,
            type: t.side,
            side: t.side,
            price: t.price,
            amount: t.quantity,
            total: t.total,
            impactPercent: t.impactPercent,
            accountId: t.accountId,
            username: t.username,
          }));

        return {
          accountId: acc.accountId,
          username: acc.username,
          keyHash: acc.keyHash,
          balance: acc.balance,
          assetBalance: portfolio ? portfolio.quantity : 0,
          averagePrice: portfolio ? portfolio.averagePrice : 0,
          history: accountTrades,
          createdAt: acc.createdAt,
          updatedAt: acc.updatedAt,
        };
      });

      const recentTrades = tradesList.slice(0, 50).map((t) => ({
        id: t.tradeId || t.orderId,
        side: t.side,
        price: t.price,
        amount: t.quantity,
        total: t.total,
        impactPercent: t.impactPercent,
        accountId: t.accountId,
        username: t.username,
        timestamp: t.createdAt,
      }));

      const aggregatedState = {
        marketHistory: historyList.map((h) => ({
          sequence: h.sequence,
          price: h.price,
          updatedAt: h.updatedAt,
        })),
        accounts,
        recentTrades,
        totalVolume: marketState.totalVolume ?? 0,
        buyVolume: marketState.buyVolume ?? 0,
        sellVolume: marketState.sellVolume ?? 0,
        latestMarketEvent: marketState.latestMarketEvent ?? null,
        nextMarketEventAt: marketState.nextMarketEventAt ?? null,
      };

      this.state = aggregatedState;
      logger.info('state.loaded_modular', { dataDir: this.dataDir });
      return { ...aggregatedState };
    } catch (error) {
      logger.error('state.load_modular_failed', { dataDir: this.dataDir, message: error.message });
      throw error;
    }
  }

  /**
   * Grava cópia consistente do estado distribuindo entre os arquivos modulares via repositório.
   * @param {Record<string, unknown>} updates
   * @returns {Promise<void>}
   */
  async save(updates) {
    this.state = { ...this.state, ...updates };

    const accounts = Array.isArray(this.state.accounts) ? this.state.accounts : [];
    const history = Array.isArray(this.state.marketHistory) ? this.state.marketHistory : [];
    const currentPrice = history.length > 0 ? history[history.length - 1].price : 100;
    const currentSequence = history.length > 0 ? history[history.length - 1].sequence : 0;
    const currentUpdatedAt = history.length > 0 ? history[history.length - 1].updatedAt : new Date().toISOString();

    // 1. Prepara accounts.json
    const accountsData = accounts.map((acc) => ({
      accountId: acc.accountId,
      username: acc.username,
      keyHash: acc.keyHash,
      balance: roundMoney(acc.balance),
      createdAt: acc.createdAt || new Date().toISOString(),
      updatedAt: acc.updatedAt || new Date().toISOString(),
    }));

    // 2. Prepara portfolios.json
    const portfoliosData = accounts.map((acc) => ({
      accountId: acc.accountId,
      assetId: DEFAULT_ASSET_ID,
      quantity: roundAsset(acc.assetBalance),
      averagePrice: roundMoney(acc.averagePrice || 0),
      updatedAt: acc.updatedAt || new Date().toISOString(),
    }));

    // 3. Prepara assets.json
    const assetsData = [
      {
        assetId: DEFAULT_ASSET_ID,
        symbol: 'SIM',
        name: 'Ativo Simulado',
        currentPrice: roundMoney(currentPrice),
        updatedAt: currentUpdatedAt,
      },
    ];

    // 4. Prepara trades.json e orders.json
    // O recentTrades contém as negociações recentes
    // Para manter integridade histórica acumulada, buscamos trades existentes e mesclamos os novos
    const existingTrades = await this.repository.getTrades();
    const tradesMap = new Map();
    for (const t of existingTrades) {
      tradesMap.set(t.tradeId, t);
    }

    if (Array.isArray(this.state.recentTrades)) {
      for (const t of this.state.recentTrades) {
        const id = t.id || t.tradeId;
        if (!tradesMap.has(id)) {
          tradesMap.set(id, {
            tradeId: id,
            orderId: id,
            accountId: t.accountId,
            username: t.username,
            assetId: DEFAULT_ASSET_ID,
            side: t.side || t.type,
            quantity: roundAsset(t.amount ?? t.quantity),
            price: roundMoney(t.price),
            total: roundMoney(t.total),
            impactPercent: Number(Number(t.impactPercent || 0).toFixed(4)),
            createdAt: t.timestamp || t.createdAt || new Date().toISOString(),
          });
        }
      }
    }

    const tradesData = [...tradesMap.values()].sort((a, b) =>
      Date.parse(b.createdAt) - Date.parse(a.createdAt)
    );

    const ordersData = tradesData.map((t) => ({
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

    // 5. Prepara market-history.json
    const marketHistoryData = history.map((tick) => ({
      assetId: DEFAULT_ASSET_ID,
      sequence: tick.sequence,
      price: roundMoney(tick.price),
      updatedAt: tick.updatedAt,
    }));

    // 6. Prepara market-events.json
    const existingEvents = await this.repository.getMarketEvents();
    const eventsData = [...existingEvents];
    if (this.state.latestMarketEvent && typeof this.state.latestMarketEvent === 'object') {
      const latest = this.state.latestMarketEvent;
      const alreadyHas = eventsData.some((e) =>
        e.title === latest.title && e.occurredAt === latest.occurredAt
      );
      if (!alreadyHas) {
        eventsData.unshift({
          eventId: `ev-${Date.now()}`,
          assetId: DEFAULT_ASSET_ID,
          category: latest.category || 'Geral',
          title: latest.title,
          description: latest.description || '',
          impactPercent: Number(Number(latest.impactPercent || 0).toFixed(4)),
          occurredAt: latest.occurredAt || new Date().toISOString(),
        });
      }
    }

    // 7. Prepara market-state.json
    const marketStateData = {
      assetId: DEFAULT_ASSET_ID,
      currentPrice: roundMoney(currentPrice),
      sequence: currentSequence,
      totalVolume: roundMoney(this.state.totalVolume ?? 0),
      buyVolume: roundMoney(this.state.buyVolume ?? 0),
      sellVolume: roundMoney(this.state.sellVolume ?? 0),
      latestMarketEvent: this.state.latestMarketEvent || null,
      nextMarketEventAt: this.state.nextMarketEventAt || null,
      updatedAt: currentUpdatedAt,
    };

    // Persiste todas as coleções de forma atômica e coordenada
    await this.repository.saveFullSnapshot({
      accounts: accountsData,
      portfolios: portfoliosData,
      assets: assetsData,
      orders: ordersData,
      trades: tradesData,
      marketHistory: marketHistoryData,
      marketEvents: eventsData,
      marketState: marketStateData,
    });
  }
}

export const marketStateStore = new JsonStateStore();
