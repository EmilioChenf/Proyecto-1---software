const {
  listUsers,
  getUserById,
  createUser,
  updateUser,
  deleteUser,
} = require("../services/usersService");
const { getRequestMetadata, recordAudit } = require("../services/auditService");

async function getUsers(_req, res, next) {
  try {
    const users = await listUsers();
    res.status(200).json(users);
  } catch (error) {
    next(error);
  }
}

async function getUser(req, res, next) {
  try {
    const user = await getUserById(Number(req.params.id));
    res.status(200).json(user);
  } catch (error) {
    next(error);
  }
}

const { query: dbQuery } = require("../database/mysql");

// Un rol personalizado con permiso sobre Usuarios solo gestiona guardias, residentes e inquilinos:
// nunca puede crear administradores ni asignar roles personalizados (evita que se dé más permisos).
async function assertDelegatedScope(req, { userId, typeId } = {}) {
  if (req.authUser?.role === "admin") return;
  const restricted = new Error("Tu rol solo puede gestionar guardias, residentes e inquilinos.");
  restricted.status = 403;
  const isAllowedType = async (sql, id) => {
    const rows = await dbQuery(sql, [id]);
    return rows.length === 0 || ["guardia", "residente", "inquilino"].includes(rows[0].nombre);
  };
  if (typeId && !(await isAllowedType("SELECT nombre FROM TIPO_USUARIO WHERE id_tipo_usuario = ?", Number(typeId)))) throw restricted;
  if (userId && !(await isAllowedType("SELECT tu.nombre FROM USUARIO u JOIN TIPO_USUARIO tu ON tu.id_tipo_usuario = u.id_tipo_usuario WHERE u.id_usuario = ?", Number(userId)))) throw restricted;
}

async function postUser(req, res, next) {
  try {
    await assertDelegatedScope(req, { typeId: req.body?.id_tipo_usuario });
    const user = await createUser(req.body || {});
    await recordAudit({ userId: req.authUser.id, action: "USER_CREATED", entity: "USUARIO", entityId: user.id, newData: user, metadata: getRequestMetadata(req) });
    res.status(201).json(user);
  } catch (error) {
    next(error);
  }
}

async function putUser(req, res, next) {
  try {
    await assertDelegatedScope(req, { userId: req.params.id, typeId: req.body?.id_tipo_usuario });
    const previous = await getUserById(Number(req.params.id));
    const user = await updateUser(Number(req.params.id), req.body || {});
    await recordAudit({ userId: req.authUser.id, action: "USER_UPDATED", entity: "USUARIO", entityId: user.id, previousData: previous, newData: user, metadata: getRequestMetadata(req) });
    res.status(200).json(user);
  } catch (error) {
    next(error);
  }
}

async function removeUser(req, res, next) {
  try {
    await assertDelegatedScope(req, { userId: req.params.id });
    const previous = await getUserById(Number(req.params.id));
    const user = await deleteUser(Number(req.params.id));
    await recordAudit({ userId: req.authUser.id, action: "USER_DELETED", entity: "USUARIO", entityId: req.params.id, previousData: previous, newData: user, metadata: getRequestMetadata(req) });
    res.status(200).json(user);
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getUsers,
  getUser,
  postUser,
  putUser,
  removeUser,
};
