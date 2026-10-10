import {
	MARKET_EVENT_MAX_INTERVAL_MS,
	MARKET_EVENT_MIN_INTERVAL_MS,
} from "../config/constants.js";

/**
 * Gera um número aleatório dentro do intervalo informado.
 */
const randomBetween = (minimum, maximum) =>
	minimum + Math.random() * (maximum - minimum);

/**
 * Calcula o horário do próximo evento de mercado.
 */
export const scheduleNextMarketEvent = () => {
	const delay = randomBetween(
		MARKET_EVENT_MIN_INTERVAL_MS,
		MARKET_EVENT_MAX_INTERVAL_MS,
	);

	return new Date(Date.now() + delay).toISOString();
};

/**
 * Seleciona um evento e calcula o próximo preço do ativo.
 */
export const calculateMarketEvent = (previous, events) => {
	const template = events[Math.floor(Math.random() * events.length)];

	const changePercent = randomBetween(template.minImpact, template.maxImpact);

	const actualImpactPercent = (Math.exp(changePercent / 100) - 1) * 100;

	const price = Number(
		Math.max(0.01, previous.price * Math.exp(changePercent / 100)).toFixed(2),
	);

	const occurredAt = new Date().toISOString();

	return {
		tick: {
			sequence: previous.sequence + 1,
			price,
			updatedAt: occurredAt,
		},
		event: {
			category: template.category,
			title: template.title,
			description: template.description,
			impactPercent: Number(actualImpactPercent.toFixed(4)),
			occurredAt,
		},
	};
};
