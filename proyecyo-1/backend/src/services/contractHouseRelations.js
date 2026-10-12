const { guatemalaToday } = require('../utils/guatemalaTime');
// Compatibility pointers support existing operational modules. Financial access
// always uses CUOTA.id_responsable, never these replaceable pointers.
async function syncHouseRelations(c,houseId,today=guatemalaToday()) {
  const [[house]]=await c.execute('SELECT relaciones_confirmadas_en FROM CASA WHERE id_casa=? FOR UPDATE',[houseId]);
  if (!house?.relaciones_confirmadas_en) return;
  const activation=await require('./contractActivationService').activateScheduledTransfer(c,houseId,today);
  const [[title]]=await c.execute('SELECT id_usuario FROM CASA_TITULARIDAD WHERE id_casa=? AND id_version_pendiente IS NULL AND vigente_desde<=? AND (vigente_hasta IS NULL OR vigente_hasta>?) ORDER BY vigente_desde DESC LIMIT 1',[houseId,today,today]);
  // A first configuration scheduled in the future must not remove today's operational links.
  if(!title){
    const [[earliest]]=await c.execute("SELECT DATE_FORMAT(MIN(vigente_desde),'%Y-%m-%d') inicio FROM CASA_TITULARIDAD WHERE id_casa=?",[houseId]);
    if(earliest?.inicio>today)return;
  }
  let resident=null;
  if (title?.id_usuario) {
    await c.execute('INSERT INTO RESIDENTE(id_usuario) VALUES(?) ON DUPLICATE KEY UPDATE id_usuario=VALUES(id_usuario)',[title.id_usuario]);
    const [[r]]=await c.execute('SELECT id_residente FROM RESIDENTE WHERE id_usuario=?',[title.id_usuario]); resident=r.id_residente;
  }
  await c.execute('UPDATE CASA SET id_residente=? WHERE id_casa=?',[resident,houseId]);
  await c.execute('DELETE FROM INQUILINO_CASA WHERE id_casa=?',[houseId]);
  const [tenants]=await c.execute("SELECT id_usuario,autorizado FROM CASA_HABITANTE WHERE id_casa=? AND id_version_pendiente IS NULL AND calidad IN ('ARRENDATARIO_DIRECTO','INQUILINO_PRIVADO') AND vigente_desde<=? AND (vigente_hasta IS NULL OR vigente_hasta>?)",[houseId,today,today]);
  for (const tenant of tenants) {
    await c.execute('SELECT id_usuario FROM USUARIO WHERE id_usuario=? FOR UPDATE',[tenant.id_usuario]);
    const [[other]]=await c.execute(`SELECT id_casa FROM CASA_HABITANTE WHERE id_usuario=? AND id_casa<>?
      AND id_version_pendiente IS NULL AND vigente_desde<=? AND (vigente_hasta IS NULL OR vigente_hasta>?) LIMIT 1 FOR UPDATE`,[tenant.id_usuario,houseId,today,today]);
    if(other)throw Object.assign(new Error('La persona mantiene otra vivienda vigente.'),{status:409,code:'HABITANTE_CONFLICTO'});
    const [legacy]=await c.execute(`SELECT ic.id_casa FROM INQUILINO_CASA ic JOIN INQUILINO i ON i.id_inquilino=ic.id_inquilino
      WHERE i.id_usuario=? AND ic.id_casa<>? FOR UPDATE`,[tenant.id_usuario,houseId]);
    await c.execute(`DELETE ic FROM INQUILINO_CASA ic JOIN INQUILINO i ON i.id_inquilino=ic.id_inquilino
      WHERE i.id_usuario=? AND ic.id_casa<>?`,[tenant.id_usuario,houseId]);
    if(legacy.length)await require('./auditService').recordAudit({userId:null,action:'TENANT_OPERATIONAL_RECONCILED',entity:'CASA',entityId:houseId,
      previousData:{id_usuario:tenant.id_usuario,casas:legacy.map(h=>h.id_casa)},newData:{id_usuario:tenant.id_usuario,id_casa:houseId,fecha:today}},async(sql,args=[])=>(await c.execute(sql,args))[0]);
    await c.execute('INSERT INTO INQUILINO(id_usuario,autorizado) VALUES(?,?) ON DUPLICATE KEY UPDATE autorizado=VALUES(autorizado)',[tenant.id_usuario,tenant.autorizado]);
    await c.execute('INSERT INTO INQUILINO_CASA(id_inquilino,id_casa) SELECT id_inquilino,? FROM INQUILINO WHERE id_usuario=?',[houseId,tenant.id_usuario]);
  }
  return activation;
}
async function syncEffectiveRelations() {
  const {query,pool}=require('../database/mysql');
  const houses=await query('SELECT id_casa FROM CASA WHERE relaciones_confirmadas_en IS NOT NULL ORDER BY id_casa');
  for (const house of houses) {
    const c=await pool.getConnection();
    try {await c.beginTransaction();await syncHouseRelations(c,house.id_casa);await c.commit();}
    catch(error) {await c.rollback();require('../utils/safeLogger').logger.error('No se sincronizó una vivienda.',{id_casa:house.id_casa,code:error.code||'RELACIONES_ERROR'});} finally {c.release();}
  }
}
async function syncUserRelations(userId){
  const {query,pool}=require('../database/mysql');
  const houses=await query(`SELECT c.id_casa FROM CASA c WHERE c.relaciones_confirmadas_en IS NOT NULL AND
    (EXISTS(SELECT 1 FROM CASA_TITULARIDAD t WHERE t.id_casa=c.id_casa AND t.id_usuario=?) OR
     EXISTS(SELECT 1 FROM CASA_HABITANTE h WHERE h.id_casa=c.id_casa AND h.id_usuario=?) OR
     EXISTS(SELECT 1 FROM CASA_RESPONSABLE_FINANCIERO r WHERE r.id_casa=c.id_casa AND r.id_usuario=?)) ORDER BY c.id_casa`,[userId,userId,userId]);
  for(const house of houses){const c=await pool.getConnection();try{await c.beginTransaction();await syncHouseRelations(c,house.id_casa);await c.commit();}catch(error){await c.rollback();throw error;}finally{c.release();}}
}
module.exports={syncHouseRelations,syncEffectiveRelations,syncUserRelations};
