const router = require('express').Router();
const { requireAdmin } = require('../middlewares/requireAdmin');
const dashboard = require('../services/financialDashboardService');

router.get('/admin/finanzas/resumen', requireAdmin, async (req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store');
    res.json(await dashboard.summary(req.query));
  } catch (error) { next(error); }
});
module.exports = router;
