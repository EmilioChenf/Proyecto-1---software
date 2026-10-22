# HU-C01 — Corrección de autenticación y seguridad

## Diagnóstico inicial

| Aspecto | Estado encontrado |
|---|---|
| Contraseñas | `USUARIO.password`. Altas/ediciones de admin y recuperación guardan bcrypt (costo 10–12). `comparePassword` acepta además texto plano heredado cuando `USE_BCRYPT=false` (semillas `1234`). |
| Login | `POST /login` → `loginUser`: recorta correo y contraseña, compara y crea una fila en `SESION_ACTIVA`. |
| Tokens | HMAC-SHA256 propio (`sessionTokenService`) con `sub` (usuario), `sid` (sesión) y `exp` (8 h). |
| Validación de sesión | Todos los middlewares (`requireRoles`, `requireAdminSession`, `requireFinancialSession`, `requireResidentSession`) verifican la firma **y** `assertActiveSession` (fila no revocada ni expirada). Revocar la fila invalida el token en la siguiente petición. |
| Recuperación | `POST /auth/password/forgot` y `POST /auth/password/reset` (token de un solo uso, hash SHA-256, revoca sesiones). Política: 8–128 caracteres con letras y números (`validateNewPassword`). |
| Cambio propio | **No existía.** Solo un administrador podía cambiar la contraseña de otro usuario. |
| Rate limiting | `express-rate-limit` en `/login` (20/15 min) y `/auth/password/forgot` (5/15 min), definidos a nivel de módulo. `/auth/password/reset` no tenía límite. Sin `trust proxy`. |
| Errores | `{ message, code? }`. El frontend trata cualquier 401 (fuera de `/login`) como sesión expirada y cierra la sesión. |

## Cambio de contraseña propia

`POST /auth/password/change` (cualquier rol autenticado, Bearer real)

```json
{ "currentPassword": "...", "newPassword": "...", "confirmPassword": "..." }
```

1. Valida campos, confirmación y política (la misma de la recuperación; además rechaza espacios al inicio o al final, porque el login los recorta).
2. En una transacción con `SELECT ... FOR UPDATE` sobre el usuario: verifica la contraseña actual, rechaza reutilizarla, guarda el nuevo hash bcrypt (costo 12), **revoca todas las sesiones del usuario** (incluida la que hizo la petición), invalida enlaces de recuperación pendientes, crea una sesión nueva y registra `PASSWORD_CHANGED` en `AUDITORIA` (sin contraseñas ni hashes).
3. Responde `200` con `{ message, id, email, role, token }` y `Cache-Control: no-store`. El frontend guarda el token nuevo; los demás dispositivos quedan fuera en su siguiente petición (`401 SESSION_REVOKED`).

El usuario se toma siempre de la sesión validada; un `id_usuario` en el cuerpo se ignora. Las cabeceras simuladas de pruebas (`x-user-id`) no sirven para este endpoint.

La UI está en la página de seguridad de cada rol (`/residente/sesiones`, `/inquilino/sesiones`, `/guardia/sesiones`, `/cuenta/sesiones`).

## Rate limiting (servidor)

`src/middlewares/securityRateLimits.js`, creado por instancia de la app y aplicado solo a POST.

| Endpoint | Límite | Clave |
|---|---|---|
| `POST /login` | 20 / 15 min | IP |
| `POST /auth/password/forgot` | 5 / 15 min | IP |
| `POST /auth/password/reset` | 10 / 15 min (nuevo) | IP |
| `POST /auth/password/change` | 5 / 15 min (nuevo) | usuario del token (IP si no hay token) |

En el cambio de contraseña, los errores de formulario (confirmación, política, campos) no consumen el límite: solo la contraseña actual incorrecta, los éxitos y las peticiones sin sesión. Respuesta: `429 { message, code: "RATE_LIMITED" }` con `Retry-After` y encabezados `RateLimit`.

**Proxy:** detrás de un proxy inverso hay que definir `TRUST_PROXY=<saltos>` (p. ej. `1`); si no, todos los clientes comparten la IP del proxy y el límite. Sin la variable, el comportamiento es el anterior.

## Códigos HTTP

| Caso | Código | `code` |
|---|---|---|
| Cambio exitoso | 200 | — |
| Credenciales de login incorrectas | 401 | `INVALID_CREDENTIALS` |
| Sin sesión o token inválido | 401 | `SESSION_REQUIRED` |
| Sesión revocada o expirada | 401 | `SESSION_REVOKED` |
| Contraseña actual incorrecta | 400 | `CURRENT_PASSWORD_INVALID` |
| Campos faltantes | 400 | `PASSWORD_FIELDS_REQUIRED` |
| Confirmación distinta | 400 | `PASSWORD_CONFIRMATION_MISMATCH` |
| Política no cumplida | 400 | `PASSWORD_POLICY` |
| Nueva igual a la actual | 400 | `PASSWORD_REUSED` |
| Límite excedido | 429 | `RATE_LIMITED` |

La contraseña actual incorrecta es `400` y no `401` a propósito: la sesión sigue siendo válida y un 401 haría que el frontend cerrara la sesión. Los errores de validación incluyen `errores: [{ field, message }]`, formato que el frontend ya interpretaba. Los `code` son aditivos: el `message` existente no cambia.

## Migraciones

Ninguna. Se reutilizan `USUARIO`, `SESION_ACTIVA`, `PASSWORD_RESET_TOKEN` y `AUDITORIA`.

## Pruebas

- `backend/test/authSecurity.test.js` (sin BD, dentro de `npm test`): límites y 429 de los 4 POST, contadores por instancia, GET que no consumen límite, 401 estandarizados y validaciones.
- `backend/test/integration/huc01.mysql.test.js` (`npm run test:huc01:mysql`): flujo completo con login y Bearer reales.
- `frontend/src/components/auth/ChangePasswordCard.test.tsx`: formulario → servicio → `AuthProvider` con `fetch` simulado.

## Fuera de alcance (documentado, no corregido)

- El alta/edición de usuarios por administrador acepta contraseñas de 4 caracteres; la política de 8 aplica a recuperación y cambio propio.
- `resetPassword` no recorta ni rechaza espacios al inicio/final, mientras el login sí recorta: una contraseña recuperada con esos espacios no podría usarse.
- Con `USE_BCRYPT=false`, el login acepta contraseñas heredadas en texto plano. Al cambiarlas con este flujo quedan con bcrypt.
