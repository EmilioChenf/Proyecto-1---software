import * as React from 'react';
import * as Primitive from '@radix-ui/react-dialog';
import {X} from 'lucide-react';
import {cn} from './utils';
export const Dialog=Primitive.Root;
// Las alertas de SweetAlert2 se abren encima de esta ventana: un clic en ellas no debe
// contarse como "clic afuera" (que cerraria la ventana) ni quedar bloqueado.
type OutsideEvent={target:EventTarget|null;preventDefault:()=>void};
const fromAlert=(event:OutsideEvent)=>event.target instanceof Element&&Boolean(event.target.closest('.swal2-container'));
function keepWhenAlert<E extends OutsideEvent>(handler?:(event:E)=>void){return (event:E)=>{if(fromAlert(event)){event.preventDefault();return;}handler?.(event);};}
export const DialogContent=React.forwardRef<React.ElementRef<typeof Primitive.Content>,React.ComponentPropsWithoutRef<typeof Primitive.Content>>(({className,children,onPointerDownOutside,onInteractOutside,onFocusOutside,...props},ref)=><Primitive.Portal><Primitive.Overlay className="fixed inset-0 z-50 bg-black/50"/><Primitive.Content ref={ref} className={cn('fixed left-1/2 top-1/2 z-50 grid -translate-x-1/2 -translate-y-1/2 gap-4 rounded-xl border bg-background p-6 shadow-lg',className)} onPointerDownOutside={keepWhenAlert(onPointerDownOutside)} onInteractOutside={keepWhenAlert(onInteractOutside)} onFocusOutside={keepWhenAlert(onFocusOutside)} {...props}>{children}<Primitive.Close className="absolute right-3 top-3 rounded p-1 opacity-70 hover:opacity-100 focus-visible:ring-2 focus-visible:ring-ring"><X className="size-4"/><span className="sr-only">Cerrar</span></Primitive.Close></Primitive.Content></Primitive.Portal>);
DialogContent.displayName='DialogContent';
export const DialogHeader=({className,...props}:React.HTMLAttributes<HTMLDivElement>)=><div className={cn('space-y-2 pr-7',className)} {...props}/>;
export const DialogTitle=Primitive.Title;
export const DialogDescription=Primitive.Description;
