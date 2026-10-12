// Shared sanctions queries use CUOTA alias cu and historical USUARIO alias u.
// A house's current resident is never evidence of a sanction's historical actor.
const RESPONSIBLE_NAME = "COALESCE(JSON_UNQUOTE(JSON_EXTRACT(cu.responsable_snapshot,'$.nombre')),u.nombre,'Responsable no confirmado')";
const RESPONSIBLE_JOIN = 'LEFT JOIN USUARIO u ON u.id_usuario=cu.id_responsable';

module.exports = { RESPONSIBLE_NAME, RESPONSIBLE_JOIN };
