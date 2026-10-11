import { Router } from 'express';
import { marketSimulator } from '../services/marketSimulator.js';
import { logger } from '../utils/logger.js';
import { accountCreationLimit } from './routeMiddleware.js';

const router = Router();

router.post('/', accountCreationLimit, async (req, res) => {
  try {
    const result = await marketSimulator.createAccount(req.body || {});
    return res.status(201).json({
      success: true,
      data: {
        account: result.account,
        apiKey: result.apiKey,
        warning: 'Guarde a chave agora. Ela não será exibida novamente.',
      },
    });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    if (statusCode >= 500) {
      logger.error('account.create_failed', { message: error.message });
      return res.status(500).json({ success: false, message: 'Não foi possível criar a conta.' });
    }
    return res.status(statusCode).json({ success: false, message: error.message });
  }
});

export default router;