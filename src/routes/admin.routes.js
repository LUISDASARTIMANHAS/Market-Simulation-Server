import { Router } from 'express';
import { marketSimulator } from '../services/marketSimulator.js';
import { requireAdministrator } from './routeMiddleware.js';
import { httpError, httpInternalServerError } from '../utils/httpErrors.js';

const router = Router();

router.get('/', requireAdministrator, (req, res) => {
  return res.status(200).json({ success: true, data: { accounts: marketSimulator.listAccountsForAdministration() } });
});

router.post('/', requireAdministrator, async (req, res) => {
  try {
    const result = await marketSimulator.createAccountWithRole(req.body || {}, req.body?.isAdmin === true);
    return res.status(201).json({
      success: true,
      data: {
        account: result.account,
        apiKey: result.apiKey,
        warning: 'Guarde a chave agora. Ela não será exibida novamente.',
      },
    });
  } catch (error) {
    if (error.statusCode >= 500 || !error.statusCode) {
      return httpInternalServerError(res, error, 'Não foi possível criar a conta.');
    }
    return httpError(res, error.statusCode, error.message);
  }
});

router.patch('/:accountId', requireAdministrator, async (req, res) => {
  try {
    const account = await marketSimulator.updateAccountAsAdministrator(req.params.accountId, req.body || {}, req.marketAccountId);
    return res.status(200).json({ success: true, data: { account } });
  } catch (error) {
    if (error.statusCode >= 500 || !error.statusCode) {
      return httpInternalServerError(res, error, 'Não foi possível atualizar a conta.');
    }
    return httpError(res, error.statusCode, error.message);
  }
});

router.post('/:accountId/rotate-key', requireAdministrator, async (req, res) => {
  try {
    const result = await marketSimulator.rotateApiKey(req.params.accountId);
    return res.status(200).json({
      success: true,
      data: {
        account: result.account,
        apiKey: result.apiKey,
        warning: 'A chave anterior foi revogada. Guarde a nova chave; ela não será exibida novamente.',
      },
    });
  } catch (error) {
    if (error.statusCode >= 500 || !error.statusCode) {
      return httpInternalServerError(res, error, 'Não foi possível rotacionar a chave.');
    }
    return httpError(res, error.statusCode, error.message);
  }
});

router.delete('/:accountId', requireAdministrator, async (req, res) => {
  try {
    await marketSimulator.deleteAccountAsAdministrator(req.params.accountId, req.marketAccountId);
    return res.status(200).json({ success: true, data: { accountId: req.params.accountId } });
  } catch (error) {
    if (error.statusCode >= 500 || !error.statusCode) {
      return httpInternalServerError(res, error, 'Não foi possível excluir a conta.');
    }
    return httpError(res, error.statusCode, error.message);
  }
});

export default router;
