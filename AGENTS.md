# AGENTS.md

## Project overview

This repository is a standalone Node.js + Express market simulator for paper trading. It exposes a public market status endpoint and authenticated account/order endpoints, while persisting market state locally to JSON.

Key code paths:

- HTTP bootstrap: [src/server.js](src/server.js)
- API routing and auth/rate-limit enforcement: [src/routes/marketRoutes.js](src/routes/marketRoutes.js)
- Central data access layer (MongoDB ready): [src/data/marketRepository.js](src/data/marketRepository.js)
- Atomic JSON persistence and concurrency control: [src/data/atomicJsonStore.js](src/data/atomicJsonStore.js)
- Money & asset precision helpers: [src/utils/money.js](src/utils/money.js)
- Business logic for market events, order matching, balances, and accounts: [src/services/marketSimulator.js](src/services/marketSimulator.js)
- State coordinator and legacy adapter: [src/services/stateStore.js](src/services/stateStore.js)
- Database migration script: [src/scripts/migrateDatabase.js](src/scripts/migrateDatabase.js)
- Modular data files: [data/](data/) (`accounts.json`, `assets.json`, `portfolios.json`, `orders.json`, `trades.json`, `market-history.json`, `market-events.json`, `market-state.json`)
- User-facing API and operational details: [README.md](README.md)

## Workflow and verification

- Install dependencies: `npm install`
- Run test suite: `npm test`
- Run/verify database migration: `npm run migrate`
- Start locally with auto-reload: `npm run dev`
- Start the standard app script: `npm start`
- Windows shortcut: `start.cmd`

Useful smoke checks:

- `curl http://localhost:3001/api/market/status`
- `curl -H "Authorization: Bearer <API_KEY>" http://localhost:3001/api/account`
- Confirm the server still restores and saves state in [data/market-state.json](data/market-state.json)

## Architecture and conventions

- The service uses Node.js 20+ and ES modules (`"type": "module"`).
- [src/server.js](src/server.js) initializes Express, attaches request logging, applies JSON parsing, and mounts `/api` routes.
- [src/routes/marketRoutes.js](src/routes/marketRoutes.js) owns route validation, Bearer-token auth, and in-memory rate limits. Preserve existing response shapes, status codes, and error messages unless a change is intentionally breaking.
- [src/services/marketSimulator.js](src/services/marketSimulator.js) is the business-logic source of truth for price movement, orders, account balances, and market history.
- [src/services/stateStore.js](src/services/stateStore.js) writes state via atomic rename-based JSON writes and migrates legacy state automatically when applicable.
- Default port: `3001`. Override with `MARKET_PORT`, `MARKET_STATE_FILE`, and `TRUST_PROXY`.

## Safety and compatibility rules

- Keep the public market status payload and authenticated account/order APIs backward compatible unless the change is explicitly breaking.
- Do not bypass the existing auth flow or rate-limit flow in [src/routes/marketRoutes.js](src/routes/marketRoutes.js).
- Do not introduce a new database, framework, or storage model without a clear reason and matching documentation updates.
- Preserve the paper-trading focus: this is not connected to a real exchange or broker.
- If changing order matching, price simulation, or account state, read the simulator and README examples before altering API contracts.
- If persistence changes, keep compatibility with legacy JSON state files and the existing migration behavior.
- If auth, rate-limit, or response formatting changes, keep them aligned with the existing public docs and client expectations.

## Key project-specific pitfalls

- The app persists only local JSON state; it does not share balances or market data across multiple independent instances.
- API keys are never stored in plaintext; only hashes are kept, and the value is returned to the creator only once during account creation or rotation.
- The public market status route is intentionally unauthenticated and should remain safe for clients that only need price/volume data.
- Request logging intentionally omits Authorization headers and request bodies; do not log secrets in new code.
- The app includes random market events that change price; do not treat those as real-world financial data.

## Preferred edit strategy

- Prefer small, localized changes around the request handler or simulator function being modified.
- Preserve current JSON schema fields unless a documented migration is part of the change.
- Update [README.md](README.md) when behavior, limits, or configuration changes are user-visible.
- Keep changes aligned with the existing single-authority market model described in the project docs.

## Useful files for context

- [README.md](README.md)
- [src/server.js](src/server.js)
- [src/routes/marketRoutes.js](src/routes/marketRoutes.js)
- [src/services/marketSimulator.js](src/services/marketSimulator.js)
- [src/services/stateStore.js](src/services/stateStore.js)
- [data/market-state.json](data/market-state.json)
