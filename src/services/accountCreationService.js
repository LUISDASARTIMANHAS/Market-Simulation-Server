import { randomBytes, randomUUID } from "node:crypto";
import { INITIAL_VIRTUAL_BALANCE } from "../config/constants.js";
import { hashApiKey } from "./authenticationService.js";
import {
	normalizeUsername,
	assertUsernameAvailable,
} from "./accountService.js";

export const createAccountRecord = (accounts, input = {}, isAdmin = false) => {
	const apiKey = randomBytes(32).toString("base64url");
	const accountId = randomUUID();

	const providedUsername =
		typeof input?.username === "string"
			? input.username
			: typeof input?.accountName === "string"
				? input.accountName
				: null;

	const username = normalizeUsername(providedUsername);

	assertUsernameAvailable(accounts, username);

	const account = {
		accountId,
		username,
		keyHash: hashApiKey(apiKey),
		isAdmin: isAdmin === true,
		balance: INITIAL_VIRTUAL_BALANCE,
		assetBalance: 0,
		averagePrice: 0,
		history: [],
		createdAt: new Date().toISOString(),
	};

	return { account, apiKey };
};
