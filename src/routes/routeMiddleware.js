import { rateLimit } from 'express-rate-limit';
import { marketSimulator } from '../services/marketSimulator.js';
import { logger } from '../utils/logger.js';

export const accountCreationLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Limite de criação de contas atingido. Tente novamente depois.' },
});

export const orderLimit = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Limite de ordens atingido. Tente novamente depois.' },
});

export const accountOrderLimit = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  keyGenerator: (req) => req.marketAccountId,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Limite de ordens da conta atingido. Tente novamente depois.' },
});

export const keyRotationLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 3,
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