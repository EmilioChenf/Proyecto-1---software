# Corrección posterior a la auditoría contractual

Rama exclusiva: `feature/property-contract-billing`. Base auditada y conservada:
`4a45b7bb32ce042d4cdd6d54770eff230049b21a`. Los ocho commits originales no se
reescriben. Este informe complementa [el diseño original](property-contract-billing.md).

## Hallazgos y evidencia

Las regresiones principales se ejecutaron antes de corregir: nueve casos MySQL
fallaron y cinco casos nuevos del wizard fallaron mientras sus quince casos
anteriores pasaron. Se corrigieron primero los fixtures de preparación para que
esos fallos reprodujeran el comportamiento auditado. Los casos adicionales
amplían las comprobaciones; no se eliminan ni debilitan pruebas existentes.

| Hallazgo | Antes | Corrección | Regresión | Resultado |
| --- | --- | --- | --- | --- |
| H1 | Una venta programada podía activarse pese a deuda posterior. | Versión pendiente; bloqueo de CASA y cuotas; validación de saldo en activación; titularidad, versión, responsabilidad y relaciones se activan en una sola transacción. Deuda conserva todo al saliente y registra BLOQUEADA. | MySQL: programar Q0, emitir deuda, bloquear, pagar, dos activaciones concurrentes, una sola auditoría y cargos históricos intactos; activación tardía. | PASS |
| H2 | Un vínculo únicamente en INQUILINO_CASA podía permanecer operativo en la casa anterior. | La reconciliación bloquea a la persona, verifica CASA_HABITANTE y retira únicamente los vínculos operativos legados contradictorios; deja auditoría. | Pedro pasa de A legada a B; una relación vigente; visita y solicitud nuevas en B y dirigidas a su propietaria; visita anterior sigue en A. | PASS |
| H3 | Sanciones se atribuían al propietario actual o desaparecían sin residente. | Listado, búsqueda y detalle usan snapshot/responsable de CUOTA con LEFT JOIN; desconocidos quedan identificados como tales. | Sanción de Juan tras venta, búsqueda Juan/María, renta directa y responsable legado desconocido. | PASS |
| H4 | Un expropietario sin vivienda no podía editar teléfono. | Backend distingue edición personal de cambio de rol/vivienda; formulario permite conservar vivienda nula en el mismo rol. | Edición de perfil sin vivienda; cambio real de vivienda continúa rechazado por la protección contractual; componente UserFormModal. | PASS |
| H5 | Volver desde confirmación restablecía el selector de persona existente. | Modo existente/nuevo vive en el padre del wizard; cambiar modo limpia la representación anterior. | Componente real: crear persona, nombre/correo/teléfono/contraseña, avanzar, volver; modo y datos visibles intactos. | PASS |
| H6 | Omisión accidental de inquilino podía cerrar una relación futura. | Habitantes se cargan según fecha efectiva; CONSERVAR es el valor seguro para edición existente; ACTUALIZAR exige intención explícita. | Frontend fecha futura y baja explícita; MySQL omisión, baja y renta 100→200 con habitante futuro conservado. | PASS |
| H7 | Aviso de llegada dependía de CASA.id_residente y fallaba en renta directa. | Destinatario deriva del autorizante de la visita, usuario activo y relación vigente permitida; no presupone propietario residente. | SQL real de createArrivalNotification: propietario, inquilino privado, arrendatario directo y usuario sin relación válida. | PASS |
| H8 | CHECK permitía plazo NULL en compra financiada. | Migración nueva 010 aditiva y repetible: plazo no nulo entre 1 y 1200; otros tipos conservan NULL. 009 intacta. | Inserciones directas MySQL: NULL/0/1201 rechazados; 1/1200 aceptados; modalidades sin plazo; actualización desde 009 repetida. | PASS |
| H9 | Paso vivienda sin contexto contractual suficiente. | Resumen compacto de estado, ocupación, contrato, titular, responsable y vigencia; configuración pendiente; conserva HousePicker/mapa. | Renderiza valores y etiquetas reales de contexto, además de pendiente de configuración. | PASS |
| Lote mensual | Una vivienda con error detenía el resto. | Transacción por casa; error registrado y continuación; resumen procesadas/omitidas/fallidas; claves únicas y bloqueo existentes. | Trigger sintético falla casa 2: cargos [1,0,1]; se retira el fallo y reintento produce [1,1,1], sin duplicados. | PASS |

Pruebas nuevas: [backend MySQL](../backend/test/integration/postaudit.mysql.test.js),
[wizard](../frontend/src/components/houses/PropertyContractWizard.test.tsx) y
[formulario de usuario](../frontend/src/components/admin/UserFormModal.test.tsx).
Son 22 pruebas adicionales: 16 backend y 6 frontend.

La regresión H7 ejecuta la función privada real mediante una exportación temporal
en memoria del módulo de pruebas, sobre MySQL. No reemplaza su consulta por un
mock ni añade una exportación productiva. Las suites existentes de visitas,
accesos y QR también se conservan y pasan.

## Activación, compatibilidad y recuperación

La nueva versión y su responsabilidad planificada quedan excluidas de la
facturación efectiva hasta activar. Mientras exista una transferencia pendiente
o bloqueada, otra configuración de esa casa devuelve 409. El scheduler sigue
sincronizando relaciones; la facturación también verifica la activación dentro
de su transacción por vivienda. Un bloqueo por deuda no detiene el resto del lote.

El primer día efectivo con Q0 activa una vez. Si la deuda demora la activación a
mitad de mes, titularidad y relaciones cambian ese día y la responsabilidad
financiera nueva comienza el mes siguiente, sin prorrateo ni reatribución de
cuotas emitidas. Los cargos del mes anterior conservan al responsable original.
El reintento automático del lote mantiene su regla de día 1 en America/Guatemala;
fuera de ese día se conserva la recuperación administrativa explícita existente.

010 no modifica 009 ni inventa un plazo para filas inválidas. Si una instalación
contiene compras financiadas con plazo NULL, el CHECK impide completar el
arranque hasta corregir explícitamente esos datos. Si hay varias ventas legadas
programadas para la misma vivienda, la protección detiene el arranque con
`LEGACY_TRANSFERS_REVIEW_REQUIRED`, sin elegir arbitrariamente una secuencia.
La transformación de datos se revierte por completo en ese caso; el DDL aditivo
es repetible y MySQL lo confirma independientemente de la transacción de datos.

Las ventas explícitas futuras que 009 ya hubiera escrito conservan sus IDs.
Se reabre la vigencia anterior y se ocultan las relaciones planificadas mediante
id_version_pendiente hasta revalidar el saldo. También se protege una venta con
entrada hoy si CASA aún señala al saliente. La prueba de este límite primero
falló y pasó después del ajuste. Una activación ya completada no se vuelve a
programar al repetir la migración.

La prueba de arranque ejecuta server.js real sobre un esquema previo desechable,
comprueba /health 200, 009+010, ausencia de contratos/tarifas/cargos inventados
y conservación de todos los campos originales de USUARIO, CASA, CUOTA y PAGO.
Las diez pruebas previas de migración también siguen pasando. Dos procesos Node
independientes concurrentes, seguidos de un tercero tras reinicio, generan un
solo cargo para la misma casa/período.

## Validación final

MySQL **8.4.8**, imagen `mysql:8.4` coherente con sql/Dockerfile. Servidor exclusivo
con etiqueta de esta ejecución, puerto 21480 ligado a 127.0.0.1, datos en tmpfs y
base semilla sintética `nexus_phase0_test_20261012_c7d491e2`. Cada runner verifica
propiedad, crea una copia con UUID, compara la semilla y evidencia al cerrar y
elimina únicamente sus bases temporales. No se cargaron secretos reales ni se
hicieron cobros/correos reales. No se consultó la versión de una DB productiva.

| Suite local, Node 22.12.0 | Aprobadas | Fallos/omitidas/canceladas |
| --- | ---: | ---: |
| Frontend completo, 75 archivos | 442 | 0 |
| Backend node:test | 92 | 0 |
| Backend Jest, 66 suites | 816 | 0 |
| property, incluidas 10 de migración | 54 | 0 |
| Nuevas postaudit | 16 | 0 |
| phase0 | 25 | 0 |
| hu13 | 27 | 0 |
| hu14 | 74 | 0 |
| hu15 | 54 | 0 |
| hu16 | 30 | 0 |
| hu17 | 23 | 0 |
| hu18 | 64 | 0 |
| hu19 | 51 | 0 |
| hu32 | 10 | 0 |
| viviendas | 19 | 0 |
| correlation | 33 | 0 |
| precision | 17 | 0 |
| functional, todos los archivos funcionales versionados | 12 | 0 |
| **Total único local** | **1,859** | **0** |

Integración/funcionales: 509. Las suites property y postaudit se repiten bajo
Node **20.20.2**, correspondiente al major del Dockerfile backend. El código
fuente se monta en solo lectura, se copia a tmpfs y se instala el lockfile con
`npm ci --ignore-scripts --no-audit --no-fund` dentro del contenedor desechable.
Resultado final Node 20: **70/70 PASS** (54 property + 16 postaudit), cero
fallos/omitidas/canceladas.
Esa repetición no se suma al total único local. No se cambian Dockerfiles,
dependencias ni lockfiles.

Dos intentos de Node 20 usando node_modules del montaje de Windows fallaron con
MODULE_NOT_FOUND de pdfkit o superagent. Se comprobó require.resolve dentro de
otro contenedor desechable y después se ejecutaron ambas suites completas con
dependencias Linux instaladas desde el lockfile en tmpfs. No se presentan los
intentos fallidos como PASS. La CLI npm disponible conserva su aviso de compatibilidad
con Node 22.12.0; las suites completas terminaron correctamente.

Build final Vite 6.3.5: **PASS**, 2,476 módulos. Se ejecutó el mismo bundler con
write:false y emptyOutDir:false para validar en memoria sin reemplazar artefactos
existentes. Comando: `node --input-type=module -e "import {build} from 'vite'; await build({build:{write:false,emptyOutDir:false}});"`.
`git diff --check`: **PASS**.

Se mantienen las regresiones de sesiones: 400/403/404/409/422/500 conservan sesión;
401 auténtico mantiene expiración. Mapa 3D, dashboard, usuarios, viviendas,
amenidades, reportes, visitas y autorizaciones están cubiertos por las suites
versionadas. WebGL visual, dispositivos físicos y validación manual quedan para
la siguiente etapa; no se presentan como verificación realizada.

Los scripts tarea5/integration/regression/demo siguen dependiendo de archivos no
versionados ausentes de esta rama. No se cuentan como PASS ni se copian pendientes
de otros worktrees. PUT vacío de horarios-visita permanece fuera del cambio.

## Archivos afectados

Además de este informe:

- Base/migración: backend/sql/migrations/010_property_contract_audit_fixes.sql,
  backend/src/database/propertyContractMigration.js.
- Contratos/operación: backend/src/services/contractActivationService.js,
  propertyContractsService.js, contractHouseRelations.js, housesService.js,
  tenantAuthorizationRequestsService.js, auditService.js.
- Facturación: backend/src/services/monthlyBillingService.js,
  adminRemindersService.js.
- Historial/perfil/avisos: backend/src/services/sanctionHistoryService.js,
  usersService.js, visitsService.js.
- Frontend: frontend/src/components/houses/PropertyContractWizard.tsx y su test,
  frontend/src/components/admin/UserFormModal.tsx y su test,
  frontend/src/types/propertyContracts.ts.
- Pruebas aisladas: backend/package.json,
  backend/scripts/prepare-property-contract-test-db.js,
  backend/scripts/run-isolated-tests.js,
  backend/test/integration/postaudit.mysql.test.js.

El bootstrap acepta fechas de ejecución de ocho dígitos, conservando puertos
exclusivos, nombre sintético estricto y CREATE DATABASE sin adoptar bases ajenas.

## Reproducción

Crear un MySQL temporal propio, con datos sintéticos y puerto exclusivo. Desde
backend, definir RUN_PHASE0_MYSQL_TESTS=1, PHASE0_TEST_PORT=21480 y un nombre
nexus_phase0_test_YYYYMMDD_XXXXXXXX con sufijo hexadecimal propio. Ejecutar el
bootstrap una sola vez y después:

```powershell
node scripts/run-isolated-tests.js property
node scripts/run-isolated-tests.js postaudit
node scripts/run-isolated-tests.js backend
foreach ($suite in @('phase0','hu13','hu14','hu15','hu16','hu17','hu18','hu19','hu32','viviendas','correlation','precision','functional')) {
  node scripts/run-isolated-tests.js $suite
  if ($LASTEXITCODE -ne 0) { throw "Falló $suite" }
}
# Desde frontend:
node node_modules/vitest/vitest.mjs run
```

La repetición Node 20 usa el mismo MySQL sintético mediante un proxy TCP local
del contenedor y ejecuta ambos runners completos con process.execPath; no cambia
la validación de localhost del soporte ni usa DB ajena. El código copiado incluye
src, scripts, sql, test, server.js, package.json y package-lock.json; excluye .env
y node_modules del host. Al finalizar se retiran exclusivamente los contenedores
etiquetados creados por esta ejecución.
La comprobación final de MySQL mostró únicamente la base semilla, sin clones
remanentes; se retiró su contenedor verificando ID y etiqueta. Los contenedores
Node 20 se eliminaron al terminar y no quedó ningún contenedor con la etiqueta
de esta tarea.

Veredicto: **APTO PARA RE-AUDITORÍA**. La siguiente etapa es la auditoría de solo
lectura y después la validación manual. No se realiza merge, despliegue, acceso
a producción ni validación con datos reales.
