# Copilot Instructions

## Project overview

This is a Node.js 20+ Express ES-module server for paper trading. It exposes REST APIs under `/api`, a static trader/admin web client, and optional master/node cluster synchronization. It does not connect to a real exchange or broker.

Use the detailed documentation in `README.md` and `docs/` when changing behavior or configuration. API contracts are documented in `docs/api-docs.md`; persistence and cluster behavior are documented in `docs/arquivos-de-dados.md` and `docs/cluster-e-sincronizacao.md`.

## Commands

- Install dependencies: `npm install`
- Start with the standard script: `npm start`
- Start development mode: `npm run dev`
- Run the full test suite: `npm test`
- Run one test file: `node --test --test-force-exit test/<file>.test.js`
- Example: `node --test --test-force-exit test/httpApi.test.js`
- Run or validate the JSON-to-modular migration: `npm run migrate`
- Windows shortcut: `start.cmd`
- Docker standalone: `docker compose up -d --build`
- Docker cluster: `docker compose -f compose.cluster.yaml up -d --build`

There is no separate lint script or configured linter.

Useful local smoke check: `curl http://localhost:3001/api/market/status`.

## Architecture

- `src/server.js` boots Express, serves `public/`, mounts the API response middleware and route tree, restores state, starts synchronization, and starts the market ticker.
- `src/routes/marketRoutes.js` is only the route manager. Feature route modules live in `src/routes/*.routes.js` and are mounted below `/api`.
- `src/routes/routeMiddleware.js` owns Bearer API-key authentication, administrator checks, and rate-limit middleware.
- `src/services/marketSimulator.js` is the main stateful business-logic authority for ticks, events, account operations, order matching, balances, and trade history.
- Related account, order, authentication, key, event, and market-state logic is split into focused `src/services/*Service.js` modules and utilities; route handlers should delegate to these services rather than implement domain rules.
- `src/data/marketRepository.js` is the central data-access abstraction over the modular JSON collections.
- `src/services/stateStore.js` adapts the simulator's aggregated state to and from `MarketRepository`; it also performs legacy JSON migration.
- `src/data/atomicJsonStore.js` validates JSON data, writes temporary files, renames them into place with Windows retry/copy fallback, and serializes concurrent writes per file.
- `src/services/marketSyncService.js` implements standalone/master/node reconciliation. `syncRevision` provides optimistic concurrency; node snapshot pushes with stale revisions are rejected.
- Static UI assets are in `public/`; API-facing behavior and route contracts must remain consistent with the existing UI.

## Persistence and state

- The active persisted collections are in `data/`: `accounts.json`, `assets.json`, `portfolios.json`, `orders.json`, `trades.json`, `market-history.json`, `market-events.json`, and `market-state.json`.
- `MARKET_DATA_DIR` selects the modular data directory. `MARKET_STATE_FILE` selects the state-file entry point and is used by migration/state-store compatibility paths.
- Preserve legacy monolithic state compatibility. `JsonStateStore.load()` may migrate a legacy state file through `runMigration()` automatically.
- JSON writes are per-file operations, not one distributed transaction. Do not assume cross-file atomicity.
- Use `roundMoney()` and `roundAsset()` from `src/utils/money.js` for balance, price, quantity, and total calculations. Preserve the configured single asset ID `SIM` unless a multi-asset change is intentional.
- The market simulator serializes mutations through `operationQueue`; account and order changes should remain serialized within the simulator rather than being applied concurrently.
- API keys are generated once and returned only at creation/rotation. Persist only `keyHash` values; never add plaintext API keys to JSON state or logs.

## API conventions

- Mount feature routes below `/api` using the existing `router` structure in `src/routes/marketRoutes.js`.
- Keep public market and backup routes public only when explicitly required. Protected account/admin/order routes must use `requireApiAccount` or `requireAdministrator` from `src/routes/routeMiddleware.js`.
- Apply existing rate-limit middleware to account creation, orders, and key rotation; do not bypass it in new handlers.
- Preserve existing success/error response shapes and status codes. API JSON responses are wrapped by `createApiResponseMiddleware()` with `meta.server`, and route-level payloads commonly use `{ success, data }`.
- Route modules should be thin and log failures at the appropriate level. Use `httpError()`/the helpers in `src/utils/httpErrors.js` rather than directly inventing error contracts.
- Public requests must not expose account key hashes. Existing payload code explicitly strips `keyHash` from account responses.
- Request logging sanitizes and omits credentials and bodies; do not add secrets or request payload contents to new logs.

## Cluster and configuration

- Supported roles are `standalone`, `master`, and `node`. The node mode is `bidirectional` or `receive-only`.
- Cluster operations require `MARKET_SYNC_TOKEN`. A node also requires `MARKET_SYNC_MASTER_URL`.
- In master mode, persisted `syncRevision` increments on state saves. In node/standalone modes, it is preserved unless the node receives an authoritative snapshot.
- A stale node snapshot must return conflict semantics instead of overwriting the master. Keep snapshot, revision, and rollback behavior aligned with `docs/cluster-e-sincronizacao.md`.
- Use `env.example` and `docs/instalacao-e-configuracao.md` as the sources for environment variables. Do not introduce a configuration variable without documenting it.

## Testing expectations

- Tests use Node's built-in `node:test` runner and run under ES modules.
- HTTP tests construct a temporary Express app with `src/routes/marketRoutes.js`; use the test files as examples for API integration setup.
- Persistence tests may use real modular `data/` state or migrate/restore fixtures. Inspect the relevant test's setup and cleanup before changing state files or running the full suite.
- Run the smallest relevant test file while iterating. The full suite may depend on shared market state and migration cleanup.
