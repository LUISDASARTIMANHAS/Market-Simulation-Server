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

				return [
					account.accountId,
					{
						...account,
						username,
						averagePrice: Number.isFinite(account.averagePrice)
							? account.averagePrice
							: 0,
						history: Array.isArray(account.history)
							? account.history.slice(0, MAX_ACCOUNT_HISTORY)
							: [],
					},
				];
			}),
	);
};
