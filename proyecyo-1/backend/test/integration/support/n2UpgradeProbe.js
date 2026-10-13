// Separate process: config and pool must point at the real pre-feature upgrade.
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {configureTestEnvironment,connect}=require('./isolatedMysql');
configureTestEnvironment();require('./suiteIsolation').assertOwnedSuiteDatabase();
async function main(){
  const c=await connect();let db;
  try{
    const people={};
    for(const [key,name,role]of [['juan','Juan histórico N2','residente'],['maria','María actual N2','residente'],['other','Tercero N2','residente'],['admin','Admin N2','admin']]){
      const [[t]]=await c.execute('SELECT id_tipo_usuario FROM TIPO_USUARIO WHERE nombre=?',[role]);
      const id=(await c.execute('INSERT INTO USUARIO(nombre,dpi,correo,password,activo,id_tipo_usuario) VALUES(?,?,?,?,1,?)',[name,randomUUID().slice(0,12),randomUUID()+'@n2-upgrade.test','test-only',t.id_tipo_usuario]))[0].insertId;
      people[key]={id,name};if(role==='residente')people[key].resident=(await c.execute('INSERT INTO RESIDENTE(id_usuario) VALUES(?)',[id]))[0].insertId;
    }
    const house=(await c.execute('INSERT INTO CASA(numero,id_residente,activo) VALUES(?,?,1)',['A-12',people.maria.resident]))[0].insertId;
    const quota=(await c.execute("INSERT INTO CUOTA(id_casa,id_servicio,monto,fecha_limite) VALUES(?,1,123,'2025-09-10')",[house]))[0].insertId;
    const payment=(await c.execute("INSERT INTO PAGO(id_cuota,monto_pagado,fecha_pago) VALUES(?,123,'2025-09-09')",[quota]))[0].insertId;
    await c.execute("INSERT INTO TRANSACCION_SIMULADA(id_pago,id_usuario,id_casa,rol,concepto,monto,estado) VALUES(?,?,?,'residente','Pago histórico N2',123,'APROBADA')",[payment,people.juan.id,house]);
    await c.execute("INSERT INTO PAGO_ORIGEN(id_pago,id_cuota,origen,ambiente) VALUES(?,?,'SIMULADO','academic')",[payment,quota]);
    const before={};for(const t of ['USUARIO','RESIDENTE','CASA','CUOTA','PAGO','TRANSACCION_SIMULADA','PAGO_ORIGEN'])before[t]=(await c.query(`SELECT * FROM ${t} ORDER BY 1`))[0];
    await require('../../../src/database/propertyContractMigration').applyPropertyContractMigration(c);
    for(const [t,rows]of Object.entries(before)){
      const after=(await c.query(`SELECT * FROM ${t} ORDER BY 1`))[0];
      assert.deepEqual(after.map((r,i)=>Object.fromEntries(Object.keys(rows[i]).map(k=>[k,r[k]]))),rows,t);
    }
    const [[stored]]=await c.execute('SELECT q.id_responsable,q.responsable_snapshot,p.id_actor,p.titular_snapshot FROM PAGO p JOIN CUOTA q ON q.id_cuota=p.id_cuota WHERE p.id_pago=?',[payment]);
    assert.deepEqual(Object.values(stored),[null,null,null,null],'No speculative attribution/backfill');
    db=require('../../../src/database/mysql');
    const http=require('supertest')(require('../../../src/app').createApp()),results={};
    for(const [key,p]of Object.entries(people)){
      const auth='Bearer '+(await require('../../../src/services/activeSessionsService').createActiveSession(p.id)).token;
      const json=await http.get(`/residente/pagos/${payment}/comprobante/datos`).set('Authorization',auth);
      const pdf=await http.get(`/residente/pagos/${payment}/comprobante`).set('Authorization',auth);
      const detail=await http.get('/residente/detalle-financiero').set('Authorization',auth);
      const report=key==='admin'?await http.get('/admin/reportes/financiero-mensual?mes=9&anio=2025').set('Authorization',auth):null;
      results[key]={json:json.status,pdf:pdf.status,titular:json.body.titular_nombre||null,detail:detail.status,
        includesPayment:(detail.body.pagos||[]).some(p=>p.id_pago===payment),includesQuota:(detail.body.cargos||[]).some(q=>q.id_cuota===quota),
        pdfValid:Buffer.isBuffer(pdf.body)&&pdf.body.subarray(0,4).toString()==='%PDF',report:report?.status,adminIncludesPayment:report?.body.pagos?.some(p=>p.id_pago===payment)};
    }
    console.log(JSON.stringify({case:'N2 real pre-feature upgrade',stored,results}));
    assert.equal(results.juan.json,200);assert.equal(results.juan.titular,people.juan.name);assert.equal(results.juan.pdfValid,true);
    assert.equal(results.maria.json,404,'N2: current resident must not read historical payer receipt');assert.equal(results.maria.pdf,404);
    assert.equal(results.juan.detail,200);assert.equal(results.juan.includesPayment,true);
    assert.equal(results.maria.detail,200);assert.equal(results.maria.includesPayment,false);assert.equal(results.maria.includesQuota,false);
    assert.equal(results.other.json,404);assert.equal(results.other.pdf,404);
    assert.equal(results.admin.json,403);assert.equal(results.admin.report,200);assert.equal(results.admin.adminIncludesPayment,true);
  }finally{await c.end();if(db)await db.pool.end();}
}
main().catch(e=>{console.error(e.stack);process.exitCode=1;});
