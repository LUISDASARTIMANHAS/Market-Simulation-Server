# AGENTS.md

## Project overview
This repository contains a standalone Node.js Express service that simulates a market, persists state locally, and exposes public and authenticated APIs for paper trading. The main entry point is [src/server.js](src/server.js), with routing in [src/routes/marketRoutes.js](src/routes/marketRoutes.js), business logic in [src/services/marketSimulator.js](src/services/marketSimulator.js), and JSON persistence in [src/services/stateStore.js](src/services/stateStore.js).

For API behavior, environment variables, rate limits, and usage examples, see [README.md](README.md). The runtime state is stored in [data/market-state.json](data/market-state.json).

## Commands and workflow
- Install dependencies: `npm install`
- Start the app: `npm start`
- Development watch mode: `npm run dev`
- Windows convenience launcher: `start.cmd`

This repo does not currently include an automated test suite. Validate changes by starting the server and checking the affected endpoint or behavior directly.

## Architecture and conventions
- The project uses Node.js 20+ and ES modules (`"type": "module"`).
- Express is initialized in [src/server.js](src/server.js) and mounts all routes under `/api`.
- Route authentication and rate limiting live in [src/routes/marketRoutes.js](src/routes/marketRoutes.js). Preserve the current response format and status codes when editing these handlers.
- Market simulation and account/order logic live in [src/services/marketSimulator.js](src/services/marketSimulator.js). Treat this as the business-logic source of truth.
- Persistent state is written through [src/services/stateStore.js](src/services/stateStore.js), which performs atomic JSON writes and migrates legacy state if needed.
- Default server port is `3001`. Overridable env vars: `MARKET_PORT`, `MARKET_STATE_FILE`, and `TRUST_PROXY`.

## Do and do not do
- Keep the public market status payload and authenticated account/order APIs backward compatible unless the change is intentionally breaking.
- Preserve the existing pattern of in-memory rate-limit enforcement, Bearer-token authentication, and JSON persistence.
- Prefer local, surgical edits over broad refactors.
- Do not introduce new frameworks, a database, or a different storage model without a clear reason and matching documentation updates.
- Keep this service aligned with the README’s paper-trading scope: it is not connected to a real exchange or broker.

## Safe change guidance
- When touching order matching, price movement, or account state, check the simulator and read the README examples before changing API contracts.
- If changing persistence behavior, keep migration compatibility with legacy state files in mind.
- If rate limits or auth logic change, ensure they remain consistent with the current public documentation and expected client behavior.

## Useful files for context
- [README.md](README.md)
- [src/server.js](src/server.js)
- [src/routes/marketRoutes.js](src/routes/marketRoutes.js)
- [src/services/marketSimulator.js](src/services/marketSimulator.js)
- [src/services/stateStore.js](src/services/stateStore.js)
- [data/market-state.json](data/market-state.json)
