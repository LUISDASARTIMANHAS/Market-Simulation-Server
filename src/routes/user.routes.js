import { Router } from 'express';
import { marketSimulator } from '../services/marketSimulator.js';
import { requireApiAccount } from './routeMiddleware.js';

const router = Router();

router.get('/', requireApiAccount, (req, res) => {
  return res.status(200).json({
    success: true,
    data: { account: marketSimulator.getAccount(req.marketAccountId) },
  });
});

router.get('/history', requireApiAccount, (req, res) => {
  const account = marketSimulator.getAccount(req.marketAccountId);
  return res.status(200).json({ success: true, data: account.history });
});

export default router;