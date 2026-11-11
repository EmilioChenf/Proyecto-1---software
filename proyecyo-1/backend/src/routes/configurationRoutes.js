const express = require("express");

const {
  getVisitSchedule,
  updateVisitSchedule,
  getGeneral,
  updateGeneral,
  getBrand,
  putBrand,
} = require("../controllers/configurationController");
const { requireAdmin } = require("../middlewares/requireAdmin");

const router = express.Router();

router.get("/configuracion/horarios-visita", getVisitSchedule);
router.get("/admin/configuracion/horarios-visita", requireAdmin, getVisitSchedule);
router.put("/admin/configuracion/horarios-visita", requireAdmin, updateVisitSchedule);
router.get("/configuracion/marca", getBrand);
router.put("/admin/configuracion/marca", requireAdmin, putBrand);
router.get("/admin/configuracion/general", requireAdmin, getGeneral);
router.put("/admin/configuracion/general", requireAdmin, updateGeneral);

module.exports = router;
