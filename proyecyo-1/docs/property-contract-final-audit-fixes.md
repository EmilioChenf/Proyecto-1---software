# Correcciones finales R1–R3

Fecha: 2026-10-12. Rama: `feature/property-contract-billing`.

HEAD anterior: `0beccba3e144fe44f9142f41730078c5ca8a8e79`.
Código y pruebas validados: `f23a7009`.
`origin/main`: `7874d29bdaa3beb99b6fad34261740036d63ced0`; no contiene la feature.
Los 16 commits anteriores se conservan sin reescritura.

## R1: transferencia legada vencida

Antes, `protectLegacyScheduledTransfers` seleccionaba títulos desde hoy. Una
venta escrita por 009 y vencida ayer podía quedar fuera de la conciliación:
`syncHouseRelations` asignaba el comprador con Q500 pendientes del vendedor.
La regresión R1-A falló antes de cambiar producción, al obtener al comprador
en vez del vendedor. R1-B/R1-C fallaron por la misma activación indebida.

La selección ahora incluye transiciones abiertas que ya vencieron. Bajo el
bloqueo existente de migración y el bloqueo transaccional de la casa:

- Un estado explícito de activación se respeta y no se reclasifica.
- Un título vencido ya reflejado en el propietario operativo, con la versión
  y responsable compatibles, se conserva como historia completada de 009.
  No se inventa su fecha de activación ni se reabre la venta.
- Si el propietario operativo sigue siendo el saliente, se registra el plan
  pendiente usando los IDs existentes, también cuando la fecha quedó atrás.
- Una versión ausente, responsabilidad contradictoria o propietario operativo
  ajeno a ambos titulares exige `LEGACY_TRANSFERS_REVIEW_REQUIRED`.
  La conciliación revierte sus cambios y el arranque falla antes de escuchar.
- La activación existente revalida el saldo; con deuda deja `BLOQUEADA` y
  conserva al saliente. Tras Q0 activa una sola vez y mantiene la atribución
  de las cuotas/pagos anteriores.

Pruebas después: 12 casos R1 aprobados, incluyendo A–F, dos propietarios
ambiguos, versión ausente, responsabilidad contradictoria, activación explícita
y arranque real. R1-C utiliza tres conexiones independientes. Se verifican
usuarios, residentes, inquilinos, viviendas, cuotas, pagos, visitas, accesos y
registros de ingreso; los IDs se conservan. Las ventanas contractuales y de
habitantes se concilian deliberadamente al proteger/activar, sin borrar filas.

No se agregó DDL ni se reescribieron 009/010. Se utiliza la conciliación
transaccional ya ejecutada después de esas migraciones. El DDL existente de
MySQL conserva su comportamiento de commit implícito; un error de conciliación
no implica revertir DDL ya aplicado. La repetición sigue siendo segura.

## R2: estado del wizard por modalidad

Antes, un inquilino privado incompleto seguía validándose después de cambiar
a renta directa/compra. También aparecía en el resumen aunque el payload ya
lo excluyera. Se reprodujeron seis fallas del componente real antes de corregir.

`changeType` ahora descarta los borradores dependientes: persona responsable,
modo de creación, inquilino privado, modo, ocupación, importe y plazo. Conserva
vivienda y fecha efectiva. Volver entre pasos sin cambiar modalidad conserva
modo y datos; seleccionar nuevamente la misma modalidad no los reinicia.

La ocupación guardada en DB sigue independiente del borrador: se conserva por
defecto para la fecha seleccionada; únicamente una edición explícita de
ocupación pide `ACTUALIZAR`. La carga de inquilino privado, validación, resumen
y payload consideran esa persona solamente en `PROPIEDAD_PRIVADA`.

Pruebas después: 27/27 del wizard, con siete casos nuevos. Incluyen privada
incompleta hacia renta/compra, renta hacia privada, ciclo compra/renta/privada,
atrás/adelante, resumen/payload sin datos fantasma y regreso a privada. H5
además comprueba submit con los cuatro valores originales; H6 conserva al
habitante futuro y la baja explícita continúa funcionando.

## R3: actor histórico de accesos

Antes, la unión `ACCESO → CASA → RESIDENTE actual` ocultaba renta directa con
`id_residente=NULL` y mostraba al comprador como autorizante de visitas del
vendedor. También inventaba propietario para accesos sin actor y atribuía al
propietario las visitas autorizadas por su inquilino. R3-A/B/C/E fallaron antes
de cambiar producción.

El listado usa `LEFT JOIN USUARIO` por `ACCESO.id_usuario_autoriza`. Un actor
desconocido aparece como `Sin registro`. La exportación reutiliza ese listado;
PDF/XLSX incorporan la columna `Autorizado por`. No se filtran actores históricos
por su estado activo. La PK de USUARIO y el UNIQUE de REGISTRO_ACCESO.id_acceso
conservan una fila por acceso.

Pruebas después: seis casos R3 aprobados. Renta directa y propiedad privada
utilizan creación/QR reales; se verifica autor tras venta, legado sin actor,
inquilino autorizado, salida, filtros equivalentes, cardinalidad y contenido
del XLSX. El listado actual no ofrece paginación de servidor; no se añadió
una API nueva ni se simuló su aprobación mediante cortes artificiales.

## Búsqueda dirigida: hallazgo adicional N1, sin corrección

**N1 — MEDIO — exportación de sanciones legadas sin responsable confirmado.**

Archivo: `backend/src/services/reportExportService.js`, consulta
`REPORTS.sanciones`, unión de USUARIO en torno a la línea 33.
Esta consulta distinta ya existía en el HEAD anterior; no comparte la consulta
de accesos corregida por R3.

Reproducción en otro clon temporal: casa legada sin relaciones confirmadas,
cuota con `id_responsable=NULL` y sin snapshot, sanción vinculada. Exportar;
cambiar el residente operativo de Juan a María; exportar nuevamente.

Resultado observado:

```text
exportBefore: Juan desconocido
exportAfter: Maria actual
historicalDetail: Responsable no confirmado
```

Impacto: el export de sanciones reconstruye un actor histórico desconocido
mediante el propietario actual y discrepa del detalle histórico.
Recomendación: alinear esa consulta con snapshot/responsable almacenado y
representar como desconocido lo no confirmable. Revisar aparte los usos de
compatibilidad financiera legada antes de ampliar el cambio.

Se reporta conforme a la búsqueda dirigida solicitada. No se modificó esa
consulta ni se amplió R3 a un refactor de sanciones/finanzas. La reproducción
observacional temporal no se cuenta como suite versionada aprobada ni como
una corrección de N1.

Se revisaron también accesos especiales, visitas, historial de proveedores,
pagos, cuotas, sanciones, recibos, notificaciones y auditoría. Las uniones de
autorización operativa se distinguieron de las de atribución histórica; no se
cambiaron permisos ni consultas ajenas a los tres hallazgos autorizados.

## Validación

Host: Node 22.12.0. MySQL 8.4.8 desechable, ligado a localhost:21480, con base
sintética `nexus_phase0_test_20261012_7b39f2c1`. Cada runner crea y elimina
clones identificados por UUID y verifica que la evidencia/base fuente no cambió.
No se utilizaron producción, bases existentes ni servicios externos de pagos.

| Suite versionada | PASS | FAIL | SKIP | CANCELLED |
|---|---:|---:|---:|---:|
| Frontend, 75 archivos (incluye 7 R2 nuevos) | 449 | 0 | 0 | 0 |
| Backend node:test | 92 | 0 | 0 | 0 |
| Backend Jest, 66 suites | 816 | 0 | 0 | 0 |
| Property, 44 negocio + 10 migración | 54 | 0 | 0 | 0 |
| Post-audit | 16 | 0 | 0 | 0 |
| Final-audit, 12 R1 + 6 R3 + matriz HTTP | 19 | 0 | 0 | 0 |
| Otras integraciones MySQL | 427 | 0 | 0 | 0 |
| Funcionales | 12 | 0 | 0 | 0 |
| **Total** | **1885** | **0** | **0** | **0** |

El baseline de 1859 aumenta en 26 pruebas. La matriz HTTP utiliza sesiones
reales de siete roles; prueba cuenta, cuotas, pago, recibo, checkout, query/body
manipulados y rutas administrativas. El antiguo propietario conserva su recibo;
ningún actor accede a obligaciones ajenas. La suite temporal adversarial de la
re-auditoría anterior se repitió: 20/20 PASS, incluyendo financiamiento de tres
meses impagos y venta con cien cuotas históricas pagadas. No se suma al total
versionado.

Comandos del conjunto completo, desde backend con las variables TEST:

```text
node scripts/run-isolated-tests.js <suite>
suite = finalaudit property postaudit backend phase0 hu13 hu14 hu15 hu16 hu17
        hu18 hu19 hu32 viviendas correlation precision functional
```

Desde frontend:

```text
node node_modules/vitest/vitest.mjs run --maxWorkers=2
```

Los scripts tarea5/integration/regression/demo que apuntan a archivos ausentes
no se contaron como PASS ni SKIP. Se ejecutaron todas las suites versionadas
disponibles. Las regresiones H1–H9, lote mensual, seguridad de sesiones y
operaciones de visitas pasaron dentro de este conjunto.

Node 20.20.2, Linux temporal con dependencias instaladas mediante `npm ci`:
property 54 + post-audit 16 + final-audit 19 = **89/89 PASS**, cero FAIL/SKIP/
CANCELLED. Se copió solamente código de backend a un archivo temporal; no se
modificó Dockerfile. Un proxy local del contenedor accedió exclusivamente al
MySQL temporal de esta ejecución.

Vite 6.3.5: PASS, 2476 módulos, compilación en memoria con `write:false`.
`git diff --check`: PASS. No secretos nuevos, logs de debug ni cambios de
autorización en el diff de producción. WebGL/móvil permanece pendiente de
inspección visual real.

Logs y scripts temporales de esta ejecución:
`%TEMP%/nexus-finalfix-20261012-7b39f2c1`.
Evidencia antes: `r2-before.log`, `r1-r3-before.log`; después: `r2-after.log`,
`finalaudit.log`, `frontend-full.log`, las demás suites, `node20.log`,
`independent-backend.log`, `build.log` y `history-probe.log`.
La primera preparación de R3-F tenía ambos accesos autorizados y una expectativa
incorrecta de filtro. Se preparó uno cancelado; esa falla de fixture no se
presenta como defecto del producto. Las reproducciones R1-A/B/C y R3-A/B/C/E
mantuvieron sus comprobaciones de comportamiento antes/después.

## Commits y estado

```text
f483a137 fix: reconcile overdue legacy ownership transfers
33c2317b fix(ui): reconcile contract wizard state by property type
3f42141d fix: preserve historical actors in access reports
f23a7009 test: cover final property contract audit regressions
```

Este documento se agrega en un quinto commit. Push autorizado únicamente a
`feature/property-contract-billing`, sin force, después de todos los checks.
No merge, main, Railway ni producción.

**Veredicto: NO APTO PARA RE-AUDITORÍA FINAL.** R1–R3 están corregidos y sus
regresiones pasan; queda N1, un problema histórico MEDIO demostrado fuera de
la corrección de accesos autorizada. Se requiere resolver su alcance antes de
presentar el conjunto como cerrado. No se declara aprobación manual ni merge.
