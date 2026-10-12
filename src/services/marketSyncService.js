import { hostname } from 'node:os';
import { logger } from '../utils/logger.js';
import { sanitizeNodeId } from './clusterRegistry.js';

const SYNC_TIMEOUT_MS = 10000;

export class MarketSyncService {
  constructor({
    role = process.env.MARKET_SYNC_ROLE || 'standalone',
    masterUrl = process.env.MARKET_SYNC_MASTER_URL || '',
    token = process.env.MARKET_SYNC_TOKEN || '',
    nodeId = process.env.MARKET_NODE_ID || hostname(),
    store,
    simulator,
    intervalMs = Number(process.env.MARKET_SYNC_INTERVAL_SECONDS || 5) * 1000,
    fetchImpl = fetch,
  }) {
    this.role = role;
    this.masterUrl = masterUrl.replace(/\/+$/, '');
    this.token = token;
    this.nodeId = sanitizeNodeId(nodeId, 'node');
    this.store = store;
    this.simulator = simulator;
    this.intervalMs = intervalMs;
    this.fetchImpl = fetchImpl;
    this.interval = null;
    this.dirty = false;
    this.pushQueue = Promise.resolve();

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
    if (!['standalone', 'master', 'node'].includes(this.role)) {
      throw new Error('MARKET_SYNC_ROLE deve ser standalone, master ou node.');
    }
    if (this.role === 'standalone') return;
    if (!this.token) throw new Error('MARKET_SYNC_TOKEN é obrigatório para sincronização.');
    if (this.role === 'master') return;
    if (!this.masterUrl) throw new Error('MARKET_SYNC_MASTER_URL é obrigatório no node.');

    await this.pullSnapshot();
    this.simulator.setSynchronizationHandler(() => this.pushSnapshot());
    this.interval = setInterval(() => {
      this.reconcile().catch((error) => {
        this.lastError = { message: error.message, at: new Date().toISOString() };
        logger.warn('market_sync.reconcile_failed', { message: error.message });
      });
    }, this.intervalMs);
    this.interval.unref?.();
  }

  stop() {
    if (this.interval) clearInterval(this.interval);
    this.interval = null;
    this.simulator.setSynchronizationHandler(null);
  }

  /** @returns {number} Revisão local conhecida pelo node. */
  get localRevision() {
    return Number.isInteger(this.store.state.syncRevision) ? this.store.state.syncRevision : 0;
  }

  async request(path, options = {}) {
    const response = await this.fetchImpl(new URL(path, `${this.masterUrl}/`), {
      ...options,
      signal: AbortSignal.timeout(SYNC_TIMEOUT_MS),
      headers: {
        'Content-Type': 'application/json',
        'X-Market-Sync-Token': this.token,
        'X-Market-Node-Id': this.nodeId,
        'X-Market-Node-Revision': String(this.localRevision),
        ...options.headers,
      },
    });
    const body = await response.json().catch(() => ({}));
    return { response, body };
  }

  async pullSnapshot() {
    const { response, body } = await this.request('/api/sync/snapshot');
    if (!response.ok || !body.success || !body.data?.marketState) {
      throw new Error(body.message || `Falha ao baixar snapshot do master (${response.status}).`);
    }
    const revision = body.data.marketState.syncRevision;
    if (!Number.isInteger(revision) || revision < 0) {
      throw new Error('Snapshot do master sem revisão válida.');
    }

    await this.store.repository.replaceFullSnapshot(body.data);
    this.simulator.initialize(await this.store.load());
    this.dirty = false;
    this.masterRevision = revision;
    this.lastPullAt = new Date().toISOString();
    logger.info('market_sync.snapshot_applied', { revision });
    return revision;
  }

  async reconcile() {
    const { response, body } = await this.request('/api/sync/status');
    if (!response.ok || !Number.isInteger(body.data?.revision)) {
      throw new Error(body.message || `Falha ao consultar revisão do master (${response.status}).`);
    }

    this.masterRevision = body.data.revision;
    this.lastReconcileAt = new Date().toISOString();
    this.lastError = null;

    if (body.data.revision !== this.localRevision) {
      await this.pullSnapshot();
      return;
    }
    if (this.dirty) await this.pushSnapshot();
  }

  pushSnapshot() {
    const result = this.pushQueue.then(() => this.pushSnapshotNow());
    this.pushQueue = result.catch(() => {});
    return result;
  }

  async pushSnapshotNow() {
    const baseRevision = this.localRevision;
    const snapshot = await this.simulator.getBackupSnapshot();
    this.dirty = true;
    const { response, body } = await this.request('/api/sync/snapshot', {
      method: 'PUT',
      body: JSON.stringify({ baseRevision, snapshot }),
    });

    if (response.status === 409) {
      await this.pullSnapshot();
      throw Object.assign(
        new Error('O mercado foi atualizado por outro servidor; o estado do master foi aplicado.'),
        { statusCode: 409, syncConflict: true },
      );
    }
    if (!response.ok || !Number.isInteger(body.data?.revision)) {
      this.dirty = true;
      if (response.status >= 400 && response.status < 500) {
        throw new Error(body.message || `Master recusou a sincronização (${response.status}).`);
      }
      logger.warn('market_sync.push_deferred', { statusCode: response.status });
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
    logger.info('market_sync.snapshot_sent', { revision: body.data.revision });
  }

  /**
   * Monta o estado do cluster para o painel administrativo (sem expor o token).
   * @returns {Promise<object>}
   */
  async getStatus() {
    const status = {
      syncEnabled: this.role !== 'standalone',
      role: this.role,
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