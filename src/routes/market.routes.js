import { Router } from 'express';
import { marketSimulator } from '../services/marketSimulator.js';

const router = Router();

router.get('/status', (req, res) => {
  return res.status(200).json({ success: true, data: marketSimulator.getStatus() });
});

export default router;