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

it('H5 conserva modo y datos de persona nueva al volver desde confirmación',async()=>{
  await people();fireEvent.change(screen.getByLabelText('Propietario: origen'),{target:{value:'new'}});
  for(const [key,value] of Object.entries({nombre:'Nueva persona',correo:'nueva@test.local',telefono:'55551234',password:'test-pass'}))fireEvent.change(screen.getByLabelText(`Propietario: ${key}`),{target:{value}});
  fireEvent.click(screen.getByText('Continuar'));await screen.findByText('Guardar configuración');
  fireEvent.click(screen.getByText('Anterior'));
  expect(screen.getByLabelText('Propietario: origen')).toHaveValue('new');
  expect(screen.getByLabelText('Propietario: nombre')).toHaveValue('Nueva persona');
  expect(screen.getByLabelText('Propietario: correo')).toHaveValue('nueva@test.local');
  expect(screen.getByLabelText('Propietario: telefono')).toHaveValue('55551234');
  expect(screen.getByLabelText('Propietario: password')).toHaveValue('test-pass');
  expect(screen.queryByLabelText('Propietario: usuario')).not.toBeInTheDocument();
  fireEvent.click(screen.getByText('Continuar'));await submit();
  expect(service.saveHouseContractRequest).toHaveBeenCalledWith(42,expect.objectContaining({responsable:{nombre:'Nueva persona',correo:'nueva@test.local',telefono:'55551234',password:'test-pass'}}));
});

function futureDates(){const d=new Date();d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()+1);const first=d.toISOString().slice(0,10);d.setUTCMonth(d.getUTCMonth()+1);return [first,d.toISOString().slice(0,10)];}
function futureOccupant(){
  const [first,second]=futureDates();
  vi.mocked(service.getHouseContractsRequest).mockResolvedValue({id_casa:42,version_contractual:1,estado_configuracion:'CONFIGURADA',
    versiones:[{id_version:1,id_contrato:1,tipo:'PROPIEDAD_PRIVADA',cuota_vivienda:'0',meses_financiamiento:null,vigente_desde:first,vigente_hasta:null,id_responsable:1,responsable_nombre:'Propietaria',estado:'VIGENTE',cuotas_generadas:0}],
    titularidades:[{id_usuario:1,titular_empresa:false,nombre:'Propietaria',vigente_desde:first,vigente_hasta:null}],
    habitantes:[{id_usuario:2,nombre:'Arrendatario',calidad:'INQUILINO_PRIVADO',vigente_desde:first,vigente_hasta:null}]});
  return second;
}
it('H6 fecha efectiva futura conserva al inquilino en una edición financiera',async()=>{
  const second=futureOccupant();await contract();
  fireEvent.change(screen.getByLabelText('Fecha efectiva'),{target:{value:second}});
  await screen.findByText('Q500.00');
  fireEvent.click(screen.getByText('Continuar'));
  expect(screen.getByLabelText('Agregar inquilino privado')).toBeChecked();
  expect(screen.getByLabelText('Inquilino privado: usuario')).toHaveValue('2');
  fireEvent.click(screen.getByText('Continuar'));fireEvent.click(screen.getByLabelText(/Confirmo vivienda/));fireEvent.click(screen.getByText('Guardar configuración'));
  await waitFor(()=>expect(saved).toHaveBeenCalledOnce());
  expect(service.saveHouseContractRequest).toHaveBeenCalledWith(42,expect.objectContaining({habitantes_accion:'CONSERVAR',inquilino_privado:{id_usuario:2}}));
});
it('H6 solamente la remoción explícita solicita actualizar habitantes',async()=>{
  const second=futureOccupant();await contract();fireEvent.change(screen.getByLabelText('Fecha efectiva'),{target:{value:second}});
  await screen.findByText('Q500.00');
  fireEvent.click(screen.getByText('Continuar'));fireEvent.click(screen.getByLabelText('Agregar inquilino privado'));
  fireEvent.click(screen.getByText('Continuar'));fireEvent.click(screen.getByLabelText(/Confirmo vivienda/));fireEvent.click(screen.getByText('Guardar configuración'));
  await waitFor(()=>expect(saved).toHaveBeenCalledOnce());
  expect(service.saveHouseContractRequest).toHaveBeenCalledWith(42,expect.objectContaining({habitantes_accion:'ACTUALIZAR',inquilino_privado:null}));
});
it('H9 paso vivienda muestra contrato vigente, titular, responsable y ocupación',async()=>{
  futureOccupant();
  const configured=await service.getHouseContractsRequest(42);
  configured.versiones[0].vigente_desde='2020-01-01';configured.titularidades[0].vigente_desde='2020-01-01';
  configured.habitantes[0].vigente_desde='2020-01-01';
  open();fireEvent.click(screen.getByText(/Mapa 3D/));
  expect(await screen.findByText('Contrato vigente')).toBeInTheDocument();
  expect(screen.getByText('Titular actual')).toBeInTheDocument();
  expect(screen.getByText('Responsable financiero actual')).toBeInTheDocument();
  expect(screen.getByText('Ocupación')).toBeInTheDocument();
  expect(screen.getByText('Ocupación').parentElement).toHaveTextContent('Ocupada · Arrendatario');
  expect(screen.getByText('Estado').parentElement).toHaveTextContent('Activa');
  expect(screen.getByText('Contrato vigente').parentElement).toHaveTextContent('Propiedad privada');
  expect(screen.getByText('Titular actual').parentElement).toHaveTextContent('Propietaria');
  expect(screen.getByText('Responsable financiero actual').parentElement).toHaveTextContent('Propietaria');
  expect(screen.getByText(/2020-01-01/)).toBeInTheDocument();
});
it('H9 vivienda sin contrato muestra pendiente de configuración en el primer paso',async()=>{
  open();fireEvent.click(screen.getByText(/Mapa 3D/));
  expect(await screen.findByText('Pendiente de configuración')).toBeInTheDocument();
});
for(const type of ['RENTA_DIRECTA','COMPRA_FINANCIADA'])it(`R2-A inquilino privado incompleto no bloquea ${type} ni llega al payload`,async()=>{
  await people();fireEvent.change(screen.getByLabelText('Propietario: usuario'),{target:{value:'1'}});
  fireEvent.click(screen.getByLabelText('Agregar inquilino privado'));fireEvent.change(screen.getByLabelText('Inquilino privado: origen'),{target:{value:'new'}});
  fireEvent.change(screen.getByLabelText('Inquilino privado: nombre'),{target:{value:'Borrador incompleto'}});
  fireEvent.click(screen.getByText('Anterior'));fireEvent.change(screen.getByLabelText('Tipo contractual'),{target:{value:type}});
  fireEvent.change(screen.getByLabelText('Cuota mensual'),{target:{value:'200'}});
  if(type==='COMPRA_FINANCIADA')fireEvent.change(screen.getByLabelText('Meses de financiamiento'),{target:{value:'3'}});
  fireEvent.click(screen.getByText('Continuar'));const label=type==='RENTA_DIRECTA'?'Arrendatario directo':'Comprador';
  fireEvent.change(screen.getByLabelText(`${label}: usuario`),{target:{value:type==='RENTA_DIRECTA'?'2':'1'}});
  expect(screen.queryByLabelText('Inquilino privado: nombre')).not.toBeInTheDocument();
  fireEvent.click(screen.getByText('Continuar'));await screen.findByText('Guardar configuración');await submit();
  expect(service.saveHouseContractRequest).toHaveBeenCalledWith(42,expect.objectContaining({tipo:type,inquilino_privado:null,responsable:{id_usuario:type==='RENTA_DIRECTA'?2:1}}));
});
it('R2-B renta a privada reinicia personas y borrador de ocupación de la modalidad anterior',async()=>{
  await people('RENTA_DIRECTA');fireEvent.change(screen.getByLabelText('Arrendatario directo: usuario'),{target:{value:'2'}});
  fireEvent.click(screen.getByLabelText('Arrendatario directo habita la vivienda'));
  fireEvent.click(screen.getByText('Anterior'));fireEvent.change(screen.getByLabelText('Tipo contractual'),{target:{value:'PROPIEDAD_PRIVADA'}});
  fireEvent.click(screen.getByText('Continuar'));expect(screen.getByLabelText('Propietario: usuario')).toHaveValue('');
  expect(screen.getByLabelText('Propietario habita la vivienda')).not.toBeChecked();expect(screen.getByLabelText('Agregar inquilino privado')).not.toBeChecked();
  fireEvent.change(screen.getByLabelText('Propietario: usuario'),{target:{value:'1'}});fireEvent.click(screen.getByText('Continuar'));await submit();
  expect(service.saveHouseContractRequest).toHaveBeenCalledWith(42,expect.objectContaining({tipo:'PROPIEDAD_PRIVADA',responsable:{id_usuario:1},responsable_habita:false,inquilino_privado:null,cuota_vivienda:'0',meses_financiamiento:null}));
});
it('R2-C compra a renta a privada no mezcla comprador, arrendatario ni borrador privado descartado',async()=>{
  await people('COMPRA_FINANCIADA');fireEvent.change(screen.getByLabelText('Comprador: origen'),{target:{value:'new'}});
  fireEvent.change(screen.getByLabelText('Comprador: nombre'),{target:{value:'Comprador borrador'}});
  fireEvent.click(screen.getByText('Anterior'));fireEvent.change(screen.getByLabelText('Tipo contractual'),{target:{value:'RENTA_DIRECTA'}});
  fireEvent.change(screen.getByLabelText('Cuota mensual'),{target:{value:'300'}});fireEvent.click(screen.getByText('Continuar'));
  expect(screen.getByLabelText('Arrendatario directo: origen')).toHaveValue('existing');expect(screen.getByLabelText('Arrendatario directo: usuario')).toHaveValue('');
  fireEvent.change(screen.getByLabelText('Arrendatario directo: usuario'),{target:{value:'2'}});
  fireEvent.click(screen.getByText('Anterior'));fireEvent.change(screen.getByLabelText('Tipo contractual'),{target:{value:'PROPIEDAD_PRIVADA'}});
  fireEvent.click(screen.getByText('Continuar'));expect(screen.getByLabelText('Propietario: usuario')).toHaveValue('');
  fireEvent.change(screen.getByLabelText('Propietario: usuario'),{target:{value:'1'}});fireEvent.click(screen.getByText('Continuar'));await submit();
  expect(service.saveHouseContractRequest).toHaveBeenCalledWith(42,expect.objectContaining({responsable:{id_usuario:1},inquilino_privado:null,meses_financiamiento:null}));
});
it('R2-D después de cambiar modalidad atrás y adelante conserva solamente la persona aplicable',async()=>{
  await people();fireEvent.click(screen.getByLabelText('Agregar inquilino privado'));fireEvent.change(screen.getByLabelText('Inquilino privado: origen'),{target:{value:'new'}});
  fireEvent.change(screen.getByLabelText('Inquilino privado: nombre'),{target:{value:'Descartado'}});
  fireEvent.click(screen.getByText('Anterior'));fireEvent.change(screen.getByLabelText('Tipo contractual'),{target:{value:'RENTA_DIRECTA'}});
  fireEvent.change(screen.getByLabelText('Cuota mensual'),{target:{value:'400'}});fireEvent.click(screen.getByText('Continuar'));
  fireEvent.change(screen.getByLabelText('Arrendatario directo: usuario'),{target:{value:'2'}});
  fireEvent.click(screen.getByText('Anterior'));fireEvent.click(screen.getByText('Continuar'));expect(screen.getByLabelText('Arrendatario directo: usuario')).toHaveValue('2');
  fireEvent.click(screen.getByText('Continuar'));await screen.findByText('Guardar configuración');await submit();
  expect(service.saveHouseContractRequest).toHaveBeenCalledWith(42,expect.objectContaining({tipo:'RENTA_DIRECTA',responsable:{id_usuario:2},inquilino_privado:null,cuota_vivienda:'400'}));
});
it('R2 resumen y payload omiten al inquilino privado completo de otra modalidad',async()=>{
  await people();fireEvent.change(screen.getByLabelText('Propietario: usuario'),{target:{value:'1'}});
  fireEvent.click(screen.getByLabelText('Agregar inquilino privado'));fireEvent.change(screen.getByLabelText('Inquilino privado: usuario'),{target:{value:'2'}});
  fireEvent.click(screen.getByText('Anterior'));fireEvent.change(screen.getByLabelText('Tipo contractual'),{target:{value:'RENTA_DIRECTA'}});
  fireEvent.change(screen.getByLabelText('Cuota mensual'),{target:{value:'200'}});fireEvent.click(screen.getByText('Continuar'));
  fireEvent.change(screen.getByLabelText('Arrendatario directo: usuario'),{target:{value:'2'}});fireEvent.click(screen.getByText('Continuar'));
  expect(screen.getByText('Inquilino privado').parentElement).toHaveTextContent('No aplica');await submit();
  expect(service.saveHouseContractRequest).toHaveBeenCalledWith(42,expect.objectContaining({inquilino_privado:null}));
});
it('R2 volver a privada descarta el borrador privado anterior de forma determinista',async()=>{
  await people();fireEvent.click(screen.getByLabelText('Agregar inquilino privado'));fireEvent.change(screen.getByLabelText('Inquilino privado: origen'),{target:{value:'new'}});
  fireEvent.change(screen.getByLabelText('Inquilino privado: nombre'),{target:{value:'Borrador descartado'}});
  fireEvent.click(screen.getByText('Anterior'));fireEvent.change(screen.getByLabelText('Tipo contractual'),{target:{value:'RENTA_DIRECTA'}});
  fireEvent.change(screen.getByLabelText('Tipo contractual'),{target:{value:'PROPIEDAD_PRIVADA'}});fireEvent.click(screen.getByText('Continuar'));
  expect(screen.getByLabelText('Agregar inquilino privado')).not.toBeChecked();expect(screen.queryByLabelText('Inquilino privado: nombre')).not.toBeInTheDocument();
});
async function submit(){fireEvent.click(screen.getByLabelText(/Confirmo vivienda/));fireEvent.click(screen.getByText('Guardar configuración'));await waitFor(()=>expect(saved).toHaveBeenCalledOnce());}
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
