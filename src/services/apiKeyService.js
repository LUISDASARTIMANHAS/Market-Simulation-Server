import { randomBytes } from "node:crypto";
import { hashApiKey } from "./authenticationService.js";

/**
 * Gera uma nova chave de API criptograficamente segura.
 */
export const generateApiKey = () => randomBytes(32).toString("base64url");

/**
 * Atualiza a chave de API de uma conta e retorna os dados
 * necessários para permitir a reversão em caso de falha.
 */
export const rotateAccountApiKey = (account) => {
	const previousHash = account.keyHash;
	const apiKey = generateApiKey();

	account.keyHash = hashApiKey(apiKey);

	return {
		apiKey,
		previousHash,
	};
};

/**
 * Restaura o hash anterior da chave de API.
 */
export const restoreAccountApiKey = (account, previousHash) => {
	account.keyHash = previousHash;
};
