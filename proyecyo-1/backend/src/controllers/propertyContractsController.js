const service = require('../services/propertyContractsService');
const { generateMonthlyBilling } = require('../services/monthlyBillingService');
const { getRequestMetadata } = require('../services/auditService');
const handler = (task) => async (req,res,next) => { try { res.json(await task(req)); } catch(error) { next(error); } };
module.exports = {
  getContracts:handler(req=>service.getHouseContracts(req.params.id)),
  putContract:handler(req=>service.configureHouse(req.params.id,req.body,req.authUser.id,getRequestMetadata(req))),
  getMaintenance:handler(async req=>({vigente:await service.getMaintenance(req.query.periodo),historial:await service.listMaintenance()})),
  postMaintenance:handler(req=>service.saveMaintenance(req.body,req.authUser.id,getRequestMetadata(req))),
  postBilling:handler(req=>generateMonthlyBilling({periodo:req.body.periodo,actor:req.authUser.id,metadata:getRequestMetadata(req)})),
};
