const { randomUUID } = require('node:crypto');
const { query } = require('../../../src/database/mysql');
const { createActiveSession } = require('../../../src/services/activeSessionsService');
async function person(role = 'residente') {
  const [type] = await query('SELECT id_tipo_usuario FROM TIPO_USUARIO WHERE nombre=?', [role]);
  const name = `Sprint9 ${randomUUID().slice(0, 8)}`;
  const id = (await query('INSERT INTO USUARIO(nombre,dpi,correo,password,activo,id_tipo_usuario) VALUES(?,?,?,?,1,?)',
    [name, randomUUID().slice(0, 12), `${randomUUID()}@sprint9.test`, 'test-only', type.id_tipo_usuario])).insertId;
  const resident = role === 'residente' ? (await query('INSERT INTO RESIDENTE(id_usuario) VALUES(?)', [id])).insertId : null;
  return { id, name, resident, auth: `Bearer ${(await createActiveSession(id)).token}` };
}
async function house(current) {
  return (await query('INSERT INTO CASA(numero,id_residente,activo) VALUES(?,?,1)', [randomUUID().slice(0, 8), current?.resident || null])).insertId;
}
async function quota(idCasa, { amount = '100.00', responsible = null, snapshot = null, deadline = '2030-06-01' } = {}) {
  return (await query('INSERT INTO CUOTA(id_casa,id_servicio,monto,fecha_limite,id_responsable,responsable_snapshot) VALUES(?,1,?,?,?,?)',
    [idCasa, amount, deadline, responsible?.id || null, snapshot ? JSON.stringify(snapshot) : null])).insertId;
}
async function payment(idQuota, actor, { amount = '10.00', date = '2030-06-05', snapshot = null } = {}) {
  return (await query('INSERT INTO PAGO(id_cuota,monto_pagado,fecha_pago,id_actor,titular_snapshot) VALUES(?,?,?,?,?)',
    [idQuota, amount, date, actor?.id || null, snapshot ? JSON.stringify(snapshot) : null])).insertId;
}
module.exports = { person, house, quota, payment };
