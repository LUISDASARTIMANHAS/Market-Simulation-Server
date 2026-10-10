import { Router } from "express";
import { marketSimulator } from "../services/marketSimulator.js";
import {
	accountOrderLimit,
	orderLimit,
	requireApiAccount,
} from "./routeMiddleware.js";
import { logger } from "../utils/logger.js";

const router = Router();

router.post(
	"/",
	requireApiAccount,
	orderLimit,
	accountOrderLimit,
	async (req, res) => {
		try {
			if (
				!req.body ||
				!req.body.type ||
				!req.body.symbol ||
				!req.body.quantity
			) {
				return res
					.status(400)
					.json({
						success: false,
						message: "Parâmetros inválidos para a ordem.",
					});
			}
			if (!req.marketAccountId) {
				return res
					.status(400)
					.json({ success: false, message: "ID da conta de mercado ausente." });
			}
			const result = await marketSimulator.placeOrder(
				req.marketAccountId,
				req.body,
			);
			return res.status(201).json({ success: true, data: result });
		} catch (error) {
			const statusCode = error.statusCode || 500;
			if (statusCode >= 500) {
				logger.error("order.execution_failed", {
					accountId: req.marketAccountId,
					message: error.message,
				});
			} else {
				logger.warn("order.rejected", {
					accountId: req.marketAccountId,
					statusCode,
					message: error.message,
				});
			}
			return res.status(statusCode).json({
				success: false,
				message:
					statusCode >= 500
						? "Não foi possível executar a ordem."
						: error.message,
			});
		}
	},
);

export default router;
