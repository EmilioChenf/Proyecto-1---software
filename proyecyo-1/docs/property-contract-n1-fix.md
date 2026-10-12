# Corrección N1: responsable histórico de sanciones

Fecha: 2026-10-12. Rama: `feature/property-contract-billing`.
HEAD anterior: `be7a726c59f1bc4c3d293402eb6faab1922ff8e8`.
`origin/main`: `7874d29bdaa3beb99b6fad34261740036d63ced0`.

## Antes y causa

La regresión versionada `backend/test/integration/n1.mysql.test.js` se ejecutó
antes de modificar la aplicación. N1-A creó una casa legada sin relaciones
confirmadas, una cuota sin responsable/snapshot y su sanción. Exportó, cambió
el residente operativo de Juan a María y volvió a exportar:

```json
{"case":"N1-A","exportBefore":"Juan N1-A","exportAfter":"María N1-A","historicalDetail":"Responsable no confirmado"}
```

La ejecución previa definitiva dio 3 PASS, 5 FAIL, 0 SKIP y 0 CANCELLED.
N1-B, N1-C y responsable almacenado sin snapshot ya pasaban. Fallaban N1-A,
N1-D, N1-E, N1-F y búsqueda por snapshot tras renombrar al usuario.

Consulta causante en `REPORTS.sanciones` de `reportExportService.js`:

```sql
COALESCE(JSON_UNQUOTE(JSON_EXTRACT(cu.responsable_snapshot,'$.nombre')),
         u.nombre,'Responsable pendiente de confirmar') residente
FROM SANCION s JOIN CASA c ON c.id_casa=s.id_casa
LEFT JOIN CUOTA cu ON cu.id_cuota=s.id_cuota
LEFT JOIN RESIDENTE r ON r.id_residente=c.id_residente
LEFT JOIN USUARIO u ON u.id_usuario=cu.id_responsable OR
  (cu.id_responsable IS NULL AND c.relaciones_confirmadas_en IS NULL
   AND u.id_usuario=r.id_usuario)
```

La alternativa del `OR` reconstruía un responsable histórico desconocido
mediante el residente actual. Los dos listados de `adminSanctionsService`
repetían esa atribución y utilizaban otra etiqueta para desconocidos.
Su búsqueda consultaba `u.nombre` aunque mostrase un snapshot diferente.
Son representaciones de las mismas sanciones incluidas en N1, no otro dominio.

## Corrección y después

`sanctionHistoricalActor.js` centraliza la semántica segura existente de H3.
La comparten el detalle/listado paginado histórico, listado administrativo,
historial de eventos y exportación. Las consultas usan alias `cu` y `u`:

```sql
COALESCE(JSON_UNQUOTE(JSON_EXTRACT(cu.responsable_snapshot,'$.nombre')),
         u.nombre,'Responsable no confirmado')
LEFT JOIN USUARIO u ON u.id_usuario=cu.id_responsable
```

El snapshot tiene prioridad, luego el responsable almacenado, y finalmente
la incertidumbre explícita. La búsqueda por responsable aplica esa misma
expresión. Se conserva el LEFT JOIN para cuotas/usuarios ausentes y actores
inactivos. No hay migración, backfill ni escritura de responsables históricos.

La **misma prueba**, sin cambiar expectativas ni fixtures entre la ejecución
previa definitiva y la posterior, pasó 8/8. SHA-256 del archivo en ambas:
`D7F002592492D0F51BDB2C05A3AF4E4BF7562BBB72634A03AE818E476B2FA1D4`.

```json
{"case":"N1-A","exportBefore":"Responsable no confirmado","exportAfter":"Responsable no confirmado","historicalDetail":"Responsable no confirmado"}
```

| Caso | Comprobación | Resultado |
|---|---|---|
| N1-A | Legado desconocido antes/después de Juan → María; cuota permanece sin responsable/snapshot. | PASS |
| N1-B | Facturar a Juan, pagar Q0, vender y activar realmente a María; las cinco representaciones conservan Juan. | PASS |
| N1-C | Renta directa real, residente NULL y cuota con responsable confirmado; registro visible. | PASS |
| N1-D | Renta directa, residente NULL; cuota sin responsable y sanción sin cuota se conservan como desconocidas. | PASS |
| N1-E | Detalle, listado histórico, listado administrativo, historial de eventos y exportación concuerdan antes/después del cambio. | PASS |
| N1-F | Fechas inclusivas, exclusión fuera del rango, paginación real, búsqueda histórica, una fila por sanción y contenido XLSX/PDF. | PASS |

Dos regresiones adicionales comprueban prioridad del snapshot tras renombrar/
desactivar al usuario y responsable almacenado sin snapshot tras cambiar el
residente. No se cuenta cada aserción como una prueba adicional.

Las primeras preparaciones del fixture usaron una acción de evento no admitida
y configuraron mantenimiento demasiado tarde. Se corrigieron antes de modificar
la aplicación y se guardaron sus logs aparte. Esos errores de preparación no
se presentan como defectos del producto ni como la reproducción definitiva.

## Búsqueda dirigida y límites

Se revisaron exclusivamente `reportExportService.js`, `sanctionHistoryService.js`,
`adminSanctionsService.js` y el helper nuevo. En sus consultas de sanciones
ya no queda `CASA.id_residente` ni `JOIN RESIDENTE` para atribuir responsables.
No se demostró otro hallazgo MEDIO/ALTO/CRÍTICO dentro de esta revisión limitada.

En el mismo archivo permanece la compatibilidad de `morosos`, que informa
saldo actual y no movimientos históricos. No se reclasifica esa regla como
otro defecto sin evidencia ni se modifica su política financiera. Reservas
utiliza su `id_usuario` almacenado; accesos sigue delegando al listado de R3.
No se amplió la búsqueda ni se refactorizaron otros módulos.

El informe anterior `property-contract-final-audit-fixes.md` conserva el registro
de N1 tal como se encontró entonces. Este documento registra su corrección.

## Validación

| Suite versionada | PASS | FAIL | SKIP | CANCELLED |
|---|---:|---:|---:|---:|
| Frontend, 75 archivos; incluye siete casos R2 | 449 | 0 | 0 | 0 |
| Backend node:test | 92 | 0 | 0 | 0 |
| Backend Jest, 66 suites | 816 | 0 | 0 | 0 |
| Property, 44 negocio + 10 migración | 54 | 0 | 0 | 0 |
| Post-audit | 16 | 0 | 0 | 0 |
| Final-audit, 12 R1 + 6 R3 + matriz HTTP | 19 | 0 | 0 | 0 |
| N1, nuevos | 8 | 0 | 0 | 0 |
| Otras integraciones MySQL | 427 | 0 | 0 | 0 |
| Funcionales | 12 | 0 | 0 | 0 |
| **Total real** | **1893** | **0** | **0** | **0** |

El total se obtuvo de los logs, no de ajustar un número objetivo: baseline
1885 + ocho pruebas N1. Los reintentos previos y las repeticiones Node 20 no
se suman al total versionado. Desglose de otras integraciones MySQL:
phase0 25, hu13 27, hu14 74, hu15 54, hu16 30, hu17 23, hu18 64,
hu19 51, hu32 10, viviendas 19, correlation 33, precision 17 = 427.

| Regresión | Evidencia de esta ejecución | Resultado |
|---|---|---|
| R1 | 12 casos de final-audit, incluidos bloqueo, Q0, concurrencia y ambigüedad legada. | PASS |
| R2 | Siete casos existentes en frontend; wizard completo incluido en 449 pruebas. | PASS |
| R3 | Seis casos de final-audit: accesos reales, autorizante histórico, renta directa, venta y filtros/export. | PASS |
| H1, H2, H3, H4 | Post-audit: activación/deuda, traslado, sanciones históricas y perfil del expropietario; frontend H4. | PASS |
| H5, H6 | Frontend: modos y ocupación futura; post-audit: conservación/baja explícita y cambio de renta. | PASS |
| H7, H8 | Post-audit: destinatarios de llegada y restricciones reales MySQL del plazo. | PASS |
| H9 | Frontend: contexto contractual de vivienda. | PASS |
| Finanzas | Property: compra financiada, renta directa, privada, inquilino privado Q0, venta con deuda/Q0, historial y mantenimiento. | PASS |
| Lote mensual | Post-audit: fallo aislado por casa, reintento e idempotencia; property: emisión concurrente y calendario Guatemala. | PASS |

No se modificaron ni reimplementaron R1–R3, H1–H9 o las reglas financieras.

Entorno host: Node 22.12.0. MySQL 8.4.8 desechable y exclusivo, localhost:21480,
base sintética `nexus_phase0_test_20261012_d4a8b13e`. Cada runner crea y elimina
clones propios y verifica que conteos/evidencia de la fuente no cambiaron.
Sin servicios externos de pagos ni bases existentes/productivas.
Al terminar no quedaron clones de suite pendientes. Se verificaron ID completo
y etiqueta del contenedor MySQL propio antes de retirarlo; el contenedor Node 20
se eliminó automáticamente. Los seis contenedores preexistentes se conservaron.
Los logs de evidencia permanecen en el directorio temporal indicado.

Linux temporal: imagen `node:20`, runtime comprobado exactamente `v20.20.2`,
dependencias de lockfile mediante `npm ci`, copia de código sin `.env` ni
dependencias del host. Sin cambios de Dockerfile.

| Node 20.20.2 | PASS | FAIL | SKIP | CANCELLED |
|---|---:|---:|---:|---:|
| Property | 54 | 0 | 0 | 0 |
| Post-audit | 16 | 0 | 0 | 0 |
| Final-audit, incluye R1/R3 | 19 | 0 | 0 | 0 |
| N1 | 8 | 0 | 0 | 0 |
| **Total repetido** | **97** | **0** | **0** | **0** |

Vite 6.3.5: PASS, 2476 módulos, 16.41 segundos. Se ejecutó el build de
producción con salida en memoria (`write:false`), sin sobrescribir artefactos.
`git diff --check`: PASS. El diff de aplicación se limita a atribución/búsqueda
de sanciones; no cambia autorizaciones, importes, pagos o emisión.

Comandos desde backend, con las variables TEST de la base exclusiva:

```text
node scripts/run-isolated-tests.js <suite>
suite = n1 finalaudit property postaudit backend phase0 hu13 hu14 hu15 hu16
        hu17 hu18 hu19 hu32 viviendas correlation precision functional
```

El runner `backend` ejecuta el script versionado `npm test` (node:test + Jest).
En Windows se usa `npm_execpath` para invocar el CLI de npm. `functional`
descubre los seis archivos funcionales y arranca una API temporal local.
Los scripts tarea5/integration/regression/demo siguen apuntando a archivos
ausentes; no se cuentan como PASS ni como SKIP.

Desde frontend:

```text
node node_modules/vitest/vitest.mjs run --maxWorkers=2
node --input-type=module -e "import {build} from 'vite'; await build({build:{write:false,emptyOutDir:false}});"
```

Logs de esta ejecución: `%TEMP%/nexus-n1-20261012-d4a8b13e`.
Evidencia previa: `n1-before.log` y `n1-before.test.js`; posterior: `n1-after.log`.
Las demás suites tienen logs individuales; `host-summary.log` registra sus
códigos de salida. `frontend-full.log`, `node20.log` y `build.log` completan
la evidencia. El primer intento frontend recibió EPERM de spawn del sandbox;
se repitió con ejecución local autorizada, sin cambiar pruebas.

## Entrega

Commits aditivos sobre `be7a726c`, sin reescritura:

```text
809d8b2c fix: preserve unknown historical actors in sanction exports
10bfd3fb test: cover legacy sanction export attribution
```

Código y pruebas validados: `10bfd3fb2ea44e7e4200034aba0c3cbfddb5dbd7`.
Este informe se agrega en un tercer commit documental.

Ocho archivos modificados/agregados en total:

```text
backend/src/services/reportExportService.js
backend/src/services/adminSanctionsService.js
backend/src/services/sanctionHistoryService.js
backend/src/services/sanctionHistoricalActor.js
backend/test/integration/n1.mysql.test.js
backend/scripts/run-isolated-tests.js
backend/package.json
docs/property-contract-n1-fix.md
```

Push autorizado únicamente
a `feature/property-contract-billing` después de aprobar las verificaciones.
Sin merge, cambios de main, Railway ni producción. Al finalizar se detiene
el trabajo y se espera la re-auditoría independiente.

**Veredicto: APTO PARA RE-AUDITORÍA FINAL.** N1 ya no se reproduce;
R1–R3, H1–H9, finanzas y lote mensual siguen PASS. No hay otro hallazgo
MEDIO/ALTO/CRÍTICO demostrado en la revisión limitada. La incertidumbre
legada sin evidencia permanece explícita por diseño. La re-auditoría
independiente sigue pendiente; esta entrega no aprueba validación manual,
merge ni producción.
