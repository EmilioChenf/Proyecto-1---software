import Swal from "sweetalert2";

// Todas las ventanas de SweetAlert2 de la aplicacion (resultados de acciones,
// confirmaciones y prompts) pasan por esta cola: se muestran de una en una, asi un
// aviso nunca cierra una confirmacion abierta ni dos avisos se pisan entre si.

export const ALERT_COLORS = {
  confirm: "#16A34A",
  cancel: "#DC2626",
};

// heightAuto:false evita que SweetAlert2 fuerce height:auto en html/body, lo que
// rompe los layouts con min-h-screen y el sidebar fijo.
export const modal = Swal.mixin({
  heightAuto: false,
  returnFocus: true,
  confirmButtonColor: ALERT_COLORS.confirm,
  cancelButtonColor: ALERT_COLORS.cancel,
});

let chain: Promise<unknown> = Promise.resolve();

/** Abre una ventana cuando termine la anterior y devuelve su resultado. */
export function enqueueModal<T>(open: () => Promise<T>): Promise<T> {
  const run = chain.then(open, open);
  chain = run.catch(() => undefined);
  return run;
}
