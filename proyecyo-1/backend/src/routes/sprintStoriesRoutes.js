const express = require("express");

const {
  getTenantPermissions,
  getTenantAuthorizationRequests,
  postTenantAuthorizationRequest,
  getResidentRegulations,
  getGuardAccessHistory,
  getOwnerAuthorizationRequests,
  patchOwnerAuthorizationRequest,
} = require("../controllers/sprintStoriesController");
const { requireGuard } = require("../middlewares/requireGuard");
const { requireResident, requireResidentOrTenant } = require("../middlewares/requireResident");

const router = express.Router();
const {requireAdmin}=require('../middlewares/requireAdmin');
router.get('/admin/solicitudes-arrendatarios',requireAdmin,getOwnerAuthorizationRequests);
router.patch('/admin/solicitudes-arrendatarios/:id',requireAdmin,patchOwnerAuthorizationRequest);

router.get("/inquilino/permisos", requireResidentOrTenant, getTenantPermissions);
router.get("/inquilino/autorizaciones", requireResidentOrTenant, getTenantAuthorizationRequests);
router.post("/inquilino/autorizaciones", requireResidentOrTenant, postTenantAuthorizationRequest);
router.get("/residente/reglamentos", requireResident, getResidentRegulations);
// HU32: el residente propietario resuelve las solicitudes de inquilinos de sus unidades.
router.get("/residente/solicitudes-autorizacion", requireResident, getOwnerAuthorizationRequests);
router.patch("/residente/solicitudes-autorizacion/:id", requireResident, patchOwnerAuthorizationRequest);
router.get("/guardia/historial-accesos", requireGuard, getGuardAccessHistory);

module.exports = router;
