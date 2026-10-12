const router = require('express').Router();
const { requireAdmin } = require('../middlewares/requireAdmin');
const c = require('../controllers/propertyContractsController');
router.get('/admin/viviendas/:id/contratos',requireAdmin,c.getContracts);
router.put('/admin/viviendas/:id/contrato',requireAdmin,c.putContract);
router.get('/admin/mantenimiento-global',requireAdmin,c.getMaintenance);
router.post('/admin/mantenimiento-global',requireAdmin,c.postMaintenance);
router.post('/admin/facturacion-mensual',requireAdmin,c.postBilling);
module.exports = router;
