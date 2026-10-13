import { createRequire } from 'node:module';
import { hostname } from 'node:os';
import { logger } from '../utils/logger.js';

const require = createRequire(import.meta.url);
const packageInfo = require('../../package.json');

export function createApiResponseMiddleware({
  name = process.env.MARKET_SERVER_NAME || process.env.MARKET_NODE_ID || hostname(),
  version = packageInfo.version,
  getRole = () => process.env.MARKET_SYNC_ROLE || 'standalone',
} = {}) {
  return (req, res, next) => {
    const sendJson = res.json.bind(res);
    res.json = (body) => {
      const server = { name, version, role: getRole() };
      const meta = body && typeof body === 'object' && !Array.isArray(body) && body.meta
        ? body.meta
        : {};
      const response = body && typeof body === 'object' && !Array.isArray(body)
        ? { ...body, meta: { ...meta, server } }
        : { meta: { server }, data: body };

      return sendJson(response);
    };
    next();
  };
}

export function apiNotFound(req, res) {
  return res.status(404).json({
    success: false,
    message: 'Rota da API não encontrada.',
  });
}

export function apiErrorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);

  const statusCode = Number(error.statusCode || error.status);
  const status = statusCode >= 400 && statusCode <= 599 ? statusCode : 500;
  const message = status < 500
    ? error.message || 'Requisição inválida.'
    : 'Erro interno do servidor.';

  logger.error('api.request_failed', {
    method: req.method,
    path: req.path,
    statusCode: status,
    message: error.message,
  });

  return res.status(status).json({ success: false, message });
}