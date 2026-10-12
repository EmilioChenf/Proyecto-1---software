const { pool, query } = require("../database/mysql");
const { toCents } = require("./financialBalance");
const GUATEMALA_TODAY_SQL="DATE(CONVERT_TZ(UTC_TIMESTAMP(),'+00:00','-06:00'))";

// ===== Regla unica de estado de una vivienda =====
// CASA es la vivienda. Esta OCUPADA si tiene residente (CASA.id_residente) y
// DISPONIBLE si no lo tiene. "activo" es un indicador aparte (desactivacion
// logica), no un tercer estado: una vivienda inactiva no se puede asignar.
// El frontend nunca calcula el estado: siempre lo recibe de aqui.
const HOUSE_STATUSES = Object.freeze({ AVAILABLE: "DISPONIBLE", OCCUPIED: "OCUPADA" });
const HOUSE_STATUS_SQL = `CASE WHEN c.relaciones_confirmadas_en IS NULL THEN
  CASE WHEN c.id_residente IS NULL THEN 'DISPONIBLE' ELSE 'OCUPADA' END
  WHEN EXISTS(SELECT 1 FROM CASA_HABITANTE h WHERE h.id_casa=c.id_casa AND h.id_version_pendiente IS NULL
    AND h.vigente_desde<=${GUATEMALA_TODAY_SQL} AND (h.vigente_hasta IS NULL OR h.vigente_hasta>${GUATEMALA_TODAY_SQL}))
  THEN 'OCUPADA' ELSE 'DISPONIBLE' END`;
const houseStatus = (row) => (row.id_residente == null ? HOUSE_STATUSES.AVAILABLE : HOUSE_STATUSES.OCCUPIED);

const SELECTION_ROLES = new Set(["residente", "inquilino", 'contrato']);
const MAX_MAP_INDEX = 30;

function fail(status, message, code) {
  return Object.assign(new Error(message), { status, ...(code ? { code } : {}) });
}

function houseLabel(row) {
  const tower = String(row.torre || "").trim();
  return tower ? `${tower}-${row.numero}` : String(row.numero);
}

const toNumber = (value) => (value == null ? null : Number(value));

// ===== Validacion del formulario de vivienda =====
function optionalDecimal(value, field, max) {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  let cents;
  try { cents = toCents(String(value).trim()); } catch {
    throw fail(400, `${field} debe ser un numero mayor o igual a 0 con hasta 2 decimales.`);
  }
  if (cents > max * 100) throw fail(400, `${field} excede el maximo permitido.`);
  return (cents / 100).toFixed(2);
}

function optionalInteger(value, field, min, max) {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    throw fail(400, `${field} debe ser un entero entre ${min} y ${max}.`);
  }
  return number;
}

function validateHousePayload(payload = {}) {
  const numero = String(payload.numero ?? "").trim();
  const torre = String(payload.torre ?? "").trim() || null;
  const modelo = String(payload.modelo ?? "").trim() || null;
  if (!numero) throw fail(400, "El numero de la vivienda es obligatorio.");
  if (numero.length > 10) throw fail(400, "El numero de la vivienda admite hasta 10 caracteres.");
  if (torre && torre.length > 10) throw fail(400, "La torre o manzana admite hasta 10 caracteres.");
  if (modelo && modelo.length > 60) throw fail(400, "El modelo admite hasta 60 caracteres.");

  const banos = optionalDecimal(payload.banos, "Banos", 20);
  if (banos !== null && (Number(banos) * 2) % 1 !== 0) throw fail(400, "Banos admite valores enteros o medios (ej. 2.5).");

  const fila = optionalInteger(payload.mapa_fila, "La fila del mapa", 1, MAX_MAP_INDEX);
  const columna = optionalInteger(payload.mapa_columna, "La columna del mapa", 1, MAX_MAP_INDEX);
  if ((fila === null) !== (columna === null)) throw fail(400, "Indica fila y columna del mapa, o deja ambas vacias.");

  return {
    numero, torre, modelo,
    precio: optionalDecimal(payload.precio, "El precio", 9999999999),
    area_terreno: optionalDecimal(payload.area_terreno, "El area del terreno", 999999),
    area_construccion: optionalDecimal(payload.area_construccion, "El area de construccion", 999999),
    habitaciones: optionalInteger(payload.habitaciones, "Habitaciones", 0, 50),
    banos,
    niveles: optionalInteger(payload.niveles, "Niveles", 1, 5),
    mapa_fila: fila,
    mapa_columna: columna,
  };
}

// ===== Lectura =====
const HOUSE_SELECT = `
  SELECT c.id_casa, c.numero, c.torre, c.id_residente, c.precio, c.area_terreno, c.area_construccion,
    c.version_contractual,c.relaciones_confirmadas_en,
    (SELECT ct.tipo FROM CONTRATO_CASA ct JOIN CONTRATO_CASA_VERSION cv ON cv.id_contrato=ct.id_contrato
      WHERE ct.id_casa=c.id_casa AND cv.activacion_estado='ACTIVA' AND ct.fecha_inicio<=${GUATEMALA_TODAY_SQL}
      ORDER BY ct.fecha_inicio DESC,ct.id_contrato DESC LIMIT 1) tipo_contractual,
    c.habitaciones, c.banos, c.niveles, c.modelo, c.mapa_fila, c.mapa_columna, c.activo,
    DATE_FORMAT(c.creado_en, '%Y-%m-%d %H:%i:%s') AS creado_en,
    ${HOUSE_STATUS_SQL} AS estado,
    u.id_usuario AS residente_id_usuario, u.nombre AS residente_nombre,
    (SELECT COUNT(*) FROM INQUILINO_CASA ic WHERE ic.id_casa = c.id_casa) AS cantidad_inquilinos
  FROM CASA c
  LEFT JOIN RESIDENTE r ON r.id_residente = c.id_residente
  LEFT JOIN USUARIO u ON u.id_usuario = r.id_usuario`;

function mapHouse(row) {
  return {
    id_casa: Number(row.id_casa),
    numero: row.numero,
    torre: row.torre || null,
    codigo: houseLabel(row),
    estado: row.estado || houseStatus(row),
    activo: Boolean(Number(row.activo ?? 1)),
    precio: toNumber(row.precio),
    area_terreno: toNumber(row.area_terreno),
    area_construccion: toNumber(row.area_construccion),
    habitaciones: toNumber(row.habitaciones),
    banos: toNumber(row.banos),
    niveles: toNumber(row.niveles),
    modelo: row.modelo || null,
    mapa_fila: toNumber(row.mapa_fila),
    mapa_columna: toNumber(row.mapa_columna),
    creado_en: row.creado_en || null,
    tipo_contractual:row.tipo_contractual||'PENDIENTE_CONFIGURACION',
    version_contractual:Number(row.version_contractual||0),
    residente: row.residente_id_usuario
      ? { id_usuario: Number(row.residente_id_usuario), nombre: row.residente_nombre }
      : null,
    cantidad_inquilinos: Number(row.cantidad_inquilinos || 0),
  };
}

// Elegibilidad para el selector de "Crear/Editar usuario". Es solo informativa:
// la asignacion real se revalida bajo bloqueo en assignResidentToHouse/assignTenantToHouse.
function selectionEligibility(house, role, current) {
  if (!house.activo) return { elegible: false, motivo: "Vivienda inactiva." };
  if (role==='contrato') return {elegible:true,motivo:null};
  if (role === "residente") {
    if (house.estado === HOUSE_STATUSES.AVAILABLE) return { elegible: true, motivo: null };
    if (current.residentUserId && house.residente?.id_usuario === current.residentUserId) {
      return { elegible: true, motivo: null };
    }
    return { elegible: false, motivo: "Ocupada por otro residente." };
  }
  if (house.estado !== HOUSE_STATUSES.OCCUPIED) {
    return { elegible: false, motivo: "Sin residente: un inquilino solo puede vincularse a una vivienda ocupada." };
  }
  return { elegible: true, motivo: null };
}

async function listHouses(filters = {}) {
  const where = [];
  const params = [];
  const search = String(filters.q || "").trim().toLowerCase();
  if (search) {
    where.push("(LOWER(c.numero) LIKE ? OR LOWER(COALESCE(c.torre, '')) LIKE ? OR LOWER(CONCAT(COALESCE(c.torre, ''), '-', c.numero)) LIKE ? OR LOWER(COALESCE(c.modelo, '')) LIKE ? OR LOWER(COALESCE(u.nombre, '')) LIKE ?)");
    params.push(...Array(5).fill(`%${search}%`));
  }
  const estado = String(filters.estado || "").toUpperCase();
  if (estado === HOUSE_STATUSES.AVAILABLE) where.push(`(${HOUSE_STATUS_SQL})='DISPONIBLE'`);
  else if (estado === HOUSE_STATUSES.OCCUPIED) where.push(`(${HOUSE_STATUS_SQL})='OCUPADA'`);
  else if (estado) throw fail(400, "Estado de vivienda invalido.");

  const role = String(filters.seleccion || "").toLowerCase();
  if (role && !SELECTION_ROLES.has(role)) throw fail(400, "Seleccion invalida: usa residente o inquilino.");

  const rows = await query(`${HOUSE_SELECT} ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY COALESCE(c.torre, ''), c.mapa_fila IS NULL, c.mapa_fila, c.mapa_columna, c.numero, c.id_casa`, params);
  const houses = rows.map(mapHouse);

  if (role) {
    const userId = Number(filters.id_usuario) || null;
    const current = { residentUserId: role === "residente" ? userId : null };
    houses.forEach((house) => Object.assign(house, selectionEligibility(house, role, current)));
  }

  // Conteos reales de toda la tabla (la leyenda no depende de los filtros aplicados).
  const [totals] = await query(`SELECT COUNT(*) AS total, COALESCE(SUM((${HOUSE_STATUS_SQL})='DISPONIBLE'), 0) AS disponibles,
    COALESCE(SUM((${HOUSE_STATUS_SQL})='OCUPADA'), 0) AS ocupadas, COALESCE(SUM(c.activo = 0), 0) AS inactivas FROM CASA c`);
  return {
    resumen: {
      total: Number(totals?.total || 0),
      disponibles: Number(totals?.disponibles || 0),
      ocupadas: Number(totals?.ocupadas || 0),
      inactivas: Number(totals?.inactivas || 0),
    },
    viviendas: houses,
  };
}

async function getHouseDetail(id) {
  const houseId = Number(id);
  if (!Number.isInteger(houseId) || houseId <= 0) throw fail(400, "Vivienda invalida.");
  const rows = await query(`${HOUSE_SELECT} WHERE c.id_casa = ? LIMIT 1`, [houseId]);
  if (!rows[0]) throw fail(404, "Vivienda no encontrada.");
  const house = mapHouse(rows[0]);

  const [resident] = rows[0].residente_id_usuario
    ? await query("SELECT nombre, correo, telefono FROM USUARIO WHERE id_usuario = ? LIMIT 1", [rows[0].residente_id_usuario])
    : [];
  const tenants = await query(
    `SELECT u.id_usuario, u.nombre, u.correo, u.telefono, i.autorizado
       FROM INQUILINO_CASA ic
       JOIN INQUILINO i ON i.id_inquilino = ic.id_inquilino
       JOIN USUARIO u ON u.id_usuario = i.id_usuario
      WHERE ic.id_casa = ?
      ORDER BY u.nombre`,
    [houseId],
  );
  const [history] = await query("SELECT COUNT(*) AS cuotas FROM CUOTA WHERE id_casa = ?", [houseId]);

  return {
    ...house,
    residente: resident
      ? { id_usuario: house.residente.id_usuario, nombre: resident.nombre, correo: resident.correo, telefono: resident.telefono || null }
      : null,
    inquilinos: tenants.map((t) => ({
      id_usuario: Number(t.id_usuario), nombre: t.nombre, correo: t.correo, telefono: t.telefono || null,
      autorizado: Boolean(Number(t.autorizado)),
    })),
    tiene_historial_financiero: Number(history?.cuotas || 0) > 0,
  };
}

// ===== Escritura de viviendas (admin) =====
function duplicateError(error) {
  if (error?.code !== "ER_DUP_ENTRY") return error;
  if (String(error.message).includes("uq_casa_mapa")) {
    return fail(409, "Esa posicion del mapa ya esta ocupada por otra vivienda de la misma torre o manzana.", "POSICION_DUPLICADA");
  }
  return fail(409, "Ya existe una vivienda con ese numero en esa torre o manzana.", "CODIGO_DUPLICADO");
}

async function assertUniqueHouse(connection, data, exceptId = 0) {
  const [code] = await connection.execute(
    "SELECT id_casa FROM CASA WHERE COALESCE(torre, '') = ? AND numero = ? AND id_casa <> ? LIMIT 1 FOR UPDATE",
    [data.torre || "", data.numero, exceptId],
  );
  if (code.length) throw fail(409, "Ya existe una vivienda con ese numero en esa torre o manzana.", "CODIGO_DUPLICADO");
  if (data.mapa_fila !== null) {
    const [position] = await connection.execute(
      `SELECT id_casa FROM CASA WHERE COALESCE(torre, '') = ? AND mapa_fila = ? AND mapa_columna = ?
         AND id_casa <> ? LIMIT 1 FOR UPDATE`,
      [data.torre || "", data.mapa_fila, data.mapa_columna, exceptId],
    );
    if (position.length) {
      throw fail(409, "Esa posicion del mapa ya esta ocupada por otra vivienda de la misma torre o manzana.", "POSICION_DUPLICADA");
    }
  }
}

const HOUSE_FIELDS = ["numero", "torre", "precio", "area_terreno", "area_construccion", "habitaciones", "banos", "niveles", "modelo", "mapa_fila", "mapa_columna"];

async function inTransaction(work) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await work(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw duplicateError(error);
  } finally {
    connection.release();
  }
}

async function createHouse(payload) {
  const data = validateHousePayload(payload);
  const id = await inTransaction(async (connection) => {
    await assertUniqueHouse(connection, data);
    // Una vivienda nueva nace DISPONIBLE (sin residente) y activa.
    const [result] = await connection.execute(
      `INSERT INTO CASA (${HOUSE_FIELDS.join(", ")}, id_residente, activo) VALUES (${HOUSE_FIELDS.map(() => "?").join(", ")}, NULL, TRUE)`,
      HOUSE_FIELDS.map((field) => data[field]),
    );
    return result.insertId;
  });
  return getHouseDetail(id);
}

async function updateHouse(id, payload) {
  const houseId = Number(id);
  const data = validateHousePayload(payload);
  await inTransaction(async (connection) => {
    const [rows] = await connection.execute("SELECT id_casa FROM CASA WHERE id_casa = ? FOR UPDATE", [houseId]);
    if (!rows.length) throw fail(404, "Vivienda no encontrada.");
    await assertUniqueHouse(connection, data, houseId);
    // id_residente y activo NO se editan aqui: la ocupacion cambia solo desde Usuarios.
    await connection.execute(
      `UPDATE CASA SET ${HOUSE_FIELDS.map((field) => `${field} = ?`).join(", ")} WHERE id_casa = ?`,
      [...HOUSE_FIELDS.map((field) => data[field]), houseId],
    );
  });
  return getHouseDetail(houseId);
}

// No hay borrado fisico: CASA tiene historial (cuotas, pagos, accesos...). Se desactiva.
async function setHouseActive(id, activo) {
  const houseId = Number(id);
  if (typeof activo !== "boolean") throw fail(400, "Indica activo: true o false.");
  await inTransaction(async (connection) => {
    const [rows] = await connection.execute("SELECT id_casa, id_residente, relaciones_confirmadas_en FROM CASA WHERE id_casa = ? FOR UPDATE", [houseId]);
    if (!rows.length) throw fail(404, "Vivienda no encontrada.");
    const [[inhabitants]] = rows[0].relaciones_confirmadas_en
      ? await connection.execute(`SELECT COUNT(*) n FROM CASA_HABITANTE WHERE id_casa=? AND id_version_pendiente IS NULL AND vigente_desde<=${GUATEMALA_TODAY_SQL} AND (vigente_hasta IS NULL OR vigente_hasta>${GUATEMALA_TODAY_SQL})`, [houseId])
      : [[{ n: rows[0].id_residente != null ? 1 : 0 }]];
    if (!activo && Number(inhabitants.n)>0) {
      throw fail(409, "No se puede desactivar una vivienda ocupada. Primero reasigna o retira a su residente.", "VIVIENDA_OCUPADA");
    }
    await connection.execute("UPDATE CASA SET activo = ? WHERE id_casa = ?", [activo, houseId]);
  });
  return getHouseDetail(houseId);
}

// ===== Asignacion (dentro de la transaccion de usersService) =====
// El backend es la autoridad: se bloquea la fila (FOR UPDATE) y se revalida el
// estado DENTRO de la transaccion; lo que mostro el mapa no se toma como cierto.
async function lockHouse(connection, houseId) {
  const id = Number(houseId);
  if (!Number.isInteger(id) || id <= 0) throw fail(400, "Selecciona una vivienda.");
  const [rows] = await connection.execute(
    "SELECT id_casa, numero, torre, id_residente, activo FROM CASA WHERE id_casa = ? FOR UPDATE",
    [id],
  );
  if (!rows.length) throw fail(404, "La vivienda seleccionada no existe.");
  return rows[0];
}

// A legacy move with financial history must use the confirmed, audited transfer workflow.
async function releaseHouse(connection, house) {
  const [[history]] = await connection.execute("SELECT COUNT(*) AS n FROM CUOTA WHERE id_casa = ?", [house.id_casa]);
  if (Number(history.n) > 0) {
    throw fail(409, `Confirma el cambio de titular de ${houseLabel(house)} en el asistente contractual; allí se valida el saldo pendiente y se conserva el historial pagado.`, "USAR_ASISTENTE_CONTRACTUAL");
  }
  const [[tenants]] = await connection.execute("SELECT COUNT(*) AS n FROM INQUILINO_CASA WHERE id_casa = ?", [house.id_casa]);
  if (Number(tenants.n) > 0) {
    throw fail(409, `La vivienda ${houseLabel(house)} tiene inquilinos asociados. Reasignalos o retiralos antes de cambiar su residente.`, "VIVIENDA_CON_INQUILINOS");
  }
  await connection.execute("UPDATE CASA SET id_residente = NULL WHERE id_casa = ?", [house.id_casa]);
}

async function releaseResidentHouses(connection, residentId, exceptHouseId = 0) {
  const [houses] = await connection.execute(
    "SELECT id_casa, numero, torre FROM CASA WHERE id_residente = ? AND id_casa <> ? ORDER BY id_casa FOR UPDATE",
    [residentId, exceptHouseId],
  );
  for (const house of houses) await releaseHouse(connection, house);
}

async function assignResidentToHouse(connection, residentId, houseId) {
  const house = await lockHouse(connection, houseId);
  if (house.id_residente != null && Number(house.id_residente) === Number(residentId)) return house;
  if (!Number(house.activo)) throw fail(409, `La vivienda ${houseLabel(house)} esta inactiva.`, "VIVIENDA_INACTIVA");
  if (house.id_residente != null) {
    throw fail(409, "Esta vivienda acaba de ser asignada a otro residente. Selecciona otra.", "VIVIENDA_OCUPADA");
  }
  await releaseResidentHouses(connection, residentId, house.id_casa);
  const [result] = await connection.execute(
    "UPDATE CASA SET id_residente = ? WHERE id_casa = ? AND id_residente IS NULL",
    [residentId, house.id_casa],
  );
  if (result.affectedRows !== 1) {
    throw fail(409, "Esta vivienda acaba de ser asignada a otro residente. Selecciona otra.", "VIVIENDA_OCUPADA");
  }
  return house;
}

async function assignTenantToHouse(connection, tenantId, houseId) {
  const house = await lockHouse(connection, houseId);
  if (!Number(house.activo)) throw fail(409, `La vivienda ${houseLabel(house)} esta inactiva.`, "VIVIENDA_INACTIVA");
  if (house.id_residente == null) {
    throw fail(409, `La vivienda ${houseLabel(house)} no tiene residente: un inquilino solo puede vincularse a una vivienda ocupada.`, "VIVIENDA_NO_ELEGIBLE");
  }
  // El inquilino queda vinculado a esta unica vivienda; no se crea ni se modifica la casa.
  await connection.execute("DELETE FROM INQUILINO_CASA WHERE id_inquilino = ? AND id_casa <> ?", [tenantId, house.id_casa]);
  await connection.execute("INSERT IGNORE INTO INQUILINO_CASA (id_inquilino, id_casa) VALUES (?, ?)", [tenantId, house.id_casa]);
  return house;
}

module.exports = {
  HOUSE_STATUSES,
  houseStatus,
  listHouses,
  getHouseDetail,
  createHouse,
  updateHouse,
  setHouseActive,
  assignResidentToHouse,
  assignTenantToHouse,
  releaseResidentHouses,
  __private__: { validateHousePayload, selectionEligibility, mapHouse, duplicateError },
};
