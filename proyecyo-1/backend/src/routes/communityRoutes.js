const express = require("express");
const { requireAdmin } = require("../middlewares/requireAdmin");
const { requireRoles } = require("../middlewares/requireRoles");
const { getRequestMetadata, recordAudit } = require("../services/auditService");
const community = require("../services/communityService");

const router = express.Router();
const requireCommunityMember = requireRoles(["residente", "inquilino", "guardia"], "Acceso restringido a la comunidad.");

const handle = (run, status = 200) => async (req, res, next) => {
  try { res.status(status).json(await run(req)); } catch (error) { next(error); }
};
const audited = (action, entity, run, status = 200) => async (req, res, next) => {
  try {
    const result = await run(req);
    const id = result?.id_votacion ?? result?.id_documento ?? result?.id_contacto ?? req.params.id;
    await recordAudit({ userId: req.authUser.id, action, entity, entityId: id, newData: result, metadata: getRequestMetadata(req) });
    res.status(status).json(result);
  } catch (error) { next(error); }
};
const sendFile = async (req, res, next) => {
  try {
    const file = await community.getDocumentFile(req.params.id);
    res.set({ "Content-Type": file.mime, "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.nombre)}`, "Cache-Control": "private, no-store" });
    res.send(file.buffer);
  } catch (error) { next(error); }
};
const me = (req) => ({ userId: req.authUser.id, role: req.authUser.role });

// Residentes, inquilinos (y guardia para el directorio)
router.get("/comunidad/votaciones", requireCommunityMember, handle((req) => community.listPolls(me(req))));
router.post("/comunidad/votaciones/:id/votar", requireCommunityMember, handle((req) => community.vote(req.params.id, req.authUser.id, req.authUser.role, req.body?.id_opcion)));
router.get("/comunidad/documentos", requireCommunityMember, handle(() => community.listDocuments()));
router.get("/comunidad/documentos/:id/archivo", requireCommunityMember, sendFile);
router.get("/comunidad/directorio", requireCommunityMember, handle(() => community.listContacts()));

// Administración
router.get("/admin/comunidad/votaciones", requireAdmin, handle(() => community.listPolls({ admin: true })));
router.post("/admin/comunidad/votaciones", requireAdmin, audited("POLL_CREATED", "VOTACION", (req) => community.createPoll(req.authUser.id, req.body || {}), 201));
router.post("/admin/comunidad/votaciones/:id/cerrar", requireAdmin, audited("POLL_CLOSED", "VOTACION", (req) => community.closePoll(req.params.id)));
router.delete("/admin/comunidad/votaciones/:id", requireAdmin, audited("POLL_DELETED", "VOTACION", (req) => community.deletePoll(req.params.id)));
router.get("/admin/comunidad/documentos", requireAdmin, handle(() => community.listDocuments()));
router.get("/admin/comunidad/documentos/:id/archivo", requireAdmin, sendFile);
router.post("/admin/comunidad/documentos", requireAdmin, audited("DOCUMENT_UPLOADED", "DOCUMENTO_COMUNIDAD", (req) => community.createDocument(req.authUser.id, req.body || {}), 201));
router.delete("/admin/comunidad/documentos/:id", requireAdmin, audited("DOCUMENT_DELETED", "DOCUMENTO_COMUNIDAD", (req) => community.deleteDocument(req.params.id)));
router.get("/admin/comunidad/directorio", requireAdmin, handle(() => community.listContacts()));
router.post("/admin/comunidad/directorio", requireAdmin, audited("CONTACT_SAVED", "DIRECTORIO_CONTACTO", (req) => community.saveContact(null, req.body || {}), 201));
router.put("/admin/comunidad/directorio/:id", requireAdmin, audited("CONTACT_SAVED", "DIRECTORIO_CONTACTO", (req) => community.saveContact(req.params.id, req.body || {})));
router.delete("/admin/comunidad/directorio/:id", requireAdmin, audited("CONTACT_DELETED", "DIRECTORIO_CONTACTO", (req) => community.deleteContact(req.params.id)));

module.exports = router;
