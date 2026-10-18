const {
  listResidentVisits,
  listFrequentVisitors,
  createVisit,
  updateVisit,
  deleteVisit,
  cancelVisit,
  deleteFrequentVisitor,
  getGuardShiftVisits,
  registerQrEntry,
  registerQrExit,
} = require("../services/visitsService");
const { getRequestMetadata } = require("../services/auditService");

async function getVisits(req, res, next) {
  try {
    const visits = await listResidentVisits(req.authUser.id, req.authUser.role);
    res.status(200).json(visits);
  } catch (error) {
    next(error);
  }
}

async function getFrequentVisitors(req, res, next) {
  try {
    const visitors = await listFrequentVisitors(req.authUser.id, req.authUser.role);
    res.status(200).json(visitors);
  } catch (error) {
    next(error);
  }
}

async function postVisit(req, res, next) {
  try {
    const visit = await createVisit(req.authUser.id, req.authUser.role, req.body || {});
    res.status(201).json(visit);
  } catch (error) {
    next(error);
  }
}

async function patchVisit(req, res, next) {
  try {
    const visit = await updateVisit(req.authUser.id, req.authUser.role, Number(req.params.id), req.body || {});
    res.status(200).json(visit);
  } catch (error) {
    next(error);
  }
}

async function removeVisit(req, res, next) {
  try {
    const visit = await deleteVisit(req.authUser.id, req.authUser.role, Number(req.params.id));
    res.status(200).json(visit);
  } catch (error) {
    next(error);
  }
}

async function patchCancelVisit(req, res, next) {
  try {
    const visit = await cancelVisit(req.authUser.id, req.authUser.role, Number(req.params.id));
    res.status(200).json(visit);
  } catch (error) {
    next(error);
  }
}

async function removeFrequentVisitor(req, res, next) {
  try {
    const result = await deleteFrequentVisitor(req.authUser.id, req.authUser.role, Number(req.params.id));
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

async function getGuardVisits(_req, res, next) {
  try {
    const visits = await getGuardShiftVisits();
    res.status(200).json(visits);
  } catch (error) {
    next(error);
  }
}

async function postValidateQr(req, res, next) {
  try {
    const visit = await registerQrEntry((req.body || {}).qrToken, req.authUser.id, getRequestMetadata(req));
    res.status(200).json(visit);
  } catch (error) {
    next(error);
  }
}

async function postRegisterQrEntry(req, res, next) {
  try {
    const visit = await registerQrEntry((req.body || {}).qrToken, req.authUser.id, getRequestMetadata(req));
    res.status(200).json(visit);
  } catch (error) {
    next(error);
  }
}

async function postRegisterQrExit(req, res, next) {
  try {
    const visit = await registerQrExit((req.body || {}).qrToken, req.authUser.id, getRequestMetadata(req));
    res.status(200).json(visit);
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getVisits,
  getFrequentVisitors,
  postVisit,
  patchVisit,
  removeVisit,
  patchCancelVisit,
  removeFrequentVisitor,
  getGuardVisits,
  postValidateQr,
  postRegisterQrEntry,
  postRegisterQrExit,
};
