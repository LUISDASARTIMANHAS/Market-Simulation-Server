import { timingSafeEqual } from "node:crypto";
import { Router } from "express";
import { marketSimulator } from "../services/marketSimulator.js";
import { marketStateStore } from "../services/stateStore.js";
import { logger } from "../utils/logger.js";
import {
  recordNodeActivity,
  sanitizeNodePort,
  sanitizeNodeId,
  sanitizeNodeUrl,
  sanitizeNodeVersion,
} from "../services/clusterRegistry.js";
import {
  httpBadRequest,
  httpConflict,
  http404NotFound,
  httpUnauthorized,
} from "../utils/httpErrors.js";

export function createMarketSyncRouter({
  role = process.env.MARKET_SYNC_ROLE || "standalone",
  token = process.env.MARKET_SYNC_TOKEN || "",
  simulator = marketSimulator,
  store = marketStateStore,
} = {}) {
  const router = Router();

  const authenticateNode = (req, res, next) => {
    if (role !== "master") {
      return http404NotFound(res, "Sincronização master não habilitada.");
    }
    const supplied = Buffer.from(req.get("x-market-sync-token") || "");
    const expected = Buffer.from(token);
    if (
      !expected.length ||
      supplied.length !== expected.length ||
      !timingSafeEqual(supplied, expected)
    ) {
      return httpUnauthorized(res, "Token de sincronização inválido.");
    }
    req.syncNodeId = sanitizeNodeId(req.get("x-market-node-id"));
    const reported = Number.parseInt(
      req.get("x-market-node-revision") ?? "",
      10,
    );
    req.syncNodeRevision =
      Number.isInteger(reported) && reported >= 0 ? reported : null;
    req.syncNodeMetadata = {
      version: sanitizeNodeVersion(req.get("x-market-node-version")),
      port: sanitizeNodePort(req.get("x-market-node-port")),
      url: req.get("x-market-node-url") ?? undefined,
    };
    return next();
  };

  router.get("/status", authenticateNode, async (req, res) => {
    recordNodeActivity(req.syncNodeId, "status", req.syncNodeRevision, req.syncNodeMetadata);
    const state = await store.repository.getMarketState();
    return res.status(200).json({
      success: true,
      data: {
        revision: Number.isInteger(state?.syncRevision)
          ? state.syncRevision
          : 0,
      },
    });
  });

  router.get("/snapshot", authenticateNode, async (req, res) => {
    recordNodeActivity(req.syncNodeId, "pull", req.syncNodeRevision, req.syncNodeMetadata);
    const snapshot = await simulator.enqueue(() =>
      simulator.getBackupSnapshot(),
    );
    return res.status(200).json({ success: true, data: snapshot });
  });

  router.put("/snapshot", authenticateNode, async (req, res) => {
    const { baseRevision, snapshot } = req.body || {};
    if (
      !Number.isInteger(baseRevision) ||
      baseRevision < 0 ||
      !snapshot ||
      typeof snapshot !== "object"
    ) {
      return httpBadRequest(res, "Sincronizações ou snapshot inválido.");
    }

    try {
      const result = await simulator.enqueue(async () => {
        const currentState = await store.repository.getMarketState();
        const currentRevision = Number.isInteger(currentState?.syncRevision)
          ? currentState.syncRevision
          : 0;
        if (baseRevision !== currentRevision) {
          recordNodeActivity(
            req.syncNodeId,
            "conflict",
            req.syncNodeRevision,
            req.syncNodeMetadata,
          );
          return { conflict: true, revision: currentRevision };
        }

        await store.repository.replaceFullSnapshot({
          ...snapshot,
          marketState: {
            ...snapshot.marketState,
            syncRevision: currentRevision + 1,
          },
        });
        simulator.initialize(await store.load());
        const revision = currentRevision + 1;
        recordNodeActivity(req.syncNodeId, "push", revision, req.syncNodeMetadata);
        return { conflict: false, revision };
      });

      if (result.conflict) {
        return httpConflict(
          res,
          "O node está atrasado e deve baixar o snapshot do master.",
          { data: { revision: result.revision } },
        );
      }
      return res
        .status(200)
        .json({ success: true, data: { revision: result.revision } });
    } catch (error) {
      logger.warn("market_sync.snapshot_rejected", { message: error.message });
      return httpBadRequest(res, error.message);
    }
  });

  return router;
}

export default createMarketSyncRouter();
