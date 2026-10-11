/**
 * Regras de validação e cálculo para ordens do mercado simulado.
 *
 * Este módulo não altera contas, preços ou persistência.
 */

import { MAX_ORDER_NOTIONAL_USD } from "../config/constants.js";
import { roundMoney, roundAsset } from "../utils/money.js";

/**
 * Cria um erro de negócio com código HTTP.
 */
const createOrderError = (message, statusCode = 400) =>
	Object.assign(new Error(message), { statusCode });

/**
 * Valida uma ordem e calcula sua quantidade e seu valor total.
 *
 * @param {object} account - Conta que executará a ordem.
 * @param {object} input - Dados recebidos para a ordem.
 * @param {number} currentPrice - Preço atual do ativo.
 * @returns {{ amount: number, total: number }}
 */
export const validateAndCalculateOrder = (account, input, currentPrice) => {
	let amount;
	let total;

	if (input?.side === "BUY") {
		const quoteAmount = Number(input.quoteAmount);

		if (!Number.isFinite(quoteAmount) || quoteAmount <= 0) {
			throw createOrderError("Informe quoteAmount maior que zero para compra.");
		}

		if (quoteAmount > MAX_ORDER_NOTIONAL_USD) {
			throw createOrderError(
				`O limite por ordem é US$ ${MAX_ORDER_NOTIONAL_USD}.`,
			);
		}

		total = roundMoney(quoteAmount);

		if (total > account.balance) {
			throw createOrderError("Saldo virtual insuficiente.");
		}

		amount = roundAsset(total / currentPrice);
	} else if (input?.side === "SELL") {
		amount = Number(input.assetAmount);

		if (!Number.isFinite(amount) || amount <= 0) {
			throw createOrderError("Informe assetAmount maior que zero para venda.");
		}

		amount = roundAsset(amount);

		if (amount > account.assetBalance) {
			throw createOrderError("Saldo de ativo insuficiente.");
		}

		total = roundMoney(amount * currentPrice);

		if (total > MAX_ORDER_NOTIONAL_USD) {
			throw createOrderError(
				`O limite por ordem é US$ ${MAX_ORDER_NOTIONAL_USD}.`,
			);
		}
	} else {
		throw createOrderError("side deve ser BUY ou SELL.");
	}

	if (amount <= 0 || total <= 0) {
		throw createOrderError("A ordem é menor que a precisão mínima permitida.");
	}

	return { amount, total };
};
