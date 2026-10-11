// src/services/authenticationService.js

import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Calcula o hash SHA-256 de uma chave de API.
 *
 * A chave original não deve ser armazenada no cadastro da conta.
 *
 * @param {string} apiKey - Chave de API.
 * @returns {string} Hash hexadecimal SHA-256.
 */
export const hashApiKey = (apiKey) =>
	createHash("sha256").update(apiKey).digest("hex");

/**
 * Valida uma chave de API e localiza a conta correspondente.
 *
 * A comparação é realizada em tempo constante para hashes
 * de mesmo tamanho.
 *
 * @param {Map<string, object>} accounts - Contas cadastradas.
 * @param {string} apiKey - Chave apresentada pelo cliente.
 * @returns {string | null} ID da conta ou null.
 */
export const authenticateApiKey = (accounts, apiKey) => {
	if (typeof apiKey !== "string" || apiKey.length < 40 || apiKey.length > 100) {
		return null;
	}

	const candidate = Buffer.from(hashApiKey(apiKey), "hex");

	for (const account of accounts.values()) {
		if (
			typeof account.keyHash !== "string" ||
			!/^[a-f0-9]{64}$/.test(account.keyHash)
		) {
			continue;
		}

		const stored = Buffer.from(account.keyHash, "hex");

		if (
			candidate.length === stored.length &&
			timingSafeEqual(candidate, stored)
		) {
			return account.accountId;
		}
	}

	return null;
};

/**
 * Verifica se uma conta possui privilégios administrativos.
 *
 * @param {Map<string, object>} accounts - Contas cadastradas.
 * @param {string} accountId - ID da conta.
 * @returns {boolean} true se for administradora.
 */
export const isAdministrator = (accounts, accountId) =>
	accounts.get(accountId)?.isAdmin === true;
