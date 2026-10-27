const {
  listAmenities,
  listReservableUsers,
  listReservationsByRange,
  listReservationHistory,
  getAmenityAvailability,
  getUnifiedAmenityAvailability,
  validateAmenityReservationConflict,
  createAmenityReservation,
  updateAmenityReservation,
  cancelAmenityReservation,
  adminCancelAmenityReservation,
  getAmenityStats,
  updateAmenitySchedule,
} = require("../services/amenitiesReservationsService");

// Identidad del administrador desde la sesion validada por requireAdmin (no desde x-user-id).
function getAdminViewer(req) {
  const headerUserId = Number(req.authUser?.id);

  return {
    role: "admin",
    id: Number.isInteger(headerUserId) && headerUserId > 0 ? headerUserId : null,
  };
}

async function getAmenities(_req, res, next) {
  try {
    const amenities = await listAmenities();
    res.status(200).json(amenities);
  } catch (error) {
    next(error);
  }
}

async function getReservableAmenitiesUsers(_req, res, next) {
  try {
    const users = await listReservableUsers();
    res.status(200).json(users);
  } catch (error) {
    next(error);
  }
}

async function getAmenitiesReservations(req, res, next) {
  try {
    const reservations = await listReservationsByRange(req.query.from, req.query.to, {
      id_amenidad: req.query.id_amenidad,
      id_usuario: req.query.id_usuario,
      includeUserDetails: false,
    });
    res.status(200).json(reservations);
  } catch (error) {
    next(error);
  }
}

async function getAmenitiesReservationHistory(req, res, next) {
  try {
    const history = await listReservationHistory(req.authUser.id);
    res.status(200).json(history);
  } catch (error) {
    next(error);
  }
}

async function getAdminAmenitiesReservations(req, res, next) {
  try {
    const reservations = await listReservationsByRange(req.query.from, req.query.to, {
      id_amenidad: req.query.id_amenidad,
      id_usuario: req.query.id_usuario,
      includeUserDetails: true,
      includeCanceled: true,
      estado: req.query.estado,
      unidad: req.query.unidad,
    });
    res.status(200).json(reservations);
  } catch (error) {
    next(error);
  }
}

async function getAdminAmenitiesStats(req, res, next) {
  try {
    const stats = await getAmenityStats(req.query.from, req.query.to, {
      id_amenidad: req.query.id_amenidad,
    });
    res.status(200).json(stats);
  } catch (error) {
    next(error);
  }
}

async function getAmenitiesAvailability(req, res, next) {
  try {
    const availability = await getAmenityAvailability(req.query.id_amenidad, req.query.fecha, {
      includeUserDetails: false,
    });
    res.status(200).json(availability);
  } catch (error) {
    next(error);
  }
}

async function getAdminAmenitiesAvailability(req, res, next) {
  try {
    const availability = await getAmenityAvailability(req.query.id_amenidad, req.query.fecha, {
      includeUserDetails: true,
    });
    res.status(200).json(availability);
  } catch (error) {
    next(error);
  }
}

async function getUnifiedAvailability(req, res, next) {
  try { res.status(200).json(await getUnifiedAmenityAvailability(req.query.fecha)); }
  catch (error) { next(error); }
}

async function getAmenitiesConflict(req, res, next) {
  try {
    const conflict = await validateAmenityReservationConflict(
      {
        ...req.query,
        id_usuario: req.authUser?.id,
      },
      {
        includeUserDetails: false,
        requireUserId: false,
        validateUserLimit: true,
      },
    );
    res.status(200).json(conflict);
  } catch (error) {
    next(error);
  }
}

async function getAdminAmenitiesConflict(req, res, next) {
  try {
    const conflict = await validateAmenityReservationConflict(req.query, {
      includeUserDetails: true,
      requireUserId: false,
      validateUserLimit: true,
    });
    res.status(200).json(conflict);
  } catch (error) {
    next(error);
  }
}

async function postAmenityReservation(req, res, next) {
  try {
    const reservation = await createAmenityReservation(req.authUser, req.body || {});
    res.status(201).json(reservation);
  } catch (error) {
    next(error);
  }
}

async function patchAmenityReservation(req, res, next) {
  try {
    const reservation = await updateAmenityReservation(req.authUser, req.params.key, req.body || {});
    res.status(200).json(reservation);
  } catch (error) {
    next(error);
  }
}

async function patchCancelAmenityReservation(req, res, next) {
  try {
    const reservation = await cancelAmenityReservation(req.authUser, req.params.key, req.body || {});
    res.status(200).json(reservation);
  } catch (error) {
    next(error);
  }
}

async function postAdminAmenityReservation(req, res, next) {
  try {
    const reservation = await createAmenityReservation(getAdminViewer(req), req.body || {});
    res.status(201).json(reservation);
  } catch (error) {
    next(error);
  }
}

// HU-C05.4: cancelacion administrativa; el administrador sale de la sesion validada.
async function patchAdminCancelAmenityReservation(req, res, next) {
  try {
    const reservation = await adminCancelAmenityReservation(getAdminViewer(req), req.params.key, req.body || {});
    res.status(200).json(reservation);
  } catch (error) {
    next(error);
  }
}

async function putAdminAmenitySchedule(req, res, next) {
  try {
    const amenity = await updateAmenitySchedule(Number(req.params.id), req.body || {});
    res.status(200).json(amenity);
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getAmenities,
  getReservableAmenitiesUsers,
  getAmenitiesReservations,
  getAmenitiesReservationHistory,
  getAdminAmenitiesReservations,
  getAdminAmenitiesStats,
  getAmenitiesAvailability,
  getAdminAmenitiesAvailability,
  getUnifiedAvailability,
  getAmenitiesConflict,
  getAdminAmenitiesConflict,
  postAmenityReservation,
  patchAmenityReservation,
  patchCancelAmenityReservation,
  postAdminAmenityReservation,
  patchAdminCancelAmenityReservation,
  putAdminAmenitySchedule,
};
