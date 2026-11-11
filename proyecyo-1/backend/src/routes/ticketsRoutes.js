const express = require("express");
const tickets = require("../services/ticketsService");
const { requireAdmin } = require("../middlewares/requireAdmin");
const { requireResidentOrTenant } = require("../middlewares/requireResident");
const { getRequestMetadata, recordAudit } = require("../services/auditService");

const router = express.Router();
const handle = (work, status = 200) => async (req, res, next) => {
  try { res.status(status).json(await work(req)); } catch (error) { next(error); }
};

// Residentes e inquilinos: sus propios reportes.
router.get("/tickets", requireResidentOrTenant, handle((req) => tickets.listTickets({ userId: req.authUser.id })));
router.post("/tickets", requireResidentOrTenant, handle((req) => tickets.createTicket(req.authUser.id, req.authUser.role, req.body || {}), 201));
router.get("/tickets/:id", requireResidentOrTenant, handle((req) => tickets.getTicket(req.params.id, { userId: req.authUser.id })));
router.post("/tickets/:id/comentarios", requireResidentOrTenant, handle((req) => tickets.addReporterComment(req.params.id, req.authUser.id, req.body || {}), 201));

// Administración: todos los reportes.
router.get("/admin/tickets", requireAdmin, handle((req) => tickets.listTickets({ estado: String(req.query.estado || ""), categoria: String(req.query.categoria || ""), search: String(req.query.q || "") })));
router.get("/admin/tickets/resumen", requireAdmin, handle(() => tickets.ticketSummary()));
router.get("/admin/tickets/:id", requireAdmin, handle((req) => tickets.getTicket(req.params.id, { admin: true })));
router.patch("/admin/tickets/:id", requireAdmin, handle(async (req) => {
  const ticket = await tickets.updateTicket(req.params.id, req.authUser.id, req.body || {});
  await recordAudit({ userId: req.authUser.id, action: "TICKET_UPDATED", entity: "TICKET", entityId: ticket.id_ticket, newData: { estado: ticket.estado, prioridad: ticket.prioridad }, metadata: getRequestMetadata(req) });
  return ticket;
}));

module.exports = router;
