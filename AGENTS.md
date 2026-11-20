# AGENTS.md

## Project overview

This is a standalone Node.js 20+ and Express ES-module server for paper trading. It exposes REST APIs below `/api`, serves a static trader/admin web client from `public/`, and persists state locally in modular JSON files. It does not connect to real exchanges or brokers.

Use `README.md` and `docs/` for detailed public contracts:

- API endpoints and payloads: `docs/api-docs.md`
- Installation and environment variables: `docs/instalacao-e-configuracao.md`
- Market simulation mechanics: `docs/mecanica-do-mercado.md`
- Modular JSON persistence: `docs/arquivos-de-dados.md`
- Master/node synchronization: `docs/cluster-e-sincronizacao.md`

## Commands

- Install dependencies: `npm install`
- Standard startup: `npm start`
- Development with watch/reload: `npm run dev`
- Full test suite: `npm test`
- One test file: `node --test --test-force-exit test/<file>.test.js`
- Migration: `npm run migrate`
- Standalone Docker stack: `docker compose up -d --build`
- Cluster Docker stack: `docker compose -f compose.cluster.yaml up -d --build`
- Windows shortcut: `start.cmd`

There is no configured lint script.

Useful smoke check after startup:

```bash
curl http://localhost:3001/api/market/status
```

## Architecture

- `src/server.js` boots Express, applies logging and JSON parsing, mounts the `/api` route tree, restores state, starts market synchronization, starts the ticker, and serves `public/`.
- `src/routes/marketRoutes.js` composes feature route modules. Feature handlers live in `src/routes/*.routes.js`.
- `src/routes/routeMiddleware.js` owns Bearer API-key authentication, administrator checks, and Express rate-limit middleware.
- `src/services/marketSimulator.js` is the central in-memory authority for market ticks, events, accounts, order matching, balances, portfolios, and trade history.
- Focused `src/services/*Service.js` modules implement account, authentication, API-key, order, event, state, cluster, and administration behavior used by the simulator and routes.
- `src/data/marketRepository.js` is the central repository abstraction over the modular JSON collections.
- `src/services/stateStore.js` adapts the simulator's aggregated state to and from `MarketRepository` and runs legacy monolithic-to-modular migration when needed.
- `src/data/atomicJsonStore.js` validates payloads, serializes writes per file, writes temporary JSON files, and atomically renames them into place with Windows retry/copy fallback.
- `src/services/marketSyncService.js` implements standalone/master/node reconciliation with optimistic `syncRevision` concurrency control.
- `src/middleware/apiResponse.js` adds server metadata to JSON responses and owns API-wide 404/error handling.

## Persistence

The active modular state is stored in `data/`:

- `accounts.json`
- `assets.json`
- `portfolios.json`
- `orders.json`
- `trades.json`
- `market-history.json`
- `market-events.json`
- `market-state.json`

Conventions and constraints:

- `MARKET_DATA_DIR` selects the modular data directory.
- `MARKET_STATE_FILE` selects the state-file entry point used for legacy compatibility and migration.
- Preserve migration compatibility for monolithic state files.
- JSON writes are atomic per file, not one cross-file transaction. Do not assume that updating multiple collections is globally atomic.
- Use `roundMoney()` and `roundAsset()` from `src/utils/money.js` for financial and quantity calculations.
- Keep the market operation queue in `MarketSimulator`; account and order mutations must remain serialized within the in-memory authority.
- The configured simulated asset is `SIM` unless making an intentional multi-asset change.
- Backups and logs are separate from active collections; do not treat `data/backups/` or `data/logs/` as primary state.

## API conventions

- Feature routes are mounted below `/api` by `src/routes/marketRoutes.js`.
- Route modules should remain thin; put domain behavior in services and persistence in the repository/state layer.
- Protected account, order, and administrative endpoints must use the existing middleware instead of duplicating authentication or authorization.
- Preserve public routes and existing success/error payload shapes, status codes, and rate-limit middleware unless behavior is intentionally changed.
- API JSON responses commonly use `{ success, data }`. The response middleware adds `meta.server`.
- Public account payloads must not include `keyHash`.
- API keys are returned once during account creation or rotation. Persist only the SHA-256 key hash.
- Never log request bodies, Authorization headers, API keys, or plaintext credentials. The existing logger and request middleware omit these values.

## Cluster and synchronization

- Supported roles are `standalone`, `master`, and `node`.
- Node synchronization modes are `bidirectional` and `receive-only`.
- `MARKET_SYNC_TOKEN` is mandatory for master/node cluster operations.
- `MARKET_SYNC_MASTER_URL` is mandatory for node instances.
- In master mode, state saves increment `syncRevision`; in node mode, authoritative snapshots restore it.
- Preserve stale-snapshot conflict and reconciliation behavior. A stale node push must not overwrite a newer master state.
- Cluster metadata headers and reconciliation behavior are implemented in `src/services/marketSyncService.js` and `src/routes/sync.routes.js`.

## Configuration

Use `env.example` and `docs/instalacao-e-configuracao.md` as the sources for environment variables.

Important defaults and overrides include:

- `MARKET_PORT` defaults to `3001`
- `MARKET_STATE_FILE`
- `MARKET_DATA_DIR`
- `MARKET_LOG_DIRECTORY`
- `MARKET_ADMIN_TOKEN`
- `TRUST_PROXY`
- `MARKET_SYNC_ROLE`
- `MARKET_SYNC_MASTER_URL`
- `MARKET_SYNC_TOKEN`
- `MARKET_NODE_ID`
- `MARKET_NODE_PUBLIC_URL`
- `MARKET_NODE_SYNC_MODE`
- `MARKET_SYNC_INTERVAL_SECONDS`
- `MARKET_EVENT_MIN_INTERVAL_MS`
- `MARKET_EVENT_MAX_INTERVAL_MS`

Do not introduce a new environment variable without documenting it in `env.example` and the installation guide.

## Testing

Tests use Node's built-in `node:test` runner and ES modules.

- Run one file while iterating: `node --test --test-force-exit test/<file>.test.js`
- Run the complete suite: `npm test`
- Run migration validation: `npm run migrate`
- HTTP tests start temporary Express apps with `src/routes/marketRoutes.js`.
- Persistence tests may migrate, restore, or modify files under `data/`; inspect setup/cleanup before running them.
- Run the smallest relevant test first, then `npm test` for cross-cutting route, persistence, market, or synchronization changes.

## Safety and compatibility

- Preserve the paper-trading and educational purpose.
- Preserve existing JSON schemas unless migration is explicitly part of the change.
- Inspect `src/services/marketSimulator.js` and `docs/mecanica-do-mercado.md` before changing price simulation or order matching.
- Inspect the existing route and service implementation before inventing an endpoint or response contract.
- Keep authentication, authorization, rate limiting, and secret handling aligned with existing behavior.
- Preserve unrelated uncommitted changes, especially in `data/*.json`.
