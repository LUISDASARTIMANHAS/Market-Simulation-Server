import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateSMA,
  calculateBollingerBands,
  calculateRSI,
  calculateMarketStats,
  groupIntoCandles,
} from '../public/src/js/chartEngine.js';

describe('Testes de Indicadores Técnicos e Motor de Gráficos', () => {
  const sampleTicks = [
    { sequence: 1, price: 100, updatedAt: '2026-10-20T10:00:00.000Z' },
    { sequence: 2, price: 102, updatedAt: '2026-10-20T10:01:00.000Z' },
    { sequence: 3, price: 101, updatedAt: '2026-10-20T10:02:00.000Z' },
    { sequence: 4, price: 105, updatedAt: '2026-10-20T10:03:00.000Z' },
    { sequence: 5, price: 104, updatedAt: '2026-10-20T10:04:00.000Z' },
    { sequence: 6, price: 108, updatedAt: '2026-10-20T10:05:00.000Z' },
    { sequence: 7, price: 107, updatedAt: '2026-10-20T10:06:00.000Z' },
    { sequence: 8, price: 110, updatedAt: '2026-10-20T10:07:00.000Z' },
  ];

  test('calculateSMA calcula a média móvel simples corretamente com nulos nos primeiros períodos', () => {
    const period = 3;
    const sma = calculateSMA(sampleTicks, period);

    assert.equal(sma.length, sampleTicks.length);
    assert.equal(sma[0], null);
    assert.equal(sma[1], null);
    // (100 + 102 + 101) / 3 = 101
    assert.equal(sma[2], 101);
    // (102 + 101 + 105) / 3 = 102.666...
    assert.ok(Math.abs(sma[3] - 102.666) < 0.01);
  });

  test('calculateBollingerBands calcula bandas superior, média e inferior', () => {
    const period = 4;
    const bands = calculateBollingerBands(sampleTicks, period, 2);

    assert.equal(bands.length, sampleTicks.length);
    assert.equal(bands[0].middle, null);
    assert.equal(bands[1].middle, null);
    assert.equal(bands[2].middle, null);

    const b4 = bands[3];
    assert.ok(b4.middle !== null);
    assert.ok(b4.upper > b4.middle);
    assert.ok(b4.lower < b4.middle);
  });

  test('calculateRSI calcula valores normalizados entre 0 e 100', () => {
    // 16 ticks simulando sequência de alta
    const bullishTicks = Array.from({ length: 16 }, (_, i) => ({
      sequence: i + 1,
      price: 100 + i * 2,
      updatedAt: new Date().toISOString(),
    }));

    const rsi = calculateRSI(bullishTicks, 14);
    assert.equal(rsi.length, bullishTicks.length);
    const lastRsi = rsi[rsi.length - 1];

    assert.ok(lastRsi !== null);
    assert.ok(lastRsi >= 0 && lastRsi <= 100);
    // Em sequência contínua de alta, o RSI deve ser alto (> 80)
    assert.ok(lastRsi > 80, `Esperado RSI alto, recebido: ${lastRsi}`);
  });

  test('calculateMarketStats calcula variações, spread, volatilidade e tendência', () => {
    const stats = calculateMarketStats(sampleTicks);

    assert.equal(stats.startPrice, 100);
    assert.equal(stats.currentPrice, 110);
    assert.equal(stats.change, 10);
    assert.equal(stats.changePercent, 10);
    assert.equal(stats.high, 110);
    assert.equal(stats.low, 100);
    assert.equal(stats.spread, 10);
    assert.equal(stats.volatility, 10);
    assert.ok(typeof stats.trend === 'string');
    assert.ok(stats.trendClass.startsWith('trend-'));
  });

  test('groupIntoCandles agrupa ticks em velas japonesas com Open, High, Low, Close', () => {
    const candles = groupIntoCandles(sampleTicks, 3);

    assert.ok(candles.length >= 2);
    const c1 = candles[0];
    assert.equal(c1.open, 100);
    assert.equal(c1.high, 102);
    assert.equal(c1.low, 100);
    assert.equal(c1.close, 101);
    assert.equal(c1.isUp, true);
  });
});

