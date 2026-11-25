import { hostname } from 'node:os';
import { createRequire } from 'node:module';
import { logger } from '../utils/logger.js';
import { MAX_HTTP_TRANSFER_BYTES } from '../utils/httpLimits.js';
import { sanitizeNodeId } from './clusterRegistry.js';

const DEFAULT_SYNC_TIMEOUT_MS = Number(process.env.MARKET_SYNC_TIMEOUT_MS || 30000);
const DEFAULT_RETRY_INTERVAL_MS = Number(process.env.MARKET_SYNC_RETRY_INTERVAL_MS || 5000);
const DEFAULT_INITIAL_RETRIES = Number(process.env.MARKET_SYNC_INITIAL_RETRIES || 0);
const require = createRequire(import.meta.url);
const packageInfo = require('../../package.json');

function getErrorDetails(error) {
  return {
    message: error.message,
    name: error.name,
    code: error.code,
  };
}

function getContentLength(value) {
  if (value === null || value === undefined || value === '') return null;
  const length = Number(value);
  return Number.isSafeInteger(length) && length >= 0 ? length : null;
}

async function readJsonResponse(response) {
  const declaredLength = getContentLength(response.headers.get('content-length'));
  if (declaredLength > MAX_HTTP_TRANSFER_BYTES) {
    await response.body?.cancel();
    throw Object.assign(
      new Error('A resposta do master excede o limite máximo de 10 MB.'),
      { statusCode: 413 },
    );
  }

  if (!response.body) return { body: {}, responseBytes: 0 };

  const reader = response.body.getReader();
  const chunks = [];
  let responseBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    responseBytes += value.byteLength;
    if (responseBytes > MAX_HTTP_TRANSFER_BYTES) {
      await reader.cancel();
      throw Object.assign(
        new Error('A resposta do master excede o limite máximo de 10 MB.'),
        { statusCode: 413 },
      );
    }
    chunks.push(Buffer.from(value));
  }

  if (responseBytes === 0) return { body: {}, responseBytes };
  const body = JSON.parse(Buffer.concat(chunks, responseBytes).toString('utf8'));
  return { body, responseBytes };
}

export class MarketSyncService {
  constructor({
    role = process.env.MARKET_SYNC_ROLE || 'standalone',
    syncMode = process.env.MARKET_NODE_SYNC_MODE || 'bidirectional',
    masterUrl = process.env.MARKET_SYNC_MASTER_URL || '',
    token = process.env.MARKET_SYNC_TOKEN || '',
    nodeId = process.env.MARKET_NODE_ID || hostname(),
    nodeVersion = packageInfo.version,
    nodePort = Number(process.env.MARKET_PORT || 3001),
    nodePublicUrl = process.env.MARKET_NODE_PUBLIC_URL || '',
    store,
    simulator,
    intervalMs = Number(process.env.MARKET_SYNC_INTERVAL_SECONDS || 5) * 1000,
    timeoutMs = DEFAULT_SYNC_TIMEOUT_MS,
    initialPullRetryIntervalMs = DEFAULT_RETRY_INTERVAL_MS,
    initialPullMaxRetries = DEFAULT_INITIAL_RETRIES,
    fetchImpl = fetch,
  }) {
    this.role = role;
    this.syncMode = syncMode;
    this.masterUrl = masterUrl.replace(/\/+$/, '');
    this.token = token;
    this.nodeId = sanitizeNodeId(nodeId, 'node');
    this.nodeVersion = nodeVersion;
    this.nodePort = nodePort;
    this.nodePublicUrl = nodePublicUrl;
    this.store = store;
    this.simulator = simulator;
    this.intervalMs = intervalMs;
    this.timeoutMs = timeoutMs;
    this.initialPullRetryIntervalMs = initialPullRetryIntervalMs;
    this.initialPullMaxRetries = initialPullMaxRetries;
    this.fetchImpl = fetchImpl;
    this.interval = null;
    this.dirty = false;
    this.pushQueue = Promise.resolve();
    this.stopped = false;

    this.masterRevision = null;
    this.lastPullAt = null;
    this.lastPushAt = null;
    this.lastReconcileAt = null;
    this.lastError = null;

    if (this.store && typeof this.store.setRole === 'function') {
      this.store.setRole(this.role);
    }
  }

  async start() {
    this.stopped = false;
    logger.info('market_sync.starting', {
      role: this.role,
      syncMode: this.role === 'node' ? this.syncMode : null,
      nodeId: this.nodeId,
      masterUrl: this.getMasterOrigin(),
      intervalMs: this.intervalMs,
      timeoutMs: this.timeoutMs,
      initialPullRetryIntervalMs: this.initialPullRetryIntervalMs,
    });
    if (!['standalone', 'master', 'node'].includes(this.role)) {
      logger.error('market_sync.invalid_role', { role: this.role, nodeId: this.nodeId });
      throw new Error('MARKET_SYNC_ROLE deve ser standalone, master ou node.');
    }
    if (this.role === 'standalone') {
      logger.info('market_sync.standalone_mode', { nodeId: this.nodeId });
      return;
    }
    if (this.role === 'node' && !['bidirectional', 'receive-only'].includes(this.syncMode)) {
      logger.error('market_sync.invalid_mode', { nodeId: this.nodeId, syncMode: this.syncMode });
      throw new Error('MARKET_NODE_SYNC_MODE deve ser bidirectional ou receive-only.');
    }
    if (!this.token) {
      logger.error('market_sync.missing_token', { role: this.role, nodeId: this.nodeId });
      throw new Error('MARKET_SYNC_TOKEN é obrigatório para sincronização.');
    }
    if (this.role === 'master') {
      logger.info('market_sync.master_ready', { nodeId: this.nodeId });
      return;
    }
    if (!this.masterUrl) {
      logger.error('market_sync.missing_master_url', { nodeId: this.nodeId });
      throw new Error('MARKET_SYNC_MASTER_URL é obrigatório no node.');
    }

    let attempt = 0;
    while (!this.stopped) {
      attempt += 1;
      logger.info('market_sync.node_initial_pull_started', {
        nodeId: this.nodeId,
        masterUrl: this.getMasterOrigin(),
        localRevision: this.localRevision,
        attempt,
      });
      try {
        await this.pullSnapshot();
        break;
      } catch (error) {
        logger.error('market_sync.node_initial_pull_failed', {
          nodeId: this.nodeId,
          masterUrl: this.getMasterOrigin(),
          attempt,
          ...getErrorDetails(error),
        });
        if (this.stopped) break;
        if (this.initialPullMaxRetries > 0 && attempt >= this.initialPullMaxRetries) {
          throw error;
        }
        const retryDelay = this.initialPullRetryIntervalMs;
        logger.warn('market_sync.node_initial_pull_retrying', {
          nodeId: this.nodeId,
          attempt,
          nextAttemptInMs: retryDelay,
        });
        await new Promise((resolve) => setTimeout(resolve, retryDelay));
      }
    }
    if (this.stopped) return;

    this.simulator.setSynchronizationHandler(
      this.canPush ? () => this.pushSnapshot() : null,
    );
    logger.info('market_sync.node_ready', {
      nodeId: this.nodeId,
      masterUrl: this.getMasterOrigin(),
      localRevision: this.localRevision,
      intervalMs: this.intervalMs,
    });
    this.interval = setInterval(() => {
      this.reconcile().catch((error) => {
        this.lastError = { message: error.message, at: new Date().toISOString() };
        logger.warn('market_sync.reconcile_failed', {
          nodeId: this.nodeId,
          localRevision: this.localRevision,
          ...getErrorDetails(error),
        });
      });
    }, this.intervalMs);
    this.interval.unref?.();
  }

  stop() {
    this.stopped = true;
    if (this.interval) clearInterval(this.interval);
    this.interval = null;
    this.simulator.setSynchronizationHandler(null);
    logger.info('market_sync.stopped', { role: this.role, nodeId: this.nodeId });
  }

  /** @returns {number} Sincronizações local conhecida pelo node. */
  get localRevision() {
    return Number.isInteger(this.store.state.syncRevision) ? this.store.state.syncRevision : 0;
  }

  get canPush() {
    return this.role === 'node' && this.syncMode === 'bidirectional';
  }

  async request(path, options = {}) {
    const url = new URL(path, `${this.masterUrl}/`);
    const method = options.method || 'GET';
    const requestBytes = typeof options.body === 'string'
      ? Buffer.byteLength(options.body, 'utf8')
      : Buffer.isBuffer(options.body)
        ? options.body.length
        : null;
    const transferDirection = method === 'GET'
      ? 'download'
      : options.body !== undefined
        ? 'upload'
        : 'none';
    if (requestBytes > MAX_HTTP_TRANSFER_BYTES) {
      logger.warn('market_sync.request_too_large', {
        nodeId: this.nodeId,
        method,
        endpoint: `${url.origin}${url.pathname}`,
        transferDirection,
        requestBytes,
        maxBytes: MAX_HTTP_TRANSFER_BYTES,
      });
      throw Object.assign(
        new Error('A requisição ao master excede o limite máximo de 10 MB.'),
        { statusCode: 413 },
      );
    }
    const startedAt = Date.now();
    logger.info('market_sync.request_started', {
      nodeId: this.nodeId,
      method,
      endpoint: `${url.origin}${url.pathname}`,
      transferDirection,
      requestBytes,
      localRevision: this.localRevision,
      timeoutMs: this.timeoutMs,
    });

    try {
      const response = await this.fetchImpl(url, {
        ...options,
        signal: AbortSignal.timeout(this.timeoutMs),
        headers: {
          'Content-Type': 'application/json',
          'X-Market-Sync-Token': this.token,
          'X-Market-Node-Id': this.nodeId,
          'X-Market-Node-Revision': String(this.localRevision),
          'X-Market-Node-Version': String(this.nodeVersion),
          'X-Market-Node-Port': String(this.nodePort),
          'X-Market-Node-Sync-Interval-Ms': String(this.intervalMs),
          'X-Market-Node-Url': this.nodePublicUrl,
          ...options.headers,
        },
      });
      const { body, responseBytes } = await readJsonResponse(response);
      logger.info('market_sync.request_completed', {
        nodeId: this.nodeId,
        method,
        endpoint: `${url.origin}${url.pathname}`,
        transferDirection,
        requestBytes,
        responseBytes,
        responseContentType: response.headers.get('content-type'),
        statusCode: response.status,
        durationMs: Date.now() - startedAt,
      });
      return { response, body };
    } catch (error) {
      logger.error('market_sync.request_failed', {
        nodeId: this.nodeId,
        method,
        endpoint: `${url.origin}${url.pathname}`,
        transferDirection,
        requestBytes,
        durationMs: Date.now() - startedAt,
        ...getErrorDetails(error),
      });
      throw error;
    }
  }

  async pullSnapshot() {
    logger.info('market_sync.snapshot_pull_started', {
      nodeId: this.nodeId,
      localRevision: this.localRevision,
    });
    const { response, body } = await this.request('/api/sync/snapshot');
    if (!response.ok || !body.success || !body.data?.marketState) {
      logger.error('market_sync.snapshot_pull_rejected', {
        nodeId: this.nodeId,
        statusCode: response.status,
        message: body.message,
      });
      throw new Error(body.message || `Falha ao baixar snapshot do master (${response.status}).`);
    }
    const revision = body.data.marketState.syncRevision;
    if (!Number.isInteger(revision) || revision < 0) {
      logger.error('market_sync.snapshot_invalid_revision', { nodeId: this.nodeId, revision });
      throw new Error('Snapshot do master sem Sincronizações válida.');
    }

    logger.info('market_sync.snapshot_applying', { nodeId: this.nodeId, revision });
    await this.store.repository.replaceFullSnapshot(body.data);
    this.simulator.initialize(await this.store.load());
    this.dirty = false;
    this.masterRevision = revision;
    this.lastPullAt = new Date().toISOString();
    logger.info('market_sync.snapshot_applied', { nodeId: this.nodeId, revision });
    return revision;
  }

  async reconcile() {
    logger.info('market_sync.reconcile_started', {
      nodeId: this.nodeId,
      localRevision: this.localRevision,
      dirty: this.dirty,
    });
    const { response, body } = await this.request('/api/sync/status');
    if (!response.ok || !Number.isInteger(body.data?.revision)) {
      logger.error('market_sync.reconcile_status_invalid', {
        nodeId: this.nodeId,
        statusCode: response.status,
        message: body.message,
      });
      throw new Error(body.message || `Falha ao consultar Sincronizações do master (${response.status}).`);
    }

    this.masterRevision = body.data.revision;
    this.lastReconcileAt = new Date().toISOString();
    this.lastError = null;

    if (body.data.revision !== this.localRevision) {
      logger.info('market_sync.reconcile_pull_required', {
        nodeId: this.nodeId,
        localRevision: this.localRevision,
        masterRevision: body.data.revision,
      });
      await this.pullSnapshot();
      return;
    }
    if (this.canPush && this.dirty) {
      logger.info('market_sync.reconcile_push_required', {
        nodeId: this.nodeId,
        revision: this.localRevision,
      });
      await this.pushSnapshot();
      return;
    }
    logger.info('market_sync.reconcile_up_to_date', {
      nodeId: this.nodeId,
      revision: this.localRevision,
    });
  }

  pushSnapshot() {
    if (!this.canPush) {
      return Promise.reject(Object.assign(
        new Error('Este node está configurado para somente receber dados do master.'),
        { statusCode: 403, syncPushDisabled: true },
      ));
    }
    logger.info('market_sync.push_queued', { nodeId: this.nodeId, localRevision: this.localRevision });
    const result = this.pushQueue.then(() => this.pushSnapshotNow());
    this.pushQueue = result.catch(() => {});
    return result;
  }

  async pushSnapshotNow() {
    if (!this.canPush) {
      throw Object.assign(
        new Error('Este node está configurado para somente receber dados do master.'),
        { statusCode: 403, syncPushDisabled: true },
      );
    }
    const baseRevision = this.localRevision;
    logger.info('market_sync.snapshot_push_started', { nodeId: this.nodeId, baseRevision });
    const snapshot = await this.simulator.getBackupSnapshot();
    this.dirty = true;
    logger.info('market_sync.snapshot_push_ready', { nodeId: this.nodeId, baseRevision });
    const { response, body } = await this.request('/api/sync/snapshot', {
      method: 'PUT',
      body: JSON.stringify({ baseRevision, snapshot }),
    });

    if (response.status === 409) {
      logger.warn('market_sync.snapshot_push_conflict', {
        nodeId: this.nodeId,
        baseRevision,
        masterRevision: body.data?.revision,
      });
      await this.pullSnapshot();
      throw Object.assign(
        new Error('O mercado foi atualizado por outro servidor; o estado do master foi aplicado.'),
        { statusCode: 409, syncConflict: true },
      );
    }
    if (!response.ok || !Number.isInteger(body.data?.revision)) {
      this.dirty = true;
      if (response.status >= 400 && response.status < 500) {
        logger.error('market_sync.snapshot_push_rejected', {
          nodeId: this.nodeId,
          baseRevision,
          statusCode: response.status,
          message: body.message,
        });
        throw new Error(body.message || `Master recusou a sincronização (${response.status}).`);
      }
      logger.warn('market_sync.push_deferred', {
        nodeId: this.nodeId,
        baseRevision,
        statusCode: response.status,
      });
      return;
    }

    const marketState = await this.store.repository.getMarketState();
    await this.store.repository.saveFullSnapshot({
      marketState: { ...marketState, syncRevision: body.data.revision },
    });
    this.store.state.syncRevision = body.data.revision;
    this.dirty = false;
    this.masterRevision = body.data.revision;
    this.lastPushAt = new Date().toISOString();
    logger.info('market_sync.snapshot_sent', { nodeId: this.nodeId, revision: body.data.revision });
  }

  getMasterOrigin() {
    try {
      return new URL(this.masterUrl).origin;
    } catch {
      return null;
    }
  }

  /**
   * Monta o estado do cluster para o painel administrativo (sem expor o token).
   * @returns {Promise<object>}
   */
  async getStatus() {
    const status = {
      syncEnabled: this.role !== 'standalone',
      role: this.role,
      syncMode: this.role === 'node' ? this.syncMode : null,
      canPush: this.canPush,
      nodeId: this.nodeId,
      intervalMs: this.intervalMs,
      masterUrl: null,
      masterReachable: null,
      masterRevision: this.masterRevision,
      localRevision: 0,
      lag: null,
      dirty: this.dirty,
      lastPullAt: this.lastPullAt,
      lastPushAt: this.lastPushAt,
      lastReconcileAt: this.lastReconcileAt,
      lastError: this.lastError,
    };

    if (this.role === 'master') {
      const state = await this.store.repository.getMarketState();
      status.localRevision = Number.isInteger(state?.syncRevision) ? state.syncRevision : 0;
      status.masterRevision = status.localRevision;
      return status;
    }

    status.localRevision = this.localRevision;
    try {
      status.masterUrl = new URL(this.masterUrl).origin;
    } catch {
      status.masterUrl = null;
    }
    try {
      const { response, body } = await this.request('/api/sync/status');
      status.masterReachable = response.ok && Number.isInteger(body.data?.revision);
      if (status.masterReachable) {
        this.masterRevision = body.data.revision;
        status.masterRevision = body.data.revision;
      }
    } catch {
      status.masterReachable = false;
    }
    if (Number.isInteger(status.masterRevision)) {
      status.lag = Math.max(0, status.masterRevision - status.localRevision);
    }
    return status;
  }
}