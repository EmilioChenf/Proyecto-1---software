const test=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {configureTestEnvironment}=require('./support/isolatedMysql');
const {assertOwnedSuiteDatabase}=require('./support/suiteIsolation');
configureTestEnvironment();assertOwnedSuiteDatabase();
const {pool,query}=require('../../src/database/mysql');

// Funciones de producto para vender a residenciales: amenidades, fallas, roles, etc.
async function user(role,label){
  const [t]=await query('SELECT id_tipo_usuario FROM TIPO_USUARIO WHERE nombre=?',[role]);
  const r=await query('INSERT INTO USUARIO(nombre,dpi,correo,password,activo,id_tipo_usuario) VALUES(?,?,?,?,1,?)',[label,`TEST${randomUUID().slice(0,12)}`,`${randomUUID()}@producto.test`,'test-only',t.id_tipo_usuario]);return r.insertId;
}
test.after(async()=>{await pool.end();});

test('AM01 crea, renombra, desactiva y elimina una amenidad sin historial',async()=>{
  const catalog=require('../../src/services/amenitiesCatalogService');
  const created=await catalog.createAmenity({nombre:'Rancho BBQ Test',descripcion:'Asadores',reglas:'Máx 10 personas',foto_url:'https://cdn.test/bbq.jpg',hora_apertura:'10:00',hora_cierre:'22:00',intervalo_minutos:30});
  assert.equal(created.nombre,'Rancho BBQ Test');assert.equal(created.intervalo_minutos,30);assert.equal(created.reglas,'Máx 10 personas');
  await assert.rejects(catalog.createAmenity({nombre:'rancho bbq test'}),{code:'AMENIDAD_DUPLICADA'});
  const renamed=await catalog.updateAmenity(created.id_amenidad,{nombre:'Rancho Test',activo:false});
  assert.equal(renamed.nombre,'Rancho Test');assert.equal(renamed.activo,false);
  await assert.rejects(catalog.updateAmenity(created.id_amenidad,{foto_url:'http://inseguro.test/x.png'}),{status:400});
  assert.deepEqual(await catalog.deleteAmenity(created.id_amenidad),{id_amenidad:created.id_amenidad,eliminada:true});
});
test('AM02 una amenidad con reservas no se elimina',async()=>{
  const catalog=require('../../src/services/amenitiesCatalogService');
  const created=await catalog.createAmenity({nombre:'Gimnasio Test',hora_apertura:'06:00',hora_cierre:'20:00',intervalo_minutos:60});
  const resident=await user('residente','Residente amenidad');
  await query("INSERT INTO RESERVA(id_usuario,id_amenidad,fecha,hora_inicio,hora_fin,estado) VALUES(?,?,'2030-01-10','08:00','09:00','CONFIRMADA')",[resident,created.id_amenidad]);
  await assert.rejects(catalog.deleteAmenity(created.id_amenidad),{code:'AMENIDAD_CON_HISTORIAL'});
});
test('AM03 el horario nuevo no puede dejar reservas futuras fuera',async()=>{
  const catalog=require('../../src/services/amenitiesCatalogService');
  const [gym]=await query("SELECT id_amenidad FROM AMENIDAD WHERE nombre='Gimnasio Test'");
  await assert.rejects(catalog.updateAmenity(gym.id_amenidad,{hora_apertura:'09:00'}),{status:409});
});

test('TK01 el residente reporta con foto, la administración responde y resuelve',async()=>{
  const tickets=require('../../src/services/ticketsService');
  const resident=await user('residente','Residente falla');const admin=await user('admin','Admin fallas');
  const photo='data:image/jpeg;base64,'+Buffer.from('foto-de-prueba').toString('base64');
  const created=await tickets.createTicket(resident,'residente',{titulo:'Lámpara del parqueo fundida',descripcion:'Frente a la casa 12',categoria:'ELECTRICIDAD',ubicacion:'Parqueo visitas',foto:photo});
  assert.equal(created.estado,'ABIERTO');assert.equal(created.foto,photo);assert.equal(created.casa,null);
  const adminNotice=await query("SELECT COUNT(*) n FROM NOTIFICACION WHERE id_usuario=? AND tipo='TICKET'",[admin]);
  assert.equal(Number(adminNotice[0].n),1);
  await assert.rejects(tickets.getTicket(created.id_ticket,{userId:admin}),{status:404});
  const inProgress=await tickets.updateTicket(created.id_ticket,admin,{estado:'EN_PROCESO',prioridad:'ALTA',comentario:'El electricista viene mañana'});
  assert.equal(inProgress.estado,'EN_PROCESO');assert.equal(inProgress.prioridad,'ALTA');
  assert.deepEqual(inProgress.historial.map(h=>[h.comentario,h.estado_nuevo]),[['El electricista viene mañana','EN_PROCESO']]);
  const resolved=await tickets.updateTicket(created.id_ticket,admin,{estado:'RESUELTO'});
  assert(resolved.resuelto_en);
  const reopened=await tickets.addReporterComment(created.id_ticket,resident,{comentario:'Se volvió a apagar',reabrir:true});
  assert.equal(reopened.estado,'ABIERTO');assert.equal(reopened.resuelto_en,null);
  const residentNotices=await query("SELECT titulo FROM NOTIFICACION WHERE id_usuario=? AND tipo='TICKET' ORDER BY id_notificacion",[resident]);
  assert.deepEqual(residentNotices.map(n=>n.titulo),['Tu reporte está en proceso','Tu reporte está resuelto']);
  assert.equal((await tickets.listTickets({userId:resident})).length,1);
});
test('TK02 valida título, categoría y foto',async()=>{
  const tickets=require('../../src/services/ticketsService');
  assert.throws(()=>tickets.validateTicket({titulo:'x'}),/título/);
  assert.throws(()=>tickets.validateTicket({titulo:'Fuga de agua',categoria:'INVENTADA'}),/categoría/);
  assert.throws(()=>tickets.validateTicket({titulo:'Fuga de agua',foto:'data:text/html;base64,PHNjcmlwdD4='}),/imagen/);
});

test('RL01 el admin crea un rol Contador que solo ve finanzas y pagos',async()=>{
  const roles=require('../../src/services/customRolesService');
  const request=require('supertest')(require('../../src/app').createApp());
  const admin=await user('admin','Admin roles');
  const created=await request.post('/admin/roles').set({'x-user-id':String(admin),'x-user-role':'admin'})
    .send({nombre:'Contador Test',descripcion:'Lleva la contabilidad',color:'#059669',permisos:{finanzas:'VER',pagos:'EDITAR',auditoria:'EDITAR',usuarios:'NINGUNO'}});
  assert.equal(created.status,201,JSON.stringify(created.body));
  assert.deepEqual(created.body.permisos,{finanzas:'VER',pagos:'EDITAR',auditoria:'VER'});
  const types=await request.get('/tipos-usuario').set({'x-user-id':String(admin),'x-user-role':'admin'});
  assert(types.body.some(t=>t.nombre==='Contador Test'&&t.personalizado===true));
  const accountant=await user('Contador Test','Contadora');
  const as={'x-user-id':String(accountant),'x-user-role':'Contador Test'};
  assert.equal((await request.get('/admin/pagos').set(as)).status,200);
  assert.equal((await request.get('/admin/viviendas').set(as)).status,403);
  assert.equal((await request.get('/admin/respaldos').set(as)).status,403);
  assert.equal((await request.get('/admin/roles').set(as)).status,403,'un rol personalizado no gestiona roles');
  assert.equal((await request.put('/admin/configuracion-financiera').set(as).send({})).status,403,'finanzas en Ver no permite cambios');
  const session=await roles.decorateSessionUser({id:accountant,email:'c@x',role:'Contador Test'});
  assert.equal(session.role,'admin');assert.equal(session.rol_personalizado.nombre,'Contador Test');assert.equal(session.permisos.pagos,'EDITAR');
  await assert.rejects(roles.deleteRole(created.body.id),{status:409});
  await assert.rejects(roles.createRole({nombre:'admin',permisos:{pagos:'VER'}}),{status:400});
  await assert.rejects(roles.createRole({nombre:'Sin módulos',permisos:{}}),/al menos un módulo/);
  const guard=(await query("SELECT id_tipo_usuario id FROM TIPO_USUARIO WHERE nombre='guardia'"))[0].id;
  await assert.rejects(roles.updateRole(guard,{nombre:'Guardia X',permisos:{pagos:'VER'}}),{status:403});
});
test('RL02 un rol con Usuarios no puede crear administradores',async()=>{
  const roles=require('../../src/services/customRolesService');
  const request=require('supertest')(require('../../src/app').createApp());
  await roles.createRole({nombre:'Recepcion Test',permisos:{usuarios:'EDITAR'}});
  const clerk=await user('Recepcion Test','Recepcionista');
  const as={'x-user-id':String(clerk),'x-user-role':'Recepcion Test'};
  const adminType=(await query("SELECT id_tipo_usuario id FROM TIPO_USUARIO WHERE nombre='admin'"))[0].id;
  const denied=await request.post('/usuarios').set(as).send({nombre:'Intruso',correo:`${randomUUID()}@x.test`,password:'clave1234',id_tipo_usuario:adminType});
  assert.equal(denied.status,403);
  const guardType=(await query("SELECT id_tipo_usuario id FROM TIPO_USUARIO WHERE nombre='guardia'"))[0].id;
  const ok=await request.post('/usuarios').set(as).send({nombre:'Guardia nuevo',correo:`${randomUUID()}@x.test`,password:'clave1234',id_tipo_usuario:guardType});
  assert.equal(ok.status,201,JSON.stringify(ok.body));
});

test('IN01 indicadores: morosidad mes a mes, ocupación, visitas y fallas',async()=>{
  const {getIndicators}=require('../../src/services/indicatorsService');
  const result=await getIndicators({meses:6,dias:30},new Date());
  assert.equal(result.morosidad.length,6);assert.equal(result.visitas.length,30);assert.equal(result.fallas.length,6);
  assert(result.ocupacion.every(a=>a.porcentaje>=0&&a.porcentaje<=100));
  const month=result.fallas[result.fallas.length-1];assert(month.abiertas>=1,'el ticket de TK01 cuenta en el mes actual');
  assert.equal(typeof result.resumen.visitas_promedio_dia,'number');
  const request=require('supertest')(require('../../src/app').createApp());
  await require('../../src/services/customRolesService').createRole({nombre:'Junta Test',permisos:{dashboard:'VER'}});
  const board=await user('Junta Test','Presidenta');
  assert.equal((await request.get('/admin/indicadores').set({'x-user-id':String(board),'x-user-role':'Junta Test'})).status,200);
});

test('CM01 votación: un voto por vivienda, resultados y cierre',async()=>{
  const community=require('../../src/services/communityService');
  const admin=await user('admin','Admin comunidad');
  const resident=await user('residente','Propietaria votante');
  const [res]=await query('SELECT id_residente FROM RESIDENTE WHERE id_usuario=?',[resident]);
  let residentId=res?.id_residente;
  if(!residentId){residentId=(await query('INSERT INTO RESIDENTE(id_usuario) VALUES(?)',[resident])).insertId;}
  await query("INSERT INTO CASA(numero,torre,id_residente) VALUES(?,?,?)",[`V${Date.now()%100000}`,'T9',residentId]);
  const tomorrow=new Date(Date.now()+86400000).toISOString().slice(0,16);
  assert.throws(()=>community.validatePoll({titulo:'¿Pintamos?',opciones:['Sí'],fecha_cierre:tomorrow}),/entre 2 y 8/);
  const poll=await community.createPoll(admin,{titulo:'¿Pintamos la garita de azul?',opciones:['Sí','No','Me da igual'],fecha_cierre:tomorrow,resultados_visibles:false});
  assert.equal(poll.opciones.length,3);
  const notices=await query("SELECT COUNT(*) n FROM NOTIFICACION WHERE id_usuario=? AND tipo='COMUNIDAD'",[resident]);
  assert.equal(Number(notices[0].n),1);
  const [mine]=(await community.listPolls({userId:resident,role:'residente'})).filter(p=>p.id_votacion===poll.id_votacion);
  assert.equal(mine.puede_votar,true,JSON.stringify(mine));
  const voted=await community.vote(poll.id_votacion,resident,'residente',poll.opciones[0].id_opcion);
  assert.equal(voted.mi_voto,poll.opciones[0].id_opcion);assert.equal(voted.mostrar_resultados,false,'resultados ocultos hasta el cierre');
  await assert.rejects(community.vote(poll.id_votacion,resident,'residente',poll.opciones[1].id_opcion),{status:409});
  await assert.rejects(community.vote(poll.id_votacion,resident,'inquilino',poll.opciones[1].id_opcion),{status:403});
  await assert.rejects(community.deletePoll(poll.id_votacion),{status:409});
  const closed=await community.closePoll(poll.id_votacion);
  assert.equal(closed.abierta,false);assert.equal(closed.opciones[0].votos,1);assert.equal(closed.total_votos,1);
});
test('CM02 documentos y directorio',async()=>{
  const community=require('../../src/services/communityService');
  const admin=await user('admin','Admin docs');
  const pdf='data:application/pdf;base64,'+Buffer.from('%PDF-1.4 reglamento').toString('base64');
  await assert.rejects(community.createDocument(admin,{titulo:'Malo',nombre_archivo:'x.html',archivo:'data:text/html;base64,PGI+'}),/PDF/);
  const doc=await community.createDocument(admin,{titulo:'Reglamento interno 2026',categoria:'REGLAMENTO',nombre_archivo:'reglamento.pdf',archivo:pdf,notificar:false});
  assert.equal(doc.tipo,'PDF');
  const file=await community.getDocumentFile(doc.id_documento);
  assert.equal(file.buffer.toString(),'%PDF-1.4 reglamento');
  const contacts=await community.listContacts();
  assert(contacts.some(c=>c.telefono==='110'),'trae números de emergencia');
  const plumber=await community.saveContact(null,{nombre:'Plomero Don Luis',categoria:'SERVICIOS',telefono:'5555-1234'});
  assert.equal(plumber.categoria,'SERVICIOS');
  await assert.rejects(community.saveContact(null,{nombre:'Sin datos'}),/teléfono o un correo/);
  assert.deepEqual(await community.deleteDocument(doc.id_documento),{id_documento:doc.id_documento,eliminado:true});
});

test('IM01 importa viviendas, residentes, inquilinos y saldos desde la plantilla',async()=>{
  const ExcelJS=require('exceljs');const importer=require('../../src/services/importService');
  const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(await importer.buildTemplate());
  const tag=String(Date.now()%100000);
  const fill=(name,rows)=>{const ws=workbook.getWorksheet(name);ws.spliceRows(2,ws.rowCount);rows.forEach(r=>ws.addRow(r));};
  fill('Viviendas',[['IM','1'+tag,'Ceiba','VENTA',500000,'',3,2],['IM','2'+tag,'Ceiba','RENTA','',5000,2,1],['IM','1'+tag,'Dup','VENTA','','','','']]);
  fill('Residentes',[['Ana Importada',`ana${tag}@import.test`,'5555-1111','IM','1'+tag],['Sin casa',`sincasa${tag}@import.test`,'','IM','999']]);
  fill('Inquilinos',[['Carlos Inquilino',`carlos${tag}@import.test`,'','IM','1'+tag],['Pedro Sin Residente',`pedro${tag}@import.test`,'','IM','2'+tag]]);
  fill('Saldos iniciales',[['IM','1'+tag,1250.5,'2026-11-30','Mantenimiento atrasado'],['IM','1'+tag,-5,'','Malo']]);
  const base64=Buffer.from(await workbook.xlsx.writeBuffer()).toString('base64');
  const preview=await importer.previewImport(base64);
  assert.deepEqual(preview.viviendas.map(v=>v.estado),['NUEVA','NUEVA','ERROR']);
  assert.deepEqual(preview.residentes.map(v=>v.estado),['NUEVO','ERROR']);
  assert.deepEqual(preview.inquilinos.map(v=>v.estado),['NUEVO','ERROR']);
  assert.match(preview.inquilinos[1].errores[0],/no tiene residente/);
  assert.deepEqual(preview.saldos.map(v=>v.estado),['NUEVO','ERROR']);
  assert.equal(preview.resumen.listas,5);
  assert.equal(Number((await query("SELECT COUNT(*) n FROM CASA WHERE torre='IM'"))[0].n),0,'la vista previa no guarda');
  const report=await importer.applyImport(base64,{invitar:false});
  assert.deepEqual([report.viviendas,report.residentes,report.inquilinos,report.saldos],[2,1,1,1],JSON.stringify(report));
  assert.equal(report.fallidas.length,0,JSON.stringify(report.fallidas));
  const [quota]=await query("SELECT cu.monto, cu.concepto_snapshot FROM CUOTA cu JOIN CASA c ON c.id_casa=cu.id_casa WHERE c.torre='IM' AND c.numero=?",['1'+tag]);
  assert.equal(Number(quota.monto),1250.5);assert.equal(quota.concepto_snapshot,'Mantenimiento atrasado');
  const again=await importer.previewImport(base64);
  assert.equal(again.viviendas[0].estado,'YA_EXISTE');assert.equal(again.residentes[0].estado,'YA_EXISTE');
});

test('SU01 primeros pasos: avance de la configuración inicial',async()=>{
  const setup=require('../../src/services/setupService');
  const status=await setup.getSetupStatus();
  assert.equal(status.total,6);
  assert.equal(status.pasos.find(p=>p.id==='amenidades').done,true,'AM02 dejó una amenidad activa');
  assert.equal(status.pasos.find(p=>p.id==='visitas').done,false);
  assert.equal((await setup.markStepReviewed('visitas')).pasos.find(p=>p.id==='visitas').done,true);
  assert.equal((await setup.setSetupHidden(true)).oculto,true);
});

test('FE01 datos fiscales y factura simulada por pago',async()=>{
  const fel=require('../../src/services/felService');
  await assert.rejects(fel.updateFiscalSettings({modo:'SIMULADO',nit:'5764426',nombre_emisor:'Asociación Las Brisas',direccion:'Zona 16'}),/NIT/);
  await assert.rejects(fel.updateFiscalSettings({modo:'SIMULADO',nit:'5764424'}),/razón social/);
  await assert.rejects(fel.updateFiscalSettings({modo:'CERTIFICADOR'}),/certificador/);
  const saved=await fel.updateFiscalSettings({modo:'SIMULADO',nit:'576442-4',nombre_emisor:'Asociación Las Brisas',direccion:'Km 15 Carretera a El Salvador',regimen:'GENERAL'});
  assert.equal(saved.nit,'5764424');assert.equal(saved.completos,true);
  const first=await fel.documentForPayment({id_pago:987654,monto_pagado:450});
  const again=await fel.documentForPayment({id_pago:987654,monto_pagado:450});
  assert.equal(first.simulado,true);assert.match(first.serie,/^SIM/);assert.equal(first.autorizacion,again.autorizacion,'un documento por pago');
  await fel.updateFiscalSettings({modo:'DESACTIVADO'});
  assert.equal(await fel.documentForPayment({id_pago:987655,monto_pagado:1}),null);
  const status=await require('../../src/services/paymentsIntegrationService').getIntegrationStatus();
  assert.equal(status.recurrente.modo,'SANDBOX');assert(status.produccion.length>=4);
  assert.equal(JSON.stringify(status).includes(process.env.RECURRENTE_SECRET_KEY||'@@nada@@'),false,'nunca expone la llave');
});

test('PU01 push: suscripción por dispositivo, envío y limpieza de dispositivos dados de baja',async()=>{
  const push=require('../../src/services/pushService');
  const resident=await user('residente','Residente push');
  const sub={endpoint:`https://push.example.test/${randomUUID()}`,keys:{p256dh:'B'.repeat(87),auth:'a'.repeat(22)}};
  const gone={endpoint:`https://push.example.test/${randomUUID()}`,keys:{p256dh:'C'.repeat(87),auth:'b'.repeat(22)}};
  await assert.rejects(push.subscribe(resident,{endpoint:'http://inseguro'}),{status:400});
  await push.subscribe(resident,sub,'Chrome Android');await push.subscribe(resident,gone,'iPhone');
  await query("UPDATE NOTIFICACION SET push_estado='OMITIDO' WHERE push_estado='PENDIENTE'");
  await query("INSERT INTO NOTIFICACION (id_usuario,tipo,titulo,mensaje,leido) VALUES (?,'TICKET','Tu reporte está resuelto','Reporte #1',FALSE)",[resident]);
  const sent=[];
  const sender={sendNotification:async(target,payload)=>{if(target.endpoint===gone.endpoint)throw Object.assign(new Error('Gone'),{statusCode:410});sent.push(JSON.parse(payload));}};
  const stats=await push.processPushBatch({sender});
  assert.equal(stats.sent,1);assert.equal(sent[0].title,'Tu reporte está resuelto');assert.equal(sent[0].url,'/residente/fallas');
  assert.equal(Number((await query('SELECT COUNT(*) n FROM PUSH_SUSCRIPCION WHERE id_usuario=?',[resident]))[0].n),1,'se borra el dispositivo dado de baja');
  assert.equal((await push.processPushBatch({sender})).sent,0,'no se reenvía');
});

test('VA01 avisa QR expirado sin usar y visita que no registra salida, una sola vez',async()=>{
  const alerts=require('../../src/services/visitAlertsService');
  const resident=await user('residente','Residente alertas');const guard=await user('guardia','Guardia alertas');
  let [res]=await query('SELECT id_residente FROM RESIDENTE WHERE id_usuario=?',[resident]);
  const residentId=res?.id_residente||(await query('INSERT INTO RESIDENTE(id_usuario) VALUES(?)',[resident])).insertId;
  const casa=(await query("INSERT INTO CASA(numero,torre,id_residente) VALUES(?,?,?)",[`AL${Date.now()%100000}`,'AL',residentId])).insertId;
  const visitante=async(n)=>(await query('INSERT INTO VISITANTE(nombre,dpi) VALUES(?,?)',[n,String(Date.now()).slice(-13).padStart(13,'1')])).insertId;
  const {date}=alerts.guatemalaNow(new Date());
  const v1=await visitante('Ana Tarde');const v2=await visitante('Beto Dentro');
  const a1=(await query("INSERT INTO ACCESO(id_visitante,id_casa,id_usuario_autoriza,fecha,hora_inicio,hora_fin,tipo_visita,token_qr,estado_acceso) VALUES(?,?,?,?, '08:00','10:30','VISITA',?, 'AUTORIZADA')",[v1,casa,resident,date,'tok'+Date.now()])).insertId;
  const a2=(await query("INSERT INTO ACCESO(id_visitante,id_casa,id_usuario_autoriza,fecha,hora_inicio,hora_fin,tipo_visita,token_qr,estado_acceso) VALUES(?,?,?,?, '08:00','10:30','VISITA',?, 'INGRESO_REGISTRADO')",[v2,casa,resident,date,'tok2'+Date.now()])).insertId;
  // A las 10:30 aún no expira; a las 10:31 sí (hora de Guatemala = UTC-6).
  const at=(h,m)=>new Date(`${date}T${String(h+6).padStart(2,'0')}:${String(m).padStart(2,'0')}:00Z`);
  const before=await alerts.processVisitAlerts({now:at(10,29)});
  assert.equal(await query('SELECT COUNT(*) n FROM NOTIFICACION WHERE id_acceso IN (?,?)',[a1,a2]).then(r=>Number(r[0].n)),0,JSON.stringify(before));
  const stats=await alerts.processVisitAlerts({now:at(10,31)});
  assert(stats.qr_expirados>=1&&stats.salidas_pendientes>=1,JSON.stringify(stats));
  const [exp]=await query("SELECT titulo,correo_estado,push_estado FROM NOTIFICACION WHERE id_acceso=? AND tipo='QR_EXPIRADO'",[a1]);
  assert.equal(exp.titulo,'El QR de Ana Tarde expiró');assert.equal(exp.correo_estado,'PENDIENTE','se envía también por correo');assert.equal(exp.push_estado,'PENDIENTE','y como push');
  const overdue=await query("SELECT id_usuario FROM NOTIFICACION WHERE id_acceso=? AND tipo='SALIDA_PENDIENTE'",[a2]);
  assert(overdue.some(n=>n.id_usuario===guard),'avisa al guardia');assert(overdue.some(n=>n.id_usuario===resident),'avisa al residente');
  await alerts.processVisitAlerts({now:at(10,45)});
  assert.equal(Number((await query("SELECT COUNT(*) n FROM NOTIFICACION WHERE id_acceso=? AND tipo='QR_EXPIRADO'",[a1]))[0].n),1,'no se repite');
});
