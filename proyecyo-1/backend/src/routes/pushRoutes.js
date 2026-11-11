const express = require("express");
const { requireRoles } = require("../middlewares/requireRoles");
const push = require("../services/pushService");

const router = express.Router();
const requireUser = requireRoles(["admin", "guardia", "residente", "inquilino"]);
router.get("/push/clave-publica", (_req, res) => {
  const config = push.pushConfig();
  res.json({ activo: Boolean(config), clave: config?.publicKey ?? null });
});
router.post("/push/suscripciones", requireUser, async (req, res, next) => {
  try { res.status(201).json(await push.subscribe(req.authUser.id, req.body || {}, req.header("user-agent"))); } catch (error) { next(error); }
});
router.delete("/push/suscripciones", requireUser, async (req, res, next) => {
  try { res.json(await push.unsubscribe(req.authUser.id, req.body?.endpoint)); } catch (error) { next(error); }
});
module.exports = router;
