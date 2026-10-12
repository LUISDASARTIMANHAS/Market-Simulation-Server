export const TICKER_INTERVAL_SECONDS = 2;
export const INITIAL_VIRTUAL_BALANCE = 1000;
export const MAX_ORDER_NOTIONAL_USD = 5000;
export const MAX_ORDER_IMPACT_PERCENT = 2;
export const REFERENCE_LIQUIDITY_USD = 1000;
export const MAX_ACCOUNT_HISTORY = 100;
export const MAX_PUBLIC_TRADES = 200;
export const ACCOUNT_CREATION_RATE_LIMIT_WINDOW_SECONDS = 60;
export const ACCOUNT_CREATION_RATE_LIMIT = 7;
export const ORDER_RATE_LIMIT_WINDOW_SECONDS = 60;
export const ORDER_RATE_LIMIT = 60;
export const ACCOUNT_ORDER_RATE_LIMIT_WINDOW_SECONDS = 60;
export const ACCOUNT_ORDER_RATE_LIMIT = 20;
export const KEY_ROTATION_RATE_LIMIT_WINDOW_SECONDS = 60 * 60;
export const KEY_ROTATION_RATE_LIMIT = 3;

const readPositiveInterval = (value, fallback) => {
	const interval = Number(value);
	return Number.isFinite(interval) && interval > 0 ? Math.floor(interval) : fallback;
};

export const MARKET_EVENT_MIN_INTERVAL_MS = readPositiveInterval(
	process.env.MARKET_EVENT_MIN_INTERVAL_MS,
	60_000
);
export const MARKET_EVENT_MAX_INTERVAL_MS = Math.max(
	MARKET_EVENT_MIN_INTERVAL_MS,
	readPositiveInterval(process.env.MARKET_EVENT_MAX_INTERVAL_MS, 120_000)
);
