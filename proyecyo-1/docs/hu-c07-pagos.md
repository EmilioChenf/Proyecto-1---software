# HU-C07 — Corrección y validación del flujo de pagos electrónicos

> Como Residente, quiero que el pago electrónico sea idempotente y consistente ante rechazos o interrupciones, para evitar cobros, saldos o comprobantes duplicados.

La mayor parte del flujo ya estaba implementada y probada desde HU13–HU17 (Recurrente). En el Sprint 10 se verificó cada subtarea contra el código y las suites MySQL, y se corrigió el único hueco encontrado (C07.4 en la vista del inquilino).

| Subtarea | Evidencia en código | Pruebas |
|---|---|---|
| C07.1 Entorno seguro sin producción | `config/recurrenteCheckout.js` exige `RECURRENTE_SANDBOX_ID` con formato `sbx_*`; `recurrenteClient.sandbox()` consulta `/test` y rechaza (`CHECKOUT_SANDBOX_MISMATCH`) si la cuenta no responde `environment: "sandbox"` con ese ID. Todas las filas guardan `ambiente='sandbox'`. Sin credenciales, `CHECKOUT_NOT_CONFIGURED` (nunca se llama al proveedor). | `hu13`: "Sandbox diferente bloquea POST…" |
| C07.2 Secretos | Solo en variables del backend (`.env.example` sin valores, sin prefijo `VITE_`). La clave es una propiedad no enumerable; `safeLogger` redacta secretos, `Authorization` y `X-SECRET-KEY`; los errores al cliente son códigos (`CheckoutError`). El frontend no contiene claves. | `recurrenteCheckout.routes.test.js`, `hu15` ("motivo malicioso… no persiste credenciales") |
| C07.3 Idempotencia backend | `reserve()` bloquea la cuota (`FOR UPDATE`) y admite un solo checkout activo por cuota (`BLOCKING_CHECKOUT_CONDITION`); un reintento reutiliza el mismo checkout (GET) y nunca crea otro POST. Pagos simulados: misma cuota bloqueada y saldo recalculado → el segundo envío responde 409. | `hu13`: "dos intentos concurrentes producen un unico POST y registro"; `simulatedPaymentsService.test.js` |
| C07.4 Botón deshabilitado | Residente: `checkoutInProgress` (ref) + botón deshabilitado durante la redirección. **Inquilino (corregido en Sprint 10):** el botón se reactivaba al redirigir a Recurrente y no había protección contra doble clic síncrono; ahora usa un `ref` y queda deshabilitado mientras navega. | `InquilinoAccountView.payment.test.tsx` (doble clic → un checkout) |
| C07.5 Webhooks idempotentes | `EVENTO_RECURRENTE` con `svix_id` único: un reenvío idéntico responde `duplicate` sin efectos; cuerpo distinto con el mismo ID → 409. `TRANSACCION_RECURRENTE` única por intent/pago; la cuota se bloquea antes de leer pagos. | `hu14`: "replay del mismo svix-id…", "mismo svix-id concurrente aplica exactamente una vez", "dos eventos concurrentes de la misma transaccion aplican un solo PAGO" |
| C07.6 Rechazo / cancelación / interrupción | Un intento fallido o cancelado se registra en `INTENTO_RECURRENTE` sin `PAGO` ni cambio de saldo; cualquier error SQL revierte la transacción completa y el reenvío posterior aplica una sola vez. | `hu15`: "intento persistido, sin PAGO, sin cambio de saldo/cuota/checkout", "rollback después de … conserva saldo y permite reentrega segura"; `hu14`: "fallo SQL en …: rollback completo" |
| C07.7 Estados claros | Checkout: `CREADO → INCIERTO → PENDIENTE → CONFIRMADO / EXPIRADO / FALLIDO`; `recurrenteCheckoutStatus` traduce a `PENDIENTE`, `CONFIRMADO`, `RECHAZADO`, `CANCELADO`, `INCIERTO`… con una sola acción permitida (`CONTINUAR`, `REINTENTAR`, `NINGUNA`). | `recurrenteCheckoutStatus.test.js` |
| C07.8 Sin éxito falso | El regreso desde el checkout muestra "pendiente de verificación" y consulta al servidor; solo `CONFIRMADO` (tras webhook firmado) se presenta como pago confirmado. Los comprobantes solo listan `CONFIRMADO`. El pago simulado del inquilino muestra el éxito solo con el comprobante devuelto por el servidor. | `ResidentePaymentReturnView` tests, `InquilinoAccountView.payment.test.tsx` |
| C07.9 Pruebas | Doble envío, rechazo, interrupción, reintento y webhook duplicado. | `npm run test:hu13:mysql` (27), `test:hu14:mysql` (74), `test:hu15:mysql` (54), unitarias en `npm test` |

```bash
cd backend
RUN_PHASE0_MYSQL_TESTS=1 PHASE0_TEST_DATABASE=<base nexus_phase0_test_*> PHASE0_TEST_PORT=<puerto> npm run test:hu13:mysql
# igual para test:hu14:mysql y test:hu15:mysql
cd ../frontend && npx vitest run src/views/InquilinoAccountView.payment.test.tsx
```

No se ejecutó un checkout contra la pasarela real: requiere credenciales Sandbox de Recurrente que no están en el repositorio (y no deben estarlo). Las suites usan un cliente simulado con las mismas respuestas del contrato.
