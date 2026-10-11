import { Router } from 'express';
import { marketSimulator } from '../services/marketSimulator.js';
import { logger } from '../utils/logger.js';
import { keyRotationLimit, requireApiAccount } from './routeMiddleware.js';

const router = Router();

router.post('/rotate-key', requireApiAccount, keyRotationLimit, async (req, res) => {
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

export default router;