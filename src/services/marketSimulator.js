// Importa funções criptográficas nativas do Node.js para geração de identificadores,
// criação de chaves de API, cálculo de hashes e comparação segura de credenciais.
import { randomBytes, randomUUID } from "node:crypto";

// Importa as constantes que definem os limites financeiros, os intervalos
// de eventos do mercado e a quantidade máxima de registros mantidos em memória.
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
} from "../config/constants.js";

// Utilitários para manipulação de caminhos e resolução de URLs de módulos.
import path from "node:path";
import { fileURLToPath } from "node:url";

// Utilitário externo responsável pela leitura do catálogo de eventos do mercado.
import { fopen } from "npm-package-nodejs-utils-lda";

// Gerenciador responsável por persistir e recuperar o estado do simulador.
import { marketStateStore } from "./stateStore.js";

// Logger centralizado para registrar operações e falhas do serviço.
import { logger } from "../utils/logger.js";

// Função utilizada para gravar arquivos JSON.
import { writeJson } from "../data/atomicJsonStore.js";

import {
  hashApiKey,
  authenticateApiKey as authenticateApiKeyService,
  isAdministrator as isAdministratorService,
} from "./authenticationService.js";

import {
  normalizeUsername,
  assertUsernameAvailable,
} from "./accountService.js";

import {
  listAccountsForAdministration as listAccountsForAdministrationService,
  validateAccountAdministrationUpdate,
  validateAccountAdministrationDeletion,
} from "./administrationService.js";

// Funções centralizadas para arredondamento e operações monetárias.
// A utilização desses métodos ajuda a reduzir inconsistências de ponto flutuante.
import {
  roundMoney,
  roundAsset,
  addMoney,
  subtractMoney,
  addAsset,
  subtractAsset,
} from "../utils/money.js";

// Resolve o caminho absoluto do catálogo de eventos a partir deste módulo.
const MARKET_EVENTS_FILE = fileURLToPath(
  new URL("../config/market-events.json", import.meta.url),
);

// Carrega os eventos que podem provocar alterações simuladas nos preços.
const MARKET_EVENTS = fopen(MARKET_EVENTS_FILE);

// Valida a estrutura do catálogo antes de permitir a inicialização do serviço.
// Um catálogo inválido interrompe a inicialização para evitar simulações
// baseadas em configurações incompletas ou inconsistentes.
if (
  !Array.isArray(MARKET_EVENTS) ||
  MARKET_EVENTS.length === 0 ||
  MARKET_EVENTS.some(
    (event) =>
      typeof event.category !== "string" ||
      typeof event.title !== "string" ||
      typeof event.description !== "string" ||
      !Number.isFinite(event.minImpact) ||
      !Number.isFinite(event.maxImpact) ||
      event.minImpact >= event.maxImpact,
  )
) {
  throw new Error(`Catálogo de eventos inválido: ${MARKET_EVENTS_FILE}`);
}

/**
 * Gera um número aleatório dentro do intervalo informado.
 *
 * O limite máximo não é incluído quando o resultado é gerado pelo Math.random.
 * Esta função serve para simulações, não para gerar segredos criptográficos.
 *
 * @param {number} minimum - Limite mínimo.
 * @param {number} maximum - Limite máximo.
 * @returns {number} Número aleatório dentro do intervalo.
 */
const randomBetween = (minimum, maximum) =>
  minimum + Math.random() * (maximum - minimum);

/**
 * Simulador de mercado com carteiras virtuais e ordens de compra e venda.
 *
 * Responsabilidades principais:
 * - Gerenciar o preço e o histórico do ativo simulado.
 * - Criar contas e autenticar chaves de API.
 * - Processar compras e vendas de forma serializada.
 * - Registrar negociações e volumes.
 * - Administrar contas e permissões.
 * - Persistir e restaurar o estado do mercado.
 */
class MarketSimulator {
  /**
   * Inicializa as estruturas de dados do simulador.
   *
   * @param {object} store - Repositório utilizado para persistência.
   */
  constructor(store = marketStateStore) {
    this.store = store;

    // Histórico inicial utilizado antes da recuperação do estado persistido.
    this.history = [
      { sequence: 0, price: 100, updatedAt: new Date().toISOString() },
    ];

    // Identificador do temporizador responsável por executar os ticks.
    this.interval = null;

    // Contas indexadas pelo identificador único.
    this.accounts = new Map();

    // Negociações mais recentes, destinadas à consulta pública.
    this.recentTrades = [];

    // Volumes acumulados de todas as operações.
    this.totalVolume = 0;
    this.buyVolume = 0;
    this.sellVolume = 0;

    // Fila que serializa operações assíncronas e evita alterações simultâneas
    // conflitantes nos saldos, no histórico e no estado persistido.
    this.operationQueue = Promise.resolve();

    // Informações sobre o evento mais recente e a próxima ocorrência prevista.
    this.latestEvent = null;
    this.nextEventAt = null;
  }

  /**
   * Restaura os dados do mercado a partir do estado carregado do repositório.
   *
   * Os registros são filtrados para descartar entradas com formatos básicos
   * inválidos antes de serem utilizados pelo simulador.
   *
   * @param {Record<string, unknown>} state - Estado recuperado do armazenamento.
   * @returns {void}
   */
  initialize(state) {
    // Recupera o histórico de preços e mantém apenas os ticks mais recentes.
    if (Array.isArray(state.marketHistory)) {
      const savedHistory = state.marketHistory.filter(
        (tick) =>
          Number.isInteger(tick.sequence) &&
          Number.isFinite(tick.price) &&
          tick.price > 0 &&
          typeof tick.updatedAt === "string",
      );

      if (savedHistory.length > 0) this.history = savedHistory.slice(-50);
    }

    // Recupera as contas, verificando os campos essenciais e o formato do hash.
    if (Array.isArray(state.accounts)) {
      this.accounts = new Map(
        state.accounts
          .filter(
            (account) =>
              typeof account.accountId === "string" &&
              typeof account.keyHash === "string" &&
              /^[a-f0-9]{64}$/.test(account.keyHash) &&
              Number.isFinite(account.balance) &&
              account.balance >= 0 &&
              Number.isFinite(account.assetBalance) &&
              account.assetBalance >= 0,
          )
          .map((account) => {
            // Mantém um identificador legível mesmo em registros antigos.
            const username =
              typeof account.username === "string" && account.username.trim()
                ? account.username.trim()
                : account.accountId;

            return [
              account.accountId,
              {
                ...account,
                username,

                // Garante valores padrão para campos ausentes em registros antigos.
                averagePrice: Number.isFinite(account.averagePrice)
                  ? account.averagePrice
                  : 0,

                // Limita o tamanho do histórico individual de cada conta.
                history: Array.isArray(account.history)
                  ? account.history.slice(0, MAX_ACCOUNT_HISTORY)
                  : [],
              },
            ];
          }),
      );
    }

    // Recupera as negociações públicas e os volumes acumulados.
    this.recentTrades = Array.isArray(state.recentTrades)
      ? state.recentTrades.slice(0, MAX_PUBLIC_TRADES)
      : [];

    this.totalVolume = Number.isFinite(state.totalVolume)
      ? state.totalVolume
      : 0;

    this.buyVolume = Number.isFinite(state.buyVolume) ? state.buyVolume : 0;
    this.sellVolume = Number.isFinite(state.sellVolume) ? state.sellVolume : 0;

    // Restaura o evento mais recente quando há um título válido.
    this.latestEvent =
      state.latestMarketEvent &&
      typeof state.latestMarketEvent.title === "string"
        ? state.latestMarketEvent
        : null;

    // Só aceita uma data de próximo evento que possa ser interpretada.
    this.nextEventAt =
      typeof state.nextMarketEventAt === "string" &&
      Number.isFinite(Date.parse(state.nextMarketEventAt))
        ? state.nextMarketEventAt
        : null;
  }

  /**
   * Processa um possível evento de mercado e salva as alterações.
   *
   * O evento pode modificar o preço do ativo de acordo com um impacto
   * percentual aleatório definido pelo catálogo de eventos.
   *
   * @returns {Promise<void>}
   */
  tick() {
    // A fila impede que este processamento concorra com outras mutações.
    return this.enqueue(async () => {
      // Agenda um evento caso ainda não exista uma data prevista.
      if (!this.nextEventAt) this.scheduleNextEvent();

      // Não altera o mercado antes do horário programado.
      if (Date.now() < Date.parse(this.nextEventAt)) return;

      const previous = this.history[this.history.length - 1];

      // Seleciona aleatoriamente um evento válido do catálogo.
      const template =
        MARKET_EVENTS[Math.floor(Math.random() * MARKET_EVENTS.length)];

      // Define a variação percentual dentro dos limites do evento.
      const changePercent = randomBetween(
        template.minImpact,
        template.maxImpact,
      );

      // Converte a variação logarítmica aplicada ao preço em variação percentual
      // efetiva, para que o registro reflita o impacto composto real.
      const actualImpactPercent = (Math.exp(changePercent / 100) - 1) * 100;

      // Aplica a variação e impede que o preço fique abaixo de US$ 0,01.
      const price = Number(
        Math.max(0.01, previous.price * Math.exp(changePercent / 100)).toFixed(
          2,
        ),
      );

      const occurredAt = new Date().toISOString();

      // Acrescenta o novo preço ao histórico, incrementando a sequência.
      this.history.push({
        sequence: previous.sequence + 1,
        price,
        updatedAt: occurredAt,
      });

      // Mantém apenas os 50 ticks mais recentes.
      if (this.history.length > 50) this.history.shift();

      // Registra os detalhes do evento aplicado.
      this.latestEvent = {
        category: template.category,
        title: template.title,
        description: template.description,
        impactPercent: Number(actualImpactPercent.toFixed(4)),
        occurredAt,
      };

      // Agenda a próxima alteração independente do mercado.
      this.scheduleNextEvent();

      // Registra informações operacionais sem incluir segredos de autenticação.
      logger.info("market.event_applied", {
        category: template.category,
        title: template.title,
        previousPrice: previous.price,
        currentPrice: price,
        impactPercent: Number(actualImpactPercent.toFixed(4)),
        sequence: previous.sequence + 1,
        nextEventAt: this.nextEventAt,
      });

      // Persiste o estado após atualizar o preço e os metadados do evento.
      await this.persist();
    });
  }

  /**
   * Agenda o próximo evento de mercado dentro da janela configurada.
   *
   * @returns {void}
   */
  scheduleNextEvent() {
    const delay = randomBetween(
      MARKET_EVENT_MIN_INTERVAL_MS,
      MARKET_EVENT_MAX_INTERVAL_MS,
    );

    this.nextEventAt = new Date(Date.now() + delay).toISOString();
  }

  /**
   * Inicia o temporizador que verifica periodicamente a ocorrência de eventos.
   *
   * @returns {boolean} true se iniciou; false se já estava em execução.
   */
  start() {
    // Evita criar múltiplos temporizadores para a mesma instância.
    if (this.interval) return false;

    if (!this.nextEventAt) this.scheduleNextEvent();

    // A verificação é periódica; o evento só ocorre quando chega o horário
    // registrado em nextEventAt.
    this.interval = setInterval(() => {
      this.tick().catch((error) =>
        logger.error("market.tick_failed", { message: error.message }),
      );
    }, TICKER_INTERVAL_MS);

    logger.info("market.ticker_started", {
      tickIntervalMs: TICKER_INTERVAL_MS,
      nextEventAt: this.nextEventAt,
    });

    return true;
  }

  /**
   * Coloca uma operação na fila de execução sequencial.
   *
   * Cada operação começa depois que a anterior termina. Uma falha não bloqueia
   * permanentemente a fila, embora continue sendo propagada a quem solicitou
   * a operação original.
   *
   * @param {() => Promise<unknown>} operation - Operação assíncrona.
   * @returns {Promise<unknown>} Resultado da operação.
   */
  enqueue(operation) {
    const result = this.operationQueue.then(operation);

    // Recupera a fila para permitir a execução de tarefas posteriores,
    // sem ocultar o erro da Promise retornada ao solicitante atual.
    this.operationQueue = result.catch(() => {});

    return result;
  }

  /**
   * Salva o estado atual do simulador.
   *
   * @returns {Promise<unknown>} Resultado da persistência.
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
   * Cria uma carteira virtual para um usuário comum.
   *
   * @param {{ username?: string, accountName?: string } | undefined} input
   * @returns {Promise<{ account: object, apiKey: string }>}
   */
  createAccount(input = {}) {
    // O cadastro público sempre cria contas sem privilégios administrativos.
    return this.createAccountWithRole(input, false);
  }

  /**
   * Cria uma conta com o papel definido pelo sistema chamador.
   *
   * A chave secreta é retornada uma única vez, enquanto somente seu hash
   * é mantido no objeto persistido.
   *
   * @param {{ username?: string, accountName?: string } | undefined} input
   * @param {boolean} isAdmin - Define se a conta será administradora.
   * @returns {Promise<{ account: object, apiKey: string }>}
   */
  createAccountWithRole(input = {}, isAdmin = false) {
    return this.enqueue(async () => {
      // Gera uma credencial aleatória e um identificador independente da conta.
      const apiKey = randomBytes(32).toString("base64url");
      const accountId = randomUUID();

      // Aceita username como campo preferencial e accountName como alternativa.
      const providedUsername =
        typeof input?.username === "string"
          ? input.username
          : typeof input?.accountName === "string"
            ? input.accountName
            : null;

      const username = normalizeUsername(providedUsername);

      // Impede a criação de duas contas com o mesmo nome, ignorando caixa.
      assertUsernameAvailable(this.accounts, username);

      const account = {
        accountId,
        username,

        // Nunca persiste a chave original em texto puro.
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
        // Desfaz a criação em memória se a gravação falhar.
        this.accounts.delete(account.accountId);
        throw error;
      }

      logger.info("account.created", {
        accountId: account.accountId,
        username,
      });

      // Retorna a visão pública da conta e a chave que deverá ser guardada
      // pelo usuário, pois ela não poderá ser recuperada a partir do hash.
      return { account: this.getAccount(account.accountId), apiKey };
    });
  }

  /**
   * Substitui a chave de API de uma conta.
   *
   * A chave anterior deixa de autenticar quando a nova é persistida.
   *
   * @param {string} accountId - Identificador da conta.
   * @returns {Promise<{ account: object, apiKey: string }>}
   */
  rotateApiKey(accountId) {
    return this.enqueue(async () => {
      const account = this.accounts.get(accountId);

      if (!account)
        throw Object.assign(new Error("Conta não encontrada."), {
          statusCode: 404,
        });

      // Guarda o hash anterior para permitir reversão caso a gravação falhe.
      const previousHash = account.keyHash;
      const apiKey = randomBytes(32).toString("base64url");

      account.keyHash = hashApiKey(apiKey);

      try {
        await this.persist();
      } catch (error) {
        account.keyHash = previousHash;
        throw error;
      }

      logger.info("account.api_key_rotated", { accountId });

      return { account: this.getAccount(accountId), apiKey };
    });
  }

  /**
   * Autentica uma chave de API e identifica a conta correspondente.
   *
   * @param {string} apiKey - Chave apresentada na requisição.
   * @returns {string | null} ID da conta autenticada ou null.
   */
  authenticateApiKey(apiKey) {
    return authenticateApiKeyService(this.accounts, apiKey);
  }

  /**
   * Verifica se uma conta possui privilégios administrativos.
   *
   * @param {string} accountId - ID da conta.
   * @returns {boolean} Indica se a conta é administradora.
   */
  isAdministrator(accountId) {
    return isAdministratorService(this.accounts, accountId);
  }

  /**
   * Garante a existência de uma conta administrativa do sistema.
   *
   * O método público serializa a operação para evitar que chamadas simultâneas
   * criem ou alterem a conta administrativa ao mesmo tempo.
   *
   * @param {string | undefined} apiKey - Chave opcional fornecida pelo ambiente.
   * @returns {Promise<{ accountId: string, created: boolean, apiKey: string | null }>}
   */
  ensureAdministrator(apiKey) {
    return this.enqueue(() => this.ensureAdministratorNow(apiKey));
  }

  /**
   * Cria ou recupera a conta administrativa e prepara sua chave de acesso.
   *
   * Quando não existe uma chave fornecida pelo ambiente, uma nova credencial
   * pode ser gerada durante a inicialização.
   *
   * @param {string | undefined} apiKey - Credencial opcional de implantação.
   * @returns {Promise<{ accountId: string, created: boolean, apiKey: string | null }>}
   */
  async ensureAdministratorNow(apiKey) {
    // Só considera como credencial fornecida um valor com tamanho mínimo.
    const suppliedToken =
      typeof apiKey === "string" && apiKey.length >= 40 ? apiKey : null;

    const keyHash = suppliedToken ? hashApiKey(suppliedToken) : null;

    // Primeiro procura uma conta que corresponda à chave configurada.
    // Sem chave configurada, procura uma conta administrativa do sistema.
    let account = keyHash
      ? [...this.accounts.values()].find(
          (candidate) => candidate.keyHash === keyHash,
        )
      : [...this.accounts.values()].find(
          (candidate) => candidate.isSystemAdmin === true,
        );

    let created = false;
    let changed = false;

    if (!account) {
      // Reutiliza a chave configurada ou gera uma nova chave aleatória.
      const generatedToken =
        suppliedToken || randomBytes(32).toString("base64url");

      // Evita conflitos com nomes de usuários já cadastrados.
      let username = "system_admin";
      let suffix = 1;

      while (
        [...this.accounts.values()].some(
          (candidate) => candidate.username?.toLowerCase() === username,
        )
      ) {
        suffix += 1;
        username = `system_admin_${suffix}`;
      }

      // Cria a conta administrativa com saldo virtual inicial.
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
      // Corrige o papel caso a conta localizada ainda não seja administradora.
      account.isAdmin = true;
      changed = true;
    }

    // Marca a conta como administradora gerenciada pelo sistema.
    if (!account.isSystemAdmin) {
      account.isSystemAdmin = true;
      changed = true;
    }

    // Sem token configurado externamente, gera uma chave válida durante
    // a inicialização, inclusive quando a conta já existia.
    if (!suppliedToken && !created) {
      apiKey = randomBytes(32).toString("base64url");
      account.keyHash = hashApiKey(apiKey);
      changed = true;
    }

    // Evita gravações desnecessárias quando nenhum dado foi alterado.
    if (created || changed) await this.persist();

    // Guarda uma cópia em memória para permitir recuperar a conta administrativa
    // caso uma restauração de backup remova o registro do sistema.
    this.recoveryAdministrator = {
      ...account,
      history: account.history.map((trade) => ({ ...trade })),
    };

    logger.info("admin.ready", { accountId: account.accountId, created });

    return { accountId: account.accountId, created, apiKey };
  }

  /**
   * Retorna os dados públicos de uma conta.
   *
   * O hash da chave de API e outros campos internos não são incluídos na resposta.
   *
   * @param {string} accountId - ID da conta.
   * @returns {{ accountId: string, balance: number, assetBalance: number, history: object[] } | null}
   */
  getAccount(accountId) {
    const account = this.accounts.get(accountId);
    if (!account) return null;

    return {
      accountId: account.accountId,
      username:
        typeof account.username === "string" && account.username.trim()
          ? account.username
          : account.accountId,
      isAdmin: account.isAdmin === true,
      balance: account.balance,
      assetBalance: account.assetBalance,

      // Copia os registros para evitar expor diretamente o array interno.
      history: account.history.map((trade) => ({ ...trade })),
    };
  }

  /**
   * Lista as contas disponíveis na interface administrativa.
   *
   * @returns {Array<object>} Contas sem hashes de autenticação.
   */
  listAccountsForAdministration() {
    return listAccountsForAdministrationService(this.accounts);
  }

  /**
   * Atualiza o nome e/ou as permissões de uma conta pela administração.
   *
   * @param {string} accountId - Conta que será modificada.
   * @param {{ username?: string, isAdmin?: boolean }} input - Alterações.
   * @param {string} administratorId - Administrador solicitante.
   * @returns {Promise<object>} Dados públicos atualizados.
   */
  updateAccountAsAdministrator(accountId, input = {}, administratorId) {
    return this.enqueue(async () => {
      const account = this.accounts.get(accountId);

      const { username, isAdmin } = validateAccountAdministrationUpdate(
        this.accounts,
        accountId,
        input,
        administratorId,
      );

      const previous = { ...account };

      account.username = username;
      account.isAdmin = isAdmin;
      account.updatedAt = new Date().toISOString();

      try {
        await this.persist();
      } catch (error) {
        Object.assign(account, previous);
        throw error;
      }

      logger.info("admin.account_updated", {
        administratorId,
        accountId,
        isAdmin: account.isAdmin,
      });

      return this.getAccount(accountId);
    });
  }

  /**
   * Exclui uma conta e suas negociações públicas associadas.
   *
   * @param {string} accountId - Conta a excluir.
   * @param {string} administratorId - Administrador solicitante.
   * @returns {Promise<void>}
   */
  deleteAccountAsAdministrator(accountId, administratorId) {
    return this.enqueue(async () => {
      const account = validateAccountAdministrationDeletion(
        this.accounts,
        accountId,
        administratorId,
      );

      const previousTrades = this.recentTrades;

      this.accounts.delete(accountId);

      this.recentTrades = this.recentTrades.filter(
        (trade) => trade.accountId !== accountId,
      );

      try {
        await this.persist();
      } catch (error) {
        this.accounts.set(accountId, account);
        this.recentTrades = previousTrades;
        throw error;
      }

      logger.info("admin.account_deleted", {
        administratorId,
        accountId,
      });
    });
  }

  /**
   * Executa uma ordem simulada de compra ou venda.
   *
   * BUY:
   * - Recebe o valor monetário em quoteAmount.
   * - Deduz o saldo em USD e acrescenta unidades do ativo.
   *
   * SELL:
   * - Recebe a quantidade do ativo em assetAmount.
   * - Deduz o ativo e acrescenta o valor monetário ao saldo.
   *
   * As operações atualizam o preço global, o histórico, os volumes e as
   * negociações públicas. Tudo é executado dentro da fila de operações.
   *
   * @param {string} accountId - Conta que executará a ordem.
   * @param {{ side: string, quoteAmount?: number, assetAmount?: number }} input
   * @returns {Promise<{ order: object, account: object, market: object }>}
   */
  placeOrder(accountId, input) {
    return this.enqueue(async () => {
      const account = this.accounts.get(accountId);

      if (!account)
        throw Object.assign(new Error("Conta não encontrada."), {
          statusCode: 404,
        });

      // Utiliza o último preço registrado como referência para a negociação.
      const current = this.history[this.history.length - 1];

      let amount;
      let total;

      if (input?.side === "BUY") {
        // Na compra, o cliente informa quanto deseja gastar em moeda de cotação.
        const quoteAmount = Number(input.quoteAmount);

        if (!Number.isFinite(quoteAmount) || quoteAmount <= 0) {
          throw Object.assign(
            new Error("Informe quoteAmount maior que zero para compra."),
            { statusCode: 400 },
          );
        }

        // Limita o valor financeiro máximo de uma única ordem.
        if (quoteAmount > MAX_ORDER_NOTIONAL_USD) {
          throw Object.assign(
            new Error(`O limite por ordem é US$ ${MAX_ORDER_NOTIONAL_USD}.`),
            { statusCode: 400 },
          );
        }

        total = roundMoney(quoteAmount);

        // Impede que a carteira gaste mais dinheiro do que possui.
        if (total > account.balance) {
          throw Object.assign(new Error("Saldo virtual insuficiente."), {
            statusCode: 400,
          });
        }

        // Calcula a quantidade do ativo comprada pelo valor informado.
        amount = roundAsset(total / current.price);
      } else if (input?.side === "SELL") {
        // Na venda, o cliente informa a quantidade de ativo a liquidar.
        amount = Number(input.assetAmount);

        if (!Number.isFinite(amount) || amount <= 0) {
          throw Object.assign(
            new Error("Informe assetAmount maior que zero para venda."),
            { statusCode: 400 },
          );
        }

        amount = roundAsset(amount);

        // Não permite vender mais unidades do que a conta possui.
        if (amount > account.assetBalance) {
          throw Object.assign(new Error("Saldo de ativo insuficiente."), {
            statusCode: 400,
          });
        }

        // Calcula o valor monetário bruto da venda pelo preço atual.
        total = roundMoney(amount * current.price);

        if (total > MAX_ORDER_NOTIONAL_USD) {
          throw Object.assign(
            new Error(`O limite por ordem é US$ ${MAX_ORDER_NOTIONAL_USD}.`),
            { statusCode: 400 },
          );
        }
      } else {
        // Rejeita operações que não sejam explicitamente compra ou venda.
        throw Object.assign(new Error("side deve ser BUY ou SELL."), {
          statusCode: 400,
        });
      }

      // Rejeita ordens que desapareçam após os arredondamentos financeiros.
      if (amount <= 0 || total <= 0) {
        throw Object.assign(
          new Error("A ordem é menor que a precisão mínima permitida."),
          { statusCode: 400 },
        );
      }

      // Estima o impacto da ordem sobre o preço em função do valor negociado
      // e da liquidez de referência configurada para a simulação.
      const notional = total;
      const impactPercent = Math.min(
        MAX_ORDER_IMPACT_PERCENT,
        (notional / REFERENCE_LIQUIDITY_USD) * MAX_ORDER_IMPACT_PERCENT,
      );

      // Compras aumentam o preço; vendas reduzem o preço.
      const signedImpact =
        input.side === "BUY" ? impactPercent : -impactPercent;

      const updatedPrice = Number(
        Math.max(0.01, current.price * (1 + signedImpact / 100)).toFixed(2),
      );

      const timestamp = new Date().toISOString();

      // Monta o registro da ordem executada.
      const order = {
        id: randomUUID(),
        timestamp,
        type: input.side,
        price: current.price,
        amount,
        total,
        impactPercent: Number(signedImpact.toFixed(4)),
        accountId: account.accountId,
        username:
          typeof account.username === "string" && account.username.trim()
            ? account.username
            : account.accountId,
      };

      // Guarda referências e valores anteriores para rollback caso o salvamento
      // falhe depois de as estruturas em memória terem sido alteradas.
      const accountBefore = { ...account, history: account.history };
      const historyBefore = this.history;
      const tradesBefore = this.recentTrades;
      const volumesBefore = [this.totalVolume, this.buyVolume, this.sellVolume];

      if (input.side === "BUY") {
        // Calcula o custo histórico da posição antes da nova compra.
        const currentCost = (account.averagePrice || 0) * account.assetBalance;

        // Atualiza o saldo monetário e a quantidade do ativo.
        account.balance = subtractMoney(account.balance, total);
        account.assetBalance = addAsset(account.assetBalance, amount);

        // Recalcula o preço médio ponderado da posição comprada.
        account.averagePrice =
          account.assetBalance > 0
            ? roundMoney((currentCost + total) / account.assetBalance)
            : 0;

        this.buyVolume = addMoney(this.buyVolume, total);
      } else {
        // Na venda, o valor recebido volta ao saldo monetário.
        account.balance = addMoney(account.balance, total);
        account.assetBalance = subtractAsset(account.assetBalance, amount);

        // Zera o preço médio quando toda a posição é liquidada.
        if (account.assetBalance === 0) {
          account.averagePrice = 0;
        }

        this.sellVolume = addMoney(this.sellVolume, total);
      }

      // Mantém as operações mais recentes no histórico individual da conta.
      account.history = [order, ...account.history].slice(
        0,
        MAX_ACCOUNT_HISTORY,
      );

      // Atualiza o volume total negociado.
      this.totalVolume = addMoney(this.totalVolume, total);

      // Registra o novo preço e limita o histórico a 50 ticks.
      this.history = [
        ...this.history,
        {
          sequence: current.sequence + 1,
          price: updatedPrice,
          updatedAt: timestamp,
        },
      ].slice(-50);

      // Publica um resumo da ordem sem expor informações de autenticação.
      this.recentTrades = [
        {
          id: order.id,
          side: order.type,
          price: order.price,
          amount: order.amount,
          total: order.total,
          impactPercent: order.impactPercent,
          accountId: order.accountId,
          username: order.username,
          timestamp,
        },
        ...this.recentTrades,
      ].slice(0, MAX_PUBLIC_TRADES);

      try {
        // Persiste conjuntamente os saldos, o histórico, os volumes e as ordens.
        await this.persist();
      } catch (error) {
        // Restaura os dados anteriores se a persistência não for concluída.
        Object.assign(account, accountBefore);
        this.history = historyBefore;
        this.recentTrades = tradesBefore;
        [this.totalVolume, this.buyVolume, this.sellVolume] = volumesBefore;
        throw error;
      }

      logger.info("order.executed", {
        accountId,
        orderId: order.id,
        side: input.side,
        amount,
        total,
        previousPrice: current.price,
        currentPrice: updatedPrice,
        impactPercent: Number(signedImpact.toFixed(4)),
      });

      // Retorna os dados públicos da ordem, da carteira e do mercado.
      return {
        order,
        account: this.getAccount(accountId),
        market: this.getStatus(),
      };
    });
  }

  /**
   * Exporta uma cópia do estado completo do mercado para backup ou auditoria.
   *
   * Também gera campos legados para manter compatibilidade com consumidores
   * que ainda esperam o formato antigo do resumo de negociações.
   *
   * @returns {Promise<object>} Snapshot exportável do mercado.
   */
  async getBackupSnapshot() {
    const snapshot = await this.store.repository.loadFullMarketState();

    return {
      backupVersion: 2,
      exportedAt: new Date().toISOString(),
      ...snapshot,

      // Converte os registros de negociação para o formato legado.
      recentTrades: snapshot.trades
        .slice(0, MAX_PUBLIC_TRADES)
        .map((trade) => ({
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

      // Mantém os campos de volume e evento disponíveis para clientes antigos.
      totalVolume: snapshot.marketState?.totalVolume ?? 0,
      buyVolume: snapshot.marketState?.buyVolume ?? 0,
      sellVolume: snapshot.marketState?.sellVolume ?? 0,
      latestMarketEvent: snapshot.marketState?.latestMarketEvent ?? null,
      nextMarketEventAt: snapshot.marketState?.nextMarketEventAt ?? null,
    };
  }

  /**
   * Restaura o estado do mercado a partir de um objeto de backup.
   *
   * Antes da restauração, tenta criar um backup de segurança do estado atual.
   * Backups antigos podem ser convertidos para o formato completo esperado
   * pelo repositório.
   *
   * @param {Record<string, any>} backupData - Conteúdo JSON do backup.
   * @returns {Promise<{ accountsCount: number, historyTicksCount: number, tradesCount: number, currentPrice: number, safetyBackupFile: string }>}
   */
  restoreFromBackup(backupData) {
    // Serializa a restauração em relação às demais operações do simulador.
    return this.enqueue(async () => {
      // A raiz do backup precisa ser um objeto JSON, não um array ou null.
      if (
        !backupData ||
        typeof backupData !== "object" ||
        Array.isArray(backupData)
      ) {
        throw Object.assign(
          new Error("Formato de backup inválido: deve ser um objeto JSON."),
          { statusCode: 400 },
        );
      }

      const hasHistory = Array.isArray(backupData.marketHistory);
      const hasAccounts = Array.isArray(backupData.accounts);

      // Exige pelo menos uma estrutura reconhecida para continuar.
      if (!hasHistory && !hasAccounts && !backupData.marketState) {
        throw Object.assign(
          new Error(
            "O arquivo de backup não contém dados reconhecíveis de histórico, contas ou estado.",
          ),
          { statusCode: 400 },
        );
      }

      // Cria um backup de segurança do estado atual antes da substituição.
      // A falha dessa gravação é ignorada pelo comportamento original do código.
      const currentSnapshot = await this.getBackupSnapshot();
      const backupDir = path.join(this.store.dataDir, "backups");
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const safetyBackupPath = path.join(
        backupDir,
        `market-state.pre-restore-${timestamp}.json`,
      );

      await writeJson(safetyBackupPath, currentSnapshot).catch(() => {});

      // Identifica backups que contêm todas as coleções exigidas pelo formato
      // completo utilizado pelo repositório.
      const completeSnapshot = [
        "accounts",
        "assets",
        "portfolios",
        "orders",
        "trades",
        "marketHistory",
        "marketEvents",
        "marketState",
      ].every((field) => Object.hasOwn(backupData, field));

      let snapshotToRestore = backupData;

      if (!completeSnapshot) {
        // Backups antigos não continham todas as coleções.
        // Para convertê-los, são necessários contas e histórico não vazio.
        if (
          !Array.isArray(backupData.accounts) ||
          !Array.isArray(backupData.marketHistory) ||
          backupData.marketHistory.length === 0
        ) {
          throw Object.assign(
            new Error(
              "Backup incompleto. Exporte um novo backup completo antes de restaurar.",
            ),
            { statusCode: 400 },
          );
        }

        // Usa o último tick como referência para o preço atual.
        const latestTick = backupData.marketHistory.at(-1);

        // Converte negociações antigas para o modelo de dados atual.
        const trades = (
          Array.isArray(backupData.recentTrades) ? backupData.recentTrades : []
        ).map((trade) => ({
          tradeId: trade.id || trade.tradeId,
          orderId: trade.id || trade.orderId || trade.tradeId,
          accountId: trade.accountId,
          username: trade.username,
          assetId: "SIM",
          side: trade.side || trade.type,
          quantity: trade.amount ?? trade.quantity,
          price: trade.price,
          total: trade.total,
          impactPercent: trade.impactPercent || 0,
          createdAt: trade.timestamp || trade.createdAt,
        }));

        // Monta um snapshot compatível com o formato completo do repositório.
        // As coleções ausentes no backup antigo são inicializadas explicitamente.
        snapshotToRestore = {
          accounts: backupData.accounts.map(
            ({ assetBalance, averagePrice, history, ...account }) => account,
          ),

          // O formato legado utiliza um único ativo simulado, identificado por SIM.
          assets: [
            {
              assetId: "SIM",
              symbol: "SIM",
              name: "Ativo Simulado",
              currentPrice: latestTick.price,
              updatedAt: latestTick.updatedAt,
            },
          ],

          // Transforma os saldos de ativo das contas em posições de carteira.
          portfolios: backupData.accounts.map((account) => ({
            accountId: account.accountId,
            assetId: "SIM",
            quantity: account.assetBalance || 0,
            averagePrice: account.averagePrice || 0,
            updatedAt: account.updatedAt || latestTick.updatedAt,
          })),

          // Reconstrói as ordens a partir das negociações disponíveis.
          orders: trades.map((trade) => ({
            orderId: trade.orderId,
            accountId: trade.accountId,
            assetId: trade.assetId,
            side: trade.side,
            quantity: trade.quantity,
            price: trade.price,
            limitPrice: null,
            total: trade.total,
            impactPercent: trade.impactPercent,
            status: "FILLED",
            createdAt: trade.createdAt,
            updatedAt: trade.createdAt,
          })),

          trades,

          // Acrescenta o identificador do ativo aos ticks antigos.
          marketHistory: backupData.marketHistory.map((tick) => ({
            assetId: "SIM",
            ...tick,
          })),

          // Reconstitui o catálogo de eventos usando o último evento conhecido.
          marketEvents: backupData.latestMarketEvent
            ? [
                {
                  eventId: `ev-${Date.now()}`,
                  assetId: "SIM",
                  ...backupData.latestMarketEvent,
                  occurredAt:
                    backupData.latestMarketEvent.occurredAt ||
                    latestTick.updatedAt,
                },
              ]
            : [],

          // Reconstrói o resumo do estado do mercado.
          marketState: {
            assetId: "SIM",
            currentPrice: latestTick.price,
            sequence: latestTick.sequence,
            totalVolume: backupData.totalVolume || 0,
            buyVolume: backupData.buyVolume || 0,
            sellVolume: backupData.sellVolume || 0,
            latestMarketEvent: backupData.latestMarketEvent || null,
            nextMarketEventAt: backupData.nextMarketEventAt || null,
            updatedAt: latestTick.updatedAt,
          },
        };
      }

      // Substitui o snapshot completo no repositório.
      await this.store.repository.replaceFullSnapshot(snapshotToRestore);

      // Recarrega os dados persistidos para sincronizar o estado em memória.
      const reloaded = await this.store.load();
      this.initialize(reloaded);

      // Se o backup não contiver a conta administrativa do sistema, tenta
      // restaurar a cópia de recuperação mantida durante a inicialização.
      if (
        this.recoveryAdministrator &&
        ![...this.accounts.values()].some(
          (account) => account.isSystemAdmin === true,
        )
      ) {
        this.accounts.set(
          this.recoveryAdministrator.accountId,
          this.recoveryAdministrator,
        );

        await this.persist();
      }

      /*
       * Implementação antiga de restauração mantida como referência.
       * Este bloco não é executado porque está dentro de um comentário.
       *
       * A lógica anterior salvava diretamente o estado legado ou completo,
       * enquanto a implementação atual normaliza os dados e utiliza
       * replaceFullSnapshot para substituir as coleções.
       */

      logger.info("backup.restored", {
        accountsCount: this.accounts.size,
        historyTicks: this.history.length,
        currentPrice: this.history[this.history.length - 1]?.price,
      });

      // Retorna um resumo para a interface administrativa ou para a API.
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
   * Retorna o estado público atual do mercado.
   *
   * Inclui o preço mais recente, o histórico limitado, as negociações públicas,
   * os volumes acumulados e os metadados do evento de mercado.
   *
   * @returns {{
   *   currentPrice: number,
   *   sequence: number,
   *   updatedAt: string,
   *   history: Array<{ sequence: number, price: number, updatedAt: string }>,
   *   recentTrades: Array<object>,
   *   volume: { total: number, buys: number, sells: number },
   *   latestEvent: object | null,
   *   nextEventAt: string | null
   * }}
   */
  getStatus() {
    // O último elemento representa o preço vigente do simulador.
    const current = this.history[this.history.length - 1];

    return {
      currentPrice: current.price,
      sequence: current.sequence,
      updatedAt: current.updatedAt,

      // Retorna cópias para não expor diretamente os arrays internos.
      history: this.history.map((tick) => ({ ...tick })),
      recentTrades: this.recentTrades.map((trade) => ({ ...trade })),

      // Agrupa os volumes para facilitar o consumo pela interface.
      volume: {
        total: this.totalVolume,
        buys: this.buyVolume,
        sells: this.sellVolume,
      },

      // Retorna uma cópia do último evento, quando disponível.
      latestEvent: this.latestEvent ? { ...this.latestEvent } : null,
      nextEventAt: this.nextEventAt,
    };
  }
}

// Exporta a instância compartilhada utilizada pela aplicação.
export const marketSimulator = new MarketSimulator();

// Exporta a classe para testes automatizados ou criação de instâncias isoladas.
export { MarketSimulator };
