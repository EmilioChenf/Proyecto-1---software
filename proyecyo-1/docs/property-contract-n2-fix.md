# Corrección N2: pagos y comprobantes históricos

Fecha: 2026-10-12 (America/Guatemala).
Resultado: **APTO PARA RE-AUDITORÍA FINAL**.

## A. Git y alcance

Rama exclusiva: `feature/property-contract-billing`. Antes de editar se ejecutó
`git fetch origin`; HEAD local y remoto coincidían con
`825883625a1fd894d6085d5ea5a9af77f3b22add`, con worktree limpio.
`origin/main` permaneció en `7874d29bdaa3beb99b6fad34261740036d63ced0`.
El código y las pruebas de esta corrección están en
`274ade437540aa771bec99fa4e01bb6e0b3404b5`; este documento se registra aparte.
No se cambió de rama, se tocaron otros worktrees, stash, main, Railway o producción.

## B. BEFORE reproducible

Las pruebas nuevas se ejecutaron antes de cambiar la aplicación. Para cerrar
la comparación se repitieron las 22 pruebas definitivas contra una copia
temporal del HEAD auditado, sin crear ni modificar otro worktree de Git.
Resultado: **6 PASS, 16 FAIL, 0 SKIP, 0 CANCELLED**.

El escenario de upgrade guardó un pago Q123 del 2025-09-09 y una transacción
simulada cuyo usuario era Juan. María ya era la residente actual. Ambos tenían
registros RESIDENTE; un tercero y un administrador sirvieron de controles.
Tras aplicar 009/010 y crear sesiones reales:

| Usuario | JSON BEFORE | PDF BEFORE | Detalle personal BEFORE |
|---|---:|---:|---|
| Juan | 200, titular Juan | 200 | 404; perdió acceso a su historial |
| María | 200, titular María | 200 | Incluía el pago de Juan |
| Tercero | 404 | 404 | Sin acceso al pago |
| Admin | 403 en ruta residencial | 403 | Reporte administrativo 200, pago presente |

SHA-256 de la misma prueba en BEFORE y AFTER:
`365c520ad4dc23be96d11718dcc59dab7c33f0c0a1f38435e5b27f33c4ba1796`.
El blob del servicio de recibos de la copia BEFORE coincide con el del HEAD
auditado: `81d1c15340f1c0cdfc70f268df22503a77aedc25`.

## C. Causa raíz

`paymentReceiptService.receiptRows` tenía un OR que admitía al residente
actual de una casa legada aunque la transacción identificara a otro pagador.
El nombre/correo del solicitante se utilizaba para reconstruir al titular.
El detalle personal legado consultaba por casa actual y no recuperaba la
casa histórica del pagador anterior. El estado de cuenta y la autorización de
cuotas repetían la compatibilidad por ocupación sin descartar evidencia ajena.
La cuenta contractual también buscaba pagos/reembolsos por responsable de la
cuota, omitiendo pagos legados con actor conocido y responsable NULL.

## D. Autorización implementada

`paymentHistoricalActor.js` centraliza la evidencia financiera histórica:

1. Actor explícito del pago o ID del snapshot del pago.
2. Usuario de la transacción Recurrente aplicada y vinculada al pago/cuota/casa.
3. Usuario de la transacción simulada vinculada al pago/casa.
4. Responsable almacenado de la cuota o ID de su snapshot.
5. Sin identidad confiable: NULL; no se concede acceso personal al comprobante.

JSON, PDF y listado de recibos usan esa misma identidad. La ruta de transacción
conserva su permiso por usuario almacenado y vuelve a validar el comprobante.
Una referencia o un ID recibido del cliente no reemplaza la identidad autenticada.

Las cuotas conservan su responsable explícito. En cuotas legadas sin él,
solo se utiliza un actor de pagos si la evidencia conocida coincide. La
compatibilidad operativa por residente actual permanece únicamente donde no
existe evidencia histórica conocida; nunca amplía acceso a un pago ajeno.
La evidencia contradictoria bloquea ese fallback.

## E. Titular del comprobante

Se conserva primero el snapshot del pago. El snapshot de la cuota solo aporta
el nombre cuando corresponde a la identidad resuelta. Después se utiliza el
usuario histórico almacenado; la alternativa desconocida es
`Responsable no confirmado`. El solicitante no aporta nombre ni correo.
Monto, fecha, cuota, concepto y casa se obtienen de las relaciones contables
almacenadas. Se mantienen la validación de confirmación Recurrente y su allowlist.

## F. Detalle financiero personal y accesos equivalentes

Los pagos y reembolsos personales se filtran por el actor histórico en los
caminos legado y contractual, independientemente de la vivienda ocupada hoy.
El perfil y el detalle pueden recuperar la vivienda de un pago propio anterior.
Cuotas y recargos usan el permiso histórico correspondiente.

La misma protección se aplica al estado de cuenta, pago simulado, inicio de
checkout y destinatarios de recordatorios. Se conservan los cálculos de saldo
con todos los abonos y las fechas de los movimientos; no se prorratea ni se
recalcula un hecho histórico con datos del nuevo ocupante.

## G. Pagos legados

El pago legado de Juan sigue teniendo responsable/snapshots/id_actor NULL:
su usuario ya conocido en TRANSACCION_SIMULADA basta para autorizarlo.
No hay migración nueva, columnas redundantes ni backfill especulativo.

## H. Pagos nuevos

Los pagos del modelo nuevo conservan actor/snapshot. Una venta, nuevo contrato,
fin de renta, cambio de residente, nombre del comprador o casa sin ocupante no
cambian retrospectivamente la autorización ni el titular del pago anterior.

## I. Matriz de privacidad comprobada

| Identidad / situación | Resultado |
|---|---|
| Pagador histórico conocido | JSON/PDF propios e historial permitidos |
| Residente actual diferente | JSON/PDF ajenos 404; pago, cuota atribuida y reembolso ajenos excluidos |
| Comprador nuevo después de venta real | No recibe comprobante ni pago del vendedor |
| Expropietario/pagador | Conserva comprobante e historial propios |
| Inquilino privado | Q0, sin pagos ni PDF del propietario |
| Arrendatario directo, residente NULL | PDF e historial propios; conserva acceso al terminar el contrato |
| Usuario de otra vivienda | No accede por ID/URL ni obtiene movimientos ajenos |
| Administrador | Reportes completos y exportaciones legítimas; ruta residencial continúa en 403 |
| Actor desconocido | No se inventa identidad ni permiso personal; fila administrativa preservada con etiqueta desconocida |
| Pago del modelo nuevo | Snapshot propio estable después de venta y cambio de nombre del comprador |

La ruta JSON residencial no se amplió a inquilinos o administradores.

## J. IDOR y cambios posteriores

Se probaron IDs de pagos/comprobantes válidos ajenos e inexistentes, URL y PDF
directos, query `id_usuario`/`id_casa`/`paymentId`/`role`, body de pago simulado
con identidad y rol falsificados, acceso sin sesión y exportaciones administrativas.
La autorización ocurrió en servicios/backend mediante sesiones reales.

Además se hicieron cuatro lecturas concurrentes por cada cambio de ocupante,
incluyendo residente NULL. Venta y cierre de renta se ejecutaron mediante el
servicio real de contratos, pago de deuda y activación efectiva.

## K. Upgrade real

La regresión crea una base restaurada con dueño UUID, prepara el esquema
anterior a property-contract-billing y aplica las migraciones reales.
Conserva los campos originales de USUARIO, RESIDENTE, CASA, CUOTA, PAGO,
TRANSACCION_SIMULADA y PAGO_ORIGEN. Las nuevas atribuciones permanecen NULL.

| Usuario | JSON AFTER | PDF AFTER | Detalle personal AFTER |
|---|---:|---:|---|
| Juan | 200, titular Juan | 200, PDF válido | 200; incluye Q123 |
| María | 404 | 404 | 200; excluye pago y cuota atribuida a Juan |
| Tercero | 404 | 404 | Sin pago ajeno |
| Admin | 403 en ruta residencial | 403 | Reporte administrativo 200, pago presente |

## L. PDF y exportaciones

Se verificaron PDFs reales, cabecera `%PDF` y texto del titular; una denegación
no devuelve datos parciales. Los reportes administrativos mantienen todas las
filas contables. Sus nombres históricos conocidos no se sustituyen por el
residente actual; los desconocidos pagados conservan la incertidumbre.
PDF/XLSX administrativos siguen autorizados para admin y prohibidos a roles
residenciales. No existe una ruta personal XLSX de pagos que habilitar o ampliar.

## M. H1–H9

Property (54), Post-audit (16) y frontend (449): PASS. Se conservan las
regresiones H1–H9, incluida H3 sobre actor histórico de sanciones. No se
modificaron la semántica de sanciones ni el bug separado de horarios de visita.
WebGL, 3D y responsive no se tocaron.

## N. R1–R3

Final-audit (19) y frontend (449): PASS. Se conservan las regresiones R1–R3;
R3 mantiene el actor histórico de accesos. No se cambió esa semántica.

## O. N1

N1: 8 PASS, 0 FAIL, 0 SKIP, 0 CANCELLED. Se conserva el actor histórico o
desconocido de sanciones, incluidos sus reportes y exportaciones.

## P. Suites completas y conteos definitivos

Conteos extraídos de los logs definitivos, sin sumar reintentos ni duplicar
las ejecuciones adicionales en Node 20:

| Grupo | PASS | FAIL | SKIP | CANCELLED |
|---|---:|---:|---:|---:|
| Frontend | 449 | 0 | 0 | 0 |
| Backend node:test | 92 | 0 | 0 | 0 |
| Backend Jest | 816 | 0 | 0 | 0 |
| Property | 54 | 0 | 0 | 0 |
| Post-audit | 16 | 0 | 0 | 0 |
| Final-audit | 19 | 0 | 0 | 0 |
| N1 | 8 | 0 | 0 | 0 |
| N2, nuevas | 22 | 0 | 0 | 0 |
| Otras integraciones MySQL | 427 | 0 | 0 | 0 |
| Funcionales | 12 | 0 | 0 | 0 |
| **TOTAL** | **1915** | **0** | **0** | **0** |

Desglose de las otras integraciones MySQL: Phase 0 25; HU13 27; HU14 74;
HU15 54; HU16 30; HU17 23; HU18 64; HU19 51; HU32 10; viviendas 19;
correlation 33; precision 17. Todos PASS y sin omitidas/canceladas.

N2 definitivo: BEFORE 6 PASS / 16 FAIL; AFTER 22 PASS / 0 FAIL. Se agregó
una suite de 22 pruebas a la referencia anterior de 1893; el total también
se calculó directamente de los resultados, sin asumirlo por diferencia.
Los runners confirmaron `sharedCountsAndEvidenceUnchanged` y retiraron sus
bases clonadas. El servidor temporal completo se retiró al finalizar.

La fixture de Phase 0 declara ahora al pagador 3 que representan sus casos
personales: sus expectativas de importes, fechas, saldos y recibos no cambiaron.
Los pagos sin actor siguen cubiertos separadamente por N2 y no se autorizan por
ocupación. La aserción SQL de recordatorios conserva la misma igualdad con los
operandos invertidos y añade comprobaciones del guard histórico.

No se eliminaron pruebas ni se convirtieron fallas en omitidas. Los scripts
Tarea5/integration/regression/demo apuntan a archivos ausentes y no se cuentan.

## Q. Node 20, build y diff

Runtime verificado: **Node v20.20.2**, dependencias instaladas con
`npm ci --no-audit --no-fund`, MySQL temporal separado. Batería crítica:
Property 54, Post-audit 16, Final-audit 19, N1 8 y N2 22:
**119 PASS, 0 FAIL, 0 SKIP, 0 CANCELLED**. Los cinco comandos terminaron en 0.
La ejecución completa principal usó Node v22.12.0. Las repeticiones en Node 20
no se sumaron al total de 1915.

Build de producción mediante `npm run build`: PASS, 2476 módulos, artefactos
fuera del repositorio mediante `-- --outDir` temporal. La advertencia de chunks
grandes permanece informativa.
`git diff --check` y `git diff origin/main...HEAD --check`: PASS.
Sin cambios de dependencias, lockfiles, Dockerfile o despliegue.

## R. Archivos modificados (17)

Rutas relativas a `proyecyo-1/`:

- `backend/src/services/paymentHistoricalActor.js` (nuevo).
- `backend/src/services/paymentReceiptService.js`.
- `backend/src/services/residentFinancialDetailService.js`.
- `backend/src/services/residentAccountService.js`.
- `backend/src/services/contractFinancialAccount.js`.
- `backend/src/services/simulatedPaymentsService.js`.
- `backend/src/services/recurrenteCheckoutService.js`.
- `backend/src/services/financialNotificationsService.js`.
- `backend/src/services/adminPaymentsService.js`.
- `backend/src/services/reportExportService.js`.
- `backend/test/integration/n2.mysql.test.js` (nuevo).
- `backend/test/integration/support/n2UpgradeProbe.js` (nuevo).
- `backend/test/integration/phase0.mysql.test.js`.
- `backend/src/services/__tests__/paymentRemindersRecipients.test.js`.
- `backend/scripts/run-isolated-tests.js`.
- `backend/package.json`: registro de `test:n2:mysql`.
- `docs/property-contract-n2-fix.md`: este informe.

## S. Commits

- `7a4af685` — fix: isolate historical payment receipts by payer.
- `4abd6cf5` — fix: scope financial history to stored historical actors.
- `274ade43` — test: cover legacy payment ownership and real upgrade access.
- Commit documental que contiene este informe: docs: record N2 fix and regression evidence.

## T. Búsqueda dirigida, límites y evidencia

Se revisaron recibos JSON/PDF/listados/transacción, cuentas y detalle personal,
pagos simulados, checkout/status/retry, notificaciones, reportes, exportaciones,
conciliación y reembolsos. Los caminos personales restantes usan identidad
almacenada; los administrativos conservan sus guards. No se demostró otro
escape equivalente pendiente de N2. El helper de sanciones no se fuerza sobre
pagos: estos tienen evidencia adicional en pago y transacciones.

Las primeras ejecuciones exploratorias detectaron fixtures incompletas y
contención del bloqueo global de migración entre suites. Se conservaron esos
logs, se corrigió la preparación y se repitieron las afectadas; Node 20 usa su
propio servidor temporal. No se cambió el bloqueo ni ninguna migración del producto.

Evidencia fuera del repositorio:
`%TEMP%/nexus-n2-fix-20261012-7be4d190/`, incluyendo BEFORE/AFTER, JSON del
upgrade, hashes, logs completos, conteos, build y revisión de procedencia.
Solo se usaron datos sintéticos y MySQL desechable. No se llamó al proveedor real.

Los dos servidores MySQL, el contenedor Node 20 y su sonda de versión propios
se retiraron. Se verificó que los seis contenedores preexistentes conservaran
IDs, nombres y puertos. Se retiró solo la junction de dependencias de la copia
BEFORE, sin eliminar las dependencias originales ni los archivos de evidencia.

No se agregaron DDL, backfills, credenciales, URLs locales en producción,
logs de depuración o importaciones de pruebas en servicios. La revisión dirigida
de esos patrones no encontró casos nuevos. Los scripts de infraestructura
ausente se registraron como no disponibles y no cuentan como pruebas ejecutadas.

**APTO PARA RE-AUDITORÍA FINAL**. Esta clasificación se limita a la corrección
N2 y a las verificaciones automatizadas descritas. No se realizó merge,
despliegue ni validación manual.
