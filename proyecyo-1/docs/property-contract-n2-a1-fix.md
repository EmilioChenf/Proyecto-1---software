# Corrección quirúrgica N2-A1: atribución histórica en /admin/pagos

Fecha: 2026-10-13, America/Guatemala.
Estado: corrección y validación completadas.

## A. Git inicial

`git fetch origin` ejecutado antes de editar. Rama exclusiva:
`feature/property-contract-billing`. HEAD local/remoto inicial:
`0151b93ef364723b33d324ac7ffad3aae34c8192`; worktree limpio.
`origin/main`: `7874d29bdaa3beb99b6fad34261740036d63ced0`.
No se cambiaron main, stash u otros worktrees ni se hicieron operaciones
destructivas de Git. No se accedió a Railway, producción o bases reales.

## B. Reproducción BEFORE

Se creó primero la regresión que fallaba antes de modificar el servicio.
La batería definitiva de 21 casos se volvió a ejecutar contra una copia
temporal del HEAD original, sin crear ni tocar worktrees de Git.
BEFORE: **5 PASS, 16 FAIL, 0 SKIP, 0 CANCELLED**.
Incluye las cuatro fallas obligatorias: Juan, María→Pedro, search y desconocido.

El blob del servicio durante BEFORE coincidía con el del HEAD inicial:
`831ac89985a94c263187f52c56496733bd13e87d`.
La copia temporal recibió únicamente el runner y la infraestructura de pruebas
definitiva; los servicios de producto conservaron el código original.
SHA-256 de la prueba ejecutada antes y después:
`e38fc5ea2002ecae080d0b54818a563ce06df1fe370243af9b8a5c8b613e4255`.

## C. Causa raíz

`adminPaymentsService.listDelinquentResidents` agrupaba por el responsable
explícito de CUOTA. Si era NULL, tanto el nombre como el correo recurrían al
RESIDENTE actual de CASA. El filtro search consumía ese nombre reconstruido.
Así, Q200 menos Q123 de Juan producía Q77 atribuidos a María/Pedro, mientras
otras superficies ya resolvían a Juan mediante la transacción histórica.

## D. Regla histórica aplicada

Se reutiliza **sin modificar** `paymentHistoricalActor.quotaActorSql`:

1. CUOTA.id_responsable.
2. ID del snapshot de responsable de CUOTA.
3. Actor histórico de los pagos de esa cuota, únicamente si sus actores
   conocidos coinciden. Ese actor de pago ya resuelve id_actor, snapshot,
   transacción Recurrente vinculada, transacción simulada y evidencia de cuota.
4. Si no hay actor inequívoco, NULL.

El listado agrega los saldos canónicos por casa + actor histórico resuelto.
Los cálculos de capital, recargos, reembolsos, sobrepagos y vencimiento siguen
siendo los mismos. Nombre/correo priorizan el snapshot de cuota y luego el
USUARIO de ese actor. Sin confirmación: `Responsable no confirmado`, correo
NULL e ID NULL. No se usa al solicitante ni al ocupante para atribuir deuda.
`propietario_actual` sigue siendo metadato explícito de ocupación y no participa
en el responsable financiero o su búsqueda.

## E. Caso Juan

AFTER: Q77, nombre Juan, correo de Juan e id_responsable resuelto a Juan.
El pago histórico Q123 y la cuota Q200 permanecen almacenados sin cambios.
No se hace backfill; el actor se resuelve al consultar.

## F. María / Pedro / NULL

Se cambia únicamente CASA.id_residente entre María, Pedro y NULL. El listado
conserva Juan, su correo/ID y Q77 en los tres estados. El metadato
propietario_actual refleja el ocupante actual por separado.

## G. Actor desconocido

La cuota/pago sin responsable, snapshots, actor o transacción atribuible
conserva su saldo y su fila, con `Responsable no confirmado`, correo/ID NULL.
María→Pedro→NULL no altera esa atribución. Una cuota sin pagos/evidencia tampoco
inventa responsable en `/admin/pagos`. No se borran relaciones o movimientos.

## H. Responsable explícito

CUOTA.id_responsable y su snapshot conservan prioridad frente a abonos hechos
por otras personas. Un snapshot con ID resuelve nombre/correo/ID aunque la
columna id_responsable esté NULL. Compra financiada, renta directa y propiedad
privada conservan sus responsables explícitos y mantenimiento, incluso con
otro residente actual y después de pagar las cuotas mediante el servicio real.

## I. Múltiples pagos

Q300 con Q50 + Q100 del mismo actor: Juan, saldo Q150.
Q300 con Q50 de Juan + Q100 de Pedro sin responsable/snapshot autoritativo:
`Responsable no confirmado`, ID/correo NULL, saldo Q150.
Con responsable explícito Juan, pagos de María/Pedro no transfieren la deuda.
No se elige primer/último pagador. Cuotas de varios actores de una misma casa
se agrupan separadamente; los saldos no se mezclan entre personas.

## J. Search

Nombre histórico, correo histórico, vivienda y términos parciales con distinta
capitalización: PASS en HTTP. Juan encuentra su deuda; María/Pedro y sus correos
no la encuentran por ocupación. Se conservan LIKE parcial, parámetros SQL,
filtros de estado/fecha y sus validaciones. Se incorpora el correo del actor
histórico al mismo parámetro search solicitado en la matriz, sin nuevo endpoint.

La aserción Jest existente añade esa tercera columna/parámetro de búsqueda;
mantiene las expectativas de nombre y vivienda. No se cambió una expectativa
para aceptar el actor defectuoso ni se redujo la seguridad SQL.

## K. Consistencia con reportes / PDF / XLSX

Para la misma cuota Q200/pago Q123/saldo Q77 se compararon listado admin,
reporte mensual, recibo JSON/PDF, detalle personal, exportación PDF y XLSX real.
Todos los responsables aplicables identifican a Juan. Se validó el contenido
PDF y se leyó la fila XLSX con ExcelJS, no solo sus estados HTTP.
Para el pago realmente desconocido, listado/mensual/exportación conservan la
incertidumbre y el recibo personal no se autoriza por ocupación.
La búsqueda limitada reprodujo una variante de la misma causa: una cuota
legada sin abonos mostraba incertidumbre en el listado corregido, pero María
o Pedro en mensual/exportación. Se retiraron solo esos dos fallbacks, con una
prueba adicional y un probe BEFORE/AFTER de los tres estados de ocupación.
Las ramas ya correctas para pagos conocidos y desconocidos se conservaron,
al igual que los cálculos y los reportes de sanciones/accesos.

## L. N2

N2: **22 PASS, 0 FAIL, 0 SKIP, 0 CANCELLED**. Las 21 pruebas nuevas también verifican
Juan JSON/PDF 200, titular Juan, María JSON/PDF 404 y su historial aislado.
paymentReceiptService, paymentHistoricalActor, paymentAttribution y el detalle
personal permanecen sin cambios de código.

## M. H1–H9

Property: **54 PASS**; Post-audit: **16 PASS**; frontend: **449 PASS**.
Los escenarios H1–H9 permanecen PASS, con cero fallos u omisiones.

## N. R1–R3

Final-audit: **19 PASS**; frontend: **449 PASS**, con cero fallos u omisiones.
Los escenarios R1–R3 permanecen PASS.

## O. N1

N1: **8 PASS, 0 FAIL, 0 SKIP, 0 CANCELLED**.
No se modificó la semántica de sanciones/accesos.

## P. Tests N2-A1

`test:n2a1:mysql`: 21 casos versionados nuevos. Ejecución directa AFTER:
**21 PASS, 0 FAIL, 0 SKIP, 0 CANCELLED** con idéntico SHA-256 a BEFORE.
La matriz incluye servicios, HTTP con sesiones reales, ocupantes, desconocido,
responsable/snapshot, modalidades, múltiples pagos, search, PDF/XLSX y guards.
Solo admin accede a `/admin/pagos`; residente/inquilino/guardia obtienen 403,
sin sesión 401. No se abre una ruta residencial.

Los **9 probes independientes originales** de la re-auditoría terminaron
**9 PASS, 0 FAIL, 0 SKIP, 0 CANCELLED**, con expectativas intactas y adaptando
únicamente puerto/base y datos sintéticos. El probe adicional sin abonos aprobó
las tres superficies
en tres estados de ocupación; no se agrega como test TAP al total versionado.

## Q. Suites completas

Resultado definitivo: **1936 PASS, 0 FAIL, 0 SKIP, 0 CANCELLED**.

| Grupo versionado | PASS |
| --- | ---: |
| Backend node:test | 92 |
| Backend Jest | 816 |
| Frontend | 449 |
| Property | 54 |
| Post-audit | 16 |
| Final-audit | 19 |
| N1 | 8 |
| N2 | 22 |
| N2-A1 | 21 |
| Otras suites MySQL | 427 |
| Funcional | 12 |
| **Total** | **1936** |

Detalle de otras suites MySQL: phase0 25, hu13 27, hu14 74, hu15 54, hu16 30, hu17 23, hu18 64, hu19 51, hu32 10, viviendas 19, correlation 33, precision 17.
Conteos extraídos de los logs, con cada prueba contada una sola vez. N2 y
N2-A1 usan sus repeticiones definitivas tras corregir el lector PDF; HU16 y
HU18 ejecutaron ese lector corregido durante la batería completa. Los demás
consumidores no dependen de ese helper. El código de producto final no cambió
durante estas comprobaciones.

El intento N2-A1 con 20 PASS / 1 FAIL se conserva como evidencia del defecto
del lector; no se oculta ni se suma al resultado definitivo. Los 9 probes
independientes, las ejecuciones BEFORE y las repeticiones de comprobación
no forman parte del total versionado. Tarea5 ausente: no ejecutado/no contado.

## R. Node 20

Runtime verificado: **v20.20.2**. Resultado definitivo:
**140 PASS, 0 FAIL, 0 SKIP, 0 CANCELLED**.

- property: 54 PASS.
- postaudit: 16 PASS.
- n1: 8 PASS.
- n2: 22 PASS.
- n2a1: 21 PASS.
- finalaudit: 19 PASS.

Cada suite se cuenta una vez. El primer intento de preparación de Final-audit
terminó por ETIMEDOUT antes de cualquier test (Docker exit 1); su repetición
completa aprobó 19 casos (Docker exit 0). N2 y N2-A1 se repitieron sobre el
archivo del commit ab0e1500 con el lector PDF definitivo (Docker exit 0).
Property, Post-audit, Final-audit y N1 usan el mismo código de producto final
del commit 8dff5f0e; no dependen del helper de PDF corregido.
Se conservaron ambos archivos de fuentes, logs y códigos de salida.
MySQL fue temporal y separado de la ejecución principal.

## S. Build / diff

Frontend production build: **PASS**, 2476 módulos transformados.
Artefactos en la carpeta temporal frontend-build. La advertencia habitual de
chunks mayores a 500 kB fue informativa y no produjo fallo.

`git diff --check`: **PASS**.
`git diff origin/main...HEAD --check`: **PASS**.
Las verificaciones se repiten al cerrar el commit documental y la publicación.

## T. Archivos modificados

Rutas relativas a `proyecyo-1/`:

- `backend/src/services/adminPaymentsService.js`: listDelinquentResidents y el fallback incorrecto sin abonos de mensual.
- `backend/src/services/reportExportService.js`: el mismo fallback incorrecto en morosos; demás reportes intactos.
- `backend/test/integration/n2a1.mysql.test.js`: 21 casos nuevos.
- `backend/test/integration/support/receiptPdfText.js`: lectura por longitud de bytes para verificar PDFs comprimidos sin truncarlos.
- `backend/src/services/__tests__/adminPaymentsService.test.js`: search incluye correo.
- `backend/scripts/run-isolated-tests.js`: registro de n2a1.
- `backend/package.json`: script test:n2a1:mysql.
- `docs/property-contract-n2-a1-fix.md`: este informe.

Frontend no necesitó cambios: AdminPaymentsView ya muestra propietario_nombre
bajo Responsable financiero y recibe el payload corregido. Sin rediseño,
WebGL, responsive, migración, columnas, backfill, dependencias o lockfiles nuevos.

## U. Commits

- `02b0c2aef58c89e06f8ab3b2102adc26a6ac6505` — fix: resolve delinquent balances by historical actor.
- `73c19ca98b08330d6ccf0987ee092b2694db0477` — test: cover historical admin debt attribution.
- `8dff5f0e0fba8a542b5a2490f494e3011f1a6528` — fix: keep unknown legacy debt actors consistent across reports.
- `ab0e1500b65d15c8cd4fbb8d523f0426adba8cca` — test: read compressed PDF streams by declared byte length.
- Commit documental posterior: docs: record N2-A1 regression evidence.

## V. Búsqueda dirigida

Limitada a adminPaymentsService, helpers financieros que utiliza, reportes
relacionados y AdminPaymentsView. En el listado corregido, el JOIN al residente
solo sirve a propietario_actual; responsable/correo/search usan evidencia
histórica. Los pagos recientes identifican al usuario de la transacción.
Mensual/morosos usan el mismo actor histórico y, si una cuota sin abonos no
permite confirmarlo, preservan la incertidumbre. La única variante adicional
reproducida durante esta búsqueda fue ese fallback sin abonos; se corrigió y
se agregó el caso 21. No se dejó un fallback al ocupante para atribuir la deuda
en estas consultas. No se reprodujo otro caso equivalente pendiente.
No se inició otra auditoría general ni se tocaron dominios ajenos.

## W. Hallazgos / limitaciones

N2-A1 quedó corregido en sus reproducciones versionadas e independientes.
No se declaró ningún hallazgo nuevo sin reproducción. Solo se usaron datos
sintéticos y MySQL desechables, con puertos exclusivos; ningún proveedor real.
La primera conexión al MySQL recién creado perdió el protocolo durante su
arranque; se conservó el log y se repitió la preparación tras quedar listo.
No fue una falla del producto ni se alteraron sus migraciones para resolverla.
Los scripts Tarea5 ausentes no se copiaron ni se cuentan como ejecutados.
La primera validación completa se interrumpió al demostrar la variante sin
abonos; sus logs se conservaron en pre-consistency-run y se reinició toda la
batería con el código de producto definitivo.

En esa ejecución, N2-A1 registró 20 PASS / 1 FAIL por `Z_BUF_ERROR` del lector
PDF de pruebas. Se reprodujo de forma determinista: un stream válido cuyo
último byte es CR perdía ese byte por la expresión regular. El lector ahora
respeta `/Length`; el mismo stream devuelve Juan y la regresión mantiene la
lectura de los PDFs reales. No se modificó el generador PDF ni el producto.
Se conservó el intento fallido y se repitieron BEFORE/AFTER y los consumidores
afectados. Las repeticiones se cuentan una sola vez en el resultado definitivo.

Node 20 tuvo un `ETIMEDOUT` al preparar Final-audit antes de ejecutar tests.
Se conservó el exit 1 inicial y se repitió esa suite sin alterar producto o
migraciones. La repetición terminó con 19 PASS y exit 0. Los resultados de N2
y N2-A1 se verificaron nuevamente con la infraestructura PDF definitiva: PASS.

Limpieza completada: se retiraron únicamente los tres MySQL propios de esta
tarea y los contenedores Node temporales. Los seis contenedores preexistentes
conservaron sus IDs, nombres y puertos. Se quitó únicamente el junction de
node_modules de la copia BEFORE, sin recorrer su destino; las dependencias
originales y toda la evidencia se conservaron.

Evidencia temporal: `%TEMP%/nexus-n2a1-fix-20261013-d94b7a20/`, con BEFORE/AFTER,
probes originales, PDF/XLSX, logs por suite, hashes, build y estado Git.

## X. Git final

Rama: `feature/property-contract-billing`.
HEAD final de código y pruebas: `ab0e1500b65d15c8cd4fbb8d523f0426adba8cca`.
Este informe se incorpora mediante un commit documental separado.
El HEAD completo de ese commit, el resultado del push normal exclusivo a esta
rama y la comprobación de worktree limpio se registran en `git-final.json`
y en la copia externa `n2a1-final-report.md` entregada con el cierre.

`origin/main`: `7874d29bdaa3beb99b6fad34261740036d63ced0`.
No se hizo merge, force push, despliegue, cambio de main o acceso a bases reales.

## Y. VEREDICTO

**APTO PARA RE-AUDITORÍA FINAL**.

Q77 conserva a Juan, correo e ID ante María→Pedro→NULL; search encuentra al
actor histórico; desconocido y pagadores contradictorios no inventan actor;
responsable explícito/snapshot mantienen prioridad; listado, reportes,
comprobantes y detalle personal son consistentes. N2, H1–H9, R1–R3, N1,
suites completas, Node 20 y build/diff quedaron PASS.

Se detiene el trabajo tras entregar este reporte. No se inicia otra auditoría,
merge, despliegue o validación manual sin autorización explícita.
