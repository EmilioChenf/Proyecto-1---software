const { createHash, randomUUID } = require('node:crypto');
const bcrypt = require('bcryptjs');
const { pool, query } = require('../database/mysql');
const { toCents, QUOTA_BALANCES_SQL } = require('./financialBalance');
const { guatemalaToday } = require('../utils/guatemalaTime');
const { recordAudit } = require('./auditService');

const TYPES = Object.freeze(['COMPRA_FINANCIADA', 'RENTA_DIRECTA', 'PROPIEDAD_PRIVADA']);
const error = (status, message, code) => Object.assign(new Error(message), { status, code });
function date(value) {
  const text = String(value || '');
  const parsed = new Date(`${text}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text) {
    throw error(422, 'Fecha inválida; usa AAAA-MM-DD.', 'FECHA_INVALIDA');
  }
  return text;
}
function nextPeriod(value) {
  const d = new Date(`${date(value).slice(0, 7)}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + 1);
  return d.toISOString().slice(0, 10);
}
function effectivePeriod(value) { return value.endsWith('-01') ? value : nextPeriod(value); }
function money(value) {
  let cents;
  try { cents = toCents(value); } catch { throw error(422, 'Importe inválido; admite hasta dos decimales.', 'IMPORTE_INVALIDO'); }
  if (cents > 9999999999) throw error(422, 'El importe excede el límite permitido.', 'IMPORTE_INVALIDO');
  return (cents / 100).toFixed(2);
}
function validateConfiguration(body, today = guatemalaToday()) {
  if (!TYPES.includes(body.tipo)) throw error(422, 'Selecciona un tipo contractual oficial.', 'TIPO_CONTRATO_INVALIDO');
  const start = date(body.fecha_efectiva);
  if (start < today) throw error(422, 'La fecha efectiva no puede ser retroactiva.', 'FECHA_RETROACTIVA');
  const first = effectivePeriod(start);
  // Any change during the current month applies from the next billing month.
  const installment = body.tipo === 'PROPIEDAD_PRIVADA' ? '0.00' : money(body.cuota_vivienda);
  if (body.tipo !== 'PROPIEDAD_PRIVADA' && toCents(installment) <= 0) throw error(422, 'La cuota de vivienda o renta debe ser mayor que cero.', 'CUOTA_REQUERIDA');
  const term = body.tipo === 'COMPRA_FINANCIADA' ? Number(body.meses_financiamiento) : null;
  if (term !== null && (!Number.isInteger(term) || term < 1 || term > 1200)) throw error(422, 'El financiamiento requiere entre 1 y 1200 meses.', 'PLAZO_INVALIDO');
  if (!Number.isInteger(Number(body.version)) || Number(body.version) < 0) throw error(422, 'Actualiza la versión de la vivienda.', 'VERSION_REQUERIDA');
  if (body.confirmado !== true) throw error(422, 'Confirma el resumen antes de guardar.', 'CONFIRMACION_REQUERIDA');
  return { tipo: body.tipo, start, first, installment, term };
}
async function transaction(task) {
  const connection = await pool.getConnection();
  try { await connection.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED'); await connection.beginTransaction(); const result = await task(connection); await connection.commit(); return result; }
  catch (failure) {
    await connection.rollback();
    if (['ER_DUP_ENTRY','ER_LOCK_DEADLOCK','ER_LOCK_WAIT_TIMEOUT'].includes(failure.code)) throw error(409, 'La configuración cambió o la operación ya existe. Actualiza la vivienda.', 'CONTRATO_CONFLICTO');
    throw failure;
  } finally { connection.release(); }
}
const executeWith = (c) => async (sql, args = []) => (await c.execute(sql, args))[0];
const parse = (value) => typeof value === 'string' ? JSON.parse(value) : value;

async function getMaintenance(period = nextPeriod(guatemalaToday()), execute = query) {
  date(period);
  const rows = await execute(`SELECT id_tarifa,monto,DATE_FORMAT(vigente_desde,'%Y-%m-%d') vigente_desde
    FROM TARIFA_MANTENIMIENTO WHERE vigente_desde<=? ORDER BY vigente_desde DESC LIMIT 1`, [period]);
  return rows[0] ? { ...rows[0], monto: Number(rows[0].monto) } : null;
}
async function listMaintenance() {
  return query("SELECT id_tarifa,monto,DATE_FORMAT(vigente_desde,'%Y-%m-%d') vigente_desde FROM TARIFA_MANTENIMIENTO ORDER BY vigente_desde DESC");
}
async function saveMaintenance(body, actor, metadata) {
  const since = date(body.vigente_desde);
  if (!since.endsWith('-01') || since < nextPeriod(guatemalaToday())) throw error(422, 'La tarifa comienza el primer día de un mes futuro.', 'VIGENCIA_TARIFA_INVALIDA');
  const amount = money(body.monto);
  return transaction(async (c) => {
    // Serialize tariff edits independently of house locks. No amount is seeded by migration.
    await c.execute('SELECT id_usuario FROM USUARIO WHERE id_usuario=? FOR UPDATE', [actor]);
    const exec = executeWith(c);
    const previous = await getMaintenance(since, exec);
    const result = await exec('INSERT INTO TARIFA_MANTENIMIENTO(vigente_desde,monto,creado_por) VALUES(?,?,?)', [since, amount, actor]);
    await recordAudit({ userId: actor, action: 'MAINTENANCE_TARIFF_CREATED', entity: 'TARIFA_MANTENIMIENTO', entityId: result.insertId, previousData: previous, newData: { vigente_desde: since, monto: amount }, metadata }, exec);
    return { id_tarifa: result.insertId, vigente_desde: since, monto: Number(amount) };
  });
}
async function getHouseContracts(houseId) {
  const houses = await query('SELECT id_casa,version_contractual,relaciones_confirmadas_en FROM CASA WHERE id_casa=?', [houseId]);
  if (!houses.length) throw error(404, 'Vivienda no encontrada.', 'VIVIENDA_NO_ENCONTRADA');
  const versions = await query(`SELECT v.*,ct.tipo,ct.meses_financiamiento,ct.estado,
    DATE_FORMAT(ct.fecha_inicio,'%Y-%m-%d') fecha_inicio,DATE_FORMAT(ct.primer_periodo,'%Y-%m-%d') primer_periodo,
    DATE_FORMAT(TIMESTAMPADD(MONTH,ct.meses_financiamiento-1,ct.primer_periodo),'%Y-%m-%d') ultimo_periodo_previsto,
    rf.id_usuario id_responsable,u.nombre responsable_nombre,
    DATE_FORMAT(v.vigente_desde,'%Y-%m-%d') vigente_desde,DATE_FORMAT(v.vigente_hasta,'%Y-%m-%d') vigente_hasta,
    (SELECT COUNT(*) FROM CUOTA q WHERE q.id_contrato=ct.id_contrato AND q.concepto='VIVIENDA') cuotas_generadas
    FROM CONTRATO_CASA_VERSION v JOIN CONTRATO_CASA ct ON ct.id_contrato=v.id_contrato
    JOIN CASA_RESPONSABLE_FINANCIERO rf ON rf.id_responsabilidad=v.id_responsabilidad
    JOIN USUARIO u ON u.id_usuario=rf.id_usuario WHERE v.id_casa=? ORDER BY v.vigente_desde DESC`, [houseId]);
  const titles = await query("SELECT t.*,u.nombre,DATE_FORMAT(vigente_desde,'%Y-%m-%d') vigente_desde,DATE_FORMAT(vigente_hasta,'%Y-%m-%d') vigente_hasta FROM CASA_TITULARIDAD t LEFT JOIN USUARIO u ON u.id_usuario=t.id_usuario WHERE id_casa=? ORDER BY vigente_desde DESC", [houseId]);
  const inhabitants = await query("SELECT h.*,u.nombre,DATE_FORMAT(vigente_desde,'%Y-%m-%d') vigente_desde,DATE_FORMAT(vigente_hasta,'%Y-%m-%d') vigente_hasta FROM CASA_HABITANTE h JOIN USUARIO u ON u.id_usuario=h.id_usuario WHERE id_casa=? ORDER BY vigente_desde DESC", [houseId]);
  return { ...houses[0], estado_configuracion: versions.length ? 'CONFIGURADA' : 'PENDIENTE_CONFIGURACION', versiones: versions, titularidades: titles, habitantes: inhabitants };
}
async function resolvePerson(c, value, role) {
  if (!value) throw error(422, 'Selecciona o crea a la persona responsable.', 'PERSONA_REQUERIDA');
  if (value.id_usuario) {
    const [[user]] = await c.execute(`SELECT u.id_usuario,u.nombre,u.correo,tu.nombre rol FROM USUARIO u JOIN TIPO_USUARIO tu ON tu.id_tipo_usuario=u.id_tipo_usuario WHERE u.id_usuario=? AND u.activo=1 FOR UPDATE`, [value.id_usuario]);
    if (!user || user.rol !== role) throw error(422, `Selecciona una persona activa con acceso de ${role}.`, 'PERSONA_INVALIDA');
    return user;
  }
  const name = String(value.nombre || '').trim(), email = String(value.correo || '').trim().toLowerCase();
  const password = String(value.password || '');
  if (!name || name.length > 100 || !/^\S+@\S+\.\S+$/.test(email) || password.length < 4) throw error(422, 'La persona nueva requiere nombre, correo válido y contraseña de al menos 4 caracteres.', 'PERSONA_INVALIDA');
  const [[type]] = await c.execute('SELECT id_tipo_usuario FROM TIPO_USUARIO WHERE nombre=?', [role]);
  if (!type) throw error(422, 'Rol no disponible.', 'PERSONA_INVALIDA');
  const [created] = await c.execute('INSERT INTO USUARIO(nombre,dpi,correo,telefono,password,activo,id_tipo_usuario) VALUES(?,?,?,?,?,1,?)', [name, `AUTO${randomUUID().replaceAll('-', '').slice(0,16)}`, email, String(value.telefono || '').trim() || null, await bcrypt.hash(password,10), type.id_tipo_usuario]);
  return { id_usuario: created.insertId, nombre: name, correo: email, rol: role };
}
async function outstandingForTransfer(c, houseId, ownerId) {
  // Lock individual quotas before evaluating the canonical balance, including applied refunds.
  await c.execute('SELECT id_cuota FROM CUOTA WHERE id_casa=? ORDER BY id_cuota FOR UPDATE', [houseId]);
  const [[totals]] = await c.execute(`SELECT COALESCE(SUM(b.saldo_pendiente),0) saldo,
    COALESCE(SUM(b.reembolso_inconsistente+b.sobrepago),0) revision
    FROM (${QUOTA_BALANCES_SQL}) b JOIN CUOTA q ON q.id_cuota=b.id_cuota
    WHERE b.id_casa=? AND (q.id_responsable=? OR q.id_responsable IS NULL)`, [houseId, ownerId]);
  if (Number(totals.saldo) > 0) throw error(409, `La vivienda tiene Q${Number(totals.saldo).toFixed(2)} pendientes del titular o sin atribución confirmada.`, 'VENTA_CON_DEUDA');
  if (Number(totals.revision) > 0) throw error(409, 'La vivienda requiere revisión de pagos o reembolsos antes del traspaso.', 'VENTA_REQUIERE_REVISION');
}
async function configureHouse(houseId, body, actor, metadata) {
  const config = validateConfiguration(body);
  const operationId = String(body.id_operacion || '');
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(operationId)) throw error(422, 'Identificador de operación inválido.', 'OPERACION_REQUERIDA');
  const hash = createHash('sha256').update(JSON.stringify(body)).digest('hex');
  return transaction(async (c) => {
    const exec = executeWith(c);
    const [house] = await exec('SELECT * FROM CASA WHERE id_casa=? FOR UPDATE', [houseId]);
    if (!house) throw error(404, 'Vivienda no encontrada.', 'VIVIENDA_NO_ENCONTRADA');
    const [oldOperation] = await exec('SELECT * FROM OPERACION_CONTRACTUAL WHERE id_operacion=?', [operationId]);
    if (oldOperation) {
      if (Number(oldOperation.id_usuario)!==Number(actor) || Number(oldOperation.id_casa)!==Number(houseId) || oldOperation.request_hash!==hash) throw error(409, 'El identificador ya pertenece a otra operación.', 'OPERACION_CONFLICTO');
      return parse(oldOperation.resultado);
    }
    if (!house.activo) throw error(409, 'Activa la vivienda antes de configurar el contrato.', 'VIVIENDA_INACTIVA');
    if (Number(house.version_contractual)!==Number(body.version)) throw error(409, 'La vivienda cambió; actualiza el resumen.', 'VERSION_CONFLICTO');
    const maintenance = await getMaintenance(config.first, exec);
    if (!maintenance) throw error(422, 'Configura primero la tarifa global de mantenimiento para este período.', 'MANTENIMIENTO_PENDIENTE');
    const [previous] = await exec(`SELECT v.*,ct.tipo,ct.meses_financiamiento,rf.id_usuario id_responsable
      FROM CONTRATO_CASA_VERSION v JOIN CONTRATO_CASA ct ON ct.id_contrato=v.id_contrato
      JOIN CASA_RESPONSABLE_FINANCIERO rf ON rf.id_responsabilidad=v.id_responsabilidad
      WHERE v.id_casa=? ORDER BY v.vigente_desde DESC LIMIT 1`, [houseId]);
    if (previous && previous.activacion_estado!=='ACTIVA') throw error(409, 'Hay una transferencia pendiente; resuélvela antes de programar otro cambio.', 'TRANSFERENCIA_PENDIENTE');
    if (previous && String(previous.vigente_desde instanceof Date ? previous.vigente_desde.toISOString().slice(0,10) : previous.vigente_desde)>=config.first) throw error(409, 'Ya existe una configuración para ese mes o un mes posterior.', 'VIGENCIA_CONFLICTO');
    const role = config.tipo==='RENTA_DIRECTA' ? 'inquilino' : 'residente';
    const person = await resolvePerson(c, body.responsable, role);
    const [priorTitle] = await exec('SELECT * FROM CASA_TITULARIDAD WHERE id_casa=? ORDER BY vigente_desde DESC LIMIT 1', [houseId]);
    const oldOwner = priorTitle?.id_usuario || (await exec('SELECT id_usuario FROM RESIDENTE WHERE id_residente=?', [house.id_residente]))[0]?.id_usuario;
    const newOwner = config.tipo==='RENTA_DIRECTA' ? null : person.id_usuario;
    if (oldOwner && Number(oldOwner)!==Number(newOwner)) await outstandingForTransfer(c, houseId, oldOwner);
    const scheduledTransfer = Boolean(oldOwner && Number(oldOwner)!==Number(newOwner) && config.start>guatemalaToday());
    let contractId = previous?.id_contrato;
    const continuing = previous && previous.tipo===config.tipo && Number(previous.id_responsable)===Number(person.id_usuario);
    if (continuing && config.tipo==='COMPRA_FINANCIADA' && Number(previous.meses_financiamiento)!==config.term) throw error(422, 'El plazo original del financiamiento se conserva.', 'PLAZO_INMUTABLE');
    if (previous && previous.tipo==='COMPRA_FINANCIADA' && !continuing && Number(oldOwner)===Number(newOwner)) {
      const [[count]] = await c.execute("SELECT COUNT(*) n FROM CUOTA WHERE id_contrato=? AND concepto='VIVIENDA'", [previous.id_contrato]);
      if (Number(count.n)<Number(previous.meses_financiamiento)) throw error(409, 'El financiamiento aún no ha generado todas sus cuotas.', 'FINANCIAMIENTO_INCOMPLETO');
    }
    if (!continuing) {
      if (previous && !scheduledTransfer) await exec("UPDATE CONTRATO_CASA SET estado='CERRADO' WHERE id_contrato=?", [previous.id_contrato]);
      const created = await exec('INSERT INTO CONTRATO_CASA(id_casa,tipo,fecha_inicio,primer_periodo,meses_financiamiento,creado_por) VALUES(?,?,?,?,?,?)', [houseId,config.tipo,config.start,config.first,config.term,actor]);
      contractId = created.insertId;
    }
    if (previous && !scheduledTransfer) await exec('UPDATE CONTRATO_CASA_VERSION SET vigente_hasta=? WHERE id_version=? AND vigente_hasta IS NULL', [config.first,previous.id_version]);
    if (!scheduledTransfer) await exec('UPDATE CASA_RESPONSABLE_FINANCIERO SET vigente_hasta=? WHERE id_casa=? AND vigente_hasta IS NULL', [config.first,houseId]);
    const quality = { COMPRA_FINANCIADA:'COMPRADOR', RENTA_DIRECTA:'ARRENDATARIO_DIRECTO', PROPIEDAD_PRIVADA:'PROPIETARIO' }[config.tipo];
    const responsibility = await exec('INSERT INTO CASA_RESPONSABLE_FINANCIERO(id_casa,id_usuario,calidad,vigente_desde,creado_por) VALUES(?,?,?,?,?)', [houseId,person.id_usuario,quality,config.first,actor]);
    const version = await exec('INSERT INTO CONTRATO_CASA_VERSION(id_contrato,id_casa,id_responsabilidad,cuota_vivienda,vigente_desde,creado_por) VALUES(?,?,?,?,?,?)', [contractId,houseId,responsibility.insertId,config.installment,config.first,actor]);
    // Title and occupants are explicit; neither is inferred from the financial role.
    if (!scheduledTransfer && (!priorTitle || Number(priorTitle.id_usuario)!==Number(newOwner) || Boolean(priorTitle.titular_empresa)!==(newOwner===null))) {
      if (priorTitle) await exec('UPDATE CASA_TITULARIDAD SET vigente_hasta=? WHERE id_titularidad=?', [config.start,priorTitle.id_titularidad]);
      await exec('INSERT INTO CASA_TITULARIDAD(id_casa,id_usuario,titular_empresa,vigente_desde,creado_por) VALUES(?,?,?,?,?)', [houseId,newOwner,newOwner===null,config.start,actor]);
    }
    const inhabitants = [];
    if (body.responsable_habita===true) inhabitants.push({person,quality});
    if (body.inquilino_privado) {
      if (config.tipo!=='PROPIEDAD_PRIVADA') throw error(422, 'El inquilino privado requiere propiedad privada.', 'INQUILINO_PRIVADO_INVALIDO');
      inhabitants.push({person:await resolvePerson(c,body.inquilino_privado,'inquilino'),quality:'INQUILINO_PRIVADO'});
    }
    if (body.habitantes_accion && !['CONSERVAR','ACTUALIZAR'].includes(body.habitantes_accion)) throw error(422, 'Indica si deseas conservar o actualizar habitantes.', 'HABITANTES_ACCION_INVALIDA');
    const inhabitantsAction = !previous || body.habitantes_accion==='ACTUALIZAR' ? 'ACTUALIZAR' : 'CONSERVAR';
    for (const inhabitant of inhabitants) {
      const [other] = await exec('SELECT id_casa FROM CASA_HABITANTE WHERE id_usuario=? AND id_casa<>? AND id_version_pendiente IS NULL AND (vigente_hasta IS NULL OR vigente_hasta>?) LIMIT 1 FOR UPDATE', [inhabitant.person.id_usuario,houseId,config.start]);
      if (other) throw error(409, 'La persona ya habita otra vivienda.', 'HABITANTE_CONFLICTO');
    }
    const plannedInhabitants=inhabitants.map(i=>({id_usuario:i.person.id_usuario,calidad:i.quality}));
    if (scheduledTransfer) {
      const plan={oldOwner,newOwner,previousVersion:previous?.id_version||null,previousTitle:priorTitle?.id_titularidad||null,
        first:config.first,inhabitantsAction,inhabitants:plannedInhabitants};
      await exec("UPDATE CONTRATO_CASA_VERSION SET activacion_estado='PENDIENTE',activacion_fecha=?,activacion_datos=? WHERE id_version=?",[config.start,JSON.stringify(plan),version.insertId]);
      await exec('UPDATE CASA_RESPONSABLE_FINANCIERO SET id_version_pendiente=? WHERE id_responsabilidad=?',[version.insertId,responsibility.insertId]);
    } else if (inhabitantsAction==='ACTUALIZAR') {
      await require('./contractActivationService').applyInhabitants(c,houseId,plannedInhabitants,config.start,actor);
    }
    await exec('UPDATE CASA SET version_contractual=version_contractual+1,relaciones_confirmadas_en=COALESCE(relaciones_confirmadas_en,UTC_TIMESTAMP()) WHERE id_casa=?', [houseId]);
    await require('./contractHouseRelations').syncHouseRelations(c,houseId);
    const result = { id_casa:Number(houseId),id_contrato:Number(contractId),id_version:Number(version.insertId),version:Number(house.version_contractual)+1,tipo:config.tipo,fecha_efectiva:config.start,primer_periodo:config.first,responsable:person,mantenimiento:maintenance.monto,total_mensual:(toCents(config.installment)+toCents(maintenance.monto))/100 };
    await recordAudit({ userId:actor,action:scheduledTransfer?'PROPERTY_TRANSFER_SCHEDULED':oldOwner && Number(oldOwner)!==Number(newOwner)?'PROPERTY_TRANSFERRED':'PROPERTY_CONTRACT_CONFIGURED',entity:'CASA',entityId:houseId,previousData:{contrato:previous,titular:priorTitle,id_propietario:oldOwner},newData:{...result,id_propietario:newOwner,habitantes:plannedInhabitants,habitantes_accion:inhabitantsAction,id_operacion:operationId},metadata }, exec);
    await exec('INSERT INTO OPERACION_CONTRACTUAL(id_operacion,id_usuario,id_casa,request_hash,resultado) VALUES(?,?,?,?,?)', [operationId,actor,houseId,hash,JSON.stringify(result)]);
    return result;
  });
}
module.exports = { TYPES, getMaintenance, listMaintenance, saveMaintenance, getHouseContracts, configureHouse,
  __private__: { date,nextPeriod,effectivePeriod,money,validateConfiguration,transaction,executeWith,outstandingForTransfer } };
