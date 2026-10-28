const express = require("express");

const {
  getAmenities,
  getReservableAmenitiesUsers,
  getAmenitiesReservations,
  getAmenitiesReservationHistory,
  getOwnAmenitiesReservations,
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
} = require("../controllers/amenitiesReservationsController");
const { requireResident, requireTenant } = require("../middlewares/requireResident");
const { requireAdmin } = require("../middlewares/requireAdmin");

const router = express.Router();

// HU-C05.6: consulta propia sin ampliar los permisos de creación/cancelación.
router.get("/inquilino/reservas/amenidades", requireTenant, getOwnAmenitiesReservations);
router.get("/inquilino/reservas/amenidades/historial", requireTenant, getAmenitiesReservationHistory);

router.get("/amenidades", requireResident, getAmenities);
router.get("/reservas/amenidades", requireResident, getAmenitiesReservations);
router.get("/reservas/amenidades/historial", requireResident, getAmenitiesReservationHistory);
router.get("/reservas/amenidades/disponibilidad", requireResident, getAmenitiesAvailability);
router.get("/reservas/amenidades/disponibilidad-general", requireResident, getUnifiedAvailability);
router.get("/reservas/amenidades/conflicto", requireResident, getAmenitiesConflict);
router.post("/reservas/amenidades", requireResident, postAmenityReservation);
router.patch("/reservas/amenidades/:key", requireResident, patchAmenityReservation);
router.patch("/reservas/amenidades/:key/cancelar", requireResident, patchCancelAmenityReservation);

router.get("/admin/amenidades", requireAdmin, getAmenities);
router.get("/admin/amenidades/usuarios", requireAdmin, getReservableAmenitiesUsers);
router.get("/admin/amenidades/estadisticas", requireAdmin, getAdminAmenitiesStats);
router.put("/admin/amenidades/:id/horario", requireAdmin, putAdminAmenitySchedule);
router.get("/admin/reservas/amenidades", requireAdmin, getAdminAmenitiesReservations);
router.get(
  "/admin/reservas/amenidades/disponibilidad",
  requireAdmin,
  getAdminAmenitiesAvailability,
);
router.get("/admin/reservas/amenidades/conflicto", requireAdmin, getAdminAmenitiesConflict);
router.post("/admin/reservas/amenidades", requireAdmin, postAdminAmenityReservation);
router.patch(
  "/admin/reservas/amenidades/:key/cancelar",
  requireAdmin,
  patchAdminCancelAmenityReservation,
);

module.exports = router;
