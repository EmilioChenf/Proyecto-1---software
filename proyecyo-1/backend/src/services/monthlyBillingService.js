const { query } = require('../database/mysql');
const { guatemalaToday } = require('../utils/guatemalaTime');
const { toCents } = require('./financialBalance');
const { getMaintenance, __private__: { date,transaction,executeWith } } = require('./propertyContractsService');

const LABELS = { VIVIENDA:'Cuota de vivienda', ALQUILER_RESIDENCIAL:'Renta directa', MANTENIMIENTO:'Mantenimiento' };
async function billHouse(houseId, period, actor = null, metadata = {}, asOf = period>guatemalaToday()?period:guatemalaToday()) {
  return transaction(async (c) => {
    const exec = executeWith(c);
    const [house] = await exec('SELECT id_casa,activo,relaciones_confirmadas_en FROM CASA WHERE id_casa=? FOR UPDATE', [houseId]);
    if (!house || !house.activo || !house.relaciones_confirmadas_en) return {id_casa:houseId,estado:'PENDIENTE_CONFIGURACION',generadas:0};
    await require('./contractHouseRelations').syncHouseRelations(c,houseId,asOf);
    const [frozen] = await exec('SELECT id_casa FROM FACTURACION_CASA_PERIODO WHERE id_casa=? AND periodo=?', [houseId,period]);
    if (frozen) return {id_casa:houseId,estado:'YA_FACTURADO',generadas:0};
    const [version] = await exec(`SELECT v.*,ct.tipo,ct.meses_financiamiento,rf.id_usuario,
      u.nombre,u.correo FROM CONTRATO_CASA_VERSION v
      JOIN CONTRATO_CASA ct ON ct.id_contrato=v.id_contrato
      JOIN CASA_RESPONSABLE_FINANCIERO rf ON rf.id_responsabilidad=v.id_responsabilidad
      JOIN USUARIO u ON u.id_usuario=rf.id_usuario
      WHERE v.id_casa=? AND v.activacion_estado='ACTIVA' AND v.vigente_desde<=? AND (v.vigente_hasta IS NULL OR v.vigente_hasta>?)
      ORDER BY v.vigente_desde DESC LIMIT 1`, [houseId,period,period]);
    if (!version) return {id_casa:houseId,estado:'SIN_CONTRATO_VIGENTE',generadas:0};
    const tariff = await getMaintenance(period,exec);
    if (!tariff) throw Object.assign(new Error('No existe tarifa de mantenimiento vigente.'), {status:422,code:'MANTENIMIENTO_PENDIENTE'});
    // Snapshot of the entire month, including zero concepts, is inserted in the same transaction.
    const snapshot = {tipo:version.tipo,cuota_vivienda:version.cuota_vivienda,mantenimiento:tariff.monto,id_responsable:version.id_usuario,nombre:version.nombre,correo:version.correo};
    await exec('INSERT INTO FACTURACION_CASA_PERIODO(id_casa,periodo,id_version,id_tarifa,configuracion_snapshot) VALUES(?,?,?,?,?)', [houseId,period,version.id_version,tariff.id_tarifa,JSON.stringify(snapshot)]);
    const [[generated]] = await c.execute("SELECT COUNT(*) cantidad,COALESCE(MAX(numero_cuota),0) numero FROM CUOTA WHERE id_contrato=? AND concepto='VIVIENDA'", [version.id_contrato]);
    const concepts = [];
    if (version.tipo==='COMPRA_FINANCIADA' && Number(generated.cantidad)<Number(version.meses_financiamiento)) concepts.push(['VIVIENDA',version.cuota_vivienda,Number(generated.numero)+1]);
    if (version.tipo==='RENTA_DIRECTA') concepts.push(['ALQUILER_RESIDENCIAL',version.cuota_vivienda,null]);
    concepts.push(['MANTENIMIENTO',tariff.monto,null]);
    const rules = await exec("SELECT valor FROM CONFIGURACION WHERE clave='finanzas_dia_limite' LIMIT 1");
    const dueDay = Math.min(28,Math.max(1,Number(rules[0]?.valor)||10));
    const due = `${period.slice(0,7)}-${String(dueDay).padStart(2,'0')}`;
    let count = 0;
    for (const [concept,amount,number] of concepts) {
      if (toCents(amount)===0) continue;
      await exec("INSERT INTO SERVICIO(nombre,tipo_servicio,descripcion,codigo_financiero) VALUES(?,'Residencial',?,?) ON DUPLICATE KEY UPDATE codigo_financiero=VALUES(codigo_financiero)", [LABELS[concept],LABELS[concept],concept]);
      const [service] = await exec('SELECT id_servicio FROM SERVICIO WHERE codigo_financiero=?', [concept]);
      await exec(`INSERT INTO CUOTA(id_servicio,id_casa,monto,fecha_limite,origen,periodo,concepto,concepto_snapshot,
        id_contrato,id_version,id_responsabilidad,id_responsable,responsable_snapshot,numero_cuota,creado_en)
        VALUES(?,?,?,?,'MENSUAL',?,?,?,?,?,?,?,?,?,UTC_TIMESTAMP())`, [service.id_servicio,houseId,amount,due,period,concept,LABELS[concept],version.id_contrato,version.id_version,version.id_responsabilidad,version.id_usuario,JSON.stringify({id_usuario:version.id_usuario,nombre:version.nombre,correo:version.correo}),number]);
      count++;
    }
    if (version.tipo==='COMPRA_FINANCIADA' && Number(generated.cantidad)+(concepts.some(x=>x[0]==='VIVIENDA')?1:0)>=Number(version.meses_financiamiento)) {
      await exec("UPDATE CONTRATO_CASA SET estado='FINANCIAMIENTO_COMPLETADO' WHERE id_contrato=? AND estado='VIGENTE'", [version.id_contrato]);
    }
    await require('./auditService').recordAudit({userId:actor,action:'MONTHLY_PROPERTY_BILLED',entity:'CASA',entityId:houseId,newData:{periodo:period,id_version:version.id_version,generadas:count,configuracion:snapshot},metadata},exec);
    return {id_casa:houseId,estado:'FACTURADO',generadas:count};
  });
}
async function generateMonthlyBilling({periodo,automatic=false,now=new Date(),actor=null,metadata={}}={}) {
  const today = guatemalaToday(now), period = date(periodo||`${today.slice(0,7)}-01`);
  if (!period.endsWith('-01') || period>today) throw Object.assign(new Error('El período debe ser el primer día de un mes iniciado.'), {status:422,code:'PERIODO_INVALIDO'});
  if (automatic && today.slice(8)!=='01') return {periodo:period,generadas:0,resultados:[],omitido:true};
  const houses = await query('SELECT id_casa FROM CASA WHERE activo=1 ORDER BY id_casa');
  const results=[];
  for (const house of houses) {
    try { results.push(await billHouse(Number(house.id_casa),period,actor,metadata,today)); }
    catch(error) {
      require('../utils/safeLogger').logger.error('Falló la facturación de una vivienda.',{id_casa:Number(house.id_casa),periodo:period,code:error.code||'FACTURACION_ERROR'});
      results.push({id_casa:Number(house.id_casa),estado:'ERROR',generadas:0,code:error.code||'FACTURACION_ERROR'});
    }
  }
  return {periodo:period,generadas:results.reduce((n,r)=>n+r.generadas,0),resultados:results,
    procesadas:results.filter(r=>r.estado==='FACTURADO').length,
    omitidas:results.filter(r=>!['FACTURADO','ERROR'].includes(r.estado)).length,
    fallidas:results.filter(r=>r.estado==='ERROR').length};
}
module.exports = { generateMonthlyBilling, __private__:{billHouse,LABELS} };
