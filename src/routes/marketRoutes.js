// ROTAS MANAGER, NÃO USAR LOGICA AQUI, APENAS GERENCIAR AS ROTAS E CHAMAR AS FUNÇÕES DE OUTROS ARQUIVOS
// POR EXEMPLO router.use("/api/ENDPOINT",arquivoDeCrudDeRotas);
import { Router } from 'express';
import adminRoutes from './admin.routes.js';
import authRoutes from './auth.routes.js';
import accountsRoutes from './accounts.routes.js';
import backupRoutes from './backups.routes.js';
import marketRoutes from './market.routes.js';
import ordersRoutes from './orders.routes.js';
import userRoutes from './user.routes.js';

const router = Router();

router.use('/market', marketRoutes);
router.use('/backup', backupRoutes);
router.use('/accounts', accountsRoutes);
router.use('/admin/accounts', adminRoutes);
router.use('/account', userRoutes);
router.use('/account', authRoutes);
router.use('/orders', ordersRoutes);

export default router;
