# HU-C06 - Corrección de proveedores

> Como usuario autorizado, quiero registrar proveedores con datos válidos y vigencia
> correcta desde los roles permitidos, para que sus accesos sean seguros.

## Causa

- Solo el inquilino podía registrar proveedores. `POST /inquilino/proveedores` aceptaba
  residentes, pero el servicio buscaba la casa de un inquilino y respondía 404; el
  administrador no tenía ruta de registro y su acceso especial siempre era `VISITA`.
- El inquilino registraba con dos peticiones en paralelo (proveedor + acceso): si una
  fallaba quedaba un proveedor sin acceso o un acceso sin proveedor.
- Un proveedor podía guardarse sin placa ni DPI, con fecha u horario pasados, y se
  entregaba el QR de accesos ya vencidos.

## Reglas

| Regla | Backend | Frontend |
| --- | --- | --- |
| Roles que registran: admin, residente (propietario), inquilino | `PROVIDER_REGISTRATION_ROLES`, `POST /admin/proveedores`, `POST /residente/proveedores`, `POST /inquilino/proveedores` | `registerProviderRequest(role)` y `ProviderRegistrationForm` en las tres pantallas |
| `/inquilino/proveedores*` solo para inquilinos | `requireTenant` | solo `InquilinoView` lo consume |
| En vehículo la placa es obligatoria | `PROVIDER_PLATE_REQUIRED` | error junto al campo Placa |
| A pie el DPI (13 dígitos, regla de HU-C03) es obligatorio | `PROVIDER_DOCUMENT_REQUIRED`, `INVALID_DPI` | error junto al campo DPI |
| Nunca un proveedor sin identificador válido | `ensureProviderIdentifiers` en registro, `/visitas` y acceso especial | `getProviderIdentifierErrors` |
| Sin fechas/horarios pasados (margen de 10 min para el inicio) | `VISIT_DATE_IN_PAST`, `VISIT_WINDOW_EXPIRED`, `VISIT_TIME_IN_PAST` | `getPastVisitWindowErrors`, fecha mínima de hoy |
| No se genera ni entrega QR vencido | token después de validar la vigencia, `qr_value: null` si `EXPIRED`, aprobación tardía `409 QR_WINDOW_EXPIRED` | aviso "QR no disponible" en el historial |

El medio de ingreso (`VEHICULO` / `PEATONAL`) no se guarda en una columna nueva: si no
se envía se deduce de la placa, y las respuestas lo exponen como `medio_ingreso`.

El inquilino deja al proveedor `PENDIENTE` (lo valida el propietario); el propietario y
el administrador lo registran `VALIDADO`. El registro respeta HU-C03: no sobrescribe un
visitante existente sin `confirmar_actualizacion` y rechaza accesos duplicados.

## Pruebas (HU-C06.9)

- `backend/test/providers.huc06.test.js`: identificador por medio de ingreso y vigencia con reloj fijo.
- `backend/src/services/__tests__/providerRegistration.huc06.test.js`: registro por rol, casa ajena, roles sin permiso, identificador, fecha pasada, QR vencido y aprobación tardía.
- `backend/test/app.routes.test.js`: cada rol solo registra en su ruta (403 en las demás).
- `frontend/src/utils/providerAccess.test.ts` y `frontend/src/components/providers/ProviderRegistrationForm.test.tsx`: mensajes visibles, envío por rol y errores del backend en su campo.

```bash
cd backend && npm test
cd frontend && npx vitest run
```
