import { Router } from 'express';
import { marketSimulator } from '../services/marketSimulator.js';
import { logger } from '../utils/logger.js';
import { requireAdministrator } from './routeMiddleware.js';
import { httpBadRequest, httpError, httpInternalServerError } from '../utils/httpErrors.js';

const router = Router();

router.get('/', async (req, res) => {
  const snapshot = await marketSimulator.getBackupSnapshot();
  const fileContents = JSON.stringify(snapshot, null, 2);
  return res
    .status(200)
    .set('Content-Type', 'application/json; charset=utf-8')
    .set('Content-Disposition', 'attachment; filename="market-backup.json"')
    .send(fileContents);
});

router.post('/restore', requireAdministrator, async (req, res) => {
  try {
    const backupData = req.body;
    if (!backupData || typeof backupData !== 'object' || Array.isArray(backupData)) {
      return httpBadRequest(res, 'O arquivo de backup deve ser um objeto JSON válido.');
    }
    const result = await marketSimulator.restoreFromBackup(backupData);
    return res.status(200).json({
      success: true,
      message: 'Banco de dados restaurado com sucesso!',
      data: result,
    });
  } catch (error) {
    const statusCode = error.statusCode || 400;
    logger.error('backup.restore_failed', { message: error.message });
    if (statusCode >= 500) {
      return httpInternalServerError(res, error, 'Falha ao restaurar backup.');
    }
    return httpError(res, statusCode, error.message || 'Falha ao restaurar backup.');
  }
});

export default router;