import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  INITIAL_VIRTUAL_BALANCE,
  MARKET_EVENT_MAX_INTERVAL_MS,
  MARKET_EVENT_MIN_INTERVAL_MS,
  MAX_ACCOUNT_HISTORY,
  MAX_ORDER_IMPACT_PERCENT,
  MAX_ORDER_NOTIONAL_USD,
  MAX_PUBLIC_TRADES,
  REFERENCE_LIQUIDITY_USD,
  TICKER_INTERVAL_MS,
} from '../config/constants.js';
import { marketStateStore } from './stateStore.js';
import { logger } from '../utils/logger.js';

/** @param {number} value */
const roundMoney = (value) => Math.round((value + Number.EPSILON) * 100) / 100;

/** @param {number} value */
const roundAsset = (value) => Math.round((value + Number.EPSILON) * 1e8) / 1e8;

/** @param {string} apiKey */
const hashApiKey = (apiKey) => createHash('sha256').update(apiKey).digest('hex');

const MARKET_EVENTS = [
  { category: 'Inflação', title: 'Inflação acima do esperado', description: 'Pressão inflacionária reduz o apetite por risco.', minImpact: -1.2, maxImpact: -0.3 },
  { category: 'Inflação', title: 'Inflação desacelera', description: 'Alívio inflacionário melhora o apetite por risco.', minImpact: 0.2, maxImpact: 0.9 },
  { category: 'Guerra', title: 'Escalada de conflito', description: 'Aumento da tensão geopolítica pressiona os ativos.', minImpact: -1.5, maxImpact: -0.5 },
  { category: 'Guerra', title: 'Acordo de cessar-fogo', description: 'Redução da tensão geopolítica favorece os ativos.', minImpact: 0.3, maxImpact: 1.2 },
  { category: 'Política', title: 'Instabilidade política', description: 'Incerteza política aumenta a aversão ao risco.', minImpact: -1.1, maxImpact: -0.3 },
  { category: 'Política', title: 'Acordo político', description: 'Avanço em negociações reduz a incerteza.', minImpact: 0.2, maxImpact: 0.8 },
  { category: 'Juros', title: 'Alta inesperada de juros', description: 'Juros maiores pressionam os ativos de risco.', minImpact: -1, maxImpact: -0.3 },
  { category: 'Juros', title: 'Corte de juros', description: 'Juros menores favorecem ativos de risco.', minImpact: 0.2, maxImpact: 0.9 },
  { category: 'Tecnologia', title: 'Avanço tecnológico', description: 'Uma inovação relevante melhora as perspectivas do mercado.', minImpact: 0.3, maxImpact: 1.1 },
  { category: 'Emprego', title: 'Mercado de trabalho enfraquece', description: 'Sinais de desaceleração aumentam a cautela dos investidores.', minImpact: -0.9, maxImpact: -0.2 },
];

const randomBetween = (minimum, maximum) => minimum + Math.random() * (maximum - minimum);

/**
 * Gera e mantém os preços simulados publicados pela API de mercado.
 */
class MarketSimulator {
  constructor() {
    this.history = [{ sequence: 0, price: 100, updatedAt: new Date().toISOString() }];
    this.interval = null;
    this.accounts = new Map();
    this.recentTrades = [];
    this.totalVolume = 0;
    this.buyVolume = 0;
    this.sellVolume = 0;
    this.operationQueue = Promise.resolve();
    this.latestEvent = null;
    this.nextEventAt = null;
  }

  /**
   * Restaura preços e sequência do arquivo local do serviço.
   * @param {Record<string, unknown>} state
   */
  initialize(state) {
    if (Array.isArray(state.marketHistory)) {
      const savedHistory = state.marketHistory.filter((tick) =>
        Number.isInteger(tick.sequence)
        && Number.isFinite(tick.price)
        && tick.price > 0
        && typeof tick.updatedAt === 'string'
      );
      if (savedHistory.length > 0) this.history = savedHistory.slice(-50);
    }

    if (Array.isArray(state.accounts)) {
      this.accounts = new Map(state.accounts
        .filter((account) => typeof account.accountId === 'string'
          && typeof account.keyHash === 'string'
          && /^[a-f0-9]{64}$/.test(account.keyHash)
          && Number.isFinite(account.balance)
          && account.balance >= 0
          && Number.isFinite(account.assetBalance)
          && account.assetBalance >= 0)
        .map((account) => [account.accountId, {
          ...account,
          history: Array.isArray(account.history) ? account.history.slice(0, MAX_ACCOUNT_HISTORY) : [],
        }]));
    }
    this.recentTrades = Array.isArray(state.recentTrades) ? state.recentTrades.slice(0, MAX_PUBLIC_TRADES) : [];
    this.totalVolume = Number.isFinite(state.totalVolume) ? state.totalVolume : 0;
    this.buyVolume = Number.isFinite(state.buyVolume) ? state.buyVolume : 0;
    this.sellVolume = Number.isFinite(state.sellVolume) ? state.sellVolume : 0;
    this.latestEvent = state.latestMarketEvent && typeof state.latestMarketEvent.title === 'string'
      ? state.latestMarketEvent
      : null;
    this.nextEventAt = typeof state.nextMarketEventAt === 'string'
      && Number.isFinite(Date.parse(state.nextMarketEventAt))
      ? state.nextMarketEventAt
      : null;
  }

  /**
   * Gera um novo preço e persiste o histórico atualizado.
   */
  tick() {
    return this.enqueue(async () => {
      if (!this.nextEventAt) this.scheduleNextEvent();
      if (Date.now() < Date.parse(this.nextEventAt)) return;

      const previous = this.history[this.history.length - 1];
      const template = MARKET_EVENTS[Math.floor(Math.random() * MARKET_EVENTS.length)];
      const changePercent = randomBetween(template.minImpact, template.maxImpact);
      const price = Number(Math.max(0.01, previous.price * (1 + changePercent / 100)).toFixed(2));
      const occurredAt = new Date().toISOString();
      this.history.push({
        sequence: previous.sequence + 1,
        price,
        updatedAt: occurredAt,
      });
      if (this.history.length > 50) this.history.shift();
      this.latestEvent = {
        category: template.category,
        title: template.title,
        description: template.description,
        impactPercent: Number(changePercent.toFixed(4)),
        occurredAt,
      };
      this.scheduleNextEvent();

      logger.info('market.event_applied', {
        category: template.category,
        title: template.title,
        previousPrice: previous.price,
        currentPrice: price,
        impactPercent: Number(changePercent.toFixed(4)),
        sequence: previous.sequence + 1,
        nextEventAt: this.nextEventAt,
      });
      await this.persist();
    });
  }

  /** Agenda o próximo evento dentro da janela configurada. */
  scheduleNextEvent() {
    const delay = randomBetween(MARKET_EVENT_MIN_INTERVAL_MS, MARKET_EVENT_MAX_INTERVAL_MS);
    this.nextEventAt = new Date(Date.now() + delay).toISOString();
  }

  /**
   * Inicia o ticker do mercado.
   * @returns {boolean}
   */
  start() {
    if (this.interval) return false;
    if (!this.nextEventAt) this.scheduleNextEvent();
    this.interval = setInterval(() => {
      this.tick().catch((error) => logger.error('market.tick_failed', { message: error.message }));
    }, TICKER_INTERVAL_MS);
    logger.info('market.ticker_started', {
      tickIntervalMs: TICKER_INTERVAL_MS,
      nextEventAt: this.nextEventAt,
    });
    return true;
  }

  /**
   * Executa mutações em série para proteger saldo e preço de ordens concorrentes.
   * @param {() => Promise<unknown>} operation
   */
  enqueue(operation) {
    const result = this.operationQueue.then(operation);
    this.operationQueue = result.catch(() => {});
    return result;
  }

  /**
   * Persiste preço, contas e negócios como um único estado do mercado.
   */
  persist() {
    return marketStateStore.save({
      marketHistory: this.history,
      accounts: [...this.accounts.values()],
      recentTrades: this.recentTrades,
      totalVolume: this.totalVolume,
      buyVolume: this.buyVolume,
      sellVolume: this.sellVolume,
      latestMarketEvent: this.latestEvent,
      nextMarketEventAt: this.nextEventAt,
    });
  }

  /**
   * Cria uma carteira virtual e entrega a chave secreta apenas uma vez.
   * @returns {Promise<{ account: object, apiKey: string }>}
   */
  createAccount() {
    return this.enqueue(async () => {
      const apiKey = randomBytes(32).toString('base64url');
      const account = {
        accountId: randomUUID(),
        keyHash: hashApiKey(apiKey),
        balance: INITIAL_VIRTUAL_BALANCE,
        assetBalance: 0,
        history: [],
        createdAt: new Date().toISOString(),
      };
      this.accounts.set(account.accountId, account);
      try {
        await this.persist();
      } catch (error) {
        this.accounts.delete(account.accountId);
        throw error;
      }
      logger.info('account.created', { accountId: account.accountId });
      return { account: this.getAccount(account.accountId), apiKey };
    });
  }

  /**
   * Revoga a chave atual e retorna uma substituta exibida somente uma vez.
   * @param {string} accountId
   * @returns {Promise<{ account: object, apiKey: string }>}
   */
  rotateApiKey(accountId) {
    return this.enqueue(async () => {
      const account = this.accounts.get(accountId);
      if (!account) throw Object.assign(new Error('Conta não encontrada.'), { statusCode: 404 });

      const previousHash = account.keyHash;
      const apiKey = randomBytes(32).toString('base64url');
      account.keyHash = hashApiKey(apiKey);
      try {
        await this.persist();
      } catch (error) {
        account.keyHash = previousHash;
        throw error;
      }
      logger.info('account.api_key_rotated', { accountId });
      return { account: this.getAccount(accountId), apiKey };
    });
  }

  /**
   * Resolve uma chave de API sem armazenar ou expor o segredo em texto puro.
   * @param {string} apiKey
   * @returns {string | null}
   */
  authenticateApiKey(apiKey) {
    if (typeof apiKey !== 'string' || apiKey.length < 40 || apiKey.length > 100) return null;
    const candidate = Buffer.from(hashApiKey(apiKey), 'hex');
    for (const account of this.accounts.values()) {
      const stored = Buffer.from(account.keyHash, 'hex');
      if (candidate.length === stored.length && timingSafeEqual(candidate, stored)) return account.accountId;
    }
    return null;
  }

  /**
   * Retorna somente os dados públicos da carteira, nunca o hash da chave.
   * @param {string} accountId
   * @returns {{ accountId: string, balance: number, assetBalance: number, history: object[] } | null}
   */
  getAccount(accountId) {
    const account = this.accounts.get(accountId);
    if (!account) return null;
    return {
      accountId: account.accountId,
      balance: account.balance,
      assetBalance: account.assetBalance,
      history: account.history.map((trade) => ({ ...trade })),
    };
  }

  /**
   * Aplica uma ordem paper-trading à carteira e ao preço global.
   * BUY usa quoteAmount em USD; SELL usa assetAmount em unidades do ativo.
   * @param {string} accountId
   * @param {{ side: string, quoteAmount?: number, assetAmount?: number }} input
   * @returns {Promise<{ order: object, account: object, market: object }>}
   */
  placeOrder(accountId, input) {
    return this.enqueue(async () => {
      const account = this.accounts.get(accountId);
      if (!account) throw Object.assign(new Error('Conta não encontrada.'), { statusCode: 404 });
      const current = this.history[this.history.length - 1];
      let amount;
      let total;

      if (input?.side === 'BUY') {
        const quoteAmount = Number(input.quoteAmount);
        if (!Number.isFinite(quoteAmount) || quoteAmount <= 0) {
          throw Object.assign(new Error('Informe quoteAmount maior que zero para compra.'), { statusCode: 400 });
        }
        if (quoteAmount > MAX_ORDER_NOTIONAL_USD) {
          throw Object.assign(new Error(`O limite por ordem é US$ ${MAX_ORDER_NOTIONAL_USD}.`), { statusCode: 400 });
        }
        total = roundMoney(quoteAmount);
        if (total > account.balance) {
          throw Object.assign(new Error('Saldo virtual insuficiente.'), { statusCode: 400 });
        }
        amount = roundAsset(total / current.price);
      } else if (input?.side === 'SELL') {
        amount = Number(input.assetAmount);
        if (!Number.isFinite(amount) || amount <= 0) {
          throw Object.assign(new Error('Informe assetAmount maior que zero para venda.'), { statusCode: 400 });
        }
        amount = roundAsset(amount);
        if (amount > account.assetBalance) {
          throw Object.assign(new Error('Saldo de ativo insuficiente.'), { statusCode: 400 });
        }
        total = roundMoney(amount * current.price);
        if (total > MAX_ORDER_NOTIONAL_USD) {
          throw Object.assign(new Error(`O limite por ordem é US$ ${MAX_ORDER_NOTIONAL_USD}.`), { statusCode: 400 });
        }
      } else {
        throw Object.assign(new Error('side deve ser BUY ou SELL.'), { statusCode: 400 });
      }

      if (amount <= 0 || total <= 0) {
        throw Object.assign(new Error('A ordem é menor que a precisão mínima permitida.'), { statusCode: 400 });
      }

      const notional = total;
      const impactPercent = Math.min(
        MAX_ORDER_IMPACT_PERCENT,
        (notional / REFERENCE_LIQUIDITY_USD) * MAX_ORDER_IMPACT_PERCENT
      );
      const signedImpact = input.side === 'BUY' ? impactPercent : -impactPercent;
      const updatedPrice = Number(Math.max(0.01, current.price * (1 + signedImpact / 100)).toFixed(2));
      const timestamp = new Date().toISOString();
      const order = {
        id: randomUUID(),
        timestamp,
        type: input.side,
        price: current.price,
        amount,
        total,
        impactPercent: Number(signedImpact.toFixed(4)),
      };
      const accountBefore = { ...account, history: account.history };
      const historyBefore = this.history;
      const tradesBefore = this.recentTrades;
      const volumesBefore = [this.totalVolume, this.buyVolume, this.sellVolume];

      if (input.side === 'BUY') {
        account.balance = roundMoney(account.balance - total);
        account.assetBalance = roundAsset(account.assetBalance + amount);
        this.buyVolume = roundMoney(this.buyVolume + total);
      } else {
        account.balance = roundMoney(account.balance + total);
        account.assetBalance = roundAsset(account.assetBalance - amount);
        this.sellVolume = roundMoney(this.sellVolume + total);
      }
      account.history = [order, ...account.history].slice(0, MAX_ACCOUNT_HISTORY);
      this.totalVolume = roundMoney(this.totalVolume + total);
      this.history = [...this.history, {
        sequence: current.sequence + 1,
        price: updatedPrice,
        updatedAt: timestamp,
      }].slice(-50);
      this.recentTrades = [{
        id: order.id,
        side: order.type,
        price: order.price,
        amount: order.amount,
        total: order.total,
        impactPercent: order.impactPercent,
        timestamp,
      }, ...this.recentTrades].slice(0, MAX_PUBLIC_TRADES);

      try {
        await this.persist();
      } catch (error) {
        Object.assign(account, accountBefore);
        this.history = historyBefore;
        this.recentTrades = tradesBefore;
        [this.totalVolume, this.buyVolume, this.sellVolume] = volumesBefore;
        throw error;
      }

      logger.info('order.executed', {
        accountId,
        orderId: order.id,
        side: input.side,
        amount,
        total,
        previousPrice: current.price,
        currentPrice: updatedPrice,
        impactPercent: Number(signedImpact.toFixed(4)),
      });
      return { order, account: this.getAccount(accountId), market: this.getStatus() };
    });
  }

  /**
   * Devolve o preço atual e os últimos ticks disponíveis.
   * @returns {{ currentPrice: number, sequence: number, updatedAt: string, history: Array<{ sequence: number, price: number, updatedAt: string }> }}
   */
  getStatus() {
    const current = this.history[this.history.length - 1];
    return {
      currentPrice: current.price,
      sequence: current.sequence,
      updatedAt: current.updatedAt,
      history: this.history.map((tick) => ({ ...tick })),
      recentTrades: this.recentTrades.map((trade) => ({ ...trade })),
      volume: { total: this.totalVolume, buys: this.buyVolume, sells: this.sellVolume },
      latestEvent: this.latestEvent ? { ...this.latestEvent } : null,
      nextEventAt: this.nextEventAt,
    };
  }
}

export const marketSimulator = new MarketSimulator();
