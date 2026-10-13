/**
 * Registro de cluster: guarda a referência do serviço de sincronização local
 * e, no master, os nodes que se reportaram recentemente.
 */

const MAX_NODES = 100;
const NODE_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

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

/**
 * Registra a atividade de um node (usado pelo master).
 * @param {string} nodeId
 * @param {'status'|'pull'|'push'|'conflict'} action
 * @param {number | null} [reportedRevision]
 * @returns {void}
 */
export function recordNodeActivity(nodeId, action, reportedRevision = null) {
  const now = Date.now();
  if (!nodes.has(nodeId) && nodes.size >= MAX_NODES) {
    const oldest = [...nodes.values()].sort((a, b) => a.lastSeenMs - b.lastSeenMs)[0];
    nodes.delete(oldest.nodeId);
  }
  const previous = nodes.get(nodeId);
  nodes.set(nodeId, {
    nodeId,
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