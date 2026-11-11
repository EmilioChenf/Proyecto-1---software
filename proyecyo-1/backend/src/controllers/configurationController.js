const {
  getVisitScheduleConfig,
  updateVisitScheduleConfig,
  getGeneralConfiguration,
  updateGeneralConfiguration,
  getPublicBrand,
  updateBrand,
} = require("../services/configurationService");
const { getRequestMetadata, recordAudit } = require("../services/auditService");

async function getVisitSchedule(_req, res, next) {
  try {
    const schedule = await getVisitScheduleConfig();
    res.status(200).json(schedule);
  } catch (error) {
    next(error);
  }
}

async function getGeneral(req, res, next) {
  try {
    res.status(200).json(await getGeneralConfiguration());
  } catch (error) {
    next(error);
  }
}

async function updateGeneral(req, res, next) {
  try {
    const previous = await getGeneralConfiguration();
    const configuration = await updateGeneralConfiguration(req.body || {});
    await recordAudit({
      userId: req.authUser.id,
      action: "GENERAL_CONFIGURATION_UPDATED",
      entity: "CONFIGURACION",
      entityId: "general",
      previousData: previous,
      newData: configuration,
      metadata: getRequestMetadata(req),
    });
    res.status(200).json(configuration);
  } catch (error) {
    next(error);
  }
}

async function updateVisitSchedule(req, res, next) {
  try {
    const previous = await getVisitScheduleConfig();
    const schedule = await updateVisitScheduleConfig(req.body || {});
    await recordAudit({ userId: req.authUser.id, action: "VISIT_SCHEDULE_UPDATED", entity: "CONFIGURACION", entityId: "horarios-visita", previousData: previous, newData: schedule, metadata: getRequestMetadata(req) });
    res.status(200).json(schedule);
  } catch (error) {
    next(error);
  }
}

async function getBrand(_req, res, next) {
  try {
    res.set("Cache-Control", "public, max-age=60");
    res.status(200).json(await getPublicBrand());
  } catch (error) {
    next(error);
  }
}

async function putBrand(req, res, next) {
  try {
    const previous = await getPublicBrand();
    const brand = await updateBrand(req.body || {});
    await recordAudit({ userId: req.authUser.id, action: "GENERAL_CONFIGURATION_UPDATED", entity: "CONFIGURACION", entityId: "marca", previousData: previous, newData: brand, metadata: getRequestMetadata(req) });
    res.status(200).json(brand);
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getBrand,
  putBrand,
  getVisitSchedule,
  updateVisitSchedule,
  getGeneral,
  updateGeneral,
};
