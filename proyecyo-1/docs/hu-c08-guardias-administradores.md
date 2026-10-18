# HU-C08 — Unificación operativa de Guardias y Administradores

## Modelo final

**Perfiles individuales + información compartida por rol dentro del residencial + auditoría del usuario ejecutor.**

| Concepto | Regla |
|---|---|
| Identidad | Cada Guardia y cada Administrador tiene su propio `USUARIO` (correo, DPI y contraseña únicos) y sus propias sesiones (`SESION_ACTIVA`). Nada se comparte a nivel de cuenta. |
| Autorización | El rol sale de la sesión validada (`requireRoles` → `getCurrentSession`). Una cuenta inactiva (`USUARIO.activo = 0`) recibe 403 aunque conserve su sesión. |
| Visibilidad operativa | Se decide por **rol + residencial**, nunca por la cuenta que creó el registro ni por el guardia/admin en turno. |
| Auditoría | Cada acción guarda el `id_usuario` que la ejecutó. Compartir información no borra la autoría. |

## Residencial (tenant)

El modelo de datos actual es **un residencial por base de datos**: la identidad del residencial vive en
`CONFIGURACION` (`residencial_nombre`, `residencial_zona_horaria`, ...) y ninguna tabla tiene una columna
de residencial. Por eso "mismo residencial" equivale a "misma base de datos", y el aislamiento entre
residenciales lo da el despliegue (base y credenciales distintas por residencial). Ninguna consulta usa
otra base.

HU-C08 no añade una columna `id_residencial`: sería una arquitectura multi-tenant nueva que hoy no tiene
ningún consumidor. Si se agregan varios residenciales a una misma base, los puntos a filtrar son los que ya
se listan abajo (todos parten de `ACCESO`/`CASA`), y la prueba J debe convertirse en una prueba real.

## Visibilidad por rol

| Rol | Ve | No ve |
|---|---|---|
| Guardia | Todas las visitas abiertas del turno de **cualquier** residente o inquilino (`GET /guardia/visitas`), el historial diario (`GET /guardia/historial-accesos`) y puede validar QR y registrar entrada/salida de cualquiera de ellas. | Módulos `/admin/*`, `/usuarios`, visitas privadas vía `/visitas`. |
| Administrador | La misma información administrativa y operativa que cualquier otro administrador: viviendas, usuarios, accesos (`/admin/accesos`), pagos, reservas, proveedores, sanciones, reportes, configuración y auditoría. | Endpoints de garita (`/guardia/*`), que siguen siendo exclusivos del rol guardia. |
| Residente | Sus propias visitas (las de su casa). | Visitas de otras casas; endpoints de guardia y administrador. |
| Inquilino | Solo las visitas que él autorizó (`id_usuario_autoriza`). | Visitas del residente de su misma casa o de otras casas; endpoints de guardia y administrador. |

`GET /guardia/visitas` devuelve la unión de:

1. **Abiertas del turno, sin límite**: visitas `AUTORIZADA` o `PENDIENTE_APROBACION` de hoy (Guatemala) y
   cualquier visita `INGRESO_REGISTRADO` (el visitante sigue adentro), sin importar quién la creó.
2. **Ventana reciente**: las 20 visitas más recientes de hoy o días anteriores (comportamiento HU32).

Las fechas futuras siguen sin mostrarse como si ya hubieran ocurrido (decisión de HU32).

## Diagnóstico (causa original)

No existía un filtro por guardia ni datos semilla atados a NeuroLab: no hay referencias a NeuroLab en el
código, los SQL ni el historial git, y `NexusResidencial_NeuroLab_AOIs` solo contiene capturas del estudio.
Lo que hacía que la información pareciera atada a cuentas concretas era esto:

1. **Visitas abiertas fuera de la ventana**. El panel del guardia solo mostraba las 20 visitas más recientes
   ordenadas por `hora_inicio DESC`. Con más de 20 registros del día, las visitas pendientes de horario
   temprano y los visitantes que seguían adentro desde días anteriores dejaban de aparecer. Solo se veían las
   de la pareja de cuentas que se estaba usando en ese momento.
2. **Sin guardia ejecutor**. `REGISTRO_ACCESO` no guardaba qué guardia registró la entrada ni la salida, y
   `registrar-salida` ni siquiera recibía al guardia. La única pista era `INTENTO_VALIDACION_QR`, donde dos
   guardias simultáneos quedan ambos como `VALIDO`, así que la auditoría no permitía saber quién hizo cada acción.
3. **Salida no condicional**. `UPDATE ACCESO ... SALIDA_REGISTRADA` no verificaba el estado previo (la
   transacción lo revertía, pero dependía del segundo UPDATE).

En administración no se encontraron filtros por administrador creador. Todos los listados `/admin/*` son
globales al residencial. `companyOnly` en solicitudes de arrendatarios aplica a cualquier admin activo.

## Auditoría individual

- `REGISTRO_ACCESO.id_guardia_ingreso` / `id_guardia_salida` (FK a `USUARIO`, `ON DELETE SET NULL`).
- `AUDITORIA` con `VISIT_ENTRY_REGISTERED` / `VISIT_EXIT_REGISTERED` (`id_usuario` = guardia, `entidad = ACCESO`,
  IP y user-agent). Se escribe **en la misma transacción** que el cambio de estado: si la auditoría falla, la
  entrada/salida no ocurre.
- `INTENTO_VALIDACION_QR` sigue registrando cada intento por guardia (incluido el perdedor de una carrera,
  como `REUTILIZADO`).
- Las acciones administrativas existentes ya auditaban al admin de la sesión (`USER_*`, `HOUSE_*`, configuración,
  contratos) o guardan `creado_por` / `aprobado_por` / `realizado_por` en sus tablas.
- Se ve en: historial de garita y `/admin/accesos` ("por <guardia>"), y `/admin/auditoria` (filtro nuevo
  para ingresos y salidas).

## Concurrencia del QR

El ingreso usa `UPDATE ACCESO SET estado_acceso='INGRESO_REGISTRADO' WHERE id_acceso=? AND estado_acceso='AUTORIZADA'`.
InnoDB serializa la fila: solo una transacción obtiene `affectedRows = 1`. La otra recibe `409 QR_ALREADY_USED`,
no inserta `REGISTRO_ACCESO` ni auditoría de ingreso, y su intento queda en `INTENTO_VALIDACION_QR`. La salida
aplica el mismo patrón sobre `INGRESO_REGISTRADO`.

## Migración

`ensureAccessGuardAuditSchema` (en `backend/src/database/mysql.js`, se ejecuta al arrancar como el resto de
`ensure*`), con su reflejo en `sql/init.sql`:

- Solo agrega dos columnas nulas y sus FKs. Es idempotente.
- No borra ni reescribe visitas, accesos ni historial. Los registros previos quedan con `NULL` ("ejecutor no
  registrado"). No se infiere el guardia a partir de los intentos de validación, porque sería una autoría
  supuesta y no real.

## NeuroLab

No se crearon cuentas especiales. Las pruebas usan cuentas normales (`residente@test.com`, `inquilino@test.com`
y guardias/admins creados en una base desechable). No había filtros ni semillas NeuroLab que eliminar.

## Pruebas

`backend/test/integration/huc08.mysql.test.js` usa HTTP y sesiones Bearer reales sobre una base TEST desechable:

```bash
cd backend
RUN_PHASE0_MYSQL_TESTS=1 PHASE0_TEST_DATABASE=<base nexus_phase0_test_*> PHASE0_TEST_PORT=<puerto> npm run test:huc08:mysql
```

Cubre A–I y K de la HU. J no aplica en el modelo actual de un residencial por base de datos (ver arriba).
