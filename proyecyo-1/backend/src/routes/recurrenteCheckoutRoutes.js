const express = require("express");
const { requireResidentSession } = require("../middlewares/requireResidentSession");
const { requireFinancialSession } = require('../middlewares/requireFinancialSession');
const { checkoutController, statusController, retryController } = require("../controllers/recurrenteCheckoutController");
const { createCheckoutService } = require("../services/recurrenteCheckoutService");
function recurrenteCheckoutRoutes(service = createCheckoutService()) {
  const router = express.Router();
  router.post('/inquilino/pagos/recurrente/checkout',requireFinancialSession,checkoutController(service));
  router.get('/inquilino/pagos/recurrente/checkouts/:reference',requireFinancialSession,statusController(service));
  router.post('/inquilino/pagos/recurrente/reintentar',requireFinancialSession,retryController(service));
  router.post("/residente/pagos/recurrente/checkout", requireResidentSession, checkoutController(service));
  router.get("/residente/pagos/recurrente/checkouts/:reference", requireResidentSession, statusController(service));
  router.post("/residente/pagos/recurrente/reintentar", requireResidentSession, retryController(service));
  return router;
}
module.exports = { recurrenteCheckoutRoutes };
