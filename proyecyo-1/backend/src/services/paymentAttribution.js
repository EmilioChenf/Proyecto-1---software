// Preserve the person who performed an applied payment, including legacy charges
// whose original financial responsible remains deliberately unknown.
async function attributePayment(connection,paymentId,actorId,responsibleSnapshot){
  const snapshot=responsibleSnapshot == null ? null
    : typeof responsibleSnapshot==='string' ? responsibleSnapshot : JSON.stringify(responsibleSnapshot);
  await connection.execute(`UPDATE PAGO SET id_actor=?,titular_snapshot=COALESCE(?,
    (SELECT JSON_OBJECT('id_usuario',id_usuario,'nombre',nombre,'correo',correo) FROM USUARIO WHERE id_usuario=?))
    WHERE id_pago=?`,[actorId,snapshot,actorId,paymentId]);
}
module.exports={attributePayment};
