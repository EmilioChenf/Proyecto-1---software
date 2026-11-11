const express = require("express");
const { requireAdmin } = require("../middlewares/requireAdmin");
const { getRequestMetadata, recordAudit } = require("../services/auditService");
const fel = require("../services/felService");
const { getIntegrationStatus } = require("../services/paymentsIntegrationService");

const router = express.Router();
router.get("/admin/pagos/integracion", requireAdmin, async (req, res, next) => {
  try { res.set("Cache-Control", "no-store").json(await getIntegrationStatus({ test: req.query.probar === "1" })); } catch (error) { next(error); }
});
router.get("/admin/configuracion/fiscal", requireAdmin, async (_req, res, next) => {
  try { res.json(await fel.getFiscalSettings()); } catch (error) { next(error); }
});
router.put("/admin/configuracion/fiscal", requireAdmin, async (req, res, next) => {
  try {
    const saved = await fel.updateFiscalSettings(req.body || {});
    await recordAudit({ userId: req.authUser.id, action: "FISCAL_SETTINGS_UPDATED", entity: "CONFIGURACION", entityId: "fel", newData: saved, metadata: getRequestMetadata(req) });
    res.json(saved);
  } catch (error) { next(error); }
});
module.exports = router;
