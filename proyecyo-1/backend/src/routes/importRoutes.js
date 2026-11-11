const express = require("express");
const { requireAdmin } = require("../middlewares/requireAdmin");
const { getRequestMetadata, recordAudit } = require("../services/auditService");
const importer = require("../services/importService");

const router = express.Router();
router.get("/admin/importar/plantilla", requireAdmin, async (_req, res, next) => {
  try {
    res.set({ "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": 'attachment; filename="plantilla-importacion-nexus.xlsx"', "Access-Control-Expose-Headers": "Content-Disposition" });
    res.send(await importer.buildTemplate());
  } catch (error) { next(error); }
});
router.post("/admin/importar/vista-previa", requireAdmin, async (req, res, next) => {
  try { res.json(await importer.previewImport(req.body?.archivo)); } catch (error) { next(error); }
});
router.post("/admin/importar/aplicar", requireAdmin, async (req, res, next) => {
  try {
    const report = await importer.applyImport(req.body?.archivo, { invitar: req.body?.invitar !== false });
    await recordAudit({ userId: req.authUser.id, action: "DATA_IMPORTED", entity: "IMPORTACION", entityId: null, newData: report, metadata: getRequestMetadata(req) });
    res.json(report);
  } catch (error) { next(error); }
});
module.exports = router;
