const { guatemalaToday } = require('../utils/guatemalaTime');
// Compatibility pointers support existing operational modules. Financial access
// always uses CUOTA.id_responsable, never these replaceable pointers.
async function syncHouseRelations(c,houseId,today=guatemalaToday()) {
  const [[house]]=await c.execute('SELECT relaciones_confirmadas_en FROM CASA WHERE id_casa=? FOR UPDATE',[houseId]);
  if (!house?.relaciones_confirmadas_en) return;
  const [[title]]=await c.execute('SELECT id_usuario FROM CASA_TITULARIDAD WHERE id_casa=? AND vigente_desde<=? AND (vigente_hasta IS NULL OR vigente_hasta>?) ORDER BY vigente_desde DESC LIMIT 1',[houseId,today,today]);
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
  const [tenants]=await c.execute("SELECT id_usuario,autorizado FROM CASA_HABITANTE WHERE id_casa=? AND calidad IN ('ARRENDATARIO_DIRECTO','INQUILINO_PRIVADO') AND vigente_desde<=? AND (vigente_hasta IS NULL OR vigente_hasta>?)",[houseId,today,today]);
  for (const tenant of tenants) {
    await c.execute('INSERT INTO INQUILINO(id_usuario,autorizado) VALUES(?,?) ON DUPLICATE KEY UPDATE autorizado=VALUES(autorizado)',[tenant.id_usuario,tenant.autorizado]);
    await c.execute('INSERT INTO INQUILINO_CASA(id_inquilino,id_casa) SELECT id_inquilino,? FROM INQUILINO WHERE id_usuario=?',[houseId,tenant.id_usuario]);
  }
}
async function syncEffectiveRelations() {
  const {query,pool}=require('../database/mysql');
  const houses=await query('SELECT id_casa FROM CASA WHERE relaciones_confirmadas_en IS NOT NULL ORDER BY id_casa');
  for (const house of houses) {
    const c=await pool.getConnection();
    try {await c.beginTransaction();await syncHouseRelations(c,house.id_casa);await c.commit();}
    catch(error) {await c.rollback();throw error;} finally {c.release();}
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
