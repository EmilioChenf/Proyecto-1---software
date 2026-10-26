const {
  listTenantProviders,
  getTenantProvidersHistory,
  listOwnerProviders,
  registerProvider,
  updateTenantProvider,
  updateOwnerProviderValidation,
} = require("../services/tenantProvidersService");

async function getTenantProviders(req, res, next) {
  try {
    const providers = await listTenantProviders(req.authUser.id, req.query || {});
    res.status(200).json(providers);
  } catch (error) {
    next(error);
  }
}

async function getTenantProviderHistory(req, res, next) {
  try {
    const history = await getTenantProvidersHistory(req.authUser.id, req.query || {});
    res.status(200).json(history);
  } catch (error) {
    next(error);
  }
}

async function patchTenantProvider(req, res, next) {
  try {
    const provider = await updateTenantProvider(req.authUser.id, req.params.id, req.body || {});
    res.status(200).json(provider);
  } catch (error) {
    next(error);
  }
}

async function getOwnerProviders(req, res, next) {
  try {
    const providers = await listOwnerProviders(req.authUser.id, req.query || {});
    res.status(200).json(providers);
  } catch (error) {
    next(error);
  }
}

async function patchOwnerProvider(req, res, next) {
  try {
    const provider = await updateOwnerProviderValidation(req.authUser.id, req.params.id, req.body || {});
    res.status(200).json(provider);
  } catch (error) {
    next(error);
  }
}

// HU-C06: inquilino y residente registran proveedores con el mismo servicio; el
// rol de la sesion decide en que unidad se registra.
async function postProvider(req, res, next) {
  try {
    const result = await registerProvider(
      { id: req.authUser.id, role: req.authUser.role },
      req.body || {},
    );
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getTenantProviders,
  getTenantProviderHistory,
  getOwnerProviders,
  postProvider,
  patchTenantProvider,
  patchOwnerProvider,
};
