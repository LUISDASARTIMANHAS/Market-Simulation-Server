import { logger } from '../utils/logger.js';

const SYNC_TIMEOUT_MS = 10000;

export class MarketSyncService {
  constructor({
    role = process.env.MARKET_SYNC_ROLE || 'standalone',
    masterUrl = process.env.MARKET_SYNC_MASTER_URL || '',
    token = process.env.MARKET_SYNC_TOKEN || '',
    store,
    simulator,
    intervalMs = Number(process.env.MARKET_SYNC_INTERVAL_MS || 5000),
    fetchImpl = fetch,
  }) {
    this.role = role;
    this.masterUrl = masterUrl.replace(/\/+$/, '');
    this.token = token;
    this.store = store;
    this.simulator = simulator;
    this.intervalMs = intervalMs;
    this.fetchImpl = fetchImpl;
    this.interval = null;
    this.dirty = false;
    this.pushQueue = Promise.resolve();
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

  async request(path, options = {}) {
    const response = await this.fetchImpl(new URL(path, `${this.masterUrl}/`), {
      ...options,
      signal: AbortSignal.timeout(SYNC_TIMEOUT_MS),
      headers: {
        'Content-Type': 'application/json',
        'X-Market-Sync-Token': this.token,
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
    logger.info('market_sync.snapshot_applied', { revision });
    return revision;
  }

  async reconcile() {
    const { response, body } = await this.request('/api/sync/status');
    if (!response.ok || !Number.isInteger(body.data?.revision)) {
      throw new Error(body.message || `Falha ao consultar revisão do master (${response.status}).`);
    }

    const localRevision = Number.isInteger(this.store.state.syncRevision)
      ? this.store.state.syncRevision
      : 0;
    if (body.data.revision !== localRevision) {
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
    const baseRevision = Number.isInteger(this.store.state.syncRevision)
      ? this.store.state.syncRevision
      : 0;
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
    logger.info('market_sync.snapshot_sent', { revision: body.data.revision });
  }
}