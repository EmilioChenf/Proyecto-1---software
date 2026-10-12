const { query } = require('../database/mysql');
const { QUOTA_BALANCES_SQL,calculateBalance,balanceDetails,sumMoney } = require('./financialBalance');
const { getQuotaStatus } = require('./quotaStatus');
const { guatemalaToday } = require('../utils/guatemalaTime');
const { __private__:{date} } = require('./propertyContractsService');

async function profile(userId) {
  const rows = await query(`SELECT c.id_casa,c.numero,c.torre,c.relaciones_confirmadas_en FROM CASA c WHERE
    EXISTS(SELECT 1 FROM CASA_RESPONSABLE_FINANCIERO r WHERE r.id_casa=c.id_casa AND r.id_usuario=?)
    OR EXISTS(SELECT 1 FROM CASA_HABITANTE h WHERE h.id_casa=c.id_casa AND h.id_usuario=?)
    OR EXISTS(SELECT 1 FROM INQUILINO_CASA ic JOIN INQUILINO i ON i.id_inquilino=ic.id_inquilino WHERE ic.id_casa=c.id_casa AND i.id_usuario=?)
    OR EXISTS(SELECT 1 FROM CUOTA q WHERE q.id_casa=c.id_casa AND q.id_responsable=?) ORDER BY c.id_casa`, [userId,userId,userId,userId]);
  return rows;
}
function mapQuota(row) {
  const b = calculateBalance({...row,pagado:row.total_pagado,reembolsado:row.total_reembolsado});
  return {id_cuota:Number(row.id_cuota),id_casa:Number(row.id_casa),casa_unidad:row.torre?`${row.torre}-${row.numero}`:row.numero,
    servicio:row.servicio,tipo_servicio:row.tipo_servicio,monto:b.total,monto_base:b.monto,recargo:b.recargo,monto_pagado:b.pagado,
    saldo_pendiente:b.saldo,...balanceDetails(b),fecha_limite:row.fecha_limite,ultimo_pago:row.ultimo_pago,
    estado:getQuotaStatus({saldo:b.saldo,fecha_limite:row.fecha_limite},guatemalaToday()),es_alquiler:row.concepto==='ALQUILER_RESIDENCIAL',
    periodo:row.periodo,concepto:row.concepto,numero_cuota:row.numero_cuota};
}
async function account(userId,role,filters={}) {
  const houses = await profile(userId);
  if (role!=='inquilino' && !houses.some(h=>h.relaciones_confirmadas_en)) return null;
  const from = filters.desde ? date(filters.desde) : null, to = filters.hasta ? date(filters.hasta) : null;
  if (from && to && from>to) throw Object.assign(new Error('El rango de fechas es inválido.'),{status:400});
  const rows = await query(`SELECT b.*,c.numero,c.torre,q.concepto,q.numero_cuota,
    DATE_FORMAT(q.periodo,'%Y-%m-%d') periodo,DATE_FORMAT(q.fecha_limite,'%Y-%m-%d') fecha_limite,
    DATE_FORMAT(b.ultimo_pago,'%Y-%m-%d') ultimo_pago,COALESCE(q.concepto_snapshot,s.nombre) servicio,s.tipo_servicio
    FROM (${QUOTA_BALANCES_SQL}) b JOIN CUOTA q ON q.id_cuota=b.id_cuota JOIN CASA c ON c.id_casa=q.id_casa
    JOIN SERVICIO s ON s.id_servicio=q.id_servicio WHERE q.id_responsable=? ORDER BY q.fecha_limite,q.id_cuota`, [userId]);
  const quotas = rows.map(mapQuota);
  const params=[userId,...(from?[from]:[]),...(to?[to]:[])];
  const payments=await query(`SELECT p.id_pago,p.id_cuota,p.monto_pagado,DATE_FORMAT(p.fecha_pago,'%Y-%m-%d') fecha_pago,
    COALESCE(q.concepto_snapshot,s.nombre) servicio FROM PAGO p JOIN CUOTA q ON q.id_cuota=p.id_cuota JOIN SERVICIO s ON s.id_servicio=q.id_servicio
    WHERE q.id_responsable=? ${from?'AND p.fecha_pago>=?':''} ${to?'AND p.fecha_pago<=?':''} ORDER BY p.fecha_pago DESC,p.id_pago DESC`,params);
  const surcharges=await query(`SELECT r.*,COALESCE(q.concepto_snapshot,s.nombre) servicio,DATE_FORMAT(r.fecha_aplicacion,'%Y-%m-%d') fecha_aplicacion
    FROM RECARGO_APLICADO r JOIN CUOTA q ON q.id_cuota=r.id_cuota JOIN SERVICIO s ON s.id_servicio=q.id_servicio
    WHERE q.id_responsable=? ${from?'AND r.fecha_aplicacion>=?':''} ${to?'AND r.fecha_aplicacion<=?':''} ORDER BY r.fecha_aplicacion DESC`,params);
  const refunds=await query(`SELECT rr.id_reembolso,tr.id_pago,tr.id_cuota,rr.monto_centavos,DATE_FORMAT(rr.fecha_contable,'%Y-%m-%d') fecha_reembolso,
    COALESCE(q.concepto_snapshot,s.nombre) servicio FROM REEMBOLSO_RECURRENTE rr JOIN TRANSACCION_RECURRENTE tr ON tr.id_transaccion=rr.id_transaccion
    JOIN CUOTA q ON q.id_cuota=tr.id_cuota JOIN SERVICIO s ON s.id_servicio=q.id_servicio
    WHERE q.id_responsable=? AND rr.estado='CONFIRMADO' AND rr.aplicado_en IS NOT NULL ${from?'AND rr.fecha_contable>=?':''} ${to?'AND rr.fecha_contable<=?':''}`,params);
  const sum = (field,list=quotas) => sumMoney(list.map(q=>q[field]||0));
  const summary={total_cuotas:quotas.length,cuotas_pagadas:quotas.filter(q=>q.estado==='PAGADA').length,cuotas_pendientes:quotas.filter(q=>q.estado==='PENDIENTE').length,
    cuotas_vencidas:quotas.filter(q=>q.estado==='VENCIDA').length,saldo_pendiente:sum('saldo_pendiente'),total_pagado:sum('monto_pagado'),
    total_reembolsado:sum('reembolsado'),abono_neto:sum('abono_neto'),sobrepago:sum('sobrepago'),requiere_revision:quotas.some(q=>q.requiere_revision),
    alquiler_pendiente:sum('saldo_pendiente',quotas.filter(q=>q.es_alquiler)),cuotas_adicionales_pendientes:sum('saldo_pendiente',quotas.filter(q=>!q.es_alquiler)),
    proximo_vencimiento:quotas.filter(q=>q.saldo_pendiente>0&&q.fecha_limite>=guatemalaToday()).map(q=>q.fecha_limite).sort()[0]||null,actualizado_en:new Date().toISOString()};
  const house=houses[0];
  return {casa:{id_casa:house?.id_casa||null,unidad:house?(house.torre?`${house.torre}-${house.numero}`:house.numero):'Sin vivienda',propietario:'',},
    resumen:summary,cuotas:quotas,alquiler:quotas.filter(q=>q.es_alquiler),cuotas_adicionales:quotas.filter(q=>!q.es_alquiler),
    pagos:payments.map(p=>({...p,monto_pagado:Number(p.monto_pagado),numero_comprobante:`NXR-${String(p.id_pago).padStart(8,'0')}`})),
    recargos:surcharges.map(r=>({...r,monto_recargo:Number(r.monto_recargo),monto_original:Number(r.monto_original)})),reembolsos:refunds,periodo:{desde:from,hasta:to},
    modelo_contractual:true,responsabilidad_financiera:quotas.length>0||role!=='inquilino',mensaje:role==='inquilino'&&!quotas.length?'No tienes obligaciones financieras emitidas a tu nombre.':null};
}
async function detail(userId,filters) {
  const data=await account(userId,'residente',filters); if (!data) return null;
  return {unidad:data.casa.unidad,periodo:data.periodo,resumen:{...data.resumen,
    total_cargos:sumMoney(data.cuotas.map(q=>q.monto_base)),total_recargos:sumMoney(data.cuotas.map(q=>q.recargo)),
    total_pagado_periodo:sumMoney(data.pagos.map(p=>p.monto_pagado)),total_devuelto_periodo:sumMoney(data.reembolsos.map(r=>Number(r.monto_centavos)/100))},
    cargos:data.cuotas.map(q=>({...q,monto:q.monto_base,pagado:q.monto_pagado,saldo:q.saldo_pendiente,pago_parcial:q.abono_neto>0&&q.saldo_pendiente>0})),
    pagos:data.pagos,recargos:data.recargos,reembolsos:data.reembolsos};
}
module.exports={account,detail,__private__:{profile,mapQuota}};
