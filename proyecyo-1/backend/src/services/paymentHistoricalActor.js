// SQL aliases are internal constants, never request input. Occupancy is not
// evidence of who performed an applied payment. No data is backfilled here.
function snapshotId(snapshot) {
  return `CAST(NULLIF(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(${snapshot},'$.id_usuario')),'null'),'') AS UNSIGNED)`;
}

function paymentEvidenceSql(payment = 'pg', quota = 'cu') {
  return `COALESCE(${payment}.id_actor,${snapshotId(`${payment}.titular_snapshot`)},
    (SELECT historical_tr.id_usuario FROM TRANSACCION_RECURRENTE historical_tr
      WHERE historical_tr.id_pago=${payment}.id_pago AND historical_tr.id_cuota=${quota}.id_cuota AND historical_tr.id_casa=${quota}.id_casa),
    (SELECT historical_sim.id_usuario FROM TRANSACCION_SIMULADA historical_sim
      WHERE historical_sim.id_pago=${payment}.id_pago AND historical_sim.id_casa=${quota}.id_casa))`;
}

function paymentActorSql(payment = 'pg', quota = 'cu') {
  return `COALESCE(${paymentEvidenceSql(payment,quota)},${quota}.id_responsable,${snapshotId(`${quota}.responsable_snapshot`)})`;
}

function paymentAccessSql(payment, quota, user) {
  const evidence = paymentEvidenceSql(payment,quota);
  return `(${evidence}=${user} OR (${evidence} IS NULL AND
    (${quota}.id_responsable=${user} OR (${quota}.id_responsable IS NULL AND ${snapshotId(`${quota}.responsable_snapshot`)}=${user}))))`;
}

function paymentNameSql(payment = 'pg', quota = 'cu', actor = 'historico') {
  return `COALESCE(JSON_UNQUOTE(JSON_EXTRACT(${payment}.titular_snapshot,'$.nombre')),
    CASE WHEN COALESCE(${quota}.id_responsable,${snapshotId(`${quota}.responsable_snapshot`)})=${paymentActorSql(payment,quota)}
      THEN JSON_UNQUOTE(JSON_EXTRACT(${quota}.responsable_snapshot,'$.nombre')) END,
    ${actor}.nombre,'Responsable no confirmado')`;
}

// A legacy quota can be attributed from applied payments only when their known
// actors agree. Conflicting evidence must not reopen access to a current resident.
function quotaActorSql(quota = 'cu') {
  const actor = paymentActorSql('historical_payment',quota);
  return `COALESCE(${quota}.id_responsable,${snapshotId(`${quota}.responsable_snapshot`)},
    (SELECT CASE WHEN COUNT(DISTINCT ${actor})=1 THEN MAX(${actor}) END
      FROM PAGO historical_payment WHERE historical_payment.id_cuota=${quota}.id_cuota))`;
}

function noKnownPaymentSql(quota) {
  return `NOT EXISTS(SELECT 1 FROM PAGO historical_payment WHERE historical_payment.id_cuota=${quota}.id_cuota
    AND ${paymentActorSql('historical_payment',quota)} IS NOT NULL)`;
}

function quotaAccessSql(quota, house, legacyUser, user) {
  return `(${quota}.id_responsable=${user} OR (${quota}.id_responsable IS NULL AND
    (${quotaActorSql(quota)}=${user} OR (${snapshotId(`${quota}.responsable_snapshot`)} IS NULL
      AND ${noKnownPaymentSql(quota)} AND ${house}.relaciones_confirmadas_en IS NULL AND ${legacyUser}=${user}))))`;
}

module.exports = { paymentActorSql, paymentAccessSql, paymentNameSql, quotaActorSql, quotaAccessSql };
