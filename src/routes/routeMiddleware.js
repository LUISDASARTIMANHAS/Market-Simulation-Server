import { rateLimit } from 'express-rate-limit';
import {
  ACCOUNT_CREATION_RATE_LIMIT,
  ACCOUNT_CREATION_RATE_LIMIT_WINDOW_MS,
  ACCOUNT_ORDER_RATE_LIMIT,
  ACCOUNT_ORDER_RATE_LIMIT_WINDOW_MS,
  KEY_ROTATION_RATE_LIMIT,
  KEY_ROTATION_RATE_LIMIT_WINDOW_MS,
  ORDER_RATE_LIMIT,
  ORDER_RATE_LIMIT_WINDOW_MS,
} from '../config/constants.js';
import { marketSimulator } from '../services/marketSimulator.js';
import { logger } from '../utils/logger.js';

export const accountCreationLimit = rateLimit({
  windowMs: ACCOUNT_CREATION_RATE_LIMIT_WINDOW_MS,
  limit: ACCOUNT_CREATION_RATE_LIMIT,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Limite de criação de contas atingido. Tente novamente em  depois.' },
});

export const orderLimit = rateLimit({
  windowMs: ORDER_RATE_LIMIT_WINDOW_MS,
  limit: ORDER_RATE_LIMIT,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Limite de ordens atingido. Tente novamente depois.' },
});

export const accountOrderLimit = rateLimit({
  windowMs: ACCOUNT_ORDER_RATE_LIMIT_WINDOW_MS,
  limit: ACCOUNT_ORDER_RATE_LIMIT,
  keyGenerator: (req) => req.marketAccountId,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Limite de ordens da conta atingido. Tente novamente depois.' },
});

export const keyRotationLimit = rateLimit({
  windowMs: KEY_ROTATION_RATE_LIMIT_WINDOW_MS,
  limit: KEY_ROTATION_RATE_LIMIT,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Limite de rotação de chave atingido. Tente novamente depois.' },
});

/** Autentica uma conta por chave API enviada no cabeçalho Bearer. */
export function requireApiAccount(req, res, next) {
  const authorization = req.get('authorization') || '';
  const match = /^Bearer ([A-Za-z0-9_-]+)$/.exec(authorization);
  const accountId = match ? marketSimulator.authenticateApiKey(match[1]) : null;
  if (!accountId) {
    logger.warn('auth.failed', { method: req.method, path: req.path });
    return res.status(401).json({ success: false, message: 'Chave de API ausente ou inválida.' });
  }
  req.marketAccountId = accountId;
  return next();
}

export function requireAdministrator(req, res, next) {
  requireApiAccount(req, res, () => {
    if (!marketSimulator.isAdministrator(req.marketAccountId)) {
      logger.warn('admin.access_denied', { method: req.method, path: req.path, accountId: req.marketAccountId });
      return res.status(403).json({ success: false, message: 'Apenas administradores podem restaurar backups.' });
    }
    return next();
  });
}