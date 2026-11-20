---
name: market-simulation-server
description: Orienta sessões futuras sobre arquitetura, comandos e convenções deste servidor de market simulation.
---

# Market Simulation Server

Use esta skill para alterações neste repositório.

## Before changes

- Read `AGENTS.md` and `.github/copilot-instructions.md`.
- Read `README.md` and the relevant file under `docs/` before changing public behavior, persistence, synchronization, or configuration.
- Check `git status --short` before editing and preserve unrelated data-file changes.
- This project is Node.js 20+ with ES modules and Express.

## Architecture

- `src/server.js`: HTTP bootstrap, static files, API middleware, state restore, ticker startup, and cluster startup.
- `src/routes/marketRoutes.js`: route composition only.
- `src/routes/*.routes.js`: feature handlers mounted below `/api`.
- `src/routes/routeMiddleware.js`: Bearer authentication, administrator checks, and rate limits.
- `src/services/marketSimulator.js`: authoritative in-memory market, account, balance, order, event, and trade logic.
- `src/services/*Service.js`: focused domain services used by the simulator.
- `src/data/marketRepository.js`: central modular JSON data access.
- `src/services/stateStore.js`: aggregated state adapter and legacy migration.
- `src/data/atomicJsonStore.js`: validated, atomic, serialized JSON writes.
- `src/services/marketSyncService.js`: standalone/master/node synchronization.

## Commands

- Install: `npm install`
- Development: `npm run dev`
- Standard startup: `npm start`
- Full tests: `npm test`
- One test: `node --test --test-force-exit test/<file>.test.js`
- Migration: `npm run migrate`
- Docker standalone: `docker compose up -d --build`
- Docker cluster: `docker compose -f compose.cluster.yaml up -d --build`

There is no configured lint script.

## Repository conventions

- Keep feature routes thin; place domain behavior in `src/services/` and persistence in `src/data/`.
- Preserve `/api` response shapes, status codes, and public/administrative authentication boundaries.
- Preserve API-key security: store only SHA-256 hashes and never log or expose plaintext keys.
- Use `roundMoney()` and `roundAsset()` for monetary and asset calculations.
- Keep mutations serialized through the market simulator's operation queue.
- Treat JSON persistence as per-file atomic writes, not a cross-file transaction.
- Preserve legacy monolithic state migration and modular `data/` compatibility.
- Preserve `syncRevision` and conflict behavior for master/node synchronization.
- Do not expose `keyHash` in account responses.
- Do not add secrets or Authorization headers to logs.
- Before changing price or order behavior, inspect `src/services/marketSimulator.js` and `docs/mecanica-do-mercado.md`.

## Verification

- Run the smallest relevant test file during iteration.
- Run `npm test` after cross-cutting route, service, persistence, or synchronization changes.
- Run `npm run migrate` when changing migration or persistence compatibility.
- Smoke-check `GET http://localhost:3001/api/market/status`.
