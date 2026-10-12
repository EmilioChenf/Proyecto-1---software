import {useEffect,useState} from 'react';
import {Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle} from '@/components/ui/dialog';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {HousePicker} from './HousePicker';
import {getUsersRequest} from '@/services/usersService';
import {getHouseContractsRequest,getGlobalMaintenanceRequest,saveHouseContractRequest} from '@/services/propertyContractsService';
import {contractLabels,type ContractType,type ContractPerson,type HouseContracts,type MaintenanceTariff} from '@/types/propertyContracts';
import type {HouseRecord} from '@/types/houses';
import type {UserRecord} from '@/types/users';

const currency=(amount:number)=>`Q${amount.toLocaleString('es-GT',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
export function firstBillingPeriod(day:string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return '';
  if(day.endsWith('-01'))return day;
  const d=new Date(`${day.slice(0,7)}-01T00:00:00Z`);d.setUTCMonth(d.getUTCMonth()+1);return d.toISOString().slice(0,10);
}
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Guatemala',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
type PersonMode='existing'|'new';
function PersonFields({label,role,users,value,onChange,mode,onModeChange}:{label:string;role:string;users:UserRecord[];value:ContractPerson;onChange:(person:ContractPerson)=>void;mode:PersonMode;onModeChange:(mode:PersonMode)=>void}) {
  return <fieldset className="min-w-0 space-y-3 rounded-xl border p-4"><legend className="px-1 font-semibold">{label}</legend>
    <label className="block text-sm">Persona<select aria-label={`${label}: origen`} className="mt-1 block w-full rounded-md border bg-background p-2" value={mode} onChange={e=>{onModeChange(e.target.value as PersonMode);onChange({});}}>
      <option value="existing">Seleccionar existente</option><option value="new">Crear persona</option></select></label>
    {mode==='existing'?<label className="block text-sm">{label}<select aria-label={`${label}: usuario`} className="mt-1 block w-full rounded-md border bg-background p-2" value={value.id_usuario||''} onChange={e=>onChange({id_usuario:Number(e.target.value)||undefined})}>
      <option value="">Seleccionar persona</option>{users.filter(u=>u.rol===role).map(u=><option key={u.id_usuario} value={u.id_usuario}>{u.nombre} · {u.correo}</option>)}</select></label>:
      <div className="grid gap-3 sm:grid-cols-2">{(['nombre','correo','telefono','password'] as const).map(key=><label key={key} className="text-sm">{{nombre:'Nombre',correo:'Correo',telefono:'Teléfono',password:'Contraseña'}[key]}
        <Input aria-label={`${label}: ${key}`} type={key==='password'?'password':key==='correo'?'email':'text'} autoComplete={key==='password'?'new-password':'off'} value={value[key]||''} onChange={e=>onChange({...value,[key]:e.target.value})}/></label>)}</div>}
  </fieldset>;
}
const personValid=(person:ContractPerson)=>Boolean(person.id_usuario||(person.nombre?.trim()&&/^\S+@\S+\.\S+$/.test(person.correo||'')&&(person.password?.length||0)>=4));
export function PropertyContractWizard({open,onClose,onSaved,initialHouse=null}:{open:boolean;onClose:()=>void;onSaved:()=>void;initialHouse?:HouseRecord|null}) {
  const [step,setStep]=useState(0),[house,setHouse]=useState<HouseRecord|null>(initialHouse),[contracts,setContracts]=useState<HouseContracts|null>(null);
  const [type,setType]=useState<ContractType>('PROPIEDAD_PRIVADA'),[start,setStart]=useState(today),[amount,setAmount]=useState(''),[term,setTerm]=useState('');
  const [person,setPerson]=useState<ContractPerson>({}),[tenant,setTenant]=useState<ContractPerson>({}),[privateTenant,setPrivateTenant]=useState(false),[lives,setLives]=useState(false);
  const [personMode,setPersonMode]=useState<PersonMode>('existing'),[tenantMode,setTenantMode]=useState<PersonMode>('existing'),[occupantsChanged,setOccupantsChanged]=useState(false);
  const [users,setUsers]=useState<UserRecord[]>([]),[tariff,setTariff]=useState<MaintenanceTariff|null>(null),[confirmed,setConfirmed]=useState(false);
  const [busy,setBusy]=useState(false),[loading,setLoading]=useState(false),[failure,setFailure]=useState(''),[operation,setOperation]=useState(()=>crypto.randomUUID());
  const period=firstBillingPeriod(start),total=Number(type==='PROPIEDAD_PRIVADA'?0:amount)+(Number(tariff?.monto)||0);
  useEffect(()=>{if(!open)return;let active=true;getUsersRequest().then(v=>{if(active)setUsers(v);}).catch(e=>{if(active)setFailure(e.message);});return()=>{active=false;};},[open]);
  useEffect(()=>{
    if(!open||!house)return;let active=true;setContracts(null);setLoading(true);setFailure('');
    getHouseContractsRequest(house.id_casa).then(v=>{
      if(!active)return;
      setContracts(v);setConfirmed(false);setOperation(crypto.randomUUID());
      const latest=v.versiones[0];
      setType(latest?.tipo||'PROPIEDAD_PRIVADA');setAmount(latest?.cuota_vivienda||'');
      setTerm(String(latest?.meses_financiamiento||''));setPerson(latest?{id_usuario:latest.id_responsable}:{});
      setPersonMode('existing');setTenantMode('existing');setOccupantsChanged(false);
    })
      .catch(e=>{if(active)setFailure(e.message);}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};
  },[open,house?.id_casa]);
  useEffect(()=>{
    if(!contracts||occupantsChanged)return;
    const inhabitants=contracts.habitantes.filter(h=>!h.id_version_pendiente&&h.vigente_desde<=start&&(!h.vigente_hasta||h.vigente_hasta>start));
    setLives(inhabitants.some(h=>h.id_usuario===person.id_usuario));
    const currentTenant=inhabitants.find(h=>h.calidad==='INQUILINO_PRIVADO');
    setPrivateTenant(Boolean(currentTenant));setTenant(currentTenant?{id_usuario:currentTenant.id_usuario}:{});setTenantMode('existing');
  },[contracts,start,person.id_usuario,occupantsChanged]);
  useEffect(()=>{if(!open||!period)return;let active=true;setTariff(null);getGlobalMaintenanceRequest(period).then(v=>{if(active)setTariff(v.vigente);}).catch(e=>{if(active)setFailure(e.message);});return()=>{active=false;};},[open,period]);
  function changeType(value:ContractType){setType(value);setPerson({});setPersonMode('existing');setConfirmed(false);setOperation(crypto.randomUUID());}
  function next(){
    setFailure('');
    if(step===0&&(!house||!contracts||loading)){setFailure('Selecciona una vivienda y espera a que cargue su configuración.');return;}
    if(step===1){
      if(!start||start<today()){setFailure('Selecciona una fecha efectiva desde hoy.');return;}
      if(!tariff){setFailure('Configura primero el mantenimiento global para el período seleccionado.');return;}
      if(type!=='PROPIEDAD_PRIVADA'&&(!/^\d+(\.\d{1,2})?$/.test(amount)||Number(amount)<=0)){setFailure('La cuota de vivienda o renta debe ser mayor que cero y tener hasta dos decimales.');return;}
      if(type==='COMPRA_FINANCIADA'&&(!Number.isInteger(Number(term))||Number(term)<1||Number(term)>1200)){setFailure('Indica un plazo de entre 1 y 1200 meses.');return;}
    }
    if(step===2&&(!personValid(person)||(privateTenant&&!personValid(tenant)))){setFailure('Completa los datos de las personas seleccionadas.');return;}
    setStep(step+1);setConfirmed(false);
  }
  const personName=(p:ContractPerson)=>users.find(u=>u.id_usuario===p.id_usuario)?.nombre||p.nombre||'Sin seleccionar';
  async function save(){
    if(!house||!contracts||!confirmed||busy)return;setBusy(true);setFailure('');
    try{await saveHouseContractRequest(house.id_casa,{id_operacion:operation,version:contracts.version_contractual,tipo:type,fecha_efectiva:start,cuota_vivienda:type==='PROPIEDAD_PRIVADA'?'0':amount,meses_financiamiento:type==='COMPRA_FINANCIADA'?Number(term):null,responsable:person,responsable_habita:lives,inquilino_privado:type==='PROPIEDAD_PRIVADA'&&privateTenant?tenant:null,habitantes_accion:!contracts.versiones.length||occupantsChanged?'ACTUALIZAR':'CONSERVAR',confirmado:true});onSaved();onClose();}
    catch(e){setFailure(e instanceof Error?e.message:'No fue posible guardar el contrato.');}finally{setBusy(false);}
  }
  const personLabel=type==='COMPRA_FINANCIADA'?'Comprador':type==='RENTA_DIRECTA'?'Arrendatario directo':'Propietario';
  const currentDay=today();
  const currentVersion=contracts?.versiones.find(v=>(!v.activacion_estado||v.activacion_estado==='ACTIVA')&&v.vigente_desde<=currentDay&&(!v.vigente_hasta||v.vigente_hasta>currentDay));
  const currentTitle=contracts?.titularidades.find(t=>!t.id_version_pendiente&&t.vigente_desde<=currentDay&&(!t.vigente_hasta||t.vigente_hasta>currentDay));
  const currentInhabitants=contracts?.habitantes.filter(h=>!h.id_version_pendiente&&h.vigente_desde<=currentDay&&(!h.vigente_hasta||h.vigente_hasta>currentDay))||[];
  const preservedInhabitants=contracts?.habitantes.filter(h=>!h.id_version_pendiente&&h.vigente_desde<=start&&(!h.vigente_hasta||h.vigente_hasta>start))||[];
  return <Dialog open={open} onOpenChange={v=>{if(!v&&!busy)onClose();}}><DialogContent className="max-h-[92dvh] w-[calc(100%-1rem)] max-w-5xl overflow-y-auto p-4 sm:p-6" onInteractOutside={e=>{if(busy)e.preventDefault();}}>
    <DialogHeader><DialogTitle>Vivienda, contrato y personas</DialogTitle><DialogDescription>La vivienda conserva su historial. Los cambios financieros se aplican por mes completo.</DialogDescription></DialogHeader>
    <ol aria-label="Pasos del asistente" className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">{['Vivienda','Contrato','Personas','Confirmación'].map((label,i)=><li key={label} aria-current={i===step?'step':undefined} className={`rounded-lg border p-2 ${i===step?'border-primary bg-primary/10 font-semibold':''}`}>{i+1}. {label}</li>)}</ol>
    {failure&&<p role="alert" className="rounded-lg bg-destructive/10 p-3 text-destructive">{failure}</p>}
    {step===0&&<div className="space-y-3"><HousePicker role="contrato" userId={null} value={house} onChange={setHouse}/>{house&&<p className="text-sm">{house.codigo} · {house.modelo||'Modelo sin especificar'} · {house.area_construccion??'—'} m² · {house.habitaciones??'—'} habitaciones · {house.banos??'—'} baños</p>}{loading&&<p role="status">Cargando configuración contractual…</p>}
      {house&&contracts&&<dl className="grid gap-3 rounded-xl border p-3 text-sm sm:grid-cols-2">{[
        ['Estado',house.activo?'Activa':'Inactiva'],['Ocupación',currentInhabitants.length?`Ocupada · ${currentInhabitants.map(h=>h.nombre).join(', ')}`:house.estado==='OCUPADA'?'Ocupada · Habitantes por confirmar':'Disponible · Sin habitantes confirmados'],
        ['Contrato vigente',currentVersion?contractLabels[currentVersion.tipo]:contracts.versiones.length?'Sin contrato vigente hoy':'Pendiente de configuración'],
        ['Titular actual',currentTitle?(currentTitle.titular_empresa?'La residencial':currentTitle.nombre):'Sin titular confirmado'],
        ['Responsable financiero actual',currentVersion?.responsable_nombre||'Sin responsable vigente hoy'],
        ['Vigencia',currentVersion?`${currentVersion.vigente_desde} → ${currentVersion.vigente_hasta||'Sin fecha de cierre'}`:'Por confirmar'],
      ].map(([label,value])=><div key={label}><dt className="text-muted-foreground">{label}</dt><dd className="break-words font-medium">{value}</dd></div>)}
      {contracts.versiones[0]&&!currentVersion&&<div><dt className="text-muted-foreground">Configuración programada</dt><dd>{contractLabels[contracts.versiones[0].tipo]} · {contracts.versiones[0].vigente_desde} · {contracts.versiones[0].responsable_nombre}</dd></div>}
      {contracts.versiones[0]?.activacion_estado==='BLOQUEADA'&&<p role="alert">Transferencia bloqueada por deuda o revisión financiera. El titular anterior se conserva.</p>}</dl>}
    </div>}
    {step===1&&<div className="space-y-4"><div className="grid gap-4 sm:grid-cols-2">
      <label>Tipo contractual<select aria-label="Tipo contractual" className="mt-1 block w-full rounded-md border bg-background p-2" value={type} onChange={e=>changeType(e.target.value as ContractType)}>{Object.entries(contractLabels).filter(([key])=>key!=='PENDIENTE_CONFIGURACION').map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
      <label>Fecha efectiva<Input aria-label="Fecha efectiva" type="date" min={today()} value={start} onChange={e=>setStart(e.target.value)}/></label>
      {type!=='PROPIEDAD_PRIVADA'&&<label>{type==='COMPRA_FINANCIADA'?'Cuota mensual de vivienda':'Renta mensual'}<Input aria-label="Cuota mensual" inputMode="decimal" value={amount} onChange={e=>setAmount(e.target.value)}/></label>}
      {type==='COMPRA_FINANCIADA'&&<label>Meses de financiamiento<Input aria-label="Meses de financiamiento" type="number" min="1" max="1200" value={term} onChange={e=>setTerm(e.target.value)}/></label>}</div>
      <p>Primer período de esta configuración: <strong>{period||'Selecciona una fecha'}</strong>. Sin prorrateo; las cuotas emitidas se conservan.</p>
      <div className="rounded-xl border bg-muted/30 p-4"><p>Mantenimiento global: <strong>{tariff?currency(Number(tariff.monto)):'Sin tarifa configurada'}</strong></p><p className="mt-1 text-lg font-semibold">Total mensual: {currency(total)}</p>{type==='COMPRA_FINANCIADA'&&<p className="text-sm">El mantenimiento continúa después de generar las {term||'N'} cuotas de vivienda.</p>}</div>
      {contracts?.versiones[0]?.tipo==='COMPRA_FINANCIADA'&&<p>Financiamiento registrado: {contracts.versiones[0].cuotas_generadas} cuotas generadas de {contracts.versiones[0].meses_financiamiento}. Restantes: {Math.max(0,(contracts.versiones[0].meses_financiamiento||0)-contracts.versiones[0].cuotas_generadas)}.</p>}
      {contracts?.versiones[0]?.ultimo_periodo_previsto&&<p>Inicio registrado: {contracts.versiones[0].fecha_inicio}. Último período previsto de vivienda: {contracts.versiones[0].ultimo_periodo_previsto}. El conteo corresponde a cuotas generadas.</p>}
    </div>}
    {step===2&&<div className="space-y-4"><PersonFields label={personLabel} role={type==='RENTA_DIRECTA'?'inquilino':'residente'} users={users} value={person} onChange={setPerson} mode={personMode} onModeChange={setPersonMode}/>
      <label className="flex items-center gap-2"><input type="checkbox" checked={lives} onChange={e=>{setLives(e.target.checked);setOccupantsChanged(true);}}/>{personLabel} habita la vivienda</label>
      {type==='RENTA_DIRECTA'&&<p>La residencial conserva la propiedad. El arrendatario directo paga renta y mantenimiento.</p>}
      {type==='PROPIEDAD_PRIVADA'&&<><label className="flex items-center gap-2"><input type="checkbox" checked={privateTenant} onChange={e=>{setPrivateTenant(e.target.checked);setOccupantsChanged(true);if(!e.target.checked){setTenant({});setTenantMode('existing');}}}/>Agregar inquilino privado</label><p>El propietario paga mantenimiento aunque no habite la casa. El inquilino privado tiene Q0 de obligaciones con la residencial.</p>{privateTenant&&<PersonFields label="Inquilino privado" role="inquilino" users={users} value={tenant} onChange={value=>{setTenant(value);setOccupantsChanged(true);}} mode={tenantMode} onModeChange={setTenantMode}/>}</>}
    </div>}
    {step===3&&<div className="space-y-4">
      {contracts?.versiones.length&&!occupantsChanged&&<p>Se conservan los habitantes para la fecha efectiva: {preservedInhabitants.map(h=>h.nombre).join(', ')||'Sin habitantes confirmados'}. Esta edición no solicita bajas.</p>}
      <dl className="grid gap-3 rounded-xl border p-4 sm:grid-cols-2">{[
      ['Vivienda',house?.codigo],['Tipo contractual',contractLabels[type]],['Responsable financiero',personName(person)],['Fecha efectiva',start],['Primer período',period],['Cuota vivienda / renta',currency(type==='PROPIEDAD_PRIVADA'?0:Number(amount))],['Mantenimiento global',currency(Number(tariff?.monto)||0)],['Total mensual',currency(total)],['Plazo',type==='COMPRA_FINANCIADA'?`${term} cuotas de vivienda`:'No aplica'],['Habitantes',[lives?personName(person):'',privateTenant?personName(tenant):''].filter(Boolean).join(', ')||'Desocupada'],['Propietario',type==='RENTA_DIRECTA'?'La residencial':personName(person)],['Inquilino privado',privateTenant?`${personName(tenant)} · Q0`:'No aplica']
      ].map(([label,value])=><div key={label}><dt className="text-sm text-muted-foreground">{label}</dt><dd className="break-words font-medium">{value}</dd></div>)}</dl>
      {contracts?.versiones.length?<p>Si cambia el propietario, el sistema verificará que su saldo real esté en Q0. Las cuotas y los pagos anteriores conservan a su titular.</p>:<p>Los registros históricos sin responsable confirmado quedan disponibles para revisión administrativa.</p>}
      <label className="flex items-start gap-2"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>Confirmo vivienda, personas, fecha efectiva y obligaciones del resumen.</label>
    </div>}
    <div className="flex flex-wrap justify-end gap-2"><Button type="button" variant="outline" disabled={busy} onClick={onClose}>Cancelar</Button>{step>0&&<Button type="button" variant="outline" disabled={busy} onClick={()=>{setStep(step-1);setFailure('');setConfirmed(false);}}>Anterior</Button>}{step<3?<Button type="button" disabled={loading} onClick={next}>Continuar</Button>:<Button type="button" disabled={!confirmed||busy} onClick={()=>void save()}>{busy?'Guardando…':'Guardar configuración'}</Button>}</div>
  </DialogContent></Dialog>;
}
