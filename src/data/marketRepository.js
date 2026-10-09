import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJson, writeJson } from './atomicJsonStore.js';
import { roundMoney, roundAsset } from '../utils/money.js';
import { logger } from '../utils/logger.js';

const DATA_DIRECTORY = process.env.MARKET_DATA_DIR
  ? path.resolve(process.env.MARKET_DATA_DIR)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../data');

export const DEFAULT_ASSET_ID = 'SIM';
export const DEFAULT_ASSET_SYMBOL = 'SIM';
export const DEFAULT_ASSET_NAME = 'Ativo Simulado';

/**
 * Validadores de integridade para coleções.
 */
const validators = {
  accounts(list) {
    if (!Array.isArray(list)) return false;
    return list.every((acc) =>
      typeof acc?.accountId === 'string'
      && typeof acc?.username === 'string'
      && typeof acc?.keyHash === 'string'
      && /^[a-f0-9]{64}$/.test(acc.keyHash)
      && Number.isFinite(acc?.balance)
      && acc.balance >= 0
    );
  },
  assets(list) {
    if (!Array.isArray(list)) return false;
    return list.every((item) =>
      typeof item?.assetId === 'string'
      && typeof item?.symbol === 'string'
      && Number.isFinite(item?.currentPrice)
      && item.currentPrice > 0
    );
  },
  portfolios(list) {
    if (!Array.isArray(list)) return false;
    return list.every((pos) =>
      typeof pos?.accountId === 'string'
      && typeof pos?.assetId === 'string'
      && Number.isFinite(pos?.quantity)
      && pos.quantity >= 0
    );
  },
  orders(list) {
    if (!Array.isArray(list)) return false;
    return list.every((ord) =>
      typeof ord?.orderId === 'string'
      && typeof ord?.accountId === 'string'
      && (ord?.side === 'BUY' || ord?.side === 'SELL')
      && Number.isFinite(ord?.quantity)
      && ord.quantity > 0
    );
  },
  trades(list) {
    if (!Array.isArray(list)) return false;
    return list.every((tr) =>
      typeof tr?.tradeId === 'string'
      && typeof tr?.accountId === 'string'
      && (tr?.side === 'BUY' || tr?.side === 'SELL')
      && Number.isFinite(tr?.quantity)
      && tr.quantity > 0
      && Number.isFinite(tr?.price)
      && tr.price > 0
      && Number.isFinite(tr?.total)
      && tr.total >= 0
    );
  },
  marketHistory(list) {
    if (!Array.isArray(list)) return false;
    return list.every((tick) =>
      Number.isInteger(tick?.sequence)
      && Number.isFinite(tick?.price)
      && tick.price > 0
      && typeof tick?.updatedAt === 'string'
    );
  },
  marketEvents(list) {
    if (!Array.isArray(list)) return false;
    return list.every((ev) =>
      typeof ev?.category === 'string'
      && typeof ev?.title === 'string'
      && Number.isFinite(ev?.impactPercent)
    );
  },
  marketState(state) {
    if (!state || typeof state !== 'object' || Array.isArray(state)) return false;
    return Number.isFinite(state.currentPrice)
      && state.currentPrice > 0
      && Number.isInteger(state.sequence)
      && Number.isFinite(state.totalVolume)
      && Number.isFinite(state.buyVolume)
      && Number.isFinite(state.sellVolume);
  },
};

/**
 * Camada Central de Acesso aos Dados do Mercado (Repositório).
 * Abstrai operações nos arquivos JSON e prepara interface compatível com MongoDB.
 */
export class MarketRepository {
  /**
   * @param {string} dataDir
   */
  constructor(dataDir = DATA_DIRECTORY) {
    this.dataDir = dataDir;
    this.paths = {
      accounts: path.join(dataDir, 'accounts.json'),
      assets: path.join(dataDir, 'assets.json'),
      portfolios: path.join(dataDir, 'portfolios.json'),
      orders: path.join(dataDir, 'orders.json'),
      trades: path.join(dataDir, 'trades.json'),
      marketHistory: path.join(dataDir, 'market-history.json'),
      marketEvents: path.join(dataDir, 'market-events.json'),
      marketState: path.join(dataDir, 'market-state.json'),
    };
  }

  // ==================== OPERAÇÕES DE CONTAS ====================

  /**
   * Retorna todas as contas registradas.
   * @returns {Promise<Array<object>>}
   */
  async getAccounts() {
    const list = await readJson(this.paths.accounts, []);
    return Array.isArray(list) ? list : [];
  }

  /**
   * Busca conta por accountId.
   * @param {string} accountId
   * @returns {Promise<object | null>}
   */
  async getAccount(accountId) {
    const accounts = await this.getAccounts();
    return accounts.find((acc) => acc.accountId === accountId) || null;
  }

  /**
   * Busca conta por username.
   * @param {string} username
   * @returns {Promise<object | null>}
   */
  async getAccountByUsername(username) {
    if (!username) return null;
    const lower = username.toLowerCase();
    const accounts = await this.getAccounts();
    return accounts.find((acc) => typeof acc.username === 'string' && acc.username.toLowerCase() === lower) || null;
  }

  /**
   * Busca conta por hash da chave de API.
   * @param {string} keyHash
   * @returns {Promise<object | null>}
   */
  async getAccountByKeyHash(keyHash) {
    if (!keyHash) return null;
    const accounts = await this.getAccounts();
    return accounts.find((acc) => acc.keyHash === keyHash) || null;
  }

  /**
   * Cria e persiste uma nova conta.
   * @param {object} accountData
   * @returns {Promise<object>}
   */
  async createAccount(accountData) {
    const accounts = await this.getAccounts();
    if (accounts.some((acc) => acc.accountId === accountData.accountId)) {
      throw new Error(`Conta com ID ${accountData.accountId} já existe.`);
    }
    const newAccount = {
      accountId: accountData.accountId,
      username: accountData.username,
      keyHash: accountData.keyHash,
      balance: roundMoney(accountData.balance ?? 0),
      createdAt: accountData.createdAt || new Date().toISOString(),
      updatedAt: accountData.updatedAt || accountData.createdAt || new Date().toISOString(),
    };
    accounts.push(newAccount);
    await writeJson(this.paths.accounts, accounts, validators.accounts);
    return { ...newAccount };
  }

  /**
   * Atualiza dados de uma conta existente.
   * @param {string} accountId
   * @param {object} updates
   * @returns {Promise<object>}
   */
  async updateAccount(accountId, updates) {
    const accounts = await this.getAccounts();
    const index = accounts.findIndex((acc) => acc.accountId === accountId);
    if (index === -1) throw new Error(`Conta não encontrada: ${accountId}`);

    const existing = accounts[index];
    const updated = {
      ...existing,
      ...updates,
      balance: updates.balance !== undefined ? roundMoney(updates.balance) : existing.balance,
      updatedAt: new Date().toISOString(),
    };
    accounts[index] = updated;
    await writeJson(this.paths.accounts, accounts, validators.accounts);
    return { ...updated };
  }

  // ==================== OPERAÇÕES DE ATIVOS ====================

  /**
   * Retorna todos os ativos negociáveis.
   * @returns {Promise<Array<object>>}
   */
  async getAssets() {
    const list = await readJson(this.paths.assets, []);
    return Array.isArray(list) ? list : [];
  }

  /**
   * Busca ativo por ID.
   * @param {string} assetId
   * @returns {Promise<object | null>}
   */
  async getAsset(assetId) {
    const assets = await this.getAssets();
    return assets.find((asset) => asset.assetId === assetId) || null;
  }

  /**
   * Cria ou atualiza um ativo.
   * @param {object} assetData
   * @returns {Promise<object>}
   */
  async upsertAsset(assetData) {
    const assets = await this.getAssets();
    const index = assets.findIndex((a) => a.assetId === assetData.assetId);
    const updated = {
      assetId: assetData.assetId,
      symbol: assetData.symbol,
      name: assetData.name,
      currentPrice: roundMoney(assetData.currentPrice),
      updatedAt: assetData.updatedAt || new Date().toISOString(),
    };
    if (index >= 0) {
      assets[index] = updated;
    } else {
      assets.push(updated);
    }
    await writeJson(this.paths.assets, assets, validators.assets);
    return { ...updated };
  }

  /**
   * Atualiza o preço atual de um ativo.
   * @param {string} assetId
   * @param {number} currentPrice
   * @param {string} [updatedAt]
   * @returns {Promise<object>}
   */
  async updateAssetPrice(assetId, currentPrice, updatedAt = new Date().toISOString()) {
    const assets = await this.getAssets();
    const asset = assets.find((a) => a.assetId === assetId);
    if (!asset) throw new Error(`Ativo não encontrado: ${assetId}`);
    asset.currentPrice = roundMoney(currentPrice);
    asset.updatedAt = updatedAt;
    await writeJson(this.paths.assets, assets, validators.assets);
    return { ...asset };
  }

  // ==================== OPERAÇÕES DE PORTFÓLIO / POSIÇÃO ====================

  /**
   * Retorna todas as posições em custódia.
   * @returns {Promise<Array<object>>}
   */
  async getPortfolios() {
    const list = await readJson(this.paths.portfolios, []);
    return Array.isArray(list) ? list : [];
  }

  /**
   * Busca posição de um usuário em um ativo específico.
   * @param {string} accountId
   * @param {string} [assetId=DEFAULT_ASSET_ID]
   * @returns {Promise<object | null>}
   */
  async getPortfolio(accountId, assetId = DEFAULT_ASSET_ID) {
    const portfolios = await this.getPortfolios();
    return portfolios.find((pos) => pos.accountId === accountId && pos.assetId === assetId) || null;
  }

  /**
   * Retorna todas as posições de uma conta.
   * @param {string} accountId
   * @returns {Promise<Array<object>>}
   */
  async getPortfoliosByAccount(accountId) {
    const portfolios = await this.getPortfolios();
    return portfolios.filter((pos) => pos.accountId === accountId);
  }

  /**
   * Atualiza ou cria a posição de um usuário.
   * @param {string} accountId
   * @param {string} assetId
   * @param {{ quantity: number, averagePrice?: number, updatedAt?: string }} updates
   * @returns {Promise<object>}
   */
  async updatePortfolio(accountId, assetId, updates) {
    const portfolios = await this.getPortfolios();
    const index = portfolios.findIndex((p) => p.accountId === accountId && p.assetId === assetId);
    const existing = index >= 0 ? portfolios[index] : null;

    const quantity = roundAsset(updates.quantity !== undefined ? updates.quantity : existing?.quantity ?? 0);
    const averagePrice = updates.averagePrice !== undefined
      ? roundMoney(updates.averagePrice)
      : existing?.averagePrice ?? 0;
    const updatedAt = updates.updatedAt || new Date().toISOString();

    const entry = {
      accountId,
      assetId,
      quantity,
      averagePrice,
      updatedAt,
    };

    if (index >= 0) {
      portfolios[index] = entry;
    } else {
      portfolios.push(entry);
    }

    await writeJson(this.paths.portfolios, portfolios, validators.portfolios);
    return { ...entry };
  }

  // ==================== OPERAÇÕES DE ORDENS ====================

  /**
   * Retorna ordens registradas.
   * @returns {Promise<Array<object>>}
   */
  async getOrders() {
    const list = await readJson(this.paths.orders, []);
    return Array.isArray(list) ? list : [];
  }

  /**
   * Cria e persiste uma nova ordem.
   * @param {object} orderData
   * @returns {Promise<object>}
   */
  async createOrder(orderData) {
    const orders = await this.getOrders();
    const newOrder = {
      orderId: orderData.orderId || orderData.id,
      accountId: orderData.accountId,
      assetId: orderData.assetId || DEFAULT_ASSET_ID,
      side: orderData.side || orderData.type,
      quantity: roundAsset(orderData.quantity ?? orderData.amount ?? 0),
      price: roundMoney(orderData.price ?? 0),
      limitPrice: orderData.limitPrice !== undefined ? roundMoney(orderData.limitPrice) : null,
      total: roundMoney(orderData.total ?? 0),
      impactPercent: Number(Number(orderData.impactPercent || 0).toFixed(4)),
      status: orderData.status || 'FILLED',
      createdAt: orderData.createdAt || orderData.timestamp || new Date().toISOString(),
      updatedAt: orderData.updatedAt || orderData.timestamp || new Date().toISOString(),
    };
    orders.unshift(newOrder);
    await writeJson(this.paths.orders, orders, validators.orders);
    return { ...newOrder };
  }

  // ==================== OPERAÇÕES DE NEGOCIAÇÕES (TRADES) ====================

  /**
   * Retorna o histórico oficial de negociações.
   * @returns {Promise<Array<object>>}
   */
  async getTrades() {
    const list = await readJson(this.paths.trades, []);
    return Array.isArray(list) ? list : [];
  }

  /**
   * Retorna as negociações públicas mais recentes.
   * @param {number} [limit=50]
   * @returns {Promise<Array<object>>}
   */
  async getRecentTrades(limit = 50) {
    const trades = await this.getTrades();
    return trades.slice(0, limit);
  }

  /**
   * Retorna histórico de negociações de uma conta específica.
   * @param {string} accountId
   * @param {number} [limit=100]
   * @returns {Promise<Array<object>>}
   */
  async getTradesByAccount(accountId, limit = 100) {
    const trades = await this.getTrades();
    return trades
      .filter((trade) => trade.accountId === accountId)
      .slice(0, limit);
  }

  /**
   * Registra uma nova negociação oficial (fonte única).
   * @param {object} tradeData
   * @returns {Promise<object>}
   */
  async createTrade(tradeData) {
    const trades = await this.getTrades();
    const newTrade = {
      tradeId: tradeData.tradeId || tradeData.id,
      orderId: tradeData.orderId || tradeData.id,
      accountId: tradeData.accountId,
      username: tradeData.username,
      assetId: tradeData.assetId || DEFAULT_ASSET_ID,
      side: tradeData.side || tradeData.type,
      quantity: roundAsset(tradeData.quantity ?? tradeData.amount ?? 0),
      price: roundMoney(tradeData.price ?? 0),
      total: roundMoney(tradeData.total ?? 0),
      impactPercent: Number(Number(tradeData.impactPercent || 0).toFixed(4)),
      createdAt: tradeData.createdAt || tradeData.timestamp || new Date().toISOString(),
    };
    trades.unshift(newTrade);
    await writeJson(this.paths.trades, trades, validators.trades);
    return { ...newTrade };
  }

  // ==================== HISTÓRICO DE PREÇOS DO MERCADO ====================

  /**
   * Retorna o histórico de preços.
   * @param {string} [assetId=DEFAULT_ASSET_ID]
   * @param {number} [limit=50]
   * @returns {Promise<Array<object>>}
   */
  async getMarketHistory(assetId = DEFAULT_ASSET_ID, limit = 50) {
    const list = await readJson(this.paths.marketHistory, []);
    const filtered = Array.isArray(list)
      ? list.filter((tick) => !tick.assetId || tick.assetId === assetId)
      : [];
    return filtered.slice(-limit);
  }

  /**
   * Salva o histórico completo de preços.
   * @param {Array<object>} history
   * @returns {Promise<void>}
   */
  async saveMarketHistory(history) {
    await writeJson(this.paths.marketHistory, history, validators.marketHistory);
  }

  // ==================== EVENTOS DE MERCADO ====================

  /**
   * Retorna os eventos de mercado registrados.
   * @param {number} [limit=50]
   * @returns {Promise<Array<object>>}
   */
  async getMarketEvents(limit = 50) {
    const list = await readJson(this.paths.marketEvents, []);
    return Array.isArray(list) ? list.slice(0, limit) : [];
  }

  /**
   * Adiciona um evento ocorrido ao histórico de eventos.
   * @param {object} eventData
   * @returns {Promise<object>}
   */
  async appendMarketEvent(eventData) {
    const events = await this.getMarketEvents();
    const newEvent = {
      eventId: eventData.eventId || eventData.id || `ev-${Date.now()}`,
      assetId: eventData.assetId || DEFAULT_ASSET_ID,
      category: eventData.category,
      title: eventData.title,
      description: eventData.description,
      impactPercent: Number(Number(eventData.impactPercent || 0).toFixed(4)),
      occurredAt: eventData.occurredAt || new Date().toISOString(),
    };
    events.unshift(newEvent);
    await writeJson(this.paths.marketEvents, events, validators.marketEvents);
    return { ...newEvent };
  }

  // ==================== ESTADO OPERACIONAL DO MERCADO ====================

  /**
   * Retorna o estado operacional atual do mercado.
   * @returns {Promise<object | null>}
   */
  async getMarketState() {
    return readJson(this.paths.marketState, null);
  }

  /**
   * Persiste o estado operacional do mercado.
   * @param {object} stateData
   * @returns {Promise<void>}
   */
  async updateMarketState(stateData) {
    await writeJson(this.paths.marketState, stateData, validators.marketState);
  }

  // ==================== AGREGAÇÃO E COMPATIBILIDADE ====================

  /**
   * Retorna modelo completo da conta compatível com API e clientes web:
   * { accountId, username, balance, assetBalance, history }
   * @param {string} accountId
   * @returns {Promise<object | null>}
   */
  async getFullAccount(accountId) {
    const account = await this.getAccount(accountId);
    if (!account) return null;
    const portfolio = await this.getPortfolio(accountId, DEFAULT_ASSET_ID);
    const trades = await this.getTradesByAccount(accountId, 100);

    // Mapeia histórico no formato esperado pela API/clientes (com id e type)
    const history = trades.map((tr) => ({
      id: tr.tradeId || tr.orderId,
      timestamp: tr.createdAt,
      type: tr.side,
      side: tr.side,
      price: tr.price,
      amount: tr.quantity,
      total: tr.total,
      impactPercent: tr.impactPercent,
      accountId: tr.accountId,
      username: tr.username,
    }));

    return {
      accountId: account.accountId,
      username: account.username,
      balance: account.balance,
      assetBalance: portfolio?.quantity ?? 0,
      history,
      createdAt: account.createdAt,
      updatedAt: account.updatedAt,
    };
  }

  /**
   * Carrega estado integral sincronizado para inicialização do simulador em memória.
   * @returns {Promise<{ accounts: Array<object>, assets: Array<object>, portfolios: Array<object>, orders: Array<object>, trades: Array<object>, marketHistory: Array<object>, marketEvents: Array<object>, marketState: object | null }>}
   */
  async loadFullMarketState() {
    const [accounts, assets, portfolios, orders, trades, marketHistory, marketEvents, marketState] = await Promise.all([
      this.getAccounts(),
      this.getAssets(),
      this.getPortfolios(),
      this.getOrders(),
      this.getTrades(),
      this.getMarketHistory(),
      this.getMarketEvents(),
      this.getMarketState(),
    ]);

    return {
      accounts,
      assets,
      portfolios,
      orders,
      trades,
      marketHistory,
      marketEvents,
      marketState,
    };
  }

  /**
   * Salva mutação integral do simulador persistindo de forma coordenada nos arquivos modulares.
   * @param {object} snapshot
   * @returns {Promise<void>}
   */
  async saveFullSnapshot(snapshot) {
    const writes = [];

    if (snapshot.accounts) {
      writes.push(writeJson(this.paths.accounts, snapshot.accounts, validators.accounts));
    }
    if (snapshot.assets) {
      writes.push(writeJson(this.paths.assets, snapshot.assets, validators.assets));
    }
    if (snapshot.portfolios) {
      writes.push(writeJson(this.paths.portfolios, snapshot.portfolios, validators.portfolios));
    }
    if (snapshot.orders) {
      writes.push(writeJson(this.paths.orders, snapshot.orders, validators.orders));
    }
    if (snapshot.trades) {
      writes.push(writeJson(this.paths.trades, snapshot.trades, validators.trades));
    }
    if (snapshot.marketHistory) {
      writes.push(writeJson(this.paths.marketHistory, snapshot.marketHistory, validators.marketHistory));
    }
    if (snapshot.marketEvents) {
      writes.push(writeJson(this.paths.marketEvents, snapshot.marketEvents, validators.marketEvents));
    }
    if (snapshot.marketState) {
      writes.push(writeJson(this.paths.marketState, snapshot.marketState, validators.marketState));
    }

    await Promise.all(writes);
  }
}

export const marketRepository = new MarketRepository();
