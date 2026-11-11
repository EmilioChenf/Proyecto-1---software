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
