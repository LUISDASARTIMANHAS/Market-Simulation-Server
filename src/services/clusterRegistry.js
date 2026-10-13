/**
 * Registro de cluster: guarda a referência do serviço de sincronização local
 * e, no master, os nodes que se reportaram recentemente.
 */

const MAX_NODES = 100;
const NODE_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;
const NODE_VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9.+_-]{0,63}$/;

/** @type {object | null} */
let syncService = null;
/** @type {Map<string, object>} */
const nodes = new Map();

/**
 * Registra o serviço de sincronização da instância atual.
 * @param {object} service
 * @returns {void}
 */
export function registerSyncService(service) {
  syncService = service;
}

/**
 * Retorna o serviço de sincronização registrado.
 * @returns {object | null}
 */
export function getSyncService() {
  return syncService;
}

/**
 * Valida um identificador de node, evitando conteúdo arbitrário.
 * @param {unknown} raw
 * @param {string} [fallback='unknown']
 * @returns {string}
 */
export function sanitizeNodeId(raw, fallback = 'unknown') {
  return typeof raw === 'string' && NODE_ID_PATTERN.test(raw) ? raw : fallback;
}

export function sanitizeNodeVersion(raw) {
  return typeof raw === 'string' && NODE_VERSION_PATTERN.test(raw) ? raw : null;
}

export function sanitizeNodePort(raw) {
  const port = Number(raw);
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : null;
}

export function sanitizeNodeUrl(raw) {
  if (typeof raw !== 'string' || raw.length > 512) return null;
  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

/**
 * Registra a atividade de um node (usado pelo master).
 * @param {string} nodeId
 * @param {'status'|'pull'|'push'|'conflict'} action
 * @param {number | null} [reportedRevision]
 * @returns {void}
 */
export function recordNodeActivity(nodeId, action, reportedRevision = null, metadata = {}) {
  const now = Date.now();
  if (!nodes.has(nodeId) && nodes.size >= MAX_NODES) {
    const oldest = [...nodes.values()].sort((a, b) => a.lastSeenMs - b.lastSeenMs)[0];
    nodes.delete(oldest.nodeId);
  }
  const previous = nodes.get(nodeId);
  nodes.set(nodeId, {
    nodeId,
    version: sanitizeNodeVersion(metadata.version) ?? previous?.version ?? null,
    port: sanitizeNodePort(metadata.port) ?? previous?.port ?? null,
    url: typeof metadata.url === 'string'
      ? sanitizeNodeUrl(metadata.url)
      : previous?.url ?? null,
    firstSeenMs: previous?.firstSeenMs ?? now,
    lastSeenMs: now,
    lastAction: action,
    reportedRevision: Number.isInteger(reportedRevision)
      ? reportedRevision
      : previous?.reportedRevision ?? null,
    pushes: (previous?.pushes ?? 0) + (action === 'push' ? 1 : 0),
    conflicts: (previous?.conflicts ?? 0) + (action === 'conflict' ? 1 : 0),
  });
}

/**
 * Lista os nodes conhecidos com estado calculado.
 * @param {number} masterRevision Sincronizações atual do master.
 * @param {number} onlineWindowMs Janela para considerar o node online.
 * @returns {Array<object>}
 */
export function listNodes(masterRevision, onlineWindowMs) {
  const now = Date.now();
  return [...nodes.values()]
    .sort((a, b) => b.lastSeenMs - a.lastSeenMs)
    .map((node) => ({
      nodeId: node.nodeId,
      version: node.version,
      port: node.port,
      url: node.url,
      online: now - node.lastSeenMs <= onlineWindowMs,
      firstSeenAt: new Date(node.firstSeenMs).toISOString(),
      lastSeenAt: new Date(node.lastSeenMs).toISOString(),
      lastAction: node.lastAction,
      reportedRevision: node.reportedRevision,
      behindBy: Number.isInteger(node.reportedRevision)
        ? Math.max(0, masterRevision - node.reportedRevision)
        : null,
      pushes: node.pushes,
      conflicts: node.conflicts,
    }));
}