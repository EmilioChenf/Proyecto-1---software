const test=require('node:test'),assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const ExcelJS=require('exceljs');
const {configureTestEnvironment}=require('./support/isolatedMysql');
configureTestEnvironment();require('./support/suiteIsolation').assertOwnedSuiteDatabase();
const {pool,query}=require('../../src/database/mysql');
const adminPayments=require('../../src/services/adminPaymentsService');
const contracts=require('../../src/services/propertyContractsService');
const receipts=require('../../src/services/paymentReceiptService');
const reports=require('../../src/services/reportExportService');
const {getFinancialDetail}=require('../../src/services/residentFinancialDetailService');
const {receiptPdfText}=require('./support/receiptPdfText');
const http=require('supertest')(require('../../src/app').createApp());
const UNKNOWN='Responsable no confirmado',people={};
const today=require('../../src/utils/guatemalaTime').guatemalaToday(),first=contracts.__private__.nextPeriod(today);
async function person(key,role,name){
 const [type]=await query('SELECT id_tipo_usuario FROM TIPO_USUARIO WHERE nombre=?',[role]);
 const email=randomUUID()+'@n2a1.test';
 const id=(await query('INSERT INTO USUARIO(nombre,dpi,correo,password,activo,id_tipo_usuario) VALUES(?,?,?,?,1,?)',[name,randomUUID().slice(0,12),email,'test-only',type.id_tipo_usuario])).insertId;
 const resident=role==='residente'?(await query('INSERT INTO RESIDENTE(id_usuario) VALUES(?)',[id])).insertId:null;
 return people[key]={id,name,email,resident,role,auth:'Bearer '+(await require('../../src/services/activeSessionsService').createActiveSession(id)).token};
}
async function house(current=people.maria){return(await query('INSERT INTO CASA(numero,id_residente,activo) VALUES(?,?,1)',[randomUUID().slice(0,8),current?.resident||null])).insertId;}
async function quota(id,{amount=200,responsible=null,snapshot=null}={}){
 return(await query("INSERT INTO CUOTA(id_casa,id_servicio,monto,fecha_limite,id_responsable,responsable_snapshot) VALUES(?,1,?,'2025-09-10',?,?)",[id,amount,responsible?.id||null,snapshot==null?null:JSON.stringify(snapshot)])).insertId;
}
async function payment(id,q,actor,amount=123,explicit=false){
 const p=(await query("INSERT INTO PAGO(id_cuota,monto_pagado,fecha_pago,id_actor) VALUES(?,?,'2025-09-09',?)",[q,amount,explicit?actor.id:null])).insertId;
 if(actor&&!explicit)await query("INSERT INTO TRANSACCION_SIMULADA(id_pago,id_usuario,id_casa,rol,concepto,monto,estado) VALUES(?,?,?,?, 'Abono N2-A1',?,'APROBADA')",[p,actor.id,id,actor.role,amount]);
 await query("INSERT INTO PAGO_ORIGEN(id_pago,id_cuota,origen,ambiente) VALUES(?,?,'SIMULADO','academic')",[p,q]);return p;
}
async function fixture({actor=people.juan,...options}={}){const id=await house(),q=await quota(id,options),p=await payment(id,q,actor);return{id,q,p};}
const snapshot=p=>({id_usuario:p.id,nombre:p.name,correo:p.email});
async function serviceRows(id,filters={}){return(await adminPayments.listDelinquentResidents(filters)).filter(r=>r.id_casa===id);}
async function adminRows(id,filters={}){const r=await http.get('/admin/pagos').query(filters).set('Authorization',people.admin.auth).expect(200);return r.body.filter(r=>r.id_casa===id);}
function known(row,p=people.juan,balance=77){assert.equal(row.propietario_nombre,p.name);assert.equal(row.propietario_correo,p.email);assert.equal(row.id_responsable,p.id);assert.equal(row.total_pendiente,balance);}
function unknown(row,balance=77){assert.equal(row.propietario_nombre,UNKNOWN);assert.equal(row.propietario_correo,null);assert.equal(row.id_responsable,null);assert.equal(row.total_pendiente,balance);}
function binary(res,done){const chunks=[];res.on('data',b=>chunks.push(b));res.on('end',()=>done(null,Buffer.concat(chunks)));res.on('error',done);}
test.before(async()=>{
 for(const spec of [['juan','residente','Juan N2A1'],['maria','residente','Maria N2A1'],['pedro','residente','Pedro N2A1'],['direct','inquilino','Arrendatario N2A1'],['guard','guardia','Guardia N2A1'],['admin','admin','Administrador N2A1']])await person(...spec);
 await contracts.saveMaintenance({monto:'500',vigente_desde:first},people.admin.id);
});
test.after(async()=>{await pool.end();});

test('N2-A1 BEFORE/AFTER servicio atribuye saldo Q77, ID y correo a Juan historico',async t=>{
 const f=await fixture(),rows=await serviceRows(f.id);assert.equal(rows.length,1);t.diagnostic(JSON.stringify({case:'Juan',row:rows[0]}));known(rows[0]);
});
test('N2-A1 HTTP admin muestra Juan sin conceder la deuda a Maria',async()=>{
 const f=await fixture(),rows=await adminRows(f.id);assert.equal(rows.length,1);known(rows[0]);assert.equal(rows[0].propietario_actual,people.maria.name);
});
test('N2-A1 BEFORE/AFTER Maria -> Pedro -> NULL conserva Juan, correo y saldo',async t=>{
 const f=await fixture();
 for(const occupant of [people.maria,people.pedro,null]){await query('UPDATE CASA SET id_residente=? WHERE id_casa=?',[occupant?.resident||null,f.id]);const [row]=await adminRows(f.id);t.diagnostic(JSON.stringify({case:'occupancy',occupant:occupant?.id||null,row}));known(row);assert.equal(row.propietario_actual,occupant?.name||null);}
});
test('N2-A1 BEFORE/AFTER search Juan encuentra Q77 y Maria/Pedro no la heredan',async t=>{
 const f=await fixture();await query('UPDATE CASA SET id_residente=? WHERE id_casa=?',[people.pedro.resident,f.id]);
 const own=await adminRows(f.id,{search:'Juan'}),foreign=await adminRows(f.id,{search:'Pedro'});t.diagnostic(JSON.stringify({case:'search',Juan:own,Pedro:foreign}));assert.equal(own.length,1);known(own[0]);assert.deepEqual(foreign,[]);assert.deepEqual(await adminRows(f.id,{search:'Maria'}),[]);
});
test('N2-A1 search por correo historico, vivienda y terminos parciales',async()=>{
 const f=await fixture(),[{numero}]=await query('SELECT numero FROM CASA WHERE id_casa=?',[f.id]);
 for(const term of [people.juan.email,numero,numero.slice(0,4),'jUaN']){const rows=await adminRows(f.id,{search:term});assert.equal(rows.length,1,term);known(rows[0]);}
 for(const term of [people.maria.email,people.pedro.email])assert.deepEqual(await adminRows(f.id,{search:term}),[]);
});
test('N2-A1 BEFORE/AFTER desconocido conserva incertidumbre con Maria/Pedro/NULL',async t=>{
 const f=await fixture({actor:null});for(const occupant of [people.maria,people.pedro,null]){await query('UPDATE CASA SET id_residente=? WHERE id_casa=?',[occupant?.resident||null,f.id]);const [row]=await adminRows(f.id);t.diagnostic(JSON.stringify({case:'unknown',occupant:occupant?.id||null,row}));unknown(row);}
 const [stored]=await query('SELECT id_actor,titular_snapshot FROM PAGO WHERE id_pago=?',[f.p]);assert.deepEqual(stored,{id_actor:null,titular_snapshot:null});
});
test('N2-A1 responsable explicito de cuota prevalece sobre pagadores diferentes',async()=>{
 const f=await fixture({actor:people.maria,amount:300,responsible:people.juan,snapshot:snapshot(people.juan)});await payment(f.id,f.q,people.pedro,50);known((await adminRows(f.id))[0],people.juan,127);
});
test('N2-A1 snapshot identificable de cuota resuelve nombre/correo/ID sin id_responsable',async()=>{
 const archived={id_usuario:people.juan.id,nombre:'Juan Snapshot N2A1',correo:'juan-historico@n2a1.test'};
 const f=await fixture({actor:people.pedro,snapshot:archived}),[row]=await adminRows(f.id);known(row,{...people.juan,name:archived.nombre,email:archived.correo});
});
test('N2-A1 varios abonos del mismo actor conservan un responsable y saldo exacto',async()=>{
 const id=await house(),q=await quota(id,{amount:300});await payment(id,q,people.juan,50);await payment(id,q,people.juan,100);const rows=await adminRows(id);assert.equal(rows.length,1);known(rows[0],people.juan,150);
});
test('N2-A1 pagadores contradictorios sin cuota autoritativa quedan no confirmados',async()=>{
 const id=await house(),q=await quota(id,{amount:300});await payment(id,q,people.juan,50);await payment(id,q,people.pedro,100);
 for(const occupant of [people.maria,people.pedro,null]){await query('UPDATE CASA SET id_residente=? WHERE id_casa=?',[occupant?.resident||null,id]);const rows=await adminRows(id);assert.equal(rows.length,1);unknown(rows[0],150);}
});
test('N2-A1 actor explicito de PAGO resuelve cuota legada sin transaccion',async()=>{
 const id=await house(),q=await quota(id);await payment(id,q,people.juan,123,true);known((await adminRows(id))[0]);
});
test('N2-A1 una casa con cuotas de actores diferentes no mezcla saldos entre personas',async()=>{
 const id=await house();for(const [actor,amount]of [[people.juan,200],[people.pedro,250],[null,300]]){const q=await quota(id,{amount});await payment(id,q,actor);}
 const rows=await adminRows(id);assert.equal(rows.length,3);known(rows.find(r=>r.id_responsable===people.juan.id));known(rows.find(r=>r.id_responsable===people.pedro.id),people.pedro,127);unknown(rows.find(r=>r.id_responsable===null),177);assert.equal(rows.reduce((n,r)=>n+r.total_pendiente,0),381);
});
test('N2-A1 cuota sin pagos ni evidencia tampoco inventa residente responsable',async()=>{
 const id=await house();await quota(id);unknown((await adminRows(id))[0],200);
});
for(const type of ['COMPRA_FINANCIADA','PROPIEDAD_PRIVADA','RENTA_DIRECTA'])test('N2-A1 modalidad '+type+' conserva responsable explicito e historial',async()=>{
 const p=type==='RENTA_DIRECTA'?people.direct:people.juan,id=await house(null);
 await contracts.configureHouse(id,{id_operacion:randomUUID(),version:0,tipo:type,fecha_efectiva:today,cuota_vivienda:type==='PROPIEDAD_PRIVADA'?'0':'900',meses_financiamiento:type==='COMPRA_FINANCIADA'?2:null,responsable:{id_usuario:p.id},responsable_habita:false,inquilino_privado:null,confirmado:true},people.admin.id);
 await require('../../src/services/monthlyBillingService').__private__.billHouse(id,first);
 const quotas=await query('SELECT id_cuota FROM CUOTA WHERE id_casa=?',[id]);assert.equal(quotas.length,type==='PROPIEDAD_PRIVADA'?1:2);
 for(const q of quotas)await require('../../src/services/simulatedPaymentsService').payObligation(p.id,p.role,q.id_cuota);
 await query('UPDATE CASA SET id_residente=? WHERE id_casa=?',[people.pedro.resident,id]);const rows=await adminRows(id);assert.equal(rows.length,1);known(rows[0],p,0);
});
test('N2-A1 consistencia Juan en listado, mensual, JSON/PDF, XLSX y detalle personal',async()=>{
 const f=await fixture();known((await adminRows(f.id))[0]);const report=await adminPayments.getMonthlyFinancialReport(9,2025);const monthly=report.detalle.find(r=>r.id_casa===f.id);assert.equal(monthly.usuario,people.juan.name);assert.equal(monthly.pendiente,77);
 const json=await http.get(`/residente/pagos/${f.p}/comprobante/datos`).set('Authorization',people.juan.auth).expect(200);assert.equal(json.body.titular_nombre,people.juan.name);assert.equal(json.body.monto_pagado,123);
 const pdf=await http.get(`/residente/pagos/${f.p}/comprobante`).set('Authorization',people.juan.auth).expect(200);assert.equal(pdf.body.subarray(0,4).toString(),'%PDF');assert(receiptPdfText(pdf.body).includes(people.juan.name));
 await http.get(`/residente/pagos/${f.p}/comprobante/datos`).set('Authorization',people.maria.auth).expect(404);await http.get(`/residente/pagos/${f.p}/comprobante`).set('Authorization',people.maria.auth).expect(404);
 assert((await getFinancialDetail(people.juan.id)).pagos.some(p=>p.id_pago===f.p));assert(!(await getFinancialDetail(people.maria.id)).pagos.some(p=>p.id_pago===f.p));
 const [{numero}]=await query('SELECT numero FROM CASA WHERE id_casa=?',[f.id]);const exported=(await reports.rows('morosos')).find(r=>r.unidad===numero);assert.equal(exported.residente,people.juan.name);assert.equal(Number(exported.monto),77);
 for(const format of ['pdf','xlsx']){const r=await http.get(`/admin/reportes/exportar?reporte=morosos&formato=${format}`).set('Authorization',people.admin.auth).buffer(true).parse(binary).expect(200);
  if(format==='pdf'){assert.equal(r.body.subarray(0,4).toString(),'%PDF');const text=receiptPdfText(r.body);assert(text.includes(numero));assert(text.includes(people.juan.name));}
  else{const book=new ExcelJS.Workbook();await book.xlsx.load(r.body);let values;book.eachSheet(s=>s.eachRow(row=>{if(row.values.includes(numero))values=row.values;}));assert(values);assert(values.includes(people.juan.name));assert(values.includes(77));}}
});
test('N2-A1 desconocido es consistente con mensual/export y no obtiene recibo personal',async()=>{
 const f=await fixture({actor:null});unknown((await adminRows(f.id))[0]);const monthly=(await adminPayments.getMonthlyFinancialReport(9,2025)).detalle.find(r=>r.id_casa===f.id);assert.equal(monthly.usuario,UNKNOWN);
 const [{numero}]=await query('SELECT numero FROM CASA WHERE id_casa=?',[f.id]);assert.equal((await reports.rows('morosos')).find(r=>r.unidad===numero).residente,UNKNOWN);
 for(const p of [people.juan,people.maria,people.pedro])await assert.rejects(receipts.getPaymentReceipt(p.id,p.role,f.p),{status:404});
});
test('N2-A1 /admin/pagos permanece exclusivo de admin con sesiones reales',async()=>{
 await http.get('/admin/pagos').expect(401);for(const p of [people.juan,people.maria,people.pedro,people.direct,people.guard])await http.get(`/admin/pagos?id_usuario=${people.admin.id}&role=admin`).set('Authorization',p.auth).expect(403);
 await http.get('/admin/pagos').set('Authorization',people.admin.auth).expect(200);
});
test('N2-A1 filtros de estado/fecha y SQL injection conservan su contrato',async()=>{
 const f=await fixture();const rows=await adminRows(f.id,{estado:'MOROSO',date:'2025-09-10',search:people.juan.name});assert.equal(rows.length,1);known(rows[0]);assert.deepEqual(await adminRows(f.id,{estado:'PAGADO'}),[]);
 await http.get('/admin/pagos?estado=INVALIDO').set('Authorization',people.admin.auth).expect(400);assert.deepEqual(await adminRows(f.id,{search:"'; DROP TABLE USUARIO; --"}),[]);
});
