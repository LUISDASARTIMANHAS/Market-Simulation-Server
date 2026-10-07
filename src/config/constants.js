export const TICKER_INTERVAL_MS = 2000;
export const INITIAL_VIRTUAL_BALANCE = 1000;
export const MAX_ORDER_NOTIONAL_USD = 5000;
export const MAX_ORDER_IMPACT_PERCENT = 0.25;
export const REFERENCE_LIQUIDITY_USD = 2000;
export const MAX_ACCOUNT_HISTORY = 100;
export const MAX_PUBLIC_TRADES = 50;

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
