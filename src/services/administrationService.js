/**
 * Operações administrativas relacionadas às contas do simulador.
 *
 * Este módulo contém funções auxiliares independentes da classe
 * MarketSimulator. A persistência e a coordenação das operações
 * continuam sob responsabilidade do simulador.
 */

import {
	normalizeUsername,
	assertUsernameAvailable,
} from "./accountService.js";

/**
 * Retorna a lista pública de contas para a administração.
 *
 * @param {Map<string, object>} accounts - Contas cadastradas.
 * @returns {Array<object>} Contas sem hashes de autenticação.
 */
export const listAccountsForAdministration = (accounts) =>
	[...accounts.values()]
		.map((account) => ({
			accountId: account.accountId,
			username:
				typeof account.username === "string" && account.username.trim()
					? account.username
					: account.accountId,
			isAdmin: account.isAdmin === true,
			balance: account.balance,
			assetBalance: account.assetBalance,
			createdAt: account.createdAt || null,
		}))
		.sort((first, second) =>
			String(first.username).localeCompare(String(second.username), "pt-BR"),
		);

/**
 * Valida as alterações solicitadas para uma conta.
 *
 * Não modifica a conta nem persiste dados. A função retorna os valores
 * validados para que o simulador possa aplicá-los com segurança.
 *
 * @param {Map<string, object>} accounts - Contas cadastradas.
 * @param {string} accountId - Conta que será modificada.
 * @param {{ username?: string, isAdmin?: boolean }} input - Alterações.
 * @param {string} administratorId - Administrador solicitante.
 * @returns {{ username: string, isAdmin: boolean }}
 */
export const validateAccountAdministrationUpdate = (
	accounts,
	accountId,
	input = {},
	administratorId,
) => {
	const account = accounts.get(accountId);

	if (!account) {
		throw Object.assign(new Error("Conta não encontrada."), {
			statusCode: 404,
		});
	}

	if (
		Object.prototype.hasOwnProperty.call(input, "isAdmin") &&
		typeof input.isAdmin !== "boolean"
	) {
		throw Object.assign(new Error("isAdmin deve ser verdadeiro ou falso."), {
			statusCode: 400,
		});
	}

	const nextUsername = Object.prototype.hasOwnProperty.call(input, "username")
		? normalizeUsername(input.username)
		: account.username;

	if (
		typeof nextUsername === "string" &&
		nextUsername.toLowerCase() !== account.username?.toLowerCase()
	) {
		const otherAccounts = new Map(accounts);
		otherAccounts.delete(accountId);
		assertUsernameAvailable(otherAccounts, nextUsername);
	}

	const nextIsAdmin = Object.prototype.hasOwnProperty.call(input, "isAdmin")
		? input.isAdmin
		: account.isAdmin === true;

	if (account.accountId === administratorId && !nextIsAdmin) {
		throw Object.assign(
			new Error("Não é possível remover seu próprio acesso administrativo."),
			{ statusCode: 400 },
		);
	}

	if (
		account.isAdmin === true &&
		!nextIsAdmin &&
		[...accounts.values()].filter((candidate) => candidate.isAdmin === true)
			.length === 1
	) {
		throw Object.assign(
			new Error("Deve existir pelo menos um administrador."),
			{ statusCode: 400 },
		);
	}

	return {
		username: nextUsername,
		isAdmin: nextIsAdmin,
	};
};

/**
 * Valida se uma conta pode ser excluída por um administrador.
 *
 * @param {Map<string, object>} accounts - Contas cadastradas.
 * @param {string} accountId - Conta a excluir.
 * @param {string} administratorId - Administrador solicitante.
 * @returns {object} Conta validada para exclusão.
 */
export const validateAccountAdministrationDeletion = (
	accounts,
	accountId,
	administratorId,
) => {
	const account = accounts.get(accountId);

	if (!account) {
		throw Object.assign(new Error("Conta não encontrada."), {
			statusCode: 404,
		});
	}

	if (accountId === administratorId) {
		throw Object.assign(
			new Error("Não é possível excluir a própria conta administrativa."),
			{ statusCode: 400 },
		);
	}

	if (
		account.isAdmin === true &&
		[...accounts.values()].filter((candidate) => candidate.isAdmin === true)
			.length === 1
	) {
		throw Object.assign(
			new Error("Não é possível excluir o último administrador."),
			{ statusCode: 400 },
		);
	}

	return account;
};
