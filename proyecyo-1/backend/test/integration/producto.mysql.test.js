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
