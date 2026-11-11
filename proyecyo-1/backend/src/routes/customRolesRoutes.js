const express = require("express");
const { requireRoles } = require("../middlewares/requireRoles");
const { getRequestMetadata, recordAudit } = require("../services/auditService");
const roles = require("../services/customRolesService");

const router = express.Router();
// Solo el administrador principal gestiona roles: un rol personalizado nunca puede darse más permisos.
const requireMainAdmin = (req, res, next) => requireRoles(["admin"], "Solo el administrador principal gestiona los roles.")(req, res, (error) => {
  if (error) return next(error);
  if (req.authUser?.role !== "admin") return next(Object.assign(new Error("Solo el administrador principal gestiona los roles."), { status: 403 }));
  return next();
});

function audited(action, run) {
  return async (req, res, next) => {
    try {
      const result = await run(req);
      await recordAudit({ userId: req.authUser.id, action, entity: "TIPO_USUARIO", entityId: result.id, newData: result, metadata: getRequestMetadata(req) });
      res.status(action === "ROLE_CREATED" ? 201 : 200).json(result);
    } catch (error) {
      next(error);
    }
  };
}

router.get("/admin/roles", requireMainAdmin, async (_req, res, next) => {
  try {
    res.json({ roles: await roles.listRoles(), modulos: roles.listModules(), colores: roles.COLORS });
  } catch (error) {
    next(error);
  }
});
router.post("/admin/roles", requireMainAdmin, audited("ROLE_CREATED", (req) => roles.createRole(req.body || {})));
router.put("/admin/roles/:id", requireMainAdmin, audited("ROLE_UPDATED", (req) => roles.updateRole(req.params.id, req.body || {})));
router.delete("/admin/roles/:id", requireMainAdmin, audited("ROLE_DELETED", (req) => roles.deleteRole(req.params.id)));

module.exports = router;
