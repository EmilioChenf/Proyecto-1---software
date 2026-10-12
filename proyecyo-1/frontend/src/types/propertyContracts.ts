export type ContractType = 'COMPRA_FINANCIADA' | 'RENTA_DIRECTA' | 'PROPIEDAD_PRIVADA';
export const contractLabels: Record<ContractType | 'PENDIENTE_CONFIGURACION',string> = {
  COMPRA_FINANCIADA:'Compra financiada',RENTA_DIRECTA:'Renta directa',PROPIEDAD_PRIVADA:'Propiedad privada',PENDIENTE_CONFIGURACION:'Pendiente de configuración',
};
export type ContractPerson = {id_usuario?:number;nombre?:string;correo?:string;telefono?:string;password?:string};
export type MaintenanceTariff = {id_tarifa:number;monto:number;vigente_desde:string};
export type ContractVersion = {id_version:number;id_contrato:number;tipo:ContractType;cuota_vivienda:string;meses_financiamiento:number|null;vigente_desde:string;vigente_hasta:string|null;id_responsable:number;responsable_nombre:string;estado:string;cuotas_generadas:number;fecha_inicio?:string;primer_periodo?:string;ultimo_periodo_previsto?:string|null;activacion_estado?:'ACTIVA'|'PENDIENTE'|'BLOQUEADA';activacion_error?:string|null};
export type HouseContracts = {id_casa:number;version_contractual:number;estado_configuracion:string;versiones:ContractVersion[];titularidades:Array<{id_usuario:number|null;titular_empresa:boolean;nombre:string|null;vigente_desde:string;vigente_hasta:string|null;id_version_pendiente?:number|null}>;habitantes:Array<{id_usuario:number;nombre:string;calidad:string;vigente_desde:string;vigente_hasta:string|null;id_version_pendiente?:number|null}>};
export type ContractPayload = {id_operacion:string;version:number;tipo:ContractType;fecha_efectiva:string;cuota_vivienda:string;meses_financiamiento:number|null;responsable:ContractPerson;responsable_habita:boolean;inquilino_privado:ContractPerson|null;habitantes_accion?:'CONSERVAR'|'ACTUALIZAR';confirmado:true};
export type ContractSaved = {id_casa:number;id_contrato:number;id_version:number;version:number;primer_periodo:string;total_mensual:number};
