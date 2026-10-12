import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {PropertyContractWizard,firstBillingPeriod} from './PropertyContractWizard';
import * as service from '@/services/propertyContractsService';
import {getUsersRequest} from '@/services/usersService';
const house={id_casa:42,codigo:'A-42',numero:'42',torre:'A',modelo:'Los Pinos',activo:true,estado:'DISPONIBLE',area_construccion:100,habitaciones:3,banos:2};
vi.mock('./HousePicker',()=>({HousePicker:({role,onChange}:{role:string;onChange:(h:unknown)=>void})=><button onClick={()=>onChange(house)}>Mapa 3D · {role} · Elegir A-42</button>}));
vi.mock('@/services/propertyContractsService',()=>({getHouseContractsRequest:vi.fn(),getGlobalMaintenanceRequest:vi.fn(),saveHouseContractRequest:vi.fn()}));
vi.mock('@/services/usersService',()=>({getUsersRequest:vi.fn()}));
const saved=vi.fn(),closed=vi.fn();
beforeEach(()=>{
  vi.resetAllMocks();vi.mocked(getUsersRequest).mockResolvedValue([{id_usuario:1,nombre:'Propietaria',correo:'owner@test.local',rol:'residente'},{id_usuario:2,nombre:'Arrendatario',correo:'tenant@test.local',rol:'inquilino'}] as never);
  vi.mocked(service.getHouseContractsRequest).mockResolvedValue({id_casa:42,version_contractual:0,estado_configuracion:'PENDIENTE_CONFIGURACION',versiones:[],titularidades:[],habitantes:[]});
  vi.mocked(service.getGlobalMaintenanceRequest).mockResolvedValue({vigente:{id_tarifa:1,monto:500,vigente_desde:'2026-01-01'},historial:[]});
  vi.mocked(service.saveHouseContractRequest).mockResolvedValue({id_casa:42,id_contrato:1,id_version:1,version:1,primer_periodo:'2030-01-01',total_mensual:500});
});
afterEach(cleanup);
function open(){return render(<PropertyContractWizard open onClose={closed} onSaved={saved}/>);}
async function contract(){open();fireEvent.click(screen.getByText(/Mapa 3D/));await waitFor(()=>expect(screen.queryByText('Cargando configuración contractual…')).not.toBeInTheDocument());fireEvent.click(screen.getByText('Continuar'));await screen.findByLabelText('Tipo contractual');}
async function people(type='PROPIEDAD_PRIVADA'){
  await contract();fireEvent.change(screen.getByLabelText('Tipo contractual'),{target:{value:type}});
  if(type!=='PROPIEDAD_PRIVADA')fireEvent.change(screen.getByLabelText('Cuota mensual'),{target:{value:'4000'}});
  if(type==='COMPRA_FINANCIADA')fireEvent.change(screen.getByLabelText('Meses de financiamiento'),{target:{value:'36'}});
  await screen.findByText('Q500.00');fireEvent.click(screen.getByText('Continuar'));await screen.findByText(/habita la vivienda/);
}
async function confirm(type='PROPIEDAD_PRIVADA'){await people(type);const label=type==='RENTA_DIRECTA'?'Arrendatario directo':type==='COMPRA_FINANCIADA'?'Comprador':'Propietario';fireEvent.change(screen.getByLabelText(`${label}: usuario`),{target:{value:type==='RENTA_DIRECTA'?'2':'1'}});fireEvent.click(screen.getByText('Continuar'));await screen.findByText('Guardar configuración');}
describe('Asistente contractual',()=>{
  it('F01 mantiene exactamente cuatro pasos y el selector 3D',()=>{open();expect(within(screen.getByLabelText('Pasos del asistente')).getAllByRole('listitem')).toHaveLength(4);expect(screen.getByText(/Mapa 3D · contrato/)).toBeInTheDocument();});
  it('F02 exige seleccionar la vivienda antes de continuar',()=>{open();fireEvent.click(screen.getByText('Continuar'));expect(screen.getByRole('alert')).toHaveTextContent('Selecciona una vivienda');});
  it('F03 compra muestra cuota y plazo',async()=>{await contract();fireEvent.change(screen.getByLabelText('Tipo contractual'),{target:{value:'COMPRA_FINANCIADA'}});expect(screen.getByLabelText('Cuota mensual')).toBeInTheDocument();expect(screen.getByLabelText('Meses de financiamiento')).toBeInTheDocument();});
  it('F04 renta muestra renta y omite plazo',async()=>{await contract();fireEvent.change(screen.getByLabelText('Tipo contractual'),{target:{value:'RENTA_DIRECTA'}});expect(screen.getByLabelText('Cuota mensual')).toBeInTheDocument();expect(screen.queryByLabelText('Meses de financiamiento')).not.toBeInTheDocument();});
  it('F05 privada sólo muestra mantenimiento global',async()=>{await contract();expect(screen.queryByLabelText('Cuota mensual')).not.toBeInTheDocument();expect(screen.getByText('Q500.00')).toBeInTheDocument();expect(screen.queryByRole('textbox',{name:/mantenimiento/i})).not.toBeInTheDocument();});
  it('F06 total suma vivienda y tarifa sin monto hardcodeado',async()=>{await contract();fireEvent.change(screen.getByLabelText('Tipo contractual'),{target:{value:'RENTA_DIRECTA'}});fireEvent.change(screen.getByLabelText('Cuota mensual'),{target:{value:'4000'}});expect(screen.getByText(/Total mensual/)).toHaveTextContent('Q4,500.00');});
  it('F07 rechaza compra sin plazo',async()=>{await contract();fireEvent.change(screen.getByLabelText('Tipo contractual'),{target:{value:'COMPRA_FINANCIADA'}});fireEvent.change(screen.getByLabelText('Cuota mensual'),{target:{value:'4000'}});fireEvent.click(screen.getByText('Continuar'));expect(screen.getByRole('alert')).toHaveTextContent('plazo');});
  it('F08 sin tarifa bloquea guardar la configuración',async()=>{vi.mocked(service.getGlobalMaintenanceRequest).mockResolvedValue({vigente:null,historial:[]});await contract();fireEvent.click(screen.getByText('Continuar'));expect(screen.getByRole('alert')).toHaveTextContent('mantenimiento global');});
  it('F09 permite crear personas dentro del mismo guardado',async()=>{await people();fireEvent.change(screen.getByLabelText('Propietario: origen'),{target:{value:'new'}});expect(screen.getByLabelText('Propietario: nombre')).toBeInTheDocument();expect(service.saveHouseContractRequest).not.toHaveBeenCalled();});
  it('F10 inquilino privado muestra Q0',async()=>{await people();fireEvent.click(screen.getByLabelText('Agregar inquilino privado'));expect(screen.getByText(/Q0 de obligaciones/)).toBeInTheDocument();expect(screen.getByLabelText('Inquilino privado: usuario')).toBeInTheDocument();});
  it('F11 exige confirmación explícita antes de guardar',async()=>{await confirm();expect(screen.getByText('Guardar configuración')).toBeDisabled();fireEvent.click(screen.getByLabelText(/Confirmo vivienda/));expect(screen.getByText('Guardar configuración')).toBeEnabled();});
  it('F12 guarda vivienda, responsable y vigencia en una petición',async()=>{await confirm();fireEvent.click(screen.getByLabelText(/Confirmo vivienda/));fireEvent.click(screen.getByText('Guardar configuración'));await waitFor(()=>expect(saved).toHaveBeenCalledOnce());expect(service.saveHouseContractRequest).toHaveBeenCalledWith(42,expect.objectContaining({tipo:'PROPIEDAD_PRIVADA',responsable:{id_usuario:1},version:0,confirmado:true}));});
  it('F13 deuda en venta permanece visible y conserva la sesión',async()=>{vi.mocked(service.saveHouseContractRequest).mockRejectedValue(new Error('Venta bloqueada: Q500 pendientes.'));await confirm();fireEvent.click(screen.getByLabelText(/Confirmo vivienda/));fireEvent.click(screen.getByText('Guardar configuración'));expect(await screen.findByRole('alert')).toHaveTextContent('Q500 pendientes');expect(closed).not.toHaveBeenCalled();});
  it('F14 modal tiene límites para pantalla móvil y resumen completo',async()=>{await confirm();expect(screen.getByRole('dialog').className).toContain('max-h-[92dvh]');expect(screen.getByText('Responsable financiero')).toBeInTheDocument();expect(screen.getByText('Habitantes')).toBeInTheDocument();expect(screen.getByText('Desocupada')).toBeInTheDocument();});
  it('F15 cambio a mitad de mes aplica al siguiente sin prorratear',()=>{expect(firstBillingPeriod('2030-11-17')).toBe('2030-12-01');expect(firstBillingPeriod('2030-12-17')).toBe('2031-01-01');expect(firstBillingPeriod('2030-11-01')).toBe('2030-11-01');});
});
