// gerencia a compra e venda de ativos
import { Router } from "express";
import { marketSimulator } from "../services/marketSimulator.js";
import {
	accountOrderLimit,
	orderLimit,
	requireApiAccount,
} from "./routeMiddleware.js";
import { logger } from "../utils/logger.js";

const router = Router();

const createOrderHandler = (side) => async (req, res) => {
	const input = req.body;
	if (
		!input ||
		typeof input !== "object" ||
		Array.isArray(input) ||
		!("amount" in input)
	) {
		return res
			.status(400)
			.json({
				success: false,
				message: "Parâmetros inválidos para a ordem.",
				input: input,
			});
	}

	try {
		const result = await marketSimulator.placeOrder(
			req.marketAccountId,
			side === "BUY"
				? { side, quoteAmount: input.amount }
				: { side, assetAmount: input.amount },
		);
		return res.status(201).json({ success: true, data: result.order });
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
};

router.post(
	"/buy",
	requireApiAccount,
	orderLimit,
	accountOrderLimit,
	createOrderHandler("BUY"),
);

router.post(
	"/sell",
	requireApiAccount,
	orderLimit,
	accountOrderLimit,
	createOrderHandler("SELL"),
);

export default router;
