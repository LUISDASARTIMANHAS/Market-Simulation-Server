import { createRequire } from 'node:module';
import { hostname } from 'node:os';

const require = createRequire(import.meta.url);
const packageInfo = require('../../package.json');

function formatMessage(res, message) {
  const identity = res.locals?.apiServer || {
    name: process.env.MARKET_SERVER_NAME || process.env.MARKET_NODE_ID || hostname(),
    version: packageInfo.version,
    role: process.env.MARKET_SYNC_ROLE || 'standalone',
  };
  return `${identity.name} - versão ${identity.version}:${identity.role} error: ${message}`;
}

export function httpError(res, status, message, extra = {}) {
  return res.status(status).json({
    ...extra,
    success: false,
    message: formatMessage(res, message),
  });
}

export function httpBadRequest(res, message, extra) {
  return httpError(res, 400, message, extra);
}

export function httpUnauthorized(res, message) {
  return httpError(res, 401, message);
}

export function httpForbidden(res, message) {
  return httpError(res, 403, message);
}

export function http404NotFound(res, message) {
  return httpError(res, 404, message);
}

export function httpConflict(res, message, extra) {
  return httpError(res, 409, message, extra);
}

export function httpTooManyRequests(res, message) {
  return httpError(res, 429, message);
}

export function httpInternalServerError(res, error, message = 'Erro interno do servidor.') {
  return httpError(res, 500, error?.publicMessage || message);
}

export function httpBadGateway(res, message) {
  return httpError(res, 502, message);
}