export type ContractType = 'COMPRA_FINANCIADA' | 'RENTA_DIRECTA' | 'PROPIEDAD_PRIVADA';
export const contractLabels: Record<ContractType | 'PENDIENTE_CONFIGURACION',string> = {
  COMPRA_FINANCIADA:'Compra financiada',RENTA_DIRECTA:'Renta directa',PROPIEDAD_PRIVADA:'Propiedad privada',PENDIENTE_CONFIGURACION:'Pendiente de configuración',
};
export type ContractPerson = {id_usuario?:number;nombre?:string;correo?:string;telefono?:string;password?:string};
export type MaintenanceTariff = {id_tarifa:number;monto:number;vigente_desde:string};
export type ContractVersion = {id_version:number;id_contrato:number;tipo:ContractType;cuota_vivienda:string;meses_financiamiento:number|null;vigente_desde:string;vigente_hasta:string|null;id_responsable:number;responsable_nombre:string;estado:string;cuotas_generadas:number;fecha_inicio?:string;primer_periodo?:string;ultimo_periodo_previsto?:string|null;activacion_estado?:'ACTIVA'|'PENDIENTE'|'BLOQUEADA';activacion_error?:string|null;precio_total?:string|null;enganche?:string|null;monto_financiado?:string|null;dia_pago?:number|null;responsable_calidad?:string};
export type HouseContracts = {id_casa:number;version_contractual:number;estado_configuracion:string;versiones:ContractVersion[];titularidades:Array<{id_usuario:number|null;titular_empresa:boolean;nombre:string|null;vigente_desde:string;vigente_hasta:string|null;id_version_pendiente?:number|null}>;habitantes:Array<{id_usuario:number;nombre:string;calidad:string;vigente_desde:string;vigente_hasta:string|null;id_version_pendiente?:number|null}>};
export type ContractPayload = {id_operacion:string;version:number;tipo:ContractType;fecha_efectiva:string;cuota_vivienda:string;meses_financiamiento:number|null;responsable:ContractPerson;responsable_habita:boolean;inquilino_privado:ContractPerson|null;habitantes_accion?:'CONSERVAR'|'ACTUALIZAR';confirmado:true;precio_total?:string;enganche?:string;mantenimiento_paga?:'PROPIETARIO'|'INQUILINO'};
export type ContractSaved = {id_casa:number;id_contrato:number;id_version:number;version:number;primer_periodo:string;total_mensual:number;dia_pago?:number};
/** Qué significa cada tipo para la persona, en palabras simples. */
export const contractDescriptions: Record<ContractType,string> = {
  COMPRA_FINANCIADA:'Residente que compra con la administración: dio un enganche y paga cuotas mensuales de la casa más el mantenimiento.',
  RENTA_DIRECTA:'Residente que renta la casa a la administración (la casa es de la residencial): paga la renta mensual más el mantenimiento.',
  PROPIEDAD_PRIVADA:'Residente propietario que ya pagó la casa: solo paga mantenimiento. Si se la alquila a alguien por su cuenta, ese inquilino puede pagar el mantenimiento.',
};
