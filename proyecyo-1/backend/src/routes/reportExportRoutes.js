const router = require("express").Router();
const { requireAdmin } = require("../middlewares/requireAdmin");
const reports = require("../services/reportExportService");

router.get('/admin/reportes/catalogo', requireAdmin, (_req, res) => {
  res.set('Cache-Control', 'no-store').json(reports.catalog());
});

router.get("/admin/reportes/exportar", requireAdmin, async (req, res, next) => {
  try {
    const { type, format } = reports.validate(req.query.reporte, req.query.formato);
    const filters = reports.validateFilters(req.query, type);
    const now = new Date();
    if (filters.vista === "hoy") {
      filters.desde = filters.hasta = reports.localTimestamp(now).slice(0, 10);
    }
    const data = await reports.rows(type, filters, now);
    const file = await reports[format === "pdf" ? "pdf" : "excel"](type, data, req.authUser.id, filters, now);
    const name = `nexus-${type}-${reports.localTimestamp(now).slice(0, 10)}.${format}`;
    res.set("Content-Type", format === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.set("Content-Disposition", `attachment; filename="${name}"`);
    res.set("Access-Control-Expose-Headers", "Content-Disposition");
    res.set("Cache-Control", "no-store");
    res.send(file);
  } catch (error) {
    next(error);
  }
});
module.exports = router;
