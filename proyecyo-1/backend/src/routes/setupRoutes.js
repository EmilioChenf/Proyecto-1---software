const express = require("express");
const { requireAdmin } = require("../middlewares/requireAdmin");
const setup = require("../services/setupService");

const router = express.Router();
const handle = (run) => async (req, res, next) => { try { res.json(await run(req)); } catch (error) { next(error); } };
router.get("/admin/configuracion/primeros-pasos", requireAdmin, handle(() => setup.getSetupStatus()));
router.put("/admin/configuracion/primeros-pasos/oculto", requireAdmin, handle((req) => setup.setSetupHidden(req.body?.oculto !== false)));
router.post("/admin/configuracion/primeros-pasos/:paso/revisado", requireAdmin, handle((req) => setup.markStepReviewed(req.params.paso)));
module.exports = router;
