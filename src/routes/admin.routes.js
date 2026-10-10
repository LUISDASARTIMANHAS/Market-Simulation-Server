import { Router } from 'express';
import { marketSimulator } from '../services/marketSimulator.js';
import { requireAdministrator } from './routeMiddleware.js';

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
    return res.status(error.statusCode || 500).json({ success: false, message: error.statusCode ? error.message : 'Não foi possível criar a conta.' });
  }
});

router.patch('/:accountId', requireAdministrator, async (req, res) => {
  try {
    const account = await marketSimulator.updateAccountAsAdministrator(req.params.accountId, req.body || {}, req.marketAccountId);
    return res.status(200).json({ success: true, data: { account } });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, message: error.statusCode ? error.message : 'Não foi possível atualizar a conta.' });
  }
});

router.delete('/:accountId', requireAdministrator, async (req, res) => {
  try {
    await marketSimulator.deleteAccountAsAdministrator(req.params.accountId, req.marketAccountId);
    return res.status(200).json({ success: true, data: { accountId: req.params.accountId } });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, message: error.statusCode ? error.message : 'Não foi possível excluir a conta.' });
  }
});

export default router;