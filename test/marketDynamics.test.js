import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { MarketSimulator } from "../src/services/marketSimulator.js";

test("faixas de eventos positivos e negativos têm média neutra", async () => {
  const rawEvents = await readFile(
    new URL("../src/config/market-events.json", import.meta.url),
    "utf8",
  );
  const events = JSON.parse(rawEvents);
  const expectedImpactSum = events.reduce(
    (sum, event) => sum + event.minImpact + event.maxImpact,
    0,
  );

  assert.equal(events.length, 12);
  assert.ok(events.some((event) => event.maxImpact < 0));
  assert.ok(events.some((event) => event.minImpact > 0));
  assert.ok(Math.abs(expectedImpactSum) < 1e-10);
});

test("evento aplica retorno logarítmico e publica o impacto efetivo", async () => {
  const simulator = new MarketSimulator({ save: async () => {} });
  simulator.initialize({
    marketHistory: [
      { sequence: 0, price: 100, updatedAt: new Date().toISOString() },
    ],
    nextMarketEventAt: new Date(Date.now() - 1).toISOString(),
  });
  const originalRandom = Math.random;
  const randomValues = [0, 0, 0.5];
  Math.random = () => randomValues.shift() ?? 0.5;

  try {
    await simulator.tick();
  } finally {
    Math.random = originalRandom;
  }

  assert.equal(simulator.getStatus().currentPrice, 99.1);
  assert.equal(simulator.getStatus().latestEvent.impactPercent, -0.896);
});

test("ordens de compra e venda movimentam o preço em proporção ao notional", async () => {
  const simulator = new MarketSimulator({ save: async () => {} });
  simulator.initialize({
    marketHistory: [
      { sequence: 0, price: 100, updatedAt: new Date().toISOString() },
    ],
  });
  const { account } = await simulator.createAccount({ username: "impact_test" });

  const purchase = await simulator.placeOrder(account.accountId, {
    side: "BUY",
    quoteAmount: 200,
  });
  assert.equal(purchase.order.impactPercent, 0.4);
  assert.equal(purchase.market.currentPrice, 100.4);

  const sale = await simulator.placeOrder(account.accountId, {
    side: "SELL",
    assetAmount: 0.5,
  });
  assert.ok(sale.order.impactPercent < 0);
  assert.ok(sale.market.currentPrice < purchase.market.currentPrice);
});