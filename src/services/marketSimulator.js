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
import path from 'node:path';
import { marketStateStore } from './stateStore.js';
import { logger } from '../utils/logger.js';
import { writeJson } from '../data/atomicJsonStore.js';
import {
  roundMoney,
  roundAsset,
  addMoney,
  subtractMoney,
  addAsset,
  subtractAsset,
} from '../utils/money.js';

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
 * @param {string | null | undefined} username
 * @returns {string | null}
 */
const normalizeUsername = (username) => {
  if (typeof username !== 'string') {
    throw Object.assign(new Error('username é obrigatório. Use 3 a 24 caracteres, sem espaços.'), { statusCode: 400 });
  }
  const trimmed = username.trim();
  if (!trimmed) {
    throw Object.assign(new Error('username é obrigatório. Use 3 a 24 caracteres, sem espaços.'), { statusCode: 400 });
  }
  if (trimmed.length < 3 || trimmed.length > 24) {
    throw Object.assign(new Error('username deve ter entre 3 e 24 caracteres.'), { statusCode: 400 });
  }
  if (!/^[a-zA-Z0-9._-]+$/.test(trimmed)) {
    throw Object.assign(new Error('username aceita apenas letras, números, ponto, underline e hífen.'), { statusCode: 400 });
  }
  return trimmed;
};

/**
 * @param {Map<string, Record<string, any>>} accounts
 * @param {string} username
 * @returns {void}
 */
const assertUsernameAvailable = (accounts, username) => {
  for (const account of accounts.values()) {
    if (typeof account.username === 'string' && account.username.toLowerCase() === username.toLowerCase()) {
      throw Object.assign(new Error('username já está em uso por outra conta.'), { statusCode: 409 });
    }
  }
};

/**
 * Gera e mantém os preços simulados publicados pela API de mercado.
 */
class MarketSimulator {
  constructor(store = marketStateStore) {
    this.store = store;
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
        .map((account) => {
          const username = typeof account.username === 'string' && account.username.trim()
            ? account.username.trim()
            : account.accountId;
          return [account.accountId, {
            ...account,
            username,
            averagePrice: Number.isFinite(account.averagePrice) ? account.averagePrice : 0,
            history: Array.isArray(account.history) ? account.history.slice(0, MAX_ACCOUNT_HISTORY) : [],
          }];
        }));
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
    return this.store.save({
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
   * @param {{ username?: string, accountName?: string } | undefined} input
   * @returns {Promise<{ account: object, apiKey: string }>}
   */
  createAccount(input = {}) {
    return this.createAccountWithRole(input, false);
  }

  /**
   * Cria uma conta com o papel definido pela administração. Esta operação não
   * é exposta pela rota pública de cadastro.
   * @param {{ username?: string, accountName?: string } | undefined} input
   * @param {boolean} isAdmin
   * @returns {Promise<{ account: object, apiKey: string }>}
   */
  createAccountWithRole(input = {}, isAdmin = false) {
    return this.enqueue(async () => {
      const apiKey = randomBytes(32).toString('base64url');
      const accountId = randomUUID();
      const providedUsername = typeof input?.username === 'string'
        ? input.username
        : typeof input?.accountName === 'string'
          ? input.accountName
          : null;
      const username = normalizeUsername(providedUsername);
      assertUsernameAvailable(this.accounts, username);
      const account = {
        accountId,
        username,
        keyHash: hashApiKey(apiKey),
        isAdmin: isAdmin === true,
        balance: INITIAL_VIRTUAL_BALANCE,
        assetBalance: 0,
        averagePrice: 0,
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
      logger.info('account.created', { accountId: account.accountId, username });
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

  /** @param {string} accountId */
  isAdministrator(accountId) {
    return this.accounts.get(accountId)?.isAdmin === true;
  }

  /**
   * Creates an administrator when none exists, or rotates an existing admin key.
   * Only the key hash is persisted.
   * An explicit token may be supplied by the deployment environment.
   * @param {string | undefined} apiKey
   * @returns {Promise<{ accountId: string, created: boolean, apiKey: string | null }>}
   */
  ensureAdministrator(apiKey) {
    return this.enqueue(() => this.ensureAdministratorNow(apiKey));
  }

  async ensureAdministratorNow(apiKey) {
    const suppliedToken = typeof apiKey === 'string' && apiKey.length >= 40 ? apiKey : null;
    const keyHash = suppliedToken ? hashApiKey(suppliedToken) : null;
    let account = keyHash
      ? [...this.accounts.values()].find((candidate) => candidate.keyHash === keyHash)
      : [...this.accounts.values()].find((candidate) => candidate.isSystemAdmin === true);
    let created = false;
    let changed = false;

    if (!account) {
      const generatedToken = suppliedToken || randomBytes(32).toString('base64url');
      let username = 'system_admin';
      let suffix = 1;
      while ([...this.accounts.values()].some((candidate) => candidate.username?.toLowerCase() === username)) {
        suffix += 1;
        username = `system_admin_${suffix}`;
      }
      account = {
        accountId: randomUUID(),
        username,
        keyHash: hashApiKey(generatedToken),
        isAdmin: true,
        isSystemAdmin: true,
        balance: INITIAL_VIRTUAL_BALANCE,
        assetBalance: 0,
        averagePrice: 0,
        history: [],
        createdAt: new Date().toISOString(),
      };
      this.accounts.set(account.accountId, account);
      created = true;
      apiKey = generatedToken;
    } else if (!account.isAdmin) {
      account.isAdmin = true;
      changed = true;
    }

    if (!account.isSystemAdmin) {
      account.isSystemAdmin = true;
      changed = true;
    }

    // Without an environment-provided token, create a fresh valid key at every
    // boot. This keeps the terminal value usable even if an admin already exists.
    if (!suppliedToken && !created) {
      apiKey = randomBytes(32).toString('base64url');
      account.keyHash = hashApiKey(apiKey);
      changed = true;
    }

    if (created || changed) await this.persist();
    this.recoveryAdministrator = { ...account, history: account.history.map((trade) => ({ ...trade })) };
    logger.info('admin.ready', { accountId: account.accountId, created });
    return { accountId: account.accountId, created, apiKey };
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
      username: typeof account.username === 'string' && account.username.trim()
        ? account.username
        : account.accountId,
      isAdmin: account.isAdmin === true,
      balance: account.balance,
      assetBalance: account.assetBalance,
      history: account.history.map((trade) => ({ ...trade })),
    };
  }

  /** Retorna dados seguros para a lista de contas da administração. */
  listAccountsForAdministration() {
    return [...this.accounts.values()]
      .map((account) => ({
        accountId: account.accountId,
        username: typeof account.username === 'string' && account.username.trim()
          ? account.username
          : account.accountId,
        isAdmin: account.isAdmin === true,
        balance: account.balance,
        assetBalance: account.assetBalance,
        createdAt: account.createdAt || null,
      }))
      .sort((first, second) => String(first.username).localeCompare(String(second.username), 'pt-BR'));
  }

  /**
   * Atualiza os campos administrativos permitidos de uma conta.
   * @param {string} accountId
   * @param {{ username?: string, isAdmin?: boolean }} input
   * @param {string} administratorId
   */
  updateAccountAsAdministrator(accountId, input = {}, administratorId) {
    return this.enqueue(async () => {
      const account = this.accounts.get(accountId);
      if (!account) throw Object.assign(new Error('Conta não encontrada.'), { statusCode: 404 });

      if (Object.prototype.hasOwnProperty.call(input, 'isAdmin') && typeof input.isAdmin !== 'boolean') {
        throw Object.assign(new Error('isAdmin deve ser verdadeiro ou falso.'), { statusCode: 400 });
      }

      const nextUsername = Object.prototype.hasOwnProperty.call(input, 'username')
        ? normalizeUsername(input.username)
        : account.username;
      if (nextUsername.toLowerCase() !== account.username.toLowerCase()) {
        const otherAccounts = new Map(this.accounts);
        otherAccounts.delete(accountId);
        assertUsernameAvailable(otherAccounts, nextUsername);
      }

      const nextIsAdmin = Object.prototype.hasOwnProperty.call(input, 'isAdmin') ? input.isAdmin : account.isAdmin === true;
      if (account.accountId === administratorId && !nextIsAdmin) {
        throw Object.assign(new Error('Não é possível remover seu próprio acesso administrativo.'), { statusCode: 400 });
      }
      if (account.isAdmin === true && !nextIsAdmin
        && [...this.accounts.values()].filter((candidate) => candidate.isAdmin === true).length === 1) {
        throw Object.assign(new Error('Deve existir pelo menos um administrador.'), { statusCode: 400 });
      }

      const previous = { ...account };
      account.username = nextUsername;
      account.isAdmin = nextIsAdmin;
      account.updatedAt = new Date().toISOString();
      try {
        await this.persist();
      } catch (error) {
        Object.assign(account, previous);
        throw error;
      }
      logger.info('admin.account_updated', { administratorId, accountId, isAdmin: account.isAdmin });
      return this.getAccount(accountId);
    });
  }

  /**
   * Exclui uma conta e seus dados de negociação do simulador.
   * @param {string} accountId
   * @param {string} administratorId
   */
  deleteAccountAsAdministrator(accountId, administratorId) {
    return this.enqueue(async () => {
      const account = this.accounts.get(accountId);
      if (!account) throw Object.assign(new Error('Conta não encontrada.'), { statusCode: 404 });
      if (accountId === administratorId) {
        throw Object.assign(new Error('Não é possível excluir a própria conta administrativa.'), { statusCode: 400 });
      }
      if (account.isAdmin === true && [...this.accounts.values()].filter((candidate) => candidate.isAdmin === true).length === 1) {
        throw Object.assign(new Error('Não é possível excluir o último administrador.'), { statusCode: 400 });
      }

      const previousTrades = this.recentTrades;
      this.accounts.delete(accountId);
      this.recentTrades = this.recentTrades.filter((trade) => trade.accountId !== accountId);
      try {
        await this.persist();
      } catch (error) {
        this.accounts.set(accountId, account);
        this.recentTrades = previousTrades;
        throw error;
      }
      logger.info('admin.account_deleted', { administratorId, accountId });
    });
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
        accountId: account.accountId,
        username: typeof account.username === 'string' && account.username.trim()
          ? account.username
          : account.accountId,
      };
      const accountBefore = { ...account, history: account.history };
      const historyBefore = this.history;
      const tradesBefore = this.recentTrades;
      const volumesBefore = [this.totalVolume, this.buyVolume, this.sellVolume];

      if (input.side === 'BUY') {
        const currentCost = (account.averagePrice || 0) * account.assetBalance;
        account.balance = subtractMoney(account.balance, total);
        account.assetBalance = addAsset(account.assetBalance, amount);
        account.averagePrice = account.assetBalance > 0
          ? roundMoney((currentCost + total) / account.assetBalance)
          : 0;
        this.buyVolume = addMoney(this.buyVolume, total);
      } else {
        account.balance = addMoney(account.balance, total);
        account.assetBalance = subtractAsset(account.assetBalance, amount);
        if (account.assetBalance === 0) {
          account.averagePrice = 0;
        }
        this.sellVolume = addMoney(this.sellVolume, total);
      }
      account.history = [order, ...account.history].slice(0, MAX_ACCOUNT_HISTORY);
      this.totalVolume = addMoney(this.totalVolume, total);
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
        accountId: order.accountId,
        username: order.username,
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
   * Exporta um snapshot completo do mercado para auditoria ou backup.
   * @returns {{ marketHistory: Array<object>, accounts: Array<object>, recentTrades: Array<object>, totalVolume: number, buyVolume: number, sellVolume: number, latestMarketEvent: object | null, nextMarketEventAt: string | null }}
   */
  async getBackupSnapshot() {
    const snapshot = await this.store.repository.loadFullMarketState();
    return {
      backupVersion: 2,
      exportedAt: new Date().toISOString(),
      ...snapshot,
      // Campos legados para consumidores que apenas exibiam o resumo do backup.
      recentTrades: snapshot.trades.slice(0, MAX_PUBLIC_TRADES).map((trade) => ({
        id: trade.tradeId || trade.orderId,
        side: trade.side,
        price: trade.price,
        amount: trade.quantity,
        total: trade.total,
        impactPercent: trade.impactPercent,
        accountId: trade.accountId,
        username: trade.username,
        timestamp: trade.createdAt,
      })),
      totalVolume: snapshot.marketState?.totalVolume ?? 0,
      buyVolume: snapshot.marketState?.buyVolume ?? 0,
      sellVolume: snapshot.marketState?.sellVolume ?? 0,
      latestMarketEvent: snapshot.marketState?.latestMarketEvent ?? null,
      nextMarketEventAt: snapshot.marketState?.nextMarketEventAt ?? null,
    };
  }

  /**
   * Restaura o banco de dados a partir de um snapshot ou backup em JSON.
   * Cria backup de segurança automático do estado atual antes de aplicar a alteração.
   * @param {Record<string, any>} backupData
   * @returns {Promise<{ accountsCount: number, historyTicksCount: number, tradesCount: number, currentPrice: number, safetyBackupFile: string }>}
   */
  restoreFromBackup(backupData) {
    return this.enqueue(async () => {
      if (!backupData || typeof backupData !== 'object' || Array.isArray(backupData)) {
        throw Object.assign(new Error('Formato de backup inválido: deve ser um objeto JSON.'), { statusCode: 400 });
      }

      const hasHistory = Array.isArray(backupData.marketHistory);
      const hasAccounts = Array.isArray(backupData.accounts);

      if (!hasHistory && !hasAccounts && !backupData.marketState) {
        throw Object.assign(new Error('O arquivo de backup não contém dados reconhecíveis de histórico, contas ou estado.'), { statusCode: 400 });
      }

      // Cria backup de segurança automático pré-restauração
      const currentSnapshot = await this.getBackupSnapshot();
      const backupDir = path.join(this.store.dataDir, 'backups');
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const safetyBackupPath = path.join(backupDir, `market-state.pre-restore-${timestamp}.json`);
      await writeJson(safetyBackupPath, currentSnapshot).catch(() => {});

      const completeSnapshot = [
        'accounts', 'assets', 'portfolios', 'orders', 'trades',
        'marketHistory', 'marketEvents', 'marketState',
      ].every((field) => Object.hasOwn(backupData, field));

      let snapshotToRestore = backupData;
      if (!completeSnapshot) {
        // Version 1 backups did not include all collections. Convert what they
        // contain and explicitly reset every collection they did not contain.
        if (!Array.isArray(backupData.accounts) || !Array.isArray(backupData.marketHistory) || backupData.marketHistory.length === 0) {
          throw Object.assign(new Error('Backup incompleto. Exporte um novo backup completo antes de restaurar.'), { statusCode: 400 });
        }
        const latestTick = backupData.marketHistory.at(-1);
        const trades = (Array.isArray(backupData.recentTrades) ? backupData.recentTrades : []).map((trade) => ({
          tradeId: trade.id || trade.tradeId,
          orderId: trade.id || trade.orderId || trade.tradeId,
          accountId: trade.accountId,
          username: trade.username,
          assetId: 'SIM',
          side: trade.side || trade.type,
          quantity: trade.amount ?? trade.quantity,
          price: trade.price,
          total: trade.total,
          impactPercent: trade.impactPercent || 0,
          createdAt: trade.timestamp || trade.createdAt,
        }));
        snapshotToRestore = {
          accounts: backupData.accounts.map(({ assetBalance, averagePrice, history, ...account }) => account),
          assets: [{ assetId: 'SIM', symbol: 'SIM', name: 'Ativo Simulado', currentPrice: latestTick.price, updatedAt: latestTick.updatedAt }],
          portfolios: backupData.accounts.map((account) => ({ accountId: account.accountId, assetId: 'SIM', quantity: account.assetBalance || 0, averagePrice: account.averagePrice || 0, updatedAt: account.updatedAt || latestTick.updatedAt })),
          orders: trades.map((trade) => ({ orderId: trade.orderId, accountId: trade.accountId, assetId: trade.assetId, side: trade.side, quantity: trade.quantity, price: trade.price, limitPrice: null, total: trade.total, impactPercent: trade.impactPercent, status: 'FILLED', createdAt: trade.createdAt, updatedAt: trade.createdAt })),
          trades,
          marketHistory: backupData.marketHistory.map((tick) => ({ assetId: 'SIM', ...tick })),
          marketEvents: backupData.latestMarketEvent ? [{ eventId: `ev-${Date.now()}`, assetId: 'SIM', ...backupData.latestMarketEvent, occurredAt: backupData.latestMarketEvent.occurredAt || latestTick.updatedAt }] : [],
          marketState: { assetId: 'SIM', currentPrice: latestTick.price, sequence: latestTick.sequence, totalVolume: backupData.totalVolume || 0, buyVolume: backupData.buyVolume || 0, sellVolume: backupData.sellVolume || 0, latestMarketEvent: backupData.latestMarketEvent || null, nextMarketEventAt: backupData.nextMarketEventAt || null, updatedAt: latestTick.updatedAt },
        };
      }

      await this.store.repository.replaceFullSnapshot(snapshotToRestore);
      const reloaded = await this.store.load();
      this.initialize(reloaded);
      if (this.recoveryAdministrator && ![...this.accounts.values()].some((account) => account.isSystemAdmin === true)) {
        this.accounts.set(this.recoveryAdministrator.accountId, this.recoveryAdministrator);
        await this.persist();
      }

      /*
      if (hasAccounts && hasHistory) {
        await this.store.save({
          marketHistory: backupData.marketHistory,
          accounts: backupData.accounts,
          recentTrades: Array.isArray(backupData.recentTrades) ? backupData.recentTrades : [],
          totalVolume: Number.isFinite(backupData.totalVolume) ? backupData.totalVolume : 0,
          buyVolume: Number.isFinite(backupData.buyVolume) ? backupData.buyVolume : 0,
          sellVolume: Number.isFinite(backupData.sellVolume) ? backupData.sellVolume : 0,
          latestMarketEvent: backupData.latestMarketEvent || null,
          nextMarketEventAt: backupData.nextMarketEventAt || null,
        });

        const reloaded = await this.store.load();
        this.initialize(reloaded);
      } else if (backupData.marketState && backupData.assets) {
        await this.store.repository.saveFullSnapshot(backupData);
        const reloaded = await this.store.load();
        this.initialize(reloaded);
      } else {
        throw Object.assign(new Error('Estrutura de dados não suportada para restauração.'), { statusCode: 400 });
      }
      */

      logger.info('backup.restored', {
        accountsCount: this.accounts.size,
        historyTicks: this.history.length,
        currentPrice: this.history[this.history.length - 1]?.price,
      });

      return {
        accountsCount: this.accounts.size,
        historyTicksCount: this.history.length,
        tradesCount: this.recentTrades.length,
        currentPrice: this.history[this.history.length - 1]?.price,
        safetyBackupFile: safetyBackupPath,
      };
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
export { MarketSimulator };
