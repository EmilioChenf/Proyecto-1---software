import { apiRequest } from './api';
import type {ContractPayload,ContractSaved,HouseContracts,MaintenanceTariff} from '@/types/propertyContracts';
export const getHouseContractsRequest=(id:number)=>apiRequest<HouseContracts>(`/admin/viviendas/${id}/contratos`);
export const saveHouseContractRequest=(id:number,body:ContractPayload)=>apiRequest<ContractSaved>(`/admin/viviendas/${id}/contrato`,{method:'PUT',body});
export const getGlobalMaintenanceRequest=(periodo?:string)=>apiRequest<{vigente:MaintenanceTariff|null;historial:MaintenanceTariff[]}>(`/admin/mantenimiento-global${periodo?`?periodo=${encodeURIComponent(periodo)}`:''}`);
export const saveGlobalMaintenanceRequest=(body:{monto:string;vigente_desde:string})=>apiRequest<MaintenanceTariff>('/admin/mantenimiento-global',{method:'POST',body});
