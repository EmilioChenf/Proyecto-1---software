const {
  listTenantPermissions,
  listTenantAuthorizationRequests,
  createTenantAuthorizationRequest,
  listResidentRegulations,
  listGuardDailyAccessHistory,
} = require("../services/sprintStoriesService");
const {
  listOwnerAuthorizationRequests,
  resolveOwnerAuthorizationRequest,
} = require("../services/tenantAuthorizationRequestsService");

async function getTenantPermissions(req, res, next) {
  try {
    const permissions = await listTenantPermissions(req.authUser.id);
    res.status(200).json(permissions);
  } catch (error) {
    next(error);
  }
}

async function getTenantAuthorizationRequests(req, res, next) {
  try {
    const requests = await listTenantAuthorizationRequests(req.authUser.id);
    res.status(200).json(requests);
  } catch (error) {
    next(error);
  }
}

async function postTenantAuthorizationRequest(req, res, next) {
  try {
    const request = await createTenantAuthorizationRequest(req.authUser.id, req.body || {});
    res.status(201).json(request);
  } catch (error) {
    next(error);
  }
}

async function getResidentRegulations(req, res, next) {
  try {
    const regulations = await listResidentRegulations(req.query || {});
    res.status(200).json(regulations);
  } catch (error) {
    next(error);
  }
}

async function getGuardAccessHistory(req, res, next) {
  try {
    const history = await listGuardDailyAccessHistory(req.query || {});
    res.status(200).json(history);
  } catch (error) {
    next(error);
  }
}

async function getOwnerAuthorizationRequests(req, res, next) {
  try {
    res.status(200).json(await listOwnerAuthorizationRequests(req.authUser.id, { estado: req.query.estado,companyOnly:req.authUser.role==='admin' }));
  } catch (error) {
    next(error);
  }
}

async function patchOwnerAuthorizationRequest(req, res, next) {
  try {
    res.status(200).json(await resolveOwnerAuthorizationRequest(req.authUser.id, req.params.id, req.body || {},{companyOnly:req.authUser.role==='admin'}));
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getOwnerAuthorizationRequests,
  patchOwnerAuthorizationRequest,
  getTenantPermissions,
  getTenantAuthorizationRequests,
  postTenantAuthorizationRequest,
  getResidentRegulations,
  getGuardAccessHistory,
};
