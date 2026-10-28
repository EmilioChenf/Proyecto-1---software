# Sprint 10 — Arodi

Rama: `Arodi-Spring10`. Fecha de verificación: 27 de octubre de 2026 (Guatemala).
Base: `51d1a4e5` de `main`.

## Notificaciones flotantes

`ActionToasts` vive por encima del enrutador y atiende a administrador, residente,
inquilino y guardia, además de las vistas públicas. Los resultados de las operaciones,
errores de carga y advertencias conservan sus mensajes dentro de la vista y también
se muestran en la bandeja flotante mediante `useFeedbackState` y las funciones
`notifySuccess`, `notifyError`, `notifyWarning` y `notifyInfo`.

Se integraron los mensajes de las vistas existentes y sus formularios compartidos.
También se agregaron resultados explícitos a operaciones que antes eran silenciosas:
sesiones, lectura de avisos, revisión de proveedores, solicitudes de demostración,
aplicación de recargos y descargas. Los errores junto al campo permanecen disponibles.
La navegación y la escritura de cada carácter no generan avisos de éxito.

La bandeja presenta hasta cuatro avisos, deduplica mensajes, permite cierre con
teclado y pausa la expiración al pasar el puntero o enfocar un aviso. El éxito dura
4.5 segundos; los demás resultados duran 8 segundos. Los textos se escapan y los
errores técnicos se sanean. No hay animaciones nuevas. Los avisos no cierran las
confirmaciones o solicitudes de motivo de SweetAlert2. Al cerrar o expirar una sesión
se limpia el contenido anterior.

## HU-C05 — Corrección integral de amenidades y reservas

Parte de la historia ya estaba implementada en `main`. Esta rama completa los
vacíos encontrados y conserva las validaciones, auditoría transaccional y permisos.

| Subtarea de la imagen | Comportamiento y evidencia |
| --- | --- |
| C05.1 Error visible por fecha pasada | Bloques vencidos deshabilitados, aviso en la vista y error flotante con `RESERVATION_IN_PAST`; pruebas del residente. |
| C05.2 Impedir guardar vencidas | Validación del servidor antes del `INSERT`; nuevas regresiones para día anterior y hora vencida del mismo día. |
| C05.3 Registrar qué cambió | Historial existente con amenidad, fecha y horario anteriores/nuevos, actor y rol; se conserva. |
| C05.4 Cancelación administrativa | Confirmación con motivo opcional; actualización local al guardar y recarga posterior. |
| C05.5 Quién, cuándo y motivo | Se devuelve el instante UTC realmente guardado en MySQL en la misma respuesta de cancelación; visualización en hora de Guatemala. |
| C05.6 Reflejar en la cuenta | Se refrescan reservas/historial del residente. Nueva vista `/inquilino/reservas` para consultar reservas hechas en su nombre, incluidas canceladas, responsable y motivo. |
| C05.7 Calendario administrativo | Las canceladas siguen separadas de la ocupación; al refrescar después de una acción se conservan los filtros. |
| C05.8 Liberar horario | Disponibilidad y conflictos existentes ignoran canceladas; cambios entre pestañas se anuncian sin compartir datos de usuarios. |
| C05.9 Administrador creador | `creada_por`, `CREACION_ADMIN` y auditoría existentes; visibles también en la consulta propia del inquilino. |
| C05.10 Confirmar en nombre de otro | Se conserva la confirmación con usuario, unidad, amenidad y horario. |
| C05.11 Auditoría integral | Se agrega `CREACION` al historial de reservas propias; creación, modificación y cancelación conservan auditoría dentro de la transacción y rollback si falla. |
| C05.12 Permisos | Pruebas HTTP para rechazo de otros roles y sesión ausente; pruebas de servicio para reserva ajena y pruebas del historial propio del inquilino. |

Los calendarios abiertos reciben cambios de su pestaña y otras pestañas del mismo
navegador. También se actualizan al recuperar el foco, volver a mostrarse la pestaña
y cada 20 segundos cuando está visible. Entre dispositivos distintos, el refresco
periódico limita el retraso a ese intervalo; no se agregó un servidor de tiempo real.

El inquilino consulta su historial a través de dos rutas de lectura protegidas por
`requireTenant`. Su identidad se toma de la sesión, incluso si envía otro `id_usuario`.
Se conservan los permisos anteriores: no se le habilita la creación o modificación
autónoma de reservas ni la cancelación administrativa. Administración puede reservar
en su nombre, y el inquilino puede consultar el resultado.

Si una escritura fue confirmada pero falla la consulta posterior, se informa que el
cambio quedó guardado y no se invita a repetir la operación. El residente confirma
explícitamente antes de cancelar una reserva propia.

## Investigación del total de viviendas

No se encontró un total fijo de 2500/2,500/2.500 viviendas en las vistas o servicios.
`HouseExplorer` muestra `summary.total`; `housesService.listHouses` obtiene el total
mediante `COUNT(*) FROM CASA`, sin uniones que multipliquen filas. El mapa se construye
con las viviendas entregadas por la API.

La conexión local disponible por defecto respondió `ECONNREFUSED`. No había un archivo
`.env` local con otra conexión. Por ello **no se verificó ni corrigió un inventario
real de 2500 a 20 viviendas**. El usuario indicó que se le informara si no se localizaba
el problema. No se ocultaron filas ni se reemplazó el conteo real por un número fijo.

Para continuar sobre la base donde aparece la cifra, estas consultas son de lectura:

```sql
SELECT COUNT(*) AS total, SUM(activo = 1) AS activas,
       SUM(activo = 0) AS inactivas,
       CASE WHEN COUNT(*) = 20 THEN 'CORRECTO' ELSE 'REVISAR' END AS esperado_20
FROM CASA;

SELECT torre, COUNT(*) AS viviendas
FROM CASA
GROUP BY torre
ORDER BY viviendas DESC;
```

Si el resultado supera 20, hace falta identificar las viviendas válidas y el origen
de las demás antes de depurar registros relacionados con usuarios, cuotas y pagos.

## Verificación

| Comprobación | Resultado |
| --- | --- |
| `frontend: npm run test:run -- --maxWorkers=4` | 94 archivos, 555 pruebas aprobadas. |
| `backend: npm test` y regresiones finales de Jest | 132 pruebas de Node + 899 pruebas de Jest, todas aprobadas (74 suites de Jest). |
| `frontend: npm run build` | Compilación de producción aprobada. Advertencia existente de paquetes grandes. |
| Chromium, frontend real con API simulada | 4 roles × 2 anchos (1440 y 375 px); éxito, error, cierre con teclado, ancho de la bandeja y ausencia de errores JavaScript. 18 capturas, incluidas dos de reservas del inquilino. |
| MySQL real | No ejecutado: conexión local no disponible. Se amplió `test/integration/sprint10.mysql.test.js`, pendiente de ejecución en la base TEST aislada. |
| TypeScript 5.9.3, `tsc --noEmit` | No aprobado: 37 diagnósticos en líneas de código que ya existían en `main`; incluyen mocks, tipos Node/Vite, filtros y `VisitPayload`. No se amplió esta tarea a corregir esos módulos. |

Las dependencias faltantes se instalaron para verificar el proyecto. Las herramientas
temporales de tipos no se añadieron a `package.json` ni a los lockfiles.

La evidencia del navegador está en [evidence/ui-results.json](evidence/ui-results.json).
El script [verify-ui.cjs](verify-ui.cjs) reproduce la revisión con una API simulada,
sin conectarse ni modificar datos reales. Requiere Playwright/Chromium disponibles y
el frontend iniciado. Se pueden configurar `NEXUS_PLAYWRIGHT_MODULE`, `NEXUS_CHROMIUM`
y `NEXUS_UI_ORIGIN` cuando no están en las rutas predeterminadas del entorno.

## Commits de implementación

1. `36f778fe` — Bandeja global de notificaciones accesibles y pruebas.
2. `c68538a8` — Integración de mensajes en vistas, formularios y los cuatro roles.
3. `d41dbb2e` — Historial de creación propia y datos de cancelación del servidor.
4. `c90fb789` — Sincronización de calendarios y confirmación de cancelaciones.
5. `d4146efb` — Consulta propia del inquilino y pruebas de permisos.
6. `9abc6ff9` — Regresiones de fechas vencidas, fallo de recarga y ajustes finales.

Un commit adicional conserva esta documentación y la evidencia visual.
