const express = require("express");

const {
  getVisits,
  getFrequentVisitors,
  postVisit,
  patchVisit,
  removeVisit,
  patchCancelVisit,
  removeFrequentVisitor,
  patchFrequentVisitor,
  getGuardVisits,
  postValidateQr,
  postRegisterQrEntry,
  postRegisterQrExit,
} = require("../controllers/visitsController");
const { requireResidentOrTenant } = require("../middlewares/requireResident");
const { requireGuard } = require("../middlewares/requireGuard");

const router = express.Router();

router.get("/visitas", requireResidentOrTenant, getVisits);
router.get("/visitantes-frecuentes", requireResidentOrTenant, getFrequentVisitors);
router.patch("/visitantes-frecuentes/:id", requireResidentOrTenant, patchFrequentVisitor);
router.delete("/visitantes-frecuentes/:id", requireResidentOrTenant, removeFrequentVisitor);
router.post("/visitas", requireResidentOrTenant, postVisit);
router.patch("/visitas/:id", requireResidentOrTenant, patchVisit);
router.delete("/visitas/:id", requireResidentOrTenant, removeVisit);
router.patch("/visitas/:id/cancelar", requireResidentOrTenant, patchCancelVisit);
router.get("/guardia/visitas", requireGuard, getGuardVisits);
router.post("/guardia/validar-qr", requireGuard, postValidateQr);
router.post("/guardia/registrar-ingreso", requireGuard, postRegisterQrEntry);
router.post("/guardia/registrar-salida", requireGuard, postRegisterQrExit);

module.exports = router;
