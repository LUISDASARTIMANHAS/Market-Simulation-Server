export const normalizeMarketHistory = (marketHistory) => {
	if (!Array.isArray(marketHistory)) {
		return null;
	}

	const validHistory = marketHistory.filter(
		(tick) =>
			Number.isInteger(tick.sequence) &&
			Number.isFinite(tick.price) &&
			tick.price > 0 &&
			typeof tick.updatedAt === "string",
	);

	return validHistory.length > 0 ? validHistory.slice(-50) : null;
};

import { MAX_ACCOUNT_HISTORY } from "../config/constants.js";
import { roundMoney, roundAsset } from "../utils/money.js";

export const normalizeMarketAccounts = (savedAccounts) => {
	if (!Array.isArray(savedAccounts)) {
		return null;
	}

	return new Map(
		savedAccounts
			.filter(
				(account) =>
					typeof account.accountId === "string" &&
					typeof account.keyHash === "string" &&
					/^[a-f0-9]{64}$/.test(account.keyHash) &&
					Number.isFinite(account.balance) &&
					account.balance >= 0 &&
					Number.isFinite(account.assetBalance) &&
					account.assetBalance >= 0,
			)
			.map((account) => {
				const username =
					typeof account.username === "string" && account.username.trim()
						? account.username.trim()
						: account.accountId;

				let positions = Array.isArray(account.positions)
					? account.positions
							.filter(
								(p) =>
									p &&
									typeof p.positionId === "string" &&
									Number.isFinite(p.quantity) &&
									p.quantity > 0,
							)
							.map((p) => ({
								positionId: p.positionId,
								orderId: p.orderId || p.positionId,
								buyPrice: roundMoney(Number.isFinite(p.buyPrice) ? p.buyPrice : 0),
								quantity: roundAsset(p.quantity),
								initialQuantity: roundAsset(
									Number.isFinite(p.initialQuantity) ? p.initialQuantity : p.quantity,
								),
								totalCost: roundMoney(
									Number.isFinite(p.totalCost) ? p.totalCost : p.quantity * p.buyPrice,
								),
								createdAt: p.createdAt || account.createdAt || new Date().toISOString(),
							}))
					: [];

				// Se houver saldo de ativos sem posições individualizadas registradas, cria um lote inicial
				if (positions.length === 0 && account.assetBalance > 0) {
					positions.push({
						positionId: `pos-${account.accountId}-init`,
						orderId: `init-${account.accountId}`,
						buyPrice: roundMoney(Number.isFinite(account.averagePrice) && account.averagePrice > 0 ? account.averagePrice : 100),
						quantity: roundAsset(account.assetBalance),
						initialQuantity: roundAsset(account.assetBalance),
						totalCost: roundMoney(
							account.assetBalance *
								(Number.isFinite(account.averagePrice) && account.averagePrice > 0 ? account.averagePrice : 100),
						),
						createdAt: account.updatedAt || account.createdAt || new Date().toISOString(),
					});
				}

				return [
					account.accountId,
					{
						...account,
						username,
						averagePrice: Number.isFinite(account.averagePrice)
							? account.averagePrice
							: 0,
						positions,
						history: Array.isArray(account.history)
							? account.history.slice(0, MAX_ACCOUNT_HISTORY)
							: [],
					},
				];
			}),
	);
};
