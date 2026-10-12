const { QUOTA_BALANCES_SQL, toCents } = require('./financialBalance');
const { __private__: refundRules } = require('./recurrenteRefundService');
// A legacy NULL is recoverable only for this normalization error and only when
// the identical original body now supplies consistent, explicit Sandbox proof.
function reviewReceiptMatches(receipt, event, sandboxId) {
  return !!receipt && ['REVISION','PROCESADO'].includes(receipt.estado)
    && ['PAYMENT','REFUND'].includes(event.disposition) && !event.code
    && receipt.tipo_evento === event.eventType && receipt.id_operacion_externa === event.sourceId
    && receipt.ambiente === 'sandbox' && receipt.sandbox_id === sandboxId
    && event.environment === 'sandbox' && event.sandboxId === sandboxId && event.liveMode === false
    && ([0,false].includes(receipt.live_mode) || receipt.live_mode === null
      && receipt.estado === 'REVISION' && receipt.tipo_evento === 'refund.create'
      && receipt.error_codigo === 'REFUND_ENVIRONMENT_UNPROVEN' && event.disposition === 'REFUND');
}
async function previewRefund(connection, { receipt, event, sandboxId }) {
  const reject = () => ({result:'review',financialRowsModified:0});
  const [refunds] = await connection.execute("SELECT *,DATE_FORMAT(fecha_contable,'%Y-%m-%d') fecha_contable_dia FROM REEMBOLSO_RECURRENTE WHERE ambiente='sandbox' AND id_externo=?",[event.sourceId]);
  const rr = refunds[0], evidence = event.refund;
  if (refunds.length !== 1 || rr.estado !== 'CONFIRMADO' || rr.estado_proveedor !== 'succeeded'
    || !rr.aplicado_en || !rr.confirmado_en || rr.error_codigo || rr.sandbox_id !== sandboxId
    || evidence?.status !== 'succeeded' || evidence.id !== rr.id_externo || evidence.amount !== Number(rr.monto_centavos)
    || evidence.currency !== rr.moneda || rr.moneda !== 'GTQ' || !evidence.time
    || evidence.time.original !== rr.fecha_proveedor_original || evidence.time.accountingDate !== rr.fecha_contable_dia
    || evidence.accountId && evidence.accountId !== rr.cuenta_proveedor
    || evidence.merchantAmount != null && evidence.merchantAmount !== Number(rr.importe_comercio_centavos)
    || Number(rr.capital_revertido_centavos) + Number(rr.recargo_revertido_centavos) !== Number(rr.monto_centavos)) return reject();
  let local;
  try { local = await refundRules.localTransaction(connection,rr.id_transaccion); }
  catch (error) { if (error.code === 'REFUND_NOT_FOUND') return reject(); throw error; }
  if (!refundRules.eligibleLocal(local,sandboxId) || event.parentId !== local.legacy_intent
    || Number(receipt.id_checkout) !== Number(local.id_checkout)
    || event.checkoutId != null && event.checkoutId !== local.checkout_externo
    || event.checkoutStatus != null && event.checkoutStatus !== 'paid'
    || event.checkoutAmount != null && event.checkoutAmount !== Number(local.monto_centavos)
    || event.checkoutCurrency != null && event.checkoutCurrency !== local.moneda
    || event.paymentId != null && event.paymentId !== local.id_pago_externo
    || event.checkoutPaymentId != null && event.checkoutPaymentId !== local.id_pago_externo
    || event.intentId != null && event.intentId !== local.id_externo
    || event.parentAmount != null && event.parentAmount !== Number(local.monto_centavos)
    || event.parentCurrency != null && event.parentCurrency !== local.moneda) return reject();
  const [all] = await connection.execute('SELECT * FROM REEMBOLSO_RECURRENTE WHERE id_transaccion=? ORDER BY id_reembolso',[local.id_transaccion]);
  const amounts = refundRules.budget(local,all);
  if ((amounts.devuelto_centavos === amounts.original_centavos ? 'REEMBOLSADA' : 'REEMBOLSADA_PARCIAL') !== local.estado) return reject();
  const [balances] = await connection.execute(`SELECT * FROM (${QUOTA_BALANCES_SQL}) b WHERE id_cuota=?`,[local.id_cuota]);
  const b = balances[0]; if (!b || Number(b.sobrepago) !== 0 || Number(b.reembolso_inconsistente) !== 0) return reject();
  return {result:'duplicate',eventId:receipt.id_evento,refundId:rr.id_reembolso,externalRefund:rr.id_externo,
    checkoutId:local.id_checkout,externalCheckout:local.checkout_externo,transactionId:local.id_transaccion,
    quotaId:local.id_cuota,paymentId:local.id_pago,intent:local.id_externo,externalPayment:local.id_pago_externo,
    amountCents:Number(rr.monto_centavos),currency:rr.moneda,balance:b.saldo_pendiente,
    refundState:rr.estado,providerState:rr.estado_proveedor,alreadyApplied:true,
    sandboxMatches:true,liveMode:event.liveMode,financialRowsModified:0};
}
// Strict read-only duplicate proof. It never calls receive/strongSuccessTransition,
// archives a review, locks for an update or sends a provider request.
async function previewReview(connection, { receipt, event, sandboxId }) {
  const reject = () => ({result:'review',financialRowsModified:0});
  if (!reviewReceiptMatches(receipt,event,sandboxId)) return reject();
  if (event.disposition === 'REFUND') return previewRefund(connection,{receipt,event,sandboxId});
  const [checkouts] = await connection.execute("SELECT * FROM CHECKOUT_RECURRENTE WHERE ambiente='sandbox' AND id_externo=?",[event.checkoutId]);
  const local = checkouts[0]; if (checkouts.length !== 1 || local.sandbox_id !== sandboxId) return reject();
  const [quotas] = await connection.execute(`SELECT cu.id_cuota,cu.id_casa,r.id_residente,COALESCE(cu.id_responsable,co.id_usuario) id_usuario
    FROM CUOTA cu JOIN CHECKOUT_RECURRENTE co ON co.id_cuota=cu.id_cuota AND co.id_checkout=?
    LEFT JOIN RESIDENTE r ON r.id_usuario=COALESCE(cu.id_responsable,co.id_usuario)
    WHERE cu.id_cuota=?`,[local.id_checkout,local.id_cuota]);
  const quota = quotas[0];
  if (!quota || Number(local.id_casa) !== Number(quota.id_casa) || Number(local.id_residente) !== Number(quota.id_residente)
    || Number(local.id_usuario) !== Number(quota.id_usuario) || Number(receipt.id_checkout) !== Number(local.id_checkout)
    || Number(local.monto_centavos) !== event.amount || local.moneda !== event.currency || local.moneda !== 'GTQ'
    || event.reference !== undefined && event.reference !== local.referencia_local) return reject();
  const [transactions] = await connection.execute(`SELECT * FROM TRANSACCION_RECURRENTE
    WHERE ambiente='sandbox' AND (id_externo=? OR (? IS NOT NULL AND id_pago_externo=?))`,[event.externalId,event.paymentId,event.paymentId]);
  const tr = transactions[0];
  if (!tr?.id_pago) return {result:'requires-recovery',financialRowsModified:0};
  const [siblings] = await connection.execute('SELECT id_transaccion FROM TRANSACCION_RECURRENTE WHERE id_checkout=?',[local.id_checkout]);
  if (transactions.length !== 1 || siblings.length !== 1 || Number(siblings[0].id_transaccion) !== Number(tr.id_transaccion)
    || Number(tr.id_checkout) !== Number(local.id_checkout) || Number(tr.id_cuota) !== Number(local.id_cuota)
    || Number(tr.id_usuario) !== Number(local.id_usuario) || Number(tr.id_casa) !== Number(local.id_casa)
    || Number(tr.monto_centavos) !== event.amount || tr.moneda !== event.currency || tr.id_externo !== event.externalId
    || !event.paymentId || tr.id_pago_externo !== event.paymentId || tr.fecha_proveedor_original !== event.time?.original
    || !['CONFIRMADA','REEMBOLSADA_PARCIAL','REEMBOLSADA'].includes(tr.estado)
    || local.estado !== 'CONFIRMADO' || local.estado_proveedor !== 'paid' || event.checkoutStatus !== 'paid') return reject();
  const [payments] = await connection.execute(`SELECT p.id_pago,p.id_cuota,p.monto_pagado,
    DATE_FORMAT(p.fecha_pago,'%Y-%m-%d') fecha_pago,o.origen,o.ambiente FROM PAGO p
    JOIN PAGO_ORIGEN o ON o.id_pago=p.id_pago WHERE p.id_pago=? AND p.id_cuota=?`,[tr.id_pago,local.id_cuota]);
  const payment = payments[0];
  if (payments.length !== 1 || payment.origen !== 'RECURRENTE' || payment.ambiente !== 'sandbox'
    || payment.fecha_pago !== event.time.accountingDate || toCents(payment.monto_pagado) !== event.amount) return reject();
  const [balances] = await connection.execute(`SELECT * FROM (${QUOTA_BALANCES_SQL}) b WHERE id_cuota=?`,[local.id_cuota]);
  const balance = balances[0];
  if (!balance || Number(balance.sobrepago) !== 0 || Number(balance.reembolso_inconsistente) !== 0) return reject();
  return {result:'duplicate',eventId:receipt.id_evento,checkoutId:local.id_checkout,transactionId:tr.id_transaccion,
    quotaId:local.id_cuota,paymentId:tr.id_pago,intent:tr.id_externo,externalPayment:tr.id_pago_externo,
    amountCents:event.amount,currency:event.currency,balance:balance.saldo_pendiente,financialRowsModified:0};
}
module.exports = { previewReview, reviewReceiptMatches };
