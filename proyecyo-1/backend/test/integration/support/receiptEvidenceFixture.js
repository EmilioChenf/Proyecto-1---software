// Synthetic reproduction of the invariants in the versioned HU16/HU17 tests.
// Not provider evidence and never loaded by the application or a production migration.
const {randomUUID}=require('node:crypto');
async function seedReceiptEvidence(c){
  await c.beginTransaction();
  try{
    const [service]=await c.execute("INSERT INTO SERVICIO(nombre,tipo_servicio,descripcion) VALUES('HU13 Sandbox Q5 TEST','General','Fixture sintética de regresión, sin proveedor real')");
    for(const id of [171,998])await c.execute('INSERT INTO CUOTA(id_cuota,id_servicio,id_casa,monto,fecha_limite) VALUES(?,?,1,5,?)',[id,service.insertId,id===171?'2026-10-10':'2099-12-01']);
    await c.execute("INSERT INTO PAGO(id_pago,id_cuota,monto_pagado,fecha_pago) VALUES(395,171,5,'2026-10-02')");
    await c.execute("INSERT INTO PAGO_ORIGEN(id_pago,id_cuota,origen,ambiente) VALUES(395,171,'RECURRENTE','sandbox')");
    for(const [id,quota,external,state,provider] of [[433,171,'ch_orahuujriakj0kgk','CONFIRMADO','paid'],[937,998,'ch_PROPERTY_TEST_FAILED','PENDIENTE','unpaid']]){
      await c.query('INSERT INTO CHECKOUT_RECURRENTE SET ?',{id_checkout:id,referencia_local:randomUUID(),idempotency_key:randomUUID(),id_externo:external,id_cuota:quota,id_usuario:3,id_residente:1,id_casa:1,monto_centavos:500,capital_centavos:500,recargo_centavos:0,moneda:'GTQ',ambiente:'sandbox',sandbox_id:'property-contract-synthetic-test',estado:state,estado_proveedor:provider,checkout_url:`https://app.recurrente.com/checkout-session/${external}`});
    }
    for(const [id,checkout,intent,type] of [[348,433,'in_y4hil51d','payment_intent.succeeded'],[349,433,'in_y4hil51d','payment_intent.succeeded'],[859,937,'in_PROPERTY_TEST_FAILED','payment_intent.failed'],[860,937,'in_PROPERTY_TEST_FAILED','payment_intent.failed']]){
      await c.query('INSERT INTO EVENTO_RECURRENTE SET ?',{id_evento:id,svix_id:`msg_property_synthetic_${id}`,ambiente:'sandbox',tipo_evento:type,id_operacion_externa:intent,id_checkout:checkout,hash_body:'a'.repeat(64),estado:'PROCESADO',intentos:1,live_mode:0});
    }
    await c.query('INSERT INTO TRANSACCION_RECURRENTE SET ?',{id_transaccion:296,id_checkout:433,id_externo:'in_y4hil51d',id_pago_externo:'pa_xzdhbyna',idempotency_key:randomUUID(),id_cuota:171,id_usuario:3,id_casa:1,id_pago:395,monto_centavos:500,moneda:'GTQ',ambiente:'sandbox',estado:'CONFIRMADA',id_evento:348,fecha_proveedor_original:'2026-10-02T18:00:00Z',fecha_proveedor_utc:'2026-10-02 18:00:00',confirmado_en:'2026-10-02 18:00:00',capital_aplicado_centavos:500,recargo_aplicado_centavos:0});
    await c.query('INSERT INTO TRANSACCION_RECURRENTE SET ?',{id_transaccion:486,id_checkout:937,id_externo:'in_PROPERTY_TEST_FAILED',idempotency_key:randomUUID(),id_cuota:998,id_usuario:3,id_casa:1,monto_centavos:500,moneda:'GTQ',ambiente:'sandbox',estado:'FALLIDA',id_evento:859});
    await c.commit();
  }catch(error){await c.rollback();throw error;}
}
module.exports={seedReceiptEvidence};
