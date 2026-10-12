import { Router } from "express";
import { marketSimulator } from "../services/marketSimulator.js";
import { getSyncService, listNodes } from "../services/clusterRegistry.js";
import { logger } from "../utils/logger.js";
import { requireAdministrator } from "./routeMiddleware.js";

const router = Router();

/**
 * Executa uma ação manual de sincronização em um node.
 * @param {'pull'|'push'} action
 * @returns {import('express').RequestHandler}
 */
const manualSync = (action) => async (req, res) => {
  const service = getSyncService();
  if (!service || service.role !== "node") {
    return res.status(400).json({
      success: false,
      message: "Ação disponível apenas em servidores node.",
    });
  }
  try {
    await marketSimulator.enqueue(() =>
      action === "pull" ? service.pullSnapshot() : service.pushSnapshot(),
    );
    logger.info("cluster.manual_sync", {
      action,
      administratorId: req.marketAccountId,
    });
    return res
      .status(200)
      .json({ success: true, data: await service.getStatus() });
  } catch (error) {
    if (error.syncConflict) {
      return res.status(409).json({ success: false, message: error.message });
    }
    logger.error("cluster.manual_sync_failed", {
      action,
      message: error.message,
    });
    return res.status(502).json({
      success: false,
      message: "Falha ao comunicar com o servidor master.",
    });
  }
};

router.get("/status", requireAdministrator, async (req, res) => {
  const service = getSyncService();
  if (!service) {
    return res.status(200).json({
      success: true,
      data: { syncEnabled: false, role: "standalone" },
    });
  }
  try {
    const data = await service.getStatus();
    if (data.role === "master") {
      data.nodes = listNodes(
        data.localRevision,
        Math.max(15000, service.intervalMs * 3),
      );
    }
    return res.status(200).json({ success: true, data });
  } catch (error) {
    logger.error("cluster.status_failed", { message: error.message });
    return res.status(500).json({
      success: false,
      message: "Não foi possível obter o estado do cluster.",
    });
  }
});

router.post("/pull", requireAdministrator, manualSync("pull"));
router.post("/push", requireAdministrator, manualSync("push"));

export default router;
