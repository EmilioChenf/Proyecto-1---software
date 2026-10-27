# Sprint 10 — Auditoría de las 8 historias y 84 subtareas

Fuente: los CSV de Jira del Sprint 10 (`Summary`/`Description` de cada subtarea) contra `main` en `800cb81`. Cada subtarea se comprobó en el código (frontend, API, servicio, esquema) y con pruebas que ejercitan el flujo; no se marcó nada por la existencia de un commit o un archivo.

Estados iniciales: **IMPL** implementada · **PARCIAL** · **NO IMPL** · **FALLANDO** (implementada pero fallando). Estado final de las 84: implementada y verificada.

## Resumen

| Historia | Subtareas | IMPL | PARCIAL | NO IMPL | FALLANDO | Corregidas en el Sprint 10 |
|---|---:|---:|---:|---:|---:|---:|
| HU-C01 Autenticación y seguridad | 7 | 6 | 1 | 0 | 0 | 1 |
| HU-C02 Interfaz, navegación y validación | 9 | 8 | 1 | 0 | 0 | 1 |
| HU-C03 Visitantes frecuentes y visitas | 12 | 3 | 8 | 0 | 1 | 9 |
| HU-C04 Accesos e historial | 7 | 0 | 4 | 3 | 0 | 7 |
| HU-C05 Amenidades y reservas | 12 | 2 | 2 | 7 | 1 | 10 |
| HU-C06 Proveedores | 9 | 9 | 0 | 0 | 0 | 0 |
| HU-C07 Pagos electrónicos | 9 | 8 | 1 | 0 | 0 | 1 |
| HU-C08 Guardias y Administradores | 19 | 14 | 0 | 0 | 5 | 5 |
| **Total** | **84** | **50** | **17** | **10** | **7** | **34** |

## HU-C01 — Autenticación y seguridad

| Subtarea | Inicial | Evidencia |
|---|---|---|
| C01.1 Cambiar contraseña propia | IMPL | `POST /auth/password/change`, `ChangePasswordCard` en `/<rol>/sesiones` |
| C01.2 Actual, nueva y confirmación | IMPL | `validateChangePayload`, formulario con los tres campos |
| C01.3 Reglas y mensajes | IMPL | `PASSWORD_POLICY`, `PASSWORD_CONFIRMATION_MISMATCH`, `errores[]` por campo |
| C01.4 Revocar/renovar sesiones | IMPL | revoca todas las sesiones y emite token nuevo bajo bloqueo; `huc01` 14/14 |
| C01.5 Rate limiting en POST sensibles | PARCIAL → corregida | solo había límites en 4 POST de autenticación; se agregaron formulario público, inicio de pagos y garita (`securityRateLimits.js`) |
| C01.6 Límites y respuestas consistentes | IMPL (ampliada) | 429 `RATE_LIMITED` con `Retry-After`; en garita solo cuentan lecturas rechazadas |
| C01.7 Pruebas | IMPL (ampliada) | `authSecurity.test.js` (7 grupos de POST), `huc01.mysql.test.js` |

## HU-C02 — Interfaz, navegación y mensajes

| Subtarea | Inicial | Evidencia |
|---|---|---|
| C02.1/C02.2 Sidebar sin duplicados, un control | IMPL | capa CSS de `.nd-collapse`; `adminTheme.layers.test.ts`, `sidebarControls.test.tsx` |
| C02.3 SweetAlert2 | IMPL | `utils/feedback.ts` (se agregó el tono `info` que usaban C03/C06 y no estaba soportado) |
| C02.4/C02.5 Validación visible e inválidos marcados | IMPL | `Input aria-invalid`, `FieldError`, `UserFormModal` |
| C02.6 Mensajes estandarizados | IMPL | `getErrorMessage`/`sanitizeErrorMessage`, códigos estables |
| C02.7/C02.8 Verificación y zoom | IMPL | `ui-responsive-check.mjs`, `ui-feedback-check.mjs` |
| C02.9 Repetir REG-UI-03/04 con evidencia | PARCIAL → corregida | re-ejecutadas en Chromium: 32/32 y 16/16; `hu-c02-evidencias/sprint10/` |

## HU-C03 — Visitantes frecuentes y registro de visitas

| Subtarea | Inicial | Evidencia final |
|---|---|---|
| C03.1 DPI obligatorio y formato | PARCIAL (DPI opcional) | `VISITOR_DOCUMENT_REQUIRED` en `/visitas` (VISITA) y en la edición; validación en ambos asistentes |
| C03.2 Detectar existente y alertar | FALLANDO | la UI leía `error.code/existing` (inexistentes en `ApiError`) y la API no enviaba `existing`; ahora confirmación SweetAlert2 con el visitante |
| C03.3 Sin sobrescritura silenciosa | PARCIAL | 409 `VISITOR_DATA_CONFLICT` y actualización solo con `confirmar_actualizacion` (residente e inquilino) |
| C03.4 Edición explícita | PARCIAL (solo residente) | edición también para inquilino; DPI obligatorio y único (`VISITOR_DPI_IN_USE`) |
| C03.5 Confirmar acceso rápido (visitante, vivienda, vigencia) | PARCIAL (sin vivienda; inquilino sin confirmación) | confirmación con los tres datos en ambos roles; `casa` en `/visitantes-frecuentes` |
| C03.6 Desactivación lógica | IMPL | `VISITANTE.activo`; ahora considera también lecturas de QR y estados usados |
| C03.7 Conservar historial | PARCIAL | la UI ocultaba sus visitas al desactivar; autorizarlo de nuevo no lo reactivaba |
| C03.8 Sin visitas equivalentes | IMPL | `DUPLICATE_VISIT` |
| C03.9 Sin dos QR válidos | PARCIAL (carrera con DPI nuevo) | bloqueo por vivienda en `createVisit`; 3 envíos simultáneos → 1 QR |
| C03.10 Mensaje claro | IMPL | mensaje del backend; la prueba usaba una forma de error irreal y se corrigió |
| C03.11 Pruebas | PARCIAL | `sprint10.mysql.test.js` (duplicidad, edición, desactivación, integridad) |
| C03.12 Repetir y conservar evidencia | PARCIAL | `sprint10-evidencias/` con la salida de las suites |

## HU-C04 — Accesos y preservación del historial

| Subtarea | Inicial | Evidencia final |
|---|---|---|
| C04.1 Sin borrado físico con entrada/salida | NO IMPL (`DELETE` borraba `REGISTRO_ACCESO`) | 409 `VISIT_IN_PROGRESS` con el visitante adentro; eliminación lógica si hay movimientos o lecturas |
| C04.2 Cancelación/desactivación lógica | NO IMPL | `ACCESO.eliminado_en/id_usuario_elimina`, `cancelado_en/id_usuario_cancela`, auditoría `VISIT_ARCHIVED`/`VISIT_CANCELLED` |
| C04.3 Conservar visitante, vivienda, timestamps, guardia y estados | PARCIAL | cancelar ya no reescribe `SALIDA_REGISTRADA` (`VISIT_ALREADY_FINISHED`); la prueba compara la fila antes y después |
| C04.4 QR cancelado/vencido no reutilizable | PARCIAL (carrera cancelación/ingreso) | cancelación condicional al estado; 410 `ACCESS_CANCELLED`/`QR_EXPIRED` comprobados en MySQL |
| C04.5 Mostrar cancelado/vencido sin perder movimientos | PARCIAL (admin mostraba "Rechazado") | `estado_detalle`, `hora_ingreso`, quién canceló; ingreso/salida visibles para residente e inquilino |
| C04.6 Relaciones sin cascada | PARCIAL | FK sin `CASCADE` verificadas en `INFORMATION_SCHEMA`; nuevas referencias `ON DELETE SET NULL` |
| C04.7 Pruebas antes/después de entrada/salida | NO IMPL | `sprint10.mysql.test.js` |

## HU-C05 — Amenidades y reservas

| Subtarea | Inicial | Evidencia final |
|---|---|---|
| C05.1 Error visible al reservar en el pasado | PARCIAL (alerta al inicio de la página) | bloques pasados deshabilitados, aviso de fecha pasada y notificación flotante; `RESERVATION_IN_PAST` |
| C05.2 No guardar vencidas | IMPL | `validateReservationRange` |
| C05.3 Registrar qué cambió | PARCIAL (detalle genérico) | detalle "amenidad/fecha/horario anterior → nuevo", amenidad nueva y rol |
| C05.4 Cancelación desde Administrador | NO IMPL | `PATCH /admin/reservas/amenidades/:key/cancelar` + botón con motivo |
| C05.5 Quién, cuándo y motivo | NO IMPL | `RESERVA.cancelada_por/cancelada_en/motivo_cancelacion`, historial |
| C05.6 Reflejar en la cuenta del usuario | NO IMPL | historial del residente/inquilino + notificación `RESERVA_CANCELADA` |
| C05.7 Calendario sin canceladas como ocupación | FALLANDO | el calendario y los indicadores contaban canceladas; ahora se muestran aparte |
| C05.8 Liberar el horario | IMPL | disponibilidad/conflictos ignoran canceladas; otra persona reserva el bloque en la prueba |
| C05.9 Admin que creó en nombre de otro | NO IMPL | `RESERVA.creada_por`, `CREACION_ADMIN` en historial |
| C05.10 Confirmación al reservar en nombre de otro | NO IMPL | confirmación con usuario, unidad, amenidad y horario |
| C05.11 Auditoría | NO IMPL | `RESERVATION_CREATED/UPDATED/CANCELLED` en `AUDITORIA` |
| C05.12 Pruebas de permisos | NO IMPL | `app.routes.test.js` y `sprint10.mysql.test.js` (403 residente/inquilino/guardia, 401 sin sesión, 404 reserva ajena) |

## HU-C06 — Proveedores

Las 9 subtareas estaban implementadas (commits del 26-10) y se verificaron: registro por admin/residente/inquilino con guardas alineadas (`app.routes.test.js`), placa en vehículo y DPI a pie (`providerAccessValidation`), sin registros sin identificador, fechas pasadas bloqueadas y sin QR vencido (`visitWindow.js`), mensajes junto al campo (`ProviderRegistrationForm`) y pruebas por rol, identificador, fecha y QR (`providers.huc06.test.js`, `providerRegistration.huc06.test.js`). Detalle en `hu-c06-proveedores.md`.

## HU-C07 — Pagos electrónicos

8 de 9 implementadas desde HU13–HU17; C07.4 era parcial en la vista del inquilino (el botón se reactivaba durante la redirección). Detalle y evidencia por subtarea en `hu-c07-pagos.md`.

## HU-C08 — Guardias y Administradores

La funcionalidad de las 19 subtareas estaba implementada (`hu-c08-guardias-administradores.md`), pero **las pruebas C08.14–C08.18 fallaban**: el fixture creaba visitas con inicio 60 minutos en el pasado, que la regla de HU-C06.6 rechaza. Se corrigió el fixture (sin cambiar aserciones): `huc08` 9/9. Sin filtros por administrador creador ni referencias a NeuroLab en código, SQL o semillas.

## Pruebas del Sprint 10

```bash
cd backend && npm test                              # unitarias y de rutas, sin BD
RUN_PHASE0_MYSQL_TESTS=1 PHASE0_TEST_DATABASE=<base nexus_phase0_test_*> PHASE0_TEST_PORT=<puerto> npm run test:sprint10:mysql
# igual: test:huc01:mysql, test:huc08:mysql, test:hu13..hu15:mysql
cd ../frontend && npx vitest run && npm run build
```

### Resultados y suites ajustadas

Resultados completos en `sprint10-evidencias/suites-mysql.txt` (con la comparación contra `main` original) y la salida TAP de `sprint10` y `huc08`.

Datos de entrada de pruebas existentes que dejaron de ser válidos con las reglas del sprint (no se cambió ninguna aserción):

- `huc08`: ventanas que empezaban 60 min en el pasado (C06.6) → empiezan en el minuto actual. Antes 2/9, ahora 9/9.
- `finalaudit`: el helper `visit()` creaba visitas sin DPI (C03.1) y con inicio a las 00:00/12:00 (C06.6); R3-F registraba dos nombres con la misma placa sin la confirmación de C03.3. Antes 12/19 en `main`, ahora 18/19.
- `postaudit`: dos visitas sin DPI (C03.1). 16/16.
- `providers.huc06.test.js` y `providerAccess.test.ts` afirmaban que una VISITA sin DPI era válida, lo contrario de C03.1.

Fallas preexistentes de entorno (idénticas en `main` original): `hu18` #63 y `finalaudit` #19 necesitan la evidencia manual de Recurrente (transacciones 486/937, un checkout previo) de la base compartida del equipo; `hu19` #49 restaura un respaldo con recordatorios cuyas cuotas no existen en una base limpia; `hu16`/`hu17` no arrancan sin esa evidencia y `integration`/`regression` requieren `tarea5.mysql.test.js`, no versionado.
