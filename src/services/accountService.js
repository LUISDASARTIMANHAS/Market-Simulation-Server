// src/services/accountService.js

/**
 * Cria um erro de validação com o código HTTP correspondente.
 *
 * @param {string} message - Mensagem do erro.
 * @param {number} statusCode - Código HTTP.
 * @returns {Error} Erro com statusCode.
 */
const createAccountError = (message, statusCode) =>
	Object.assign(new Error(message), { statusCode });

/**
 * Normaliza e valida um nome de usuário.
 *
 * @param {string | null | undefined} username - Nome informado.
 * @returns {string} Nome validado.
 * @throws {Error} Erro HTTP 400 se o nome for inválido.
 */
export const normalizeUsername = (username) => {
	if (typeof username !== "string") {
		throw createAccountError(
			"username é obrigatório. Use 3 a 24 caracteres, sem espaços.",
			400,
		);
	}

	const trimmed = username.trim();

	if (!trimmed) {
		throw createAccountError(
			"username é obrigatório. Use 3 a 24 caracteres, sem espaços.",
			400,
		);
	}

	if (trimmed.length < 3 || trimmed.length > 24) {
		throw createAccountError("username deve ter entre 3 e 24 caracteres.", 400);
	}

	if (!/^[a-zA-Z0-9._-]+$/.test(trimmed)) {
		throw createAccountError(
			"username aceita apenas letras, números, ponto, underline e hífen.",
			400,
		);
	}

	return trimmed;
};

/**
 * Verifica se um nome de usuário já está cadastrado.
 *
 * A comparação ignora diferenças entre maiúsculas e minúsculas.
 *
 * @param {Map<string, object>} accounts - Contas cadastradas.
 * @param {string} username - Nome a verificar.
 * @returns {void}
 * @throws {Error} Erro HTTP 409 se o nome estiver ocupado.
 */
export const assertUsernameAvailable = (accounts, username) => {
	for (const account of accounts.values()) {
		if (
			typeof account.username === "string" &&
			account.username.toLowerCase() === username.toLowerCase()
		) {
			throw createAccountError("username já está em uso por outra conta.", 409);
		}
	}
};
