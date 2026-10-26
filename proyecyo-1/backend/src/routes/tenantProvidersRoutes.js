const express = require("express");

const {
  getTenantProviders,
  getTenantProviderHistory,
  getOwnerProviders,
  postProvider,
  patchTenantProvider,
  patchOwnerProvider,
} = require("../controllers/tenantProvidersController");
const { requireResident, requireTenant } = require("../middlewares/requireResident");

const router = express.Router();

// HU-C06.2: los permisos del backend coinciden con las pantallas del frontend.
// /inquilino/* resuelve la unidad del inquilino, asi que solo lo usa el inquilino;
// el residente gestiona y registra sus proveedores en /residente/*.
router.get("/inquilino/proveedores", requireTenant, getTenantProviders);
router.get("/inquilino/proveedores/historial", requireTenant, getTenantProviderHistory);
router.post("/inquilino/proveedores", requireTenant, postProvider);
router.patch("/inquilino/proveedores/:id", requireTenant, patchTenantProvider);
router.get("/residente/proveedores", requireResident, getOwnerProviders);
router.post("/residente/proveedores", requireResident, postProvider);
router.patch("/residente/proveedores/:id", requireResident, patchOwnerProvider);

module.exports = router;
