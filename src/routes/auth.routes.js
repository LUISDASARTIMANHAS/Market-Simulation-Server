import { Router } from 'express';
import { marketSimulator } from '../services/marketSimulator.js';
import { logger } from '../utils/logger.js';
import { keyRotationLimit, requireApiAccount } from './routeMiddleware.js';
import { httpError, httpForbidden, httpInternalServerError } from '../utils/httpErrors.js';

const router = Router();

router.post('/rotate-key', requireApiAccount, keyRotationLimit, async (req, res) => {
  try {
    let targetAccountId = req.body?.accountId;

    if (!targetAccountId && req.body?.username && marketSimulator.isAdministrator(req.marketAccountId)) {
      const targetUser = String(req.body.username).trim().toLowerCase();
      const candidate = [...marketSimulator.accounts.values()].find(
        (acc) => acc.username?.toLowerCase() === targetUser
      );
      if (candidate) {
        targetAccountId = candidate.accountId;
      }
    }

    if (!targetAccountId) {
      targetAccountId = req.marketAccountId;
    }

    if (targetAccountId !== req.marketAccountId && !marketSimulator.isAdministrator(req.marketAccountId)) {
      return httpForbidden(res, 'Apenas administradores podem regenerar chaves de outras contas.');
    }

    const result = await marketSimulator.rotateApiKey(targetAccountId);
    return res.status(200).json({
      success: true,
      data: {
        account: result.account,
        apiKey: result.apiKey,
        warning: 'A chave anterior foi revogada. Guarde a nova chave; ela não será exibida novamente.',
      },
    });
  } catch (error) {
    if (error.statusCode && error.statusCode < 500) {
      return httpError(res, error.statusCode, error.message);
    }
    logger.error('account.api_key_rotation_failed', {
      accountId: req.marketAccountId,
      message: error.message,
    });
    return httpInternalServerError(res, error, 'Não foi possível rotacionar a chave.');
  }
});

export default router;
