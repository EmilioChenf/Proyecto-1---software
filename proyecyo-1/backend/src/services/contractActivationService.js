const { guatemalaToday } = require('../utils/guatemalaTime');
const { recordAudit } = require('./auditService');
const day = value => value instanceof Date ? value.toISOString().slice(0,10) : String(value);
const json = value => typeof value === 'string' ? JSON.parse(value) : value;

// Called with the house locked, inside the caller's transaction.
async function applyInhabitants(c, houseId, inhabitants, effective, actor) {
  const [existing] = await c.execute(`SELECT * FROM CASA_HABITANTE WHERE id_casa=?
    AND id_version_pendiente IS NULL AND (vigente_hasta IS NULL OR vigente_hasta>?) FOR UPDATE`,[houseId,effective]);
  for(const row of existing) {
    if(day(row.vigente_desde)>=effective) throw Object.assign(new Error('Hay habitantes programados para esa fecha; revisa su vigencia.'),{status:409,code:'HABITANTES_PROGRAMADOS'});
    await c.execute('UPDATE CASA_HABITANTE SET vigente_hasta=? WHERE id_habitante=?',[effective,row.id_habitante]);
  }
  for(const inhabitant of inhabitants) {
    await c.execute('SELECT id_usuario FROM USUARIO WHERE id_usuario=? FOR UPDATE',[inhabitant.id_usuario]);
    const [[other]]=await c.execute(`SELECT id_casa FROM CASA_HABITANTE WHERE id_usuario=? AND id_casa<>?
      AND id_version_pendiente IS NULL AND (vigente_hasta IS NULL OR vigente_hasta>?) LIMIT 1 FOR UPDATE`,[inhabitant.id_usuario,houseId,effective]);
    if(other)throw Object.assign(new Error('La persona ya habita otra vivienda.'),{status:409,code:'HABITANTE_CONFLICTO'});
    await c.execute('INSERT INTO CASA_HABITANTE(id_casa,id_usuario,calidad,vigente_desde,creado_por) VALUES(?,?,?,?,?)',
      [houseId,inhabitant.id_usuario,inhabitant.calidad,effective,actor]);
  }
}

async function activateScheduledTransfer(c, houseId, today=guatemalaToday()) {
  await c.execute('SELECT id_casa FROM CASA WHERE id_casa=? FOR UPDATE',[houseId]);
  const [[version]]=await c.execute(`SELECT v.*,ct.tipo FROM CONTRATO_CASA_VERSION v
    JOIN CONTRATO_CASA ct ON ct.id_contrato=v.id_contrato
    WHERE v.id_casa=? AND v.activacion_estado<>'ACTIVA' AND v.activacion_fecha<=?
    ORDER BY v.activacion_fecha,v.id_version LIMIT 1 FOR UPDATE`,[houseId,today]);
  if(!version)return null;
  const plan=json(version.activacion_datos);
  const {outstandingForTransfer,effectivePeriod}=require('./propertyContractsService').__private__;
  try {
    if(plan.oldOwner)await outstandingForTransfer(c,houseId,plan.oldOwner);
  } catch(error) {
    if(!['VENTA_CON_DEUDA','VENTA_REQUIERE_REVISION'].includes(error.code))throw error;
    await c.execute("UPDATE CONTRATO_CASA_VERSION SET activacion_estado='BLOQUEADA',activacion_error=? WHERE id_version=?",[error.code,version.id_version]);
    if(version.activacion_estado!=='BLOQUEADA'||version.activacion_error!==error.code) {
      await recordAudit({userId:version.creado_por,action:'PROPERTY_TRANSFER_BLOCKED',entity:'CASA',entityId:houseId,
        newData:{id_version:version.id_version,fecha:today,code:error.code}},async(sql,args=[])=>(await c.execute(sql,args))[0]);
    }
    return {estado:'BLOQUEADA',code:error.code,id_version:version.id_version};
  }
  const first=effectivePeriod(today)>plan.first?effectivePeriod(today):plan.first;
  if(plan.previousVersion) {
    const [[previous]]=await c.execute('SELECT id_contrato,id_responsabilidad FROM CONTRATO_CASA_VERSION WHERE id_version=? FOR UPDATE',[plan.previousVersion]);
    await c.execute('UPDATE CONTRATO_CASA_VERSION SET vigente_hasta=? WHERE id_version=?',[first,plan.previousVersion]);
    await c.execute('UPDATE CASA_RESPONSABLE_FINANCIERO SET vigente_hasta=? WHERE id_responsabilidad=?',[first,previous.id_responsabilidad]);
    await c.execute("UPDATE CONTRATO_CASA SET estado='CERRADO' WHERE id_contrato=?",[previous.id_contrato]);
  }
  if(plan.previousTitle)await c.execute('UPDATE CASA_TITULARIDAD SET vigente_hasta=? WHERE id_titularidad=?',[today,plan.previousTitle]);
  if(plan.legacyTitle) {
    await c.execute('UPDATE CASA_TITULARIDAD SET vigente_desde=?,id_version_pendiente=NULL WHERE id_titularidad=?',[today,plan.legacyTitle]);
  } else {
    await c.execute('INSERT INTO CASA_TITULARIDAD(id_casa,id_usuario,titular_empresa,vigente_desde,creado_por) VALUES(?,?,?,?,?)',
      [houseId,plan.newOwner,plan.newOwner===null,today,version.creado_por]);
  }
  if(plan.inhabitantsAction==='ACTUALIZAR') {
    await applyInhabitants(c,houseId,plan.inhabitants,today,version.creado_por);
  }
  // Legacy 009 scheduled rows are retained, but become visible only now.
  for(const id of plan.legacyClosedHabitants||[])await c.execute('UPDATE CASA_HABITANTE SET vigente_hasta=? WHERE id_habitante=?',[today,id]);
  if(plan.legacyHabitants?.length) {
    for(const id of plan.legacyHabitants)await c.execute('UPDATE CASA_HABITANTE SET vigente_desde=?,id_version_pendiente=NULL WHERE id_habitante=?',[today,id]);
  }
  await c.execute('UPDATE CASA_RESPONSABLE_FINANCIERO SET vigente_desde=?,id_version_pendiente=NULL WHERE id_responsabilidad=?',[first,version.id_responsabilidad]);
  await c.execute("UPDATE CONTRATO_CASA_VERSION SET vigente_desde=?,activacion_estado='ACTIVA',activacion_error=NULL,activado_en=UTC_TIMESTAMP() WHERE id_version=?",[first,version.id_version]);
  await c.execute('UPDATE CONTRATO_CASA SET primer_periodo=? WHERE id_contrato=?',[first,version.id_contrato]);
  await recordAudit({userId:version.creado_por,action:'PROPERTY_TRANSFER_ACTIVATED',entity:'CASA',entityId:houseId,
    newData:{id_version:version.id_version,fecha:today,primer_periodo:first,id_propietario:plan.newOwner}},async(sql,args=[])=>(await c.execute(sql,args))[0]);
  return {estado:'ACTIVA',id_version:version.id_version};
}

// Upgrade explicit scheduled transfers previously written by 009, including
// those due today when their operational owner is still the outgoing owner.
// Preserve their IDs and original rows; do not infer unknown historical owners.
async function protectLegacyScheduledTransfers(c) {
  const today=guatemalaToday();
  const [scheduled]=await c.execute(`SELECT t.*,p.id_titularidad previousTitle,p.id_usuario oldOwner
    FROM CASA_TITULARIDAD t JOIN CASA_TITULARIDAD p ON p.id_casa=t.id_casa AND p.vigente_hasta=t.vigente_desde
    WHERE t.vigente_desde>=? AND t.id_version_pendiente IS NULL
      AND (t.vigente_desde>? OR EXISTS(SELECT 1 FROM CASA c LEFT JOIN RESIDENTE r ON r.id_residente=c.id_residente
        WHERE c.id_casa=t.id_casa AND r.id_usuario<=>p.id_usuario))
      AND NOT(t.id_usuario<=>p.id_usuario) ORDER BY t.id_casa,t.vigente_desde`,[today,today]);
  const protectedHouses=new Set();
  for(const title of scheduled) {
    await c.execute('SELECT id_casa FROM CASA WHERE id_casa=? FOR UPDATE',[title.id_casa]);
    const {effectivePeriod}=require('./propertyContractsService').__private__;
    const first=effectivePeriod(day(title.vigente_desde));
    const [[version]]=await c.execute("SELECT * FROM CONTRATO_CASA_VERSION WHERE id_casa=? AND vigente_desde=? AND activacion_estado='ACTIVA' AND activado_en IS NULL FOR UPDATE",[title.id_casa,first]);
    if(!version)continue;
    if(protectedHouses.has(title.id_casa))throw Object.assign(new Error('Hay varias ventas legadas programadas para una vivienda; se requiere conciliarlas antes del arranque.'),{code:'LEGACY_TRANSFERS_REVIEW_REQUIRED'});
    protectedHouses.add(title.id_casa);
    const [[previous]]=await c.execute('SELECT * FROM CONTRATO_CASA_VERSION WHERE id_casa=? AND vigente_desde<? ORDER BY vigente_desde DESC LIMIT 1 FOR UPDATE',[title.id_casa,first]);
    const [inhabitants]=await c.execute('SELECT id_habitante FROM CASA_HABITANTE WHERE id_casa=? AND vigente_desde=?',[title.id_casa,day(title.vigente_desde)]);
    const [closedHabitants]=await c.execute('SELECT id_habitante FROM CASA_HABITANTE WHERE id_casa=? AND vigente_hasta=?',[title.id_casa,day(title.vigente_desde)]);
    const plan={oldOwner:title.oldOwner,newOwner:title.id_usuario,previousTitle:title.previousTitle,previousVersion:previous?.id_version||null,
      first,inhabitantsAction:'CONSERVAR',inhabitants:[],legacyTitle:title.id_titularidad,legacyHabitants:inhabitants.map(h=>h.id_habitante),legacyClosedHabitants:closedHabitants.map(h=>h.id_habitante)};
    await c.execute("UPDATE CONTRATO_CASA_VERSION SET activacion_estado='PENDIENTE',activacion_fecha=?,activacion_datos=? WHERE id_version=?",[day(title.vigente_desde),JSON.stringify(plan),version.id_version]);
    await c.execute('UPDATE CASA_RESPONSABLE_FINANCIERO SET id_version_pendiente=? WHERE id_responsabilidad=?',[version.id_version,version.id_responsabilidad]);
    await c.execute('UPDATE CASA_TITULARIDAD SET id_version_pendiente=? WHERE id_titularidad=?',[version.id_version,title.id_titularidad]);
    await c.execute('UPDATE CASA_TITULARIDAD SET vigente_hasta=NULL WHERE id_titularidad=?',[title.previousTitle]);
    await c.execute('UPDATE CASA_HABITANTE SET id_version_pendiente=? WHERE id_casa=? AND vigente_desde=?',[version.id_version,title.id_casa,day(title.vigente_desde)]);
    await c.execute('UPDATE CASA_HABITANTE SET vigente_hasta=NULL WHERE id_casa=? AND vigente_hasta=?',[title.id_casa,day(title.vigente_desde)]);
    if(previous) {
      await c.execute('UPDATE CONTRATO_CASA_VERSION SET vigente_hasta=NULL WHERE id_version=?',[previous.id_version]);
      await c.execute('UPDATE CASA_RESPONSABLE_FINANCIERO SET vigente_hasta=NULL WHERE id_responsabilidad=?',[previous.id_responsabilidad]);
      await c.execute(`UPDATE CONTRATO_CASA ct SET estado=CASE WHEN ct.tipo='COMPRA_FINANCIADA' AND
        (SELECT COUNT(*) FROM CUOTA q WHERE q.id_contrato=ct.id_contrato AND q.concepto='VIVIENDA')>=ct.meses_financiamiento
        THEN 'FINANCIAMIENTO_COMPLETADO' ELSE 'VIGENTE' END WHERE ct.id_contrato=?`,[previous.id_contrato]);
    }
  }
}
module.exports={activateScheduledTransfer,applyInhabitants,protectLegacyScheduledTransfers};
