import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { marketSimulator } from '../services/marketSimulator.js';
import { logger } from '../utils/logger.js';

const router = Router();
const accountCreationLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Limite de criação de contas atingido. Tente novamente depois.' },
});
const orderLimit = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Limite de ordens atingido. Tente novamente depois.' },
});
const accountOrderLimit = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  keyGenerator: (req) => req.marketAccountId,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Limite de ordens da conta atingido. Tente novamente depois.' },
});
const keyRotationLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Limite de rotação de chave atingido. Tente novamente depois.' },
});

router.get('/market/status', (req, res) => {
  return res.status(200).json({ success: true, data: marketSimulator.getStatus() });
});

router.post('/accounts', accountCreationLimit, async (req, res) => {
  try {
    const result = await marketSimulator.createAccount();
    return res.status(201).json({
      success: true,
      data: {
        account: result.account,
        apiKey: result.apiKey,
        warning: 'Guarde a chave agora. Ela não será exibida novamente.',
      },
    });
  } catch (error) {
    logger.error('account.create_failed', { message: error.message });
    return res.status(500).json({ success: false, message: 'Não foi possível criar a conta.' });
  }
});

router.get('/account', requireApiAccount, (req, res) => {
  return res.status(200).json({
    success: true,
    data: { account: marketSimulator.getAccount(req.marketAccountId) },
  });
});

router.get('/account/history', requireApiAccount, (req, res) => {
  const account = marketSimulator.getAccount(req.marketAccountId);
  return res.status(200).json({ success: true, data: account.history });
});

router.post('/account/rotate-key', requireApiAccount, keyRotationLimit, async (req, res) => {
  try {
    const result = await marketSimulator.rotateApiKey(req.marketAccountId);
    return res.status(200).json({
      success: true,
      data: {
        account: result.account,
        apiKey: result.apiKey,
        warning: 'A chave anterior foi revogada. Guarde a nova chave; ela não será exibida novamente.',
      },
    });
  } catch (error) {
    logger.error('account.api_key_rotation_failed', {
      accountId: req.marketAccountId,
      message: error.message,
    });
    return res.status(500).json({ success: false, message: 'Não foi possível rotacionar a chave.' });
  }
});

router.post('/orders', requireApiAccount, orderLimit, accountOrderLimit, async (req, res) => {
  try {
    const result = await marketSimulator.placeOrder(req.marketAccountId, req.body);
    return res.status(201).json({ success: true, data: result });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    if (statusCode >= 500) {
      logger.error('order.execution_failed', {
        accountId: req.marketAccountId,
        message: error.message,
      });
    } else {
      logger.warn('order.rejected', {
        accountId: req.marketAccountId,
        statusCode,
        message: error.message,
      });
    }
    return res.status(statusCode).json({
      success: false,
      message: statusCode >= 500 ? 'Não foi possível executar a ordem.' : error.message,
    });
  }
});

/**
 * Autentica uma conta por chave API enviada no cabeçalho Bearer.
 */
function requireApiAccount(req, res, next) {
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

export default router;
