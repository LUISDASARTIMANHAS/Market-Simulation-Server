import { createRequire } from 'node:module';
import { hostname } from 'node:os';
import { logger } from '../utils/logger.js';
import { MAX_HTTP_TRANSFER_BYTES } from '../utils/httpLimits.js';
import { http404NotFound, httpError } from '../utils/httpErrors.js';

const require = createRequire(import.meta.url);
const packageInfo = require('../../package.json');

export function createApiResponseMiddleware({
  name = process.env.MARKET_SERVER_NAME || process.env.MARKET_NODE_ID || hostname(),
  version = packageInfo.version,
  getRole = () => process.env.MARKET_SYNC_ROLE || 'standalone',
} = {}) {
  return (req, res, next) => {
    const server = { name, version, role: getRole() };
    res.locals.apiServer = server;
    const sendJson = res.json.bind(res);
    res.json = (body) => {
      const response = body && typeof body === 'object' && !Array.isArray(body)
        ? { ...body, meta: { ...body.meta, server } }
        : { data: body, meta: { server } };
      const responseBytes = Buffer.byteLength(JSON.stringify(response), 'utf8');
      if (responseBytes > MAX_HTTP_TRANSFER_BYTES) {
        logger.warn('api.response_too_large', {
          method: req.method,
          path: req.path,
          ip: req.ip,
          responseBytes,
          maxBytes: MAX_HTTP_TRANSFER_BYTES,
        });
        res.status(413).removeHeader('Content-Disposition');
        return sendJson({
          success: false,
          message: 'A resposta excede o limite máximo de 10 MB.',
          meta: { server },
        });
      }
      return sendJson(response);
    };
    next();
  };
}

export function apiNotFound(req, res) {
  return http404NotFound(res, 'Rota da API não encontrada.');
}

export function apiErrorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);

  const statusCode = Number(error.statusCode || error.status);
  const status = statusCode >= 400 && statusCode <= 599 ? statusCode : 500;
  const requestBytes = Number(req.get('content-length'));
  const message = status < 500
    ? error.message || 'Requisição inválida.'
    : 'Erro interno do servidor.';

  logger.error('api.request_failed', {
    method: req.method,
    path: req.path,
    ip: req.ip,
    requestBytes: Number.isSafeInteger(requestBytes) && requestBytes >= 0 ? requestBytes : null,
    requestContentType: req.get('content-type') || null,
    statusCode: status,
    message: error.type === 'entity.too.large'
      ? 'O corpo da requisição excede o limite máximo de 10 MB.'
      : error.message,
  });

  if (status === 413) res.set('Connection', 'close');
  return httpError(
    res,
    status,
    error.type === 'entity.too.large'
      ? 'O corpo da requisição excede o limite máximo de 10 MB.'
      : message,
  );
}