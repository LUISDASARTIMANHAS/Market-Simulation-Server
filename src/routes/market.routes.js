import { Router } from 'express';
import { marketSimulator } from '../services/marketSimulator.js';

const router = Router();

router.get('/status', (req, res) => {
  return res.status(200).json({ success: true, data: marketSimulator.getStatus() });
});

router.get('/events', (req, res) => {
  const limit = req.query.limit ? Number(req.query.limit) : Infinity;
  return res.status(200).json({ success: true, data: marketSimulator.getEvents(limit) });
});

export default router;