# Contratos de propiedad y facturación mensual

Implementación autorizada en `feature/property-contract-billing`, desde `7874d29bdaa3beb99b6fad34261740036d63ced0`. Este documento describe el comportamiento implementado y su verificación local; no autoriza integración ni despliegue.

## Modelo y reglas

CASA conserva su identidad. Contrato, titularidad, responsabilidad financiera y habitantes tienen relaciones y vigencias independientes. El estado de ocupación del mapa se calcula por habitantes confirmados; un propietario puede conservar una vivienda desocupada y su mantenimiento.

| Modalidad | Titular | Responsable | Conceptos mensuales |
| --- | --- | --- | --- |
| COMPRA_FINANCIADA | Comprador | Comprador | Vivienda hasta N cuotas generadas; mantenimiento continúa |
| RENTA_DIRECTA | La residencial, sin usuario propietario ficticio | Arrendatario directo | Renta y mantenimiento |
| PROPIEDAD_PRIVADA | Propietario | Propietario | Mantenimiento |
| Inquilino privado | El propietario conserva la titularidad | Ninguna responsabilidad por habitar | Q0, sin deuda ni recibos ajenos |

Los roles de acceso siguen siendo residente e inquilino. Las autorizaciones financieras consultan la responsabilidad explícita y las operaciones históricas del usuario; habitar una casa no autoriza a pagar sus cargos. El arrendatario directo conserva sus funciones operativas y utiliza Recurrente mediante rutas protegidas para inquilino, incluido el retorno del checkout. Las solicitudes que necesitan autorización del titular empresa pasan al administrador.

La tarifa oficial reside únicamente en TARIFA_MANTENIMIENTO. El administrador programa un importe no negativo desde el primer día de un mes futuro. Hay una versión por fecha efectiva. No se siembra una tarifa ni se usan los importes ilustrativos de las pruebas como valores productivos. Los cargos y el período completo conservan snapshots de importes, conceptos, configuración y responsable.

El asistente administra vivienda, contrato, personas y confirmación en cuatro pasos. Reutiliza HousePicker y el mapa 3D. Seleccionar o crear personas forma parte de una única transacción; un fallo revierte también las altas. Incluye detalle físico, mantenimiento consultado, total, habitantes, plazo, cuotas generadas/restantes y último período previsto. La versión de CASA y un UUID de operación impiden sobrescrituras y doble envío.

## Fechas, cuotas y transferencias

Una configuración que comienza el día 1 afecta ese período. Si comienza otro día, su primer período financiero es el mes siguiente, sin prorrateo. Titularidad y habitantes tienen su fecha efectiva operativa; la responsabilidad de los cargos cambia por mes completo. No se modifica un período ya emitido. La primera configuración con fecha futura conserva los vínculos operativos anteriores hasta su vigencia.

El financiamiento cuenta cuotas de vivienda generadas, aunque sigan pendientes. No se reinicia el contador al versionar el importe. Al generar N se registra FINANCIAMIENTO_COMPLETADO y cesa el concepto vivienda; mantenimiento continúa. La transición a PROPIEDAD_PRIVADA requiere confirmación administrativa y queda auditada. Cambiar de modalidad para el mismo comprador antes de generar N se rechaza. Una venta confirmada en Q0 puede cerrar prospectivamente el contrato anterior: no fabrica deuda por cuotas futuras no emitidas ni traslada cargos existentes.

La transferencia bloquea CASA y sus cuotas, y consulta el saldo canónico: capital y recargos menos pagos aplicados y reembolsos confirmados/aplicados. Se consideran las obligaciones del titular y los cargos legados de atribución desconocida de esa casa. Deuda real impide la operación; cuotas históricas completamente pagadas no la impiden. Sobrepagos o reembolsos inconsistentes requieren revisión contable previa. La auditoría registra titular anterior/nuevo, administrador, casa, fecha y operación. La ruta antigua de traslado con historial remite al asistente para obtener esta confirmación y conservar las atribuciones.

El nuevo propietario solo obtiene sus cargos. El anterior puede conservar sus operaciones identificadas de manera segura. Un cargo legado sin responsable verificable permanece desconocido: no se atribuye al nuevo dueño. Un checkout preexistente conserva su actor registrado para verificar pagos, recibos, conciliación y reembolsos, sin rellenar especulativamente CUOTA.id_responsable.

SANCION y RECARGO_APLICADO mantienen sus funciones actuales. SANCION no se suma al saldo canónico de CUOTA ni se activa por facturación; se preserva la distinción encontrada en la auditoría. Sus consultas administrativas utilizan el responsable histórico del cargo cuando está disponible.

## Scheduler y concurrencia

Se reutiliza el scheduler de recordatorios, al arrancar y cada cinco minutos. Antes de los avisos sincroniza relaciones operativas y llama a la generación mensual. El proceso automático solo factura el día 1 de America/Guatemala. El período se obtiene mediante Intl con esa zona, sin usar el día UTC. Las fechas operativas SQL usan UTC−06:00. Un arranque en otro día no inventa cobros retroactivos; la recuperación de un mes omitido es una acción administrativa explícita.

Cada casa se factura en una transacción. El bloqueo de CASA serializa facturación y cambios contractuales. FACTURACION_CASA_PERIODO congela el mes entero, incluso cuando mantenimiento es cero. Las claves únicas `(id_casa, periodo, concepto)` y `(id_contrato, numero_cuota)` protegen contra duplicados. Repetir el proceso o ejecutarlo concurrentemente reutiliza el mes emitido. Un lote parcialmente completado puede reintentarse: las casas ya procesadas no se duplican. Cada período generado se audita, con administrador para ejecución manual y actor sistema para scheduler.

## Esquema y compatibilidad

Migración: `backend/sql/migrations/009_property_contract_billing.sql`. El servidor la ejecuta después de las migraciones anteriores y antes del scheduler. GET_LOCK serializa la migración entre instancias; los ALTER se condicionan mediante information_schema para permitir reanudación y repetición. MySQL confirma DDL individualmente: no se presenta como una migración DDL transaccional.

Tablas nuevas: TARIFA_MANTENIMIENTO, CONTRATO_CASA, CASA_TITULARIDAD, CASA_RESPONSABLE_FINANCIERO, CONTRATO_CASA_VERSION, CASA_HABITANTE, FACTURACION_CASA_PERIODO y OPERACION_CONTRACTUAL.

| Tabla existente | Adición o ajuste |
| --- | --- |
| CASA | version_contractual; relaciones_confirmadas_en |
| SERVICIO | codigo_financiero y unicidad del concepto oficial |
| CUOTA | origen, periodo, concepto, concepto_snapshot, id_contrato, id_version, id_responsabilidad, id_responsable, responsable_snapshot, numero_cuota, creado_en |
| PAGO | id_actor; titular_snapshot |
| SOLICITUD_AUTORIZACION_DIGITAL | id_propietario_usuario admite NULL para titular empresa |

Se añaden PK, índices de vigencia y claves únicas de mes, operación y número de cuota. Las FK enlazan casa, contrato, versión, responsable, usuario y tarifa; las compuestas impiden usar relaciones de otra casa. Los CHECK protegen importes, períodos, plazos, fechas y los datos obligatorios de un cargo mensual. La exclusión temporal entre versiones se valida bajo bloqueo de CASA; no depende de una supuesta restricción de intervalos de MySQL.

La migración no contiene backfill de personas, contratos o cobros, ni borrado de información. Las casas existentes quedan pendientes de configuración y no generan cuotas contractuales. Los cargos legados conservan HISTORICO, con responsable y período desconocidos cuando corresponde. Los nuevos campos nullable permiten conservar registros anteriores. Los respaldos incluyen las ocho tablas y auditoría; el exportador serializa JSON, conserva precisión temporal y falla si faltan tablas contractuales. La restauración verifica todas las referencias afectadas antes del commit.

No se añade rollback destructivo. Tras configurar contratos, retirar el nuevo código también retiraría los controles financieros nuevos; cualquier reversión necesita revisión específica, conservando los datos y sus snapshots.

## Endpoints

| Método y ruta | Autorización y uso |
| --- | --- |
| GET /admin/viviendas/:id/contratos | Administrador; configuración e historial contractual |
| PUT /admin/viviendas/:id/contrato | Administrador; confirmación, versión y operación idempotente |
| GET /admin/mantenimiento-global | Administrador; tarifa por período e historial |
| POST /admin/mantenimiento-global | Administrador; programación de tarifa |
| POST /admin/facturacion-mensual | Administrador; recuperación explícita de un período iniciado |
| /inquilino/pagos/recurrente/checkout, /checkouts/:reference, /reintentar | Sesión Bearer activa y responsabilidad verificada por cuota/operación |
| GET/PATCH /admin/solicitudes-arrendatarios | Administrador; solicitudes de viviendas cuyo titular vigente es empresa |

Los controladores toman la identidad de req.authUser. Los IDs y el rol enviados en el body no autorizan operaciones. Las rutas de pago simulado, recibos y finanzas existentes aplican también el aislamiento. Las notificaciones ya entregadas se filtran al leerlas para impedir que permanezca visible deuda ajena. Los errores de negocio mantienen el comportamiento de sesión existente; solo un 401 auténtico activa su cierre.

## Verificación local

Se usó MySQL 8.4.8 en un contenedor exclusivo, puerto 21480 ligado a 127.0.0.1 y datos en tmpfs. La base semilla fue `nexus_phase0_test_20261011_bf8a1939`. Cada runner creó una copia con UUID y marcador de propietario, comprobó que la base semilla y sus recibos no cambiaron, y eliminó sus copias. Las referencias de recibos HU16/HU17 se reprodujeron con datos sintéticos explícitos del entorno de pruebas; no representan evidencia del proveedor real. No se cargaron secretos ni se hicieron solicitudes a Recurrente real.

| Suite | Aprobadas | Fallos | Omitidas/canceladas |
| --- | ---: | ---: | ---: |
| Frontend, 75 archivos | 436 | 0 | 0 |
| Backend node:test | 92 | 0 | 0 |
| Backend Jest, 66 suites | 816 | 0 | 0 |
| property: 44 negocio/seguridad + 10 migración | 54 | 0 | 0 |
| phase0 | 25 | 0 | 0 |
| hu13 | 27 | 0 | 0 |
| hu14 | 74 | 0 | 0 |
| hu15 | 54 | 0 | 0 |
| hu16 | 30 | 0 | 0 |
| hu17 | 23 | 0 | 0 |
| hu18 | 64 | 0 | 0 |
| hu19 | 51 | 0 | 0 |
| hu32 | 10 | 0 | 0 |
| viviendas | 19 | 0 | 0 |
| correlation | 33 | 0 | 0 |
| precision | 17 | 0 | 0 |
| functional, todos los archivos funcionales versionados | 12 | 0 | 0 |

Total: 1,837 pruebas aprobadas. Integración/funcionales: 493, incluidas las 54 property. Pruebas nuevas: 74 = 44 backend/DB + 10 migración + 19 frontend + 1 Jest del retorno Recurrente. Build Vite y git diff --check aprobados. El build conserva el aviso de tamaño de chunks; no hay error de compilación.

La primera ejecución concurrente de frontend tuvo un fallo intermitente de espera del KPI de saldo en una prueba existente. Se conservó su registro y la suite completa pasó con `--maxWorkers=2`, sin omitir pruebas ni cambiar esa expectativa. Durante el desarrollo también se detectaron y corrigieron fixtures ausentes, serialización JSON y expectativas antiguas de deuda del inquilino; los resultados de la tabla son las ejecuciones finales. La CLI npm disponible usada para lockfiles actuales emite un aviso de compatibilidad con Node 22.12.0; los comandos terminaron correctamente y no se modificaron dependencias ni lockfiles.

Los comandos test:tarea5:mysql, test:integration, test:regression y test:tarea5:demo dependen de archivos no versionados en origin/main. Se reportan como infraestructura ausente, sin contar PASS ni copiar los pendientes de otro worktree. El bug independiente de PUT /admin/configuracion/horarios-visita con body vacío sigue separado y sin modificación.

### Conservación por migración

La prueba crea un esquema previo en una base desechable, carga datos, ejecuta 009, compara todos los campos anteriores de cada fila y repite la migración. No se limita a comparar conteos.

| Tabla | Antes | Después |
| --- | ---: | ---: |
| USUARIO | 4 | 4 |
| RESIDENTE | 1 | 1 |
| INQUILINO | 1 | 1 |
| CASA | 1 | 1 |
| CUOTA | 4 | 4 |
| PAGO | 1 | 1 |
| SERVICIO | 6 | 6 |
| PAGO_ORIGEN | 1 | 1 |

Contratos, versiones, tarifas y facturación nuevos permanecen vacíos después de migrar. Los cargos anteriores siguen con responsable desconocido. /health responde y se verifican las claves únicas nuevas.

### Casos de negocio demostrados

| Caso solicitado | Evidencia en property.mysql.test.js |
| --- | --- |
| Compra financiada | B01, B06, B16, B17 |
| Renta directa | B02, B07, B37 y pago/webhook/recibo B39 |
| Propiedad privada | B03, B08 |
| Propietario e inquilino privado | B09–B13, B31–B32, B43 |
| Venta con deuda bloqueada | B20 |
| Venta con Q0 permitida | B21, B44 |
| Venta conserva historial y privacidad | B21–B23, B40 |
| Cron repetido y concurrente no duplica | B14–B15, B35, B38 |
| Fin del financiamiento sin N+1 | B16–B17, transición confirmada B42 |
| Casa desocupada conserva mantenimiento | B24 |
| Cambio de tarifa y cambio a mitad de mes | B18, B19, B41 |
| Doble submit y dos administradores | B25–B28, B33–B34 |

Las pruebas de interfaz verifican campos, pasos, conceptos, confirmación, errores y límites responsive. No se presenta una inspección visual manual de WebGL o dispositivos físicos como prueba realizada.

## Reproducción aislada

Crear un MySQL 8.4 desechable propio en 127.0.0.1:21480, con datos temporales y sin credenciales productivas. El bootstrap exige ese puerto o 21479 y el nombre de base explícito siguiente; CREATE DATABASE no adopta una base existente.

```powershell
$env:RUN_PHASE0_MYSQL_TESTS='1'
$env:PHASE0_TEST_DATABASE='nexus_phase0_test_20261011_1234abcd'
$env:PHASE0_TEST_PORT='21480'
node scripts/prepare-property-contract-test-db.js
npm run test:property:mysql
npm run test:isolated:backend
foreach ($suite in @('phase0','hu13','hu14','hu15','hu16','hu17','hu18','hu19','hu32','viviendas','correlation','precision','functional')) {
  node scripts/run-isolated-tests.js $suite
  if ($LASTEXITCODE -ne 0) { throw "Falló $suite" }
}
# Desde frontend:
npm run test:run -- --maxWorkers=2
npm run build
```

Al finalizar se retiran exclusivamente el contenedor y los datos creados por esa ejecución. La evidencia de esta implementación se conserva fuera del repositorio, junto al informe final: `NexusResidencial-property-contract-evidence-2026-10-11`.
