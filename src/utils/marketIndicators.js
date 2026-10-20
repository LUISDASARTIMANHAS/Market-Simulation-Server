/**
 * Utilitário de Pré-processamento e Indicadores Técnicos do Mercado.
 *
 * Fornece métricas e indicadores prontos para alimentar interfaces,
 * agentes de Inteligência Artificial e sistemas de trading algorítmico.
 */

import { roundMoney } from './money.js';

/**
 * Calcula Média Móvel Simples (SMA).
 * @param {Array<{ price: number }>} history
 * @param {number} period
 * @returns {Array<number|null>}
 */
export function calculateSMA(history, period) {
  const result = [];
  for (let i = 0; i < history.length; i++) {
    if (i < period - 1) {
      result.push(null);
    } else {
      let sum = 0;
      for (let j = 0; j < period; j++) {
        sum += history[i - j].price;
      }
      result.push(roundMoney(sum / period));
    }
  }
  return result;
}

/**
 * Calcula Bandas de Bollinger (SMA e desvios padrão).
 * @param {Array<{ price: number }>} history
 * @param {number} period
 * @param {number} multiplier
 * @returns {Array<{ upper: number|null, middle: number|null, lower: number|null }>}
 */
export function calculateBollingerBands(history, period = 20, multiplier = 2) {
  const sma = calculateSMA(history, period);
  const result = [];

  for (let i = 0; i < history.length; i++) {
    const middle = sma[i];
    if (middle === null) {
      result.push({ upper: null, middle: null, lower: null });
      continue;
    }

    let varianceSum = 0;
    for (let j = 0; j < period; j++) {
      varianceSum += Math.pow(history[i - j].price - middle, 2);
    }
    const stdDev = Math.sqrt(varianceSum / period);
    result.push({
      upper: roundMoney(middle + multiplier * stdDev),
      middle: roundMoney(middle),
      lower: roundMoney(middle - multiplier * stdDev),
    });
  }

  return result;
}

/**
 * Calcula o Índice de Força Relativa (RSI).
 * @param {Array<{ price: number }>} history
 * @param {number} [period=14]
 * @returns {Array<number|null>}
 */
export function calculateRSI(history, period = 14) {
  const result = [];
  if (!history || history.length <= period) {
    return (history || []).map(() => null);
  }

  let gains = 0;
  let losses = 0;

  for (let i = 1; i <= period; i++) {
    const diff = history[i].price - history[i - 1].price;
    if (diff >= 0) gains += diff;
    else losses += Math.abs(diff);
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  for (let i = 0; i < period; i++) {
    result.push(null);
  }

  let rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
  result.push(avgLoss === 0 ? 100 : Number((100 - (100 / (1 + rs))).toFixed(2)));

  for (let i = period + 1; i < history.length; i++) {
    const diff = history[i].price - history[i - 1].price;
    const currentGain = diff > 0 ? diff : 0;
    const currentLoss = diff < 0 ? Math.abs(diff) : 0;

    avgGain = (avgGain * (period - 1) + currentGain) / period;
    avgLoss = (avgLoss * (period - 1) + currentLoss) / period;

    if (avgLoss === 0) {
      result.push(100);
    } else {
      rs = avgGain / avgLoss;
      result.push(Number((100 - (100 / (1 + rs))).toFixed(2)));
    }
  }

  return result;
}

/**
 * Determina o sentimento e rótulo de tendência com base no preço, médias móveis e RSI.
 * @param {number} currentPrice
 * @param {number|null} smaShort
 * @param {number|null} rsi
 * @returns {{ direction: 'up'|'down'|'neutral', sentiment: 'bullish'|'bearish'|'neutral', label: string }}
 */
export function determineTrend(currentPrice, smaShort, rsi) {
  if (rsi !== null && smaShort !== null) {
    if (currentPrice >= smaShort && rsi >= 60) {
      return { direction: 'up', sentiment: 'bullish', label: 'Forte Alta 🟢' };
    }
    if (currentPrice >= smaShort || rsi >= 52) {
      return { direction: 'up', sentiment: 'bullish', label: 'Tendência de Alta 📈' };
    }
    if (currentPrice < smaShort && rsi <= 40) {
      return { direction: 'down', sentiment: 'bearish', label: 'Forte Baixa 🔴' };
    }
    if (currentPrice < smaShort || rsi <= 48) {
      return { direction: 'down', sentiment: 'bearish', label: 'Tendência de Baixa 📉' };
    }
  }

  return { direction: 'neutral', sentiment: 'neutral', label: 'Consolidação / Neutro 🟡' };
}

/**
 * Calcula a pressão de ordens e volumes acumulados (Order Flow Pressure).
 * @param {{ total: number, buys: number, sells: number }} volume
 * @returns {{ buyPercent: number, sellPercent: number, buysVolume: number, sellsVolume: number, ratioText: string }}
 */
export function calculateOrderPressure(volume) {
  const buys = volume?.buys || 0;
  const sells = volume?.sells || 0;
  const total = buys + sells;

  if (total <= 0) {
    return {
      buyPercent: 50,
      sellPercent: 50,
      buysVolume: 0,
      sellsVolume: 0,
      ratioText: '50% Compras · 50% Vendas',
    };
  }

  const buyPercent = Math.round((buys / total) * 100);
  const sellPercent = 100 - buyPercent;

  return {
    buyPercent,
    sellPercent,
    buysVolume: roundMoney(buys),
    sellsVolume: roundMoney(sells),
    ratioText: `${buyPercent}% Compras · ${sellPercent}% Vendas`,
  };
}

/**
 * Computa o conjunto completo de indicadores e estatísticas pré-processadas do mercado.
 * @param {Array<{ price: number, sequence?: number, updatedAt?: string }>} history
 * @param {{ total: number, buys: number, sells: number }} volume
 * @param {number} [windowTicks=30] Quantidade de ticks para a janela de indicadores
 * @returns {object} Resumo completo de indicadores técnicos
 */
export function computeMarketIndicators(history, volume, windowTicks = 30) {
  if (!history || !history.length) {
    return {
      currentPrice: 0,
      startPrice: 0,
      low: 0,
      high: 0,
      spread: 0,
      change: 0,
      changePercent: 0,
      volatility: 0,
      rsi: { period: 14, value: null, status: 'Sem dados' },
      trend: { direction: 'neutral', sentiment: 'neutral', label: 'Sem dados' },
      orderPressure: calculateOrderPressure(volume),
      movingAverages: { sma9: null, sma21: null },
      bollinger: { upper: null, middle: null, lower: null },
    };
  }

  const windowData = history.slice(-windowTicks);
  const prices = windowData.map((t) => t.price);
  const currentPrice = prices[prices.length - 1];
  const startPrice = prices[0];
  const low = roundMoney(Math.min(...prices));
  const high = roundMoney(Math.max(...prices));
  const spread = roundMoney(high - low);
  const change = roundMoney(currentPrice - startPrice);
  const changePercent = startPrice > 0 ? Number(((change / startPrice) * 100).toFixed(2)) : 0;
  const volatility = low > 0 ? Number(((spread / low) * 100).toFixed(2)) : 0;

  // Indicadores técnicos sobre a série completa de histórico
  const rsiPeriod = Math.min(14, Math.max(3, Math.floor(history.length / 2)));
  const rsiSeries = calculateRSI(history, rsiPeriod);
  const currentRsi = rsiSeries.length ? rsiSeries[rsiSeries.length - 1] : null;

  let rsiStatus = 'Neutro';
  if (currentRsi !== null) {
    if (currentRsi >= 70) rsiStatus = 'Sobrecomprado';
    else if (currentRsi <= 30) rsiStatus = 'Sobrevendido';
  }

  // Médias Móveis
  const sma9Series = calculateSMA(history, 9);
  const sma21Series = calculateSMA(history, 21);
  const smaShortVal = sma9Series.length ? sma9Series[sma9Series.length - 1] : null;
  const smaLongVal = sma21Series.length ? sma21Series[sma21Series.length - 1] : null;

  // Bandas de Bollinger
  const bollingerPeriod = Math.min(20, Math.max(5, Math.floor(history.length * 0.6)));
  const bollingerSeries = calculateBollingerBands(history, bollingerPeriod, 2);
  const currentBollinger = bollingerSeries.length
    ? bollingerSeries[bollingerSeries.length - 1]
    : { upper: null, middle: null, lower: null };

  const trend = determineTrend(currentPrice, smaShortVal, currentRsi);
  const orderPressure = calculateOrderPressure(volume);

  return {
    currentPrice: roundMoney(currentPrice),
    startPrice: roundMoney(startPrice),
    low,
    high,
    spread,
    change,
    changePercent,
    volatility,
    rsi: {
      period: rsiPeriod,
      value: currentRsi,
      status: rsiStatus,
    },
    trend,
    orderPressure,
    movingAverages: {
      sma9: smaShortVal,
      sma21: smaLongVal,
    },
    bollinger: currentBollinger,
  };
}

