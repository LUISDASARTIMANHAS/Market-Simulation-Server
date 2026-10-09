/**
 * Utilitários de precisão financeira para evitar imprecisões de ponto flutuante em JavaScript.
 * Representa valores monetários internamente em centavos (inteiros) e ativos em satoshis (1e-8).
 */

const MONEY_SCALE = 100;
const ASSET_SCALE = 100_000_000;

/**
 * Converte valor em dólares para centavos inteiros.
 * @param {number} dollars
 * @returns {number}
 */
export const toCents = (dollars) => Math.round((Number(dollars) + Number.EPSILON) * MONEY_SCALE);

/**
 * Converte centavos inteiros para dólares (2 casas decimais).
 * @param {number} cents
 * @returns {number}
 */
export const fromCents = (cents) => Math.round(Number(cents)) / MONEY_SCALE;

/**
 * Soma exata de dois valores monetários.
 * @param {number} a
 * @param {number} b
 * @returns {number}
 */
export const addMoney = (a, b) => fromCents(toCents(a) + toCents(b));

/**
 * Subtração exata de dois valores monetários.
 * @param {number} a
 * @param {number} b
 * @returns {number}
 */
export const subtractMoney = (a, b) => fromCents(toCents(a) - toCents(b));

/**
 * Arredonda valor monetário para 2 casas decimais.
 * @param {number} value
 * @returns {number}
 */
export const roundMoney = (value) => fromCents(toCents(value));

/**
 * Converte quantidade de ativos para unidades inteiras escaladas (1e8).
 * @param {number} asset
 * @returns {number}
 */
export const toAssetUnits = (asset) => Math.round((Number(asset) + Number.EPSILON) * ASSET_SCALE);

/**
 * Converte unidades escaladas para quantidade com até 8 casas decimais.
 * @param {number} units
 * @returns {number}
 */
export const fromAssetUnits = (units) => Math.round(Number(units)) / ASSET_SCALE;

/**
 * Soma exata de quantidades de ativos.
 * @param {number} a
 * @param {number} b
 * @returns {number}
 */
export const addAsset = (a, b) => fromAssetUnits(toAssetUnits(a) + toAssetUnits(b));

/**
 * Subtração exata de quantidades de ativos.
 * @param {number} a
 * @param {number} b
 * @returns {number}
 */
export const subtractAsset = (a, b) => fromAssetUnits(toAssetUnits(a) - toAssetUnits(b));

/**
 * Arredonda quantidade do ativo para até 8 casas decimais.
 * @param {number} value
 * @returns {number}
 */
export const roundAsset = (value) => fromAssetUnits(toAssetUnits(value));
