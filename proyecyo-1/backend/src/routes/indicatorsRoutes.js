const express = require("express");
const { requireAdmin } = require("../middlewares/requireAdmin");
const { getIndicators } = require("../services/indicatorsService");

const router = express.Router();
router.get("/admin/indicadores", requireAdmin, async (req, res, next) => {
  try {
    res.json(await getIndicators(req.query));
  } catch (error) {
    next(error);
  }
});
module.exports = router;
