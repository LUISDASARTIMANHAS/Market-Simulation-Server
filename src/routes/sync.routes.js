import { timingSafeEqual } from "node:crypto";
import { Router } from "express";
import { marketSimulator } from "../services/marketSimulator.js";
import { marketStateStore } from "../services/stateStore.js";
import { logger } from "../utils/logger.js";
import {
  recordNodeActivity,
  sanitizeNodeId,
} from "../services/clusterRegistry.js";

export function createMarketSyncRouter({
  role = process.env.MARKET_SYNC_ROLE || "standalone",
  token = process.env.MARKET_SYNC_TOKEN || "",
  simulator = marketSimulator,
  store = marketStateStore,
} = {}) {
  const router = Router();

  const authenticateNode = (req, res, next) => {
    if (role !== "master") {
      return res.status(404).json({
        success: false,
        message: "Sincronização master não habilitada.",
      });
    }
    const supplied = Buffer.from(req.get("x-market-sync-token") || "");
    const expected = Buffer.from(token);
    if (
      !expected.length ||
      supplied.length !== expected.length ||
      !timingSafeEqual(supplied, expected)
    ) {
      return res
        .status(401)
        .json({ success: false, message: "Token de sincronização inválido." });
    }
    req.syncNodeId = sanitizeNodeId(req.get("x-market-node-id"));
    const reported = Number.parseInt(
      req.get("x-market-node-revision") ?? "",
      10,
    );
    req.syncNodeRevision =
      Number.isInteger(reported) && reported >= 0 ? reported : null;
    return next();
  };

  router.get("/status", authenticateNode, async (req, res) => {
    recordNodeActivity(req.syncNodeId, "status", req.syncNodeRevision);
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
    recordNodeActivity(req.syncNodeId, "pull", req.syncNodeRevision);
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
      return res
        .status(400)
        .json({ success: false, message: "Revisão ou snapshot inválido." });
    }

    try {
      const result = await simulator.enqueue(async () => {
        const currentState = await store.repository.getMarketState();
        recordNodeActivity(
          req.syncNodeId,
          result.conflict ? "conflict" : "push",
          result.conflict ? req.syncNodeRevision : result.revision,
        );
        const currentRevision = Number.isInteger(currentState?.syncRevision)
          ? currentState.syncRevision
          : 0;
        if (baseRevision !== currentRevision)
          return { conflict: true, revision: currentRevision };

        await store.repository.replaceFullSnapshot({
          ...snapshot,
          marketState: {
            ...snapshot.marketState,
            syncRevision: currentRevision + 1,
          },
        });
        simulator.initialize(await store.load());
        return { conflict: false, revision: currentRevision + 1 };
      });

      if (result.conflict) {
        return res.status(409).json({
          success: false,
          message: "O node está atrasado e deve baixar o snapshot do master.",
          data: { revision: result.revision },
        });
      }
      return res
        .status(200)
        .json({ success: true, data: { revision: result.revision } });
    } catch (error) {
      logger.warn("market_sync.snapshot_rejected", { message: error.message });
      return res.status(400).json({ success: false, message: error.message });
    }
  });

  return router;
}

export default createMarketSyncRouter();
