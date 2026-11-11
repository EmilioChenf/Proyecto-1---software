const { pool, query } = require("../database/mysql");
const { ROLE_MODULES, BASE_ROLES, LEVELS, MODULE_IDS } = require("../config/roleModules");

const COLORS = ["#2563EB", "#7C3AED", "#0E7490", "#059669", "#D97706", "#DC2626", "#DB2777", "#475569"];
const CACHE_MS = 30_000;
const cache = new Map();

function fail(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

function isBaseRole(name) {
  return BASE_ROLES.includes(String(name || "").trim().toLowerCase());
}

/** Permisos {modulo: nivel} del rol personalizado con ese nombre; null si no es un rol personalizado. */
async function getPermissionsForRoleName(roleName) {
  const key = String(roleName || "");
  if (!key || isBaseRole(key)) return null;
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;
  const rows = await query(
    `SELECT tu.id_tipo_usuario AS id, tu.nombre, tu.personalizado, rp.modulo, rp.nivel
       FROM TIPO_USUARIO tu LEFT JOIN ROL_PERMISO_MODULO rp ON rp.id_tipo_usuario = tu.id_tipo_usuario
      WHERE tu.nombre = ?`,
    [key],
  );
  let value = null;
  if (rows.length && Number(rows[0].personalizado) === 1) {
    value = { id: Number(rows[0].id), nombre: rows[0].nombre, permisos: {} };
    for (const row of rows) if (row.modulo && MODULE_IDS.has(row.modulo)) value.permisos[row.modulo] = row.nivel;
  }
  cache.set(key, { value, expires: Date.now() + CACHE_MS });
  return value;
}

function clearPermissionsCache() {
  cache.clear();
}

/** Agrega al usuario de sesión los datos del rol personalizado para que el panel muestre solo sus módulos. */
async function decorateSessionUser(user) {
  if (!user || isBaseRole(user.role)) return user;
  const custom = await getPermissionsForRoleName(user.role);
  if (!custom) return user;
  return { ...user, role: "admin", rol_personalizado: { id: custom.id, nombre: custom.nombre }, permisos: custom.permisos };
}

function normalizePermissions(input) {
  const permisos = {};
  for (const [modulo, nivel] of Object.entries(input || {})) {
    if (!nivel || nivel === "NINGUNO") continue;
    const module = ROLE_MODULES.find((item) => item.id === modulo);
    if (!module) throw fail(`El módulo ${modulo} no existe.`);
    const level = String(nivel).toUpperCase();
    if (!LEVELS.includes(level)) throw fail("Cada módulo solo puede ser Ver o Editar.");
    permisos[modulo] = module.readOnly ? "VER" : level;
  }
  if (Object.keys(permisos).length === 0) throw fail("Elige al menos un módulo que este rol pueda ver.");
  return permisos;
}

function validateRole(payload) {
  const nombre = String(payload.nombre || "").trim().replace(/\s+/g, " ");
  if (nombre.length < 3 || nombre.length > 50) throw fail("El nombre del rol debe tener entre 3 y 50 caracteres.");
  if (isBaseRole(nombre)) throw fail("Ese nombre está reservado para un rol del sistema.");
  const descripcion = String(payload.descripcion || "").trim();
  if (descripcion.length > 200) throw fail("La descripción admite hasta 200 caracteres.");
  const color = String(payload.color || COLORS[0]).toUpperCase();
  if (!/^#[0-9A-F]{6}$/.test(color)) throw fail("El color no es válido.");
  return { nombre, descripcion: descripcion || null, color, permisos: normalizePermissions(payload.permisos) };
}

async function listRoles() {
  const roles = await query(
    `SELECT tu.id_tipo_usuario AS id, tu.nombre, tu.descripcion, tu.color,
            (SELECT COUNT(*) FROM USUARIO u WHERE u.id_tipo_usuario = tu.id_tipo_usuario) AS usuarios
       FROM TIPO_USUARIO tu WHERE tu.personalizado = 1 ORDER BY tu.nombre`,
  );
  const permissions = await query(
    `SELECT rp.id_tipo_usuario AS id, rp.modulo, rp.nivel FROM ROL_PERMISO_MODULO rp
       JOIN TIPO_USUARIO tu ON tu.id_tipo_usuario = rp.id_tipo_usuario WHERE tu.personalizado = 1`,
  );
  return roles.map((role) => ({
    id: Number(role.id),
    nombre: role.nombre,
    descripcion: role.descripcion,
    color: role.color || COLORS[0],
    usuarios: Number(role.usuarios),
    permisos: Object.fromEntries(permissions.filter((p) => Number(p.id) === Number(role.id) && MODULE_IDS.has(p.modulo)).map((p) => [p.modulo, p.nivel])),
  }));
}

async function getRole(id) {
  const role = (await listRoles()).find((item) => item.id === Number(id));
  if (!role) throw fail("El rol no existe.", 404);
  return role;
}

async function writePermissions(connection, id, permisos) {
  await connection.execute("DELETE FROM ROL_PERMISO_MODULO WHERE id_tipo_usuario = ?", [id]);
  for (const [modulo, nivel] of Object.entries(permisos)) {
    await connection.execute("INSERT INTO ROL_PERMISO_MODULO (id_tipo_usuario, modulo, nivel) VALUES (?, ?, ?)", [id, modulo, nivel]);
  }
}

async function assertUniqueName(nombre, exceptId = 0) {
  const rows = await query("SELECT id_tipo_usuario FROM TIPO_USUARIO WHERE LOWER(nombre) = LOWER(?) AND id_tipo_usuario <> ? LIMIT 1", [nombre, exceptId]);
  if (rows.length) throw fail("Ya existe un rol con ese nombre.", 409);
}

async function createRole(payload) {
  const role = validateRole(payload);
  await assertUniqueName(role.nombre);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [result] = await connection.execute(
      "INSERT INTO TIPO_USUARIO (nombre, personalizado, descripcion, color) VALUES (?, 1, ?, ?)",
      [role.nombre, role.descripcion, role.color],
    );
    await writePermissions(connection, result.insertId, role.permisos);
    await connection.commit();
    clearPermissionsCache();
    return getRole(result.insertId);
  } catch (error) {
    await connection.rollback();
    if (error.code === "ER_DUP_ENTRY") throw fail("Ya existe un rol con ese nombre.", 409);
    throw error;
  } finally {
    connection.release();
  }
}

async function assertCustom(id) {
  const rows = await query("SELECT personalizado FROM TIPO_USUARIO WHERE id_tipo_usuario = ? LIMIT 1", [Number(id)]);
  if (!rows.length) throw fail("El rol no existe.", 404);
  if (Number(rows[0].personalizado) !== 1) throw fail("Los roles del sistema no se pueden modificar.", 403);
}

async function updateRole(id, payload) {
  await assertCustom(id);
  const role = validateRole(payload);
  await assertUniqueName(role.nombre, Number(id));
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.execute("UPDATE TIPO_USUARIO SET nombre = ?, descripcion = ?, color = ? WHERE id_tipo_usuario = ?", [role.nombre, role.descripcion, role.color, Number(id)]);
    await writePermissions(connection, Number(id), role.permisos);
    await connection.commit();
    clearPermissionsCache();
    return getRole(id);
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function deleteRole(id) {
  await assertCustom(id);
  const role = await getRole(id);
  if (role.usuarios > 0) throw fail(`No se puede eliminar: ${role.usuarios} usuario(s) tienen este rol. Asígnales otro rol primero.`, 409);
  await query("DELETE FROM ROL_PERMISO_MODULO WHERE id_tipo_usuario = ?", [Number(id)]);
  await query("DELETE FROM TIPO_USUARIO_PERMISO WHERE id_tipo_usuario = ?", [Number(id)]);
  await query("DELETE FROM TIPO_USUARIO WHERE id_tipo_usuario = ? AND personalizado = 1", [Number(id)]);
  clearPermissionsCache();
  return role;
}

function listModules() {
  return ROLE_MODULES.map(({ id, label, readOnly }) => ({ id, label, solo_lectura: Boolean(readOnly) }));
}

module.exports = {
  COLORS, isBaseRole, getPermissionsForRoleName, clearPermissionsCache, decorateSessionUser,
  listRoles, getRole, createRole, updateRole, deleteRole, listModules,
};
