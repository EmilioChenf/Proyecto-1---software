import {useEffect,useState,type ReactNode} from 'react';
import {BadgeCheck,CalendarDays,Check,Home,KeyRound,Landmark,Loader2,Percent,Sparkles,TriangleAlert,UserPlus,Users} from 'lucide-react';
import { useFeedbackState } from "@/hooks/useFeedbackState";
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
const MONTHS=['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
const longDate=(day:string)=>/^\d{4}-\d{2}-\d{2}$/.test(day)?`${Number(day.slice(8,10))} de ${MONTHS[Number(day.slice(5,7))-1]} de ${day.slice(0,4)}`:'—';
export function firstBillingPeriod(day:string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return '';
  if(day.endsWith('-01'))return day;
  const d=new Date(`${day.slice(0,7)}-01T00:00:00Z`);d.setUTCMonth(d.getUTCMonth()+1);return d.toISOString().slice(0,10);
}
const PAYMENT_DAY_MAX=28;
/** Mismo cálculo que el backend: saldo = precio - enganche; N-1 cuotas iguales y la última ajusta centavos. */
export function financingPlan(price:string,down:string,months:string){
  const p=Math.round(Number(price)*100),d=Math.round(Number(down||0)*100),n=Number(months);
  if(!(p>0)||!(d>=0)||d>=p||!Number.isInteger(n)||n<1)return null;
  const financed=p-d,base=Math.floor(financed/n);if(base<=0)return null;
  return {financed:financed/100,base:base/100,last:(financed-base*(n-1))/100};
}
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Guatemala',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());

// Cada tipo de contrato explicado como lo vive la persona.
const TYPE_CARDS:Array<{type:ContractType;icon:ReactNode;title:string;who:string;pays:string;tint:string}>=[
  {type:'COMPRA_FINANCIADA',icon:<Landmark className="size-5"/>,title:'Compra con financiamiento',who:'Residente que compra con la administración',pays:'Enganche + cuotas mensuales + mantenimiento',tint:'bg-blue-50 text-blue-600'},
  {type:'RENTA_DIRECTA',icon:<KeyRound className="size-5"/>,title:'Renta con la administración',who:'Residente; la casa es de la residencial',pays:'Renta mensual + mantenimiento',tint:'bg-violet-50 text-violet-600'},
  {type:'PROPIEDAD_PRIVADA',icon:<BadgeCheck className="size-5"/>,title:'Propietario',who:'Residente que ya pagó la casa',pays:'Solo mantenimiento',tint:'bg-emerald-50 text-emerald-600'},
];
const DOWN_SHORTCUTS=[10,20,30];
const TERM_SHORTCUTS=[[12,'1 año'],[24,'2 años'],[60,'5 años'],[120,'10 años'],[180,'15 años'],[240,'20 años']] as const;
const STEPS=['Vivienda','Contrato','Personas','Confirmación'];

type PersonMode='existing'|'new';
function PersonFields({label,role,users,value,onChange,mode,onModeChange}:{label:string;role:string;users:UserRecord[];value:ContractPerson;onChange:(person:ContractPerson)=>void;mode:PersonMode;onModeChange:(mode:PersonMode)=>void}) {
  return <fieldset className="min-w-0 space-y-3 rounded-2xl border border-slate-200 bg-white p-4"><legend className="px-1 text-sm font-semibold text-slate-900">{label}</legend>
    <div className="grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1 text-sm">
      {([['existing','Ya tiene cuenta'],['new','Crear cuenta nueva']] as const).map(([key,text])=><button key={key} type="button" aria-pressed={mode===key} onClick={()=>{if(mode!==key){onModeChange(key);onChange({});}}} className={`rounded-lg px-3 py-1.5 font-medium ${mode===key?'bg-white text-slate-900 shadow-sm':'text-slate-500'}`}>{text}</button>)}
    </div>
    <select aria-label={`${label}: origen`} className="sr-only" tabIndex={-1} aria-hidden="true" value={mode} onChange={e=>{onModeChange(e.target.value as PersonMode);onChange({});}}>
      <option value="existing">Seleccionar existente</option><option value="new">Crear persona</option></select>
    {mode==='existing'?<label className="block text-sm font-medium text-slate-700">Persona<select aria-label={`${label}: usuario`} className="mt-1.5 block h-11 w-full rounded-xl border border-slate-200 bg-white px-3" value={value.id_usuario||''} onChange={e=>onChange({id_usuario:Number(e.target.value)||undefined})}>
      <option value="">Seleccionar persona</option>{users.filter(u=>u.rol===role).map(u=><option key={u.id_usuario} value={u.id_usuario}>{u.nombre} · {u.correo}</option>)}</select></label>:
      <div className="grid gap-3 sm:grid-cols-2">{(['nombre','correo','telefono','password'] as const).map(key=><label key={key} className="text-sm font-medium text-slate-700">{{nombre:'Nombre',correo:'Correo',telefono:'Teléfono',password:'Contraseña'}[key]}
        <Input aria-label={`${label}: ${key}`} className="mt-1.5 h-11 rounded-xl" type={key==='password'?'password':key==='correo'?'email':'text'} autoComplete={key==='password'?'new-password':'off'} value={value[key]||''} onChange={e=>onChange({...value,[key]:e.target.value})}/></label>)}</div>}
  </fieldset>;
}
const personValid=(person:ContractPerson)=>Boolean(person.id_usuario||(person.nombre?.trim()&&/^\S+@\S+\.\S+$/.test(person.correo||'')&&(person.password?.length||0)>=4));

function MoneyInput({label,value,onChange,placeholder,readOnly=false}:{label:string;value:string;onChange?:(value:string)=>void;placeholder?:string;readOnly?:boolean}) {
  return <label className="block text-sm font-medium text-slate-700">{label}
    <span className="relative mt-1.5 block"><span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">Q</span>
      <Input aria-label={label} inputMode="decimal" placeholder={placeholder} readOnly={readOnly} value={value} onChange={e=>onChange?.(e.target.value.replace(/,/g,''))} className={`h-11 rounded-xl pl-7 ${readOnly?'bg-slate-50 font-semibold text-slate-900':''}`}/></span></label>;
}

export function PropertyContractWizard({open,onClose,onSaved,initialHouse=null}:{open:boolean;onClose:()=>void;onSaved:()=>void;initialHouse?:HouseRecord|null}) {
  const [step,setStep]=useState(0),[house,setHouse]=useState<HouseRecord|null>(initialHouse),[contracts,setContracts]=useState<HouseContracts|null>(null);
  const [type,setType]=useState<ContractType>('PROPIEDAD_PRIVADA'),[start,setStart]=useState(today),[amount,setAmount]=useState(''),[term,setTerm]=useState('');
  const [price,setPrice]=useState(''),[down,setDown]=useState(''),[maintenancePayer,setMaintenancePayer]=useState<'INQUILINO'|'PROPIETARIO'>('INQUILINO');
  const [person,setPerson]=useState<ContractPerson>({}),[tenant,setTenant]=useState<ContractPerson>({}),[privateTenant,setPrivateTenant]=useState(false),[lives,setLives]=useState(false);
  const [personMode,setPersonMode]=useState<PersonMode>('existing'),[tenantMode,setTenantMode]=useState<PersonMode>('existing'),[occupantsChanged,setOccupantsChanged]=useState(false);
  const [users,setUsers]=useState<UserRecord[]>([]),[tariff,setTariff]=useState<MaintenanceTariff|null>(null),[confirmed,setConfirmed]=useState(false);
  const [noTariffThisMonth,setNoTariffThisMonth]=useState(false);
  const [busy,setBusy]=useState(false),[loading,setLoading]=useState(false),[failure,setFailure]=useFeedbackState('error', ''),[operation,setOperation]=useState(()=>crypto.randomUUID());
  const hasPrivateTenant=type==='PROPIEDAD_PRIVADA'&&privateTenant;
  const plan=type==='COMPRA_FINANCIADA'&&price?financingPlan(price,down,term):null;
  const installment=type==='PROPIEDAD_PRIVADA'?0:plan?plan.base:Number(amount)||0;
  // Un contrato que empieza hoy en una casa sin cobro este mes genera el primer cobro de
  // inmediato; si no hay tarifa para este mes o ya se cobró, empieza el mes siguiente.
  const monthStart=`${start.slice(0,7)}-01`;
  const coversThisMonth=Boolean(contracts?.versiones.some(v=>v.vigente_desde<=monthStart&&(!v.vigente_hasta||v.vigente_hasta>monthStart)&&v.cuotas_generadas>0));
  const wantsChargeNow=start===today()&&!start.endsWith('-01')&&!coversThisMonth;
  const chargesNow=wantsChargeNow&&!noTariffThisMonth;
  const period=chargesNow?monthStart:firstBillingPeriod(start),total=installment+(Number(tariff?.monto)||0);
  const paymentDay=Math.min(PAYMENT_DAY_MAX,Number(start.slice(8,10))||1);
  const firstDue=period?`${period.slice(0,7)}-${String(paymentDay).padStart(2,'0')}`:'';
  const priceNumber=Number(price)||0,downNumber=Number(down)||0;
  const remaining=Math.max(0,priceNumber-downNumber);
  const downPercent=priceNumber>0?Math.round((downNumber/priceNumber)*1000)/10:0;
  useEffect(()=>{if(!open)return;let active=true;getUsersRequest().then(v=>{if(active)setUsers(v);}).catch(e=>{if(active)setFailure(e.message);});return()=>{active=false;};},[open]);
  useEffect(()=>{
    if(!open||!house)return;let active=true;setContracts(null);setLoading(true);setFailure('');
    getHouseContractsRequest(house.id_casa).then(v=>{
      if(!active)return;
      setContracts(v);setConfirmed(false);setOperation(crypto.randomUUID());
      const latest=v.versiones[0];
      setType(latest?.tipo||'PROPIEDAD_PRIVADA');setAmount(latest?.cuota_vivienda||'');
      setTerm(String(latest?.meses_financiamiento||''));setPerson(latest?{id_usuario:latest.id_responsable}:{});
      setPrice(latest?.precio_total?String(Number(latest.precio_total)):'');setDown(latest?.enganche?String(Number(latest.enganche)):'');
      setPersonMode('existing');setTenantMode('existing');setOccupantsChanged(false);
    })
      .catch(e=>{if(active)setFailure(e.message);}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};
  },[open,house?.id_casa]);
  useEffect(()=>{
    if(!contracts||occupantsChanged)return;
    const inhabitants=contracts.habitantes.filter(h=>!h.id_version_pendiente&&h.vigente_desde<=start&&(!h.vigente_hasta||h.vigente_hasta>start));
    setLives(inhabitants.some(h=>h.id_usuario===person.id_usuario));
    const currentTenant=type==='PROPIEDAD_PRIVADA'?inhabitants.find(h=>h.calidad==='INQUILINO_PRIVADO'):undefined;
    setPrivateTenant(Boolean(currentTenant));setTenant(currentTenant?{id_usuario:currentTenant.id_usuario}:{});setTenantMode('existing');
  },[contracts,start,person.id_usuario,occupantsChanged,type]);
  useEffect(()=>{
    if(!open||!start)return;let active=true;setTariff(null);
    const nextPeriod=firstBillingPeriod(start);
    (async()=>{
      try{
        if(wantsChargeNow){
          const current=await getGlobalMaintenanceRequest(monthStart);
          if(!active)return;
          if(current.vigente){setNoTariffThisMonth(false);setTariff(current.vigente);return;}
          setNoTariffThisMonth(true);
        } else setNoTariffThisMonth(false);
        const upcoming=await getGlobalMaintenanceRequest(nextPeriod);
        if(active)setTariff(upcoming.vigente);
      }catch(e){if(active)setFailure(e instanceof Error?e.message:'No fue posible consultar el mantenimiento.');}
    })();
    return()=>{active=false;};
  },[open,start,wantsChargeNow,monthStart]);
  function changeType(value:ContractType){
    if(value===type)return;
    // A new type discards dependent drafts; saved inhabitants remain unchanged
    // unless the user explicitly edits occupancy in the selected type.
    setType(value);setTerm('');setPerson({});setPersonMode('existing');
    // Se proponen los precios registrados en la vivienda (venta o renta mensual).
    setAmount(value==='RENTA_DIRECTA'&&house?.precio_renta?String(house.precio_renta):'');
    setPrice(value==='COMPRA_FINANCIADA'&&house?.precio?String(house.precio):'');setDown('');setMaintenancePayer('INQUILINO');
    setPrivateTenant(false);setTenant({});setTenantMode('existing');setLives(false);setOccupantsChanged(false);
    setConfirmed(false);setOperation(crypto.randomUUID());
  }
  function next(){
    setFailure('');
    if(step===0&&(!house||!contracts||loading)){setFailure('Selecciona una vivienda y espera a que cargue su configuración.');return;}
    if(step===1){
      if(!start||start<today()){setFailure('Selecciona una fecha efectiva desde hoy.');return;}
      if(!tariff){setFailure('Configura primero el mantenimiento global para el período seleccionado.');return;}
      if(type==='COMPRA_FINANCIADA'&&(!Number.isInteger(Number(term))||Number(term)<1||Number(term)>1200)){setFailure('Indica un plazo de entre 1 y 1200 meses.');return;}
      if(type==='COMPRA_FINANCIADA'&&price){
        if(!/^\d+(\.\d{1,2})?$/.test(price)||!/^\d*(\.\d{1,2})?$/.test(down||'0')){setFailure('Precio y enganche admiten hasta dos decimales.');return;}
        if(!plan){setFailure('El enganche debe ser menor que el precio y el plazo debe dejar una cuota mayor que cero.');return;}
      } else if(type!=='PROPIEDAD_PRIVADA'&&(!/^\d+(\.\d{1,2})?$/.test(amount)||Number(amount)<=0)){setFailure('La cuota de vivienda o renta debe ser mayor que cero y tener hasta dos decimales.');return;}
    }
    if(step===2&&(!personValid(person)||(hasPrivateTenant&&!personValid(tenant)))){setFailure('Completa los datos de las personas seleccionadas.');return;}
    setStep(step+1);setConfirmed(false);
  }
  const personName=(p:ContractPerson)=>users.find(u=>u.id_usuario===p.id_usuario)?.nombre||p.nombre||'Sin seleccionar';
  async function save(){
    if(!house||!contracts||!confirmed||busy)return;setBusy(true);setFailure('');
    try{await saveHouseContractRequest(house.id_casa,{id_operacion:operation,version:contracts.version_contractual,tipo:type,fecha_efectiva:start,cuota_vivienda:type==='PROPIEDAD_PRIVADA'?'0':plan?plan.base.toFixed(2):amount,meses_financiamiento:type==='COMPRA_FINANCIADA'?Number(term):null,...(plan?{precio_total:price,enganche:down||'0'}:{}),...(hasPrivateTenant?{mantenimiento_paga:maintenancePayer}:{}),responsable:person,responsable_habita:lives,inquilino_privado:hasPrivateTenant?tenant:null,habitantes_accion:!contracts.versiones.length||occupantsChanged?'ACTUALIZAR':'CONSERVAR',confirmado:true});onSaved();onClose();}
    catch(e){setFailure(e instanceof Error?e.message:'No fue posible guardar el contrato.');}finally{setBusy(false);}
  }
  const personLabel=type==='COMPRA_FINANCIADA'?'Comprador':type==='RENTA_DIRECTA'?'Arrendatario directo':'Propietario';
  const currentDay=today();
  const currentVersion=contracts?.versiones.find(v=>(!v.activacion_estado||v.activacion_estado==='ACTIVA')&&v.vigente_desde<=currentDay&&(!v.vigente_hasta||v.vigente_hasta>currentDay));
  const currentTitle=contracts?.titularidades.find(t=>!t.id_version_pendiente&&t.vigente_desde<=currentDay&&(!t.vigente_hasta||t.vigente_hasta>currentDay));
  const currentInhabitants=contracts?.habitantes.filter(h=>!h.id_version_pendiente&&h.vigente_desde<=currentDay&&(!h.vigente_hasta||h.vigente_hasta>currentDay))||[];
  const preservedInhabitants=contracts?.habitantes.filter(h=>!h.id_version_pendiente&&h.vigente_desde<=start&&(!h.vigente_hasta||h.vigente_hasta>start))||[];
  const planText=plan?(plan.base===plan.last?`${Number(term)} cuota${Number(term)>1?'s':''} de ${currency(plan.base)}`:`${Number(term)-1} cuotas de ${currency(plan.base)} y la última de ${currency(plan.last)}`):'';

  const summaryRows:Array<[string,ReactNode]>=[
    ['Vivienda',house?.codigo],['Tipo contractual',contractLabels[type]],['Responsable financiero',hasPrivateTenant&&maintenancePayer==='INQUILINO'?`${personName(tenant)} (inquilino, mantenimiento)`:personName(person)],['Fecha efectiva',start],['Primer período',period],
    ...(plan?[['Precio de la vivienda',currency(Number(price))],['Enganche',currency(Number(down||0))],['Saldo financiado',currency(plan.financed)]] as Array<[string,ReactNode]>:[]),
    ['Cuota vivienda / renta',currency(installment)],['Día de pago',`Cada ${paymentDay} de mes · primer cobro ${longDate(firstDue)}`],['Mantenimiento global',currency(Number(tariff?.monto)||0)],['Total mensual',currency(total)],
    ['Plazo',type==='COMPRA_FINANCIADA'?`${term} cuotas de vivienda`:'No aplica'],['Habitantes',[lives?personName(person):'',hasPrivateTenant?personName(tenant):''].filter(Boolean).join(', ')||'Desocupada'],
    ['Propietario',type==='RENTA_DIRECTA'?'La residencial':personName(person)],['Inquilino privado',hasPrivateTenant?`${personName(tenant)} · ${maintenancePayer==='INQUILINO'?'paga el mantenimiento':'Q0'}`:'No aplica'],
  ];

  return <Dialog open={open} onOpenChange={v=>{if(!v&&!busy)onClose();}}><DialogContent className="max-h-[92dvh] w-[calc(100%-1rem)] max-w-5xl gap-0 overflow-y-auto p-0" onInteractOutside={e=>{if(busy)e.preventDefault();}}>
    <div className="border-b border-slate-100 bg-gradient-to-br from-slate-50 to-white px-5 pb-5 pt-6 sm:px-7">
      <DialogHeader><DialogTitle className="text-xl font-bold text-slate-900">Vivienda, contrato y personas</DialogTitle><DialogDescription className="text-sm text-slate-500">Registra aquí el contrato cuando ya esté firmado con la administración (y su abogado). La vivienda conserva su historial.</DialogDescription></DialogHeader>
      <ol aria-label="Pasos del asistente" className="mt-5 grid grid-cols-4 gap-2">{STEPS.map((label,i)=><li key={label} aria-current={i===step?'step':undefined} className="flex min-w-0 flex-col gap-2">
        <span className={`h-1.5 rounded-full ${i<=step?'bg-slate-900':'bg-slate-200'}`}/>
        <span className={`flex items-center gap-1.5 truncate text-xs font-medium sm:text-sm ${i===step?'text-slate-900':i<step?'text-slate-600':'text-slate-400'}`}>
          <span className={`grid size-5 shrink-0 place-items-center rounded-full text-[10px] font-bold ${i<step?'bg-emerald-500 text-white':i===step?'bg-slate-900 text-white':'bg-slate-200 text-slate-500'}`}>{i<step?<Check className="size-3"/>:i+1}</span>
          <span className="truncate">{i+1}. {label}</span></span></li>)}</ol>
    </div>

    <div className="space-y-5 px-5 py-5 sm:px-7">
    {failure&&<p role="alert" className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700"><TriangleAlert className="mt-0.5 size-4 shrink-0"/>{failure}</p>}

    {step===0&&<div className="space-y-4"><HousePicker role="contrato" userId={null} value={house} onChange={setHouse}/>
      {house&&<div className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4"><span className="grid size-11 place-items-center rounded-xl bg-slate-900 text-white"><Home className="size-5"/></span>
        <div><p className="font-semibold text-slate-900">{house.codigo} · {house.modelo||'Modelo sin especificar'}</p><p className="text-sm text-slate-500">{house.area_construccion??'—'} m² · {house.habitaciones??'—'} habitaciones · {house.banos??'—'} baños{house.precio?` · Venta ${currency(house.precio)}`:''}{house.precio_renta?` · Renta ${currency(house.precio_renta)}/mes`:''}</p></div></div>}
      {loading&&<p role="status" className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="size-4 animate-spin"/>Cargando configuración contractual…</p>}
      {house&&contracts&&<dl className="grid gap-3 rounded-2xl border border-slate-200 bg-slate-50/60 p-4 text-sm sm:grid-cols-2 lg:grid-cols-3">{[
        ['Estado',house.activo?'Activa':'Inactiva'],['Ocupación',currentInhabitants.length?`Ocupada · ${currentInhabitants.map(h=>h.nombre).join(', ')}`:house.estado==='OCUPADA'?'Ocupada · Habitantes por confirmar':'Disponible · Sin habitantes confirmados'],
        ['Contrato vigente',currentVersion?contractLabels[currentVersion.tipo]:contracts.versiones.length?'Sin contrato vigente hoy':'Pendiente de configuración'],
        ['Titular actual',currentTitle?(currentTitle.titular_empresa?'La residencial':currentTitle.nombre):'Sin titular confirmado'],
        ['Responsable financiero actual',currentVersion?.responsable_nombre||'Sin responsable vigente hoy'],
        ['Vigencia',currentVersion?`${currentVersion.vigente_desde} → ${currentVersion.vigente_hasta||'Sin fecha de cierre'}`:'Por confirmar'],
      ].map(([label,value])=><div key={label}><dt className="text-xs text-slate-500">{label}</dt><dd className="mt-0.5 break-words font-medium text-slate-900">{value}</dd></div>)}
      {contracts.versiones[0]&&!currentVersion&&<div><dt className="text-xs text-slate-500">Configuración programada</dt><dd className="mt-0.5 text-slate-900">{contractLabels[contracts.versiones[0].tipo]} · {contracts.versiones[0].vigente_desde} · {contracts.versiones[0].responsable_nombre}</dd></div>}
      {contracts.versiones[0]?.activacion_estado==='BLOQUEADA'&&<p role="alert">Transferencia bloqueada por deuda o revisión financiera. El titular anterior se conserva.</p>}</dl>}
    </div>}

    {step===1&&<div className="grid gap-5 lg:grid-cols-[1fr_300px]">
      <div className="space-y-5">
        <div role="radiogroup" aria-label="Tipo contractual" className="grid gap-3 sm:grid-cols-3">
          {TYPE_CARDS.map(card=><label key={card.type} className={`relative cursor-pointer rounded-2xl border p-4 transition ${type===card.type?'border-slate-900 bg-white ring-2 ring-slate-900/10':'border-slate-200 bg-white hover:border-slate-300'}`}>
            <input type="radio" name="tipo-contrato" className="sr-only" aria-label={contractLabels[card.type]} checked={type===card.type} onChange={()=>changeType(card.type)}/>
            {type===card.type&&<span className="absolute right-3 top-3 grid size-5 place-items-center rounded-full bg-slate-900 text-white"><Check className="size-3"/></span>}
            <span className={`grid size-10 place-items-center rounded-xl ${card.tint}`}>{card.icon}</span>
            <span className="mt-3 block font-semibold text-slate-900">{card.title}</span>
            <span className="mt-1 block text-xs text-slate-500">{card.who}</span>
            <span className="mt-2 block text-xs font-medium text-slate-700">{card.pays}</span>
          </label>)}
        </div>

        {type==='COMPRA_FINANCIADA'&&<section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900"><Sparkles className="size-4 text-blue-500"/>Calculadora de financiamiento</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <MoneyInput label="Precio de la vivienda" placeholder="950000" value={price} onChange={setPrice}/>
            <div><MoneyInput label="Enganche" placeholder="95000" value={down} onChange={setDown}/>
              {priceNumber>0&&<div className="mt-2 flex flex-wrap items-center gap-1.5">{DOWN_SHORTCUTS.map(pct=><button key={pct} type="button" onClick={()=>setDown((Math.round(priceNumber*pct)/100).toFixed(2).replace(/\.00$/,''))} className={`flex items-center gap-0.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${Math.abs(downPercent-pct)<0.05?'border-blue-600 bg-blue-600 text-white':'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>{pct}<Percent className="size-3"/></button>)}
                {downNumber>0&&<span className="text-xs text-slate-500">= {downPercent}% del precio</span>}</div>}
            </div>
          </div>
          {priceNumber>0&&<div className={`rounded-2xl p-4 ${downNumber>=priceNumber?'bg-rose-50':'bg-emerald-50'}`}>
            <div className="flex flex-wrap items-end justify-between gap-2"><div><p className={`text-xs font-semibold uppercase tracking-wide ${downNumber>=priceNumber?'text-rose-700':'text-emerald-700'}`}>Resta por pagar</p>
              <p className={`text-3xl font-bold tabular-nums ${downNumber>=priceNumber?'text-rose-700':'text-emerald-800'}`}>{currency(remaining)}</p></div>
              <p className="text-right text-xs text-slate-600">{currency(priceNumber)} precio<br/>− {currency(downNumber)} enganche</p></div>
            <div className="mt-3 flex h-2.5 overflow-hidden rounded-full bg-white"><div className="bg-emerald-500" style={{width:`${Math.min(100,downPercent)}%`}}/></div>
            {downNumber>=priceNumber&&<p className="mt-2 text-xs text-rose-700">El enganche debe ser menor que el precio.</p>}
          </div>}
          <div>
            <label className="block text-sm font-medium text-slate-700">Meses de financiamiento<Input aria-label="Meses de financiamiento" className="mt-1.5 h-11 rounded-xl" type="number" min="1" max="1200" placeholder="Ej. 120" value={term} onChange={e=>setTerm(e.target.value)}/></label>
            <div className="mt-2 flex flex-wrap gap-1.5">{TERM_SHORTCUTS.map(([months,text])=><button key={months} type="button" onClick={()=>setTerm(String(months))} className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${Number(term)===months?'border-slate-900 bg-slate-900 text-white':'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>{text}</button>)}</div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 sm:items-end">
            <MoneyInput label="Cuota mensual" readOnly={Boolean(plan)} placeholder={price?'Se calcula sola':'4000'} value={plan?plan.base.toFixed(2):amount} onChange={setAmount}/>
            <p className="text-xs leading-5 text-slate-500">{plan?<>Plan: <strong className="text-slate-800">{planText}</strong>, más el mantenimiento.</>:price?'Escribe precio, enganche (menor que el precio) y meses para calcular la cuota.':'Sin precio, escribe la cuota acordada manualmente.'}</p>
          </div>
        </section>}

        {type==='RENTA_DIRECTA'&&<section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5"><MoneyInput label="Cuota mensual" placeholder="7500" value={amount} onChange={setAmount}/>
          <p className="mt-2 text-xs text-slate-500">Renta mensual con la administración{house?.precio_renta?` (la vivienda tiene registrada ${currency(house.precio_renta)})`:''}. El mantenimiento se suma aparte.</p></section>}

        {type==='PROPIEDAD_PRIVADA'&&<p className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-4 text-sm text-emerald-900">El propietario ya pagó la casa: solo paga el mantenimiento. Si se la alquila a alguien por su cuenta, en el siguiente paso puedes agregar al inquilino y elegir quién paga el mantenimiento.</p>}

        <section className="grid gap-4 rounded-2xl border border-slate-200 bg-white p-4 sm:grid-cols-2 sm:p-5">
          <label className="block text-sm font-medium text-slate-700">Fecha efectiva<Input aria-label="Fecha efectiva" className="mt-1.5 h-11 rounded-xl" type="date" min={today()} value={start} onChange={e=>setStart(e.target.value)}/><span className="mt-1.5 block text-xs font-normal text-slate-500">Normalmente, el día que se firmó el contrato.</span></label>
          <div className="flex items-start gap-3 rounded-xl bg-slate-50 p-3"><CalendarDays className="mt-0.5 size-5 shrink-0 text-slate-500"/>
            <p className="text-sm text-slate-700">{type==='PROPIEDAD_PRIVADA'?'El mantenimiento vence':'Las cuotas vencen'} <strong>cada {paymentDay} de mes</strong>{Number(start.slice(8,10))>PAYMENT_DAY_MAX?' (los días 29 a 31 se cobran el 28)':''}. Primer cobro: <strong>{longDate(firstDue)}</strong>{chargesNow?', se genera al guardar junto con el mantenimiento.':'.'}{wantsChargeNow&&noTariffThisMonth?' No hay mantenimiento configurado para este mes, por eso empieza el siguiente.':''}</p></div>
        </section>
        {contracts?.versiones[0]?.tipo==='COMPRA_FINANCIADA'&&<p className="text-sm text-slate-600">Financiamiento registrado: {contracts.versiones[0].cuotas_generadas} cuotas generadas de {contracts.versiones[0].meses_financiamiento}. Restantes: {Math.max(0,(contracts.versiones[0].meses_financiamiento||0)-contracts.versiones[0].cuotas_generadas)}.</p>}
        {contracts?.versiones[0]?.ultimo_periodo_previsto&&<p className="text-sm text-slate-600">Inicio registrado: {contracts.versiones[0].fecha_inicio}. Último período previsto de vivienda: {contracts.versiones[0].ultimo_periodo_previsto}. El conteo corresponde a cuotas generadas.</p>}
      </div>

      <aside className="h-fit space-y-3 rounded-2xl bg-slate-900 p-5 text-white lg:sticky lg:top-0">
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Pago mensual</p>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between gap-3"><span className="text-slate-300">{type==='RENTA_DIRECTA'?'Renta':'Cuota de la casa'}</span><span className="tabular-nums">{type==='PROPIEDAD_PRIVADA'?'No aplica':currency(installment)}</span></div>
          <div className="flex justify-between gap-3"><span className="text-slate-300">Mantenimiento global</span>{tariff?<span className="tabular-nums">{currency(Number(tariff.monto))}</span>:<span className="text-amber-300">Sin tarifa configurada</span>}</div>
        </div>
        <p className="border-t border-white/10 pt-3 text-lg font-bold tabular-nums">Total mensual: {currency(total)}</p>
        {type==='COMPRA_FINANCIADA'&&<p className="text-xs text-slate-400">El mantenimiento continúa después de generar las {term||'N'} cuotas de vivienda.</p>}
        {!tariff&&<p className="rounded-xl bg-amber-400/15 p-3 text-xs text-amber-100">Configura el mantenimiento global en <a className="font-semibold underline" href="/admin/configuracion">Configuración</a> antes de guardar el contrato.</p>}
      </aside>
    </div>}

    {step===2&&<div className="grid gap-4 lg:grid-cols-2">
      <div className="space-y-3"><PersonFields label={personLabel} role="residente" users={users} value={person} onChange={setPerson} mode={personMode} onModeChange={setPersonMode}/>
        <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white p-3 text-sm"><input type="checkbox" className="size-4" checked={lives} onChange={e=>{setLives(e.target.checked);setOccupantsChanged(true);}}/>{personLabel} habita la vivienda</label>
        {type==='RENTA_DIRECTA'&&<p className="text-sm text-slate-600">La residencial conserva la propiedad. El arrendatario directo paga renta y mantenimiento.</p>}
      </div>
      {type==='PROPIEDAD_PRIVADA'?<div className="space-y-3">
        <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white p-3 text-sm font-medium"><input type="checkbox" className="size-4" checked={privateTenant} onChange={e=>{setPrivateTenant(e.target.checked);setOccupantsChanged(true);if(!e.target.checked){setTenant({});setTenantMode('existing');}}}/><UserPlus className="size-4 text-slate-400"/>Agregar inquilino privado</label>
        {privateTenant?<fieldset className="space-y-2 rounded-2xl border border-slate-200 bg-white p-4 text-sm"><legend className="px-1 font-semibold text-slate-900">¿Quién paga el mantenimiento?</legend>
          <label className={`flex items-start gap-2 rounded-xl border p-3 ${maintenancePayer==='INQUILINO'?'border-slate-900 bg-slate-50':'border-slate-200'}`}><input type="radio" className="mt-0.5" name="mantenimiento-paga" checked={maintenancePayer==='INQUILINO'} onChange={()=>setMaintenancePayer('INQUILINO')}/>El inquilino (le cae el mantenimiento en su cuenta; el propietario queda en Q0)</label>
          <label className={`flex items-start gap-2 rounded-xl border p-3 ${maintenancePayer==='PROPIETARIO'?'border-slate-900 bg-slate-50':'border-slate-200'}`}><input type="radio" className="mt-0.5" name="mantenimiento-paga" checked={maintenancePayer==='PROPIETARIO'} onChange={()=>setMaintenancePayer('PROPIETARIO')}/>El propietario (el inquilino privado tiene Q0 de obligaciones con la residencial)</label>
          <p className="text-xs text-slate-500">La renta entre propietario e inquilino se paga entre ellos, fuera de la administración.</p></fieldset>
          :<p className="rounded-xl bg-slate-50 p-3 text-sm text-slate-600">El propietario paga mantenimiento aunque no habite la casa. Si la alquila por su cuenta, puedes agregar al inquilino y elegir quién paga el mantenimiento.</p>}
        {privateTenant&&<PersonFields label="Inquilino privado" role="inquilino" users={users} value={tenant} onChange={value=>{setTenant(value);setOccupantsChanged(true);}} mode={tenantMode} onModeChange={setTenantMode}/>}
      </div>:<div className="flex items-start gap-3 rounded-2xl bg-slate-50 p-4 text-sm text-slate-600"><Users className="mt-0.5 size-5 shrink-0 text-slate-400"/>Quien compra o renta con la administración es <strong className="mx-1 text-slate-900">residente</strong>. Los inquilinos solo aplican cuando un propietario alquila su casa por su cuenta.</div>}
    </div>}

    {step===3&&<div className="space-y-4">
      <div className="rounded-2xl bg-slate-900 p-5 text-white">
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">{contractLabels[type]} · {house?.codigo}</p>
        <p className="mt-1 text-3xl font-bold tabular-nums">{currency(total)} <span className="text-base font-medium text-slate-400">al mes</span></p>
        <p className="mt-1 text-sm text-slate-300">Cada {paymentDay} de mes · primer cobro {longDate(firstDue)}{plan?` · ${planText}`:''}</p>
      </div>
      {Boolean(contracts?.versiones.length)&&!occupantsChanged&&<p className="text-sm text-slate-600">Se conservan los habitantes para la fecha efectiva: {preservedInhabitants.map(h=>h.nombre).join(', ')||'Sin habitantes confirmados'}. Esta edición no solicita bajas.</p>}
      <dl className="grid gap-x-6 gap-y-3 rounded-2xl border border-slate-200 bg-white p-5 sm:grid-cols-2 lg:grid-cols-3">{summaryRows.map(([label,value])=><div key={label} className="border-b border-slate-100 pb-2"><dt className="text-xs text-slate-500">{label}</dt><dd className="mt-0.5 break-words font-medium text-slate-900">{value}</dd></div>)}</dl>
      {contracts?.versiones.length?<p className="text-sm text-slate-600">Si cambia el propietario, el sistema verificará que su saldo real esté en Q0. Las cuotas y los pagos anteriores conservan a su titular.</p>:<p className="text-sm text-slate-600">Los registros históricos sin responsable confirmado quedan disponibles para revisión administrativa.</p>}
      <label className="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm font-medium text-slate-800"><input type="checkbox" className="mt-0.5 size-4" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>Confirmo vivienda, personas, fecha efectiva y obligaciones del resumen.</label>
    </div>}
    </div>

    <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 bg-white/95 px-5 py-4 backdrop-blur sm:px-7">
      <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>Cancelar</Button>
      <div className="flex gap-2">{step>0&&<Button type="button" variant="outline" disabled={busy} onClick={()=>{setStep(step-1);setFailure('');setConfirmed(false);}}>Anterior</Button>}{step<3?<Button type="button" disabled={loading} onClick={next}>Continuar</Button>:<Button type="button" disabled={!confirmed||busy} onClick={()=>void save()}>{busy?'Guardando…':'Guardar configuración'}</Button>}</div>
    </div>
  </DialogContent></Dialog>;
}
