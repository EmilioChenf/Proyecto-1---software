# Dar de alta un residencial nuevo (una copia por cliente)

Cada residencial que contrata NexusResidencial tiene **su propia copia** del sistema en
Railway: su base de datos, su backend y su frontend. El código es el mismo para todos;
lo que cambia son las **variables** de cada copia.

```
Proyecto Railway "nexus-lasbrisas"
├── MySQL       → datos solo de Las Brisas
├── Backend     → api-lasbrisas.nexus-residencial.com
└── Frontend    → lasbrisas.nexus-residencial.com
```

Ventajas: los datos de un residencial nunca se mezclan con los de otro, cada cliente puede
tener su marca y su correo, y se le puede restaurar un respaldo sin afectar a nadie más.

---

## 1. Antes de empezar

Ten a mano:

| Dato | Ejemplo |
|---|---|
| Nombre del residencial | Residencial Las Brisas |
| Subdominio | `lasbrisas` → `lasbrisas.nexus-residencial.com` |
| Nombre y correo del administrador | Ana López · `ana@lasbrisas.gt` |
| Contraseña temporal del administrador (mínimo 10 caracteres) | genera una aleatoria |
| Cuenta de Gmail para enviar avisos (opcional) | `avisos.lasbrisas@gmail.com` + clave de aplicación |

> El envío de correos por Gmail (SMTP) requiere que el proyecto de Railway esté en el
> **plan Pro**.

## 2. Crear el proyecto en Railway

1. En Railway crea un **proyecto nuevo** con el nombre `nexus-<subdominio>`.
2. Agrega una base de datos **MySQL** (botón *+ New → Database → MySQL*).
3. Agrega un servicio desde el repositorio de GitHub
   `EmilioChenf/Proyecto-1---software` para el **backend**:
   - *Root directory*: `proyecyo-1/backend` (usa su `Dockerfile`).
   - Rama: `main` (o `produccion`, ver sección 7).
4. Agrega otro servicio desde el mismo repositorio para el **frontend**:
   - *Root directory*: `proyecyo-1/frontend` (usa su `Dockerfile`, puerto 8080).

Si la interfaz de Railway cambió, la idea es la misma: un proyecto con tres servicios.

## 3. Variables del backend

En el servicio del backend → **Variables**. Los valores `${{MySQL.…}}` son referencias de
Railway a la base de datos del mismo proyecto; si tu servicio de MySQL tiene otro nombre,
cámbialo en la referencia.

| Variable | Valor | Para qué |
|---|---|---|
| `DB_HOST` | `${{MySQL.MYSQLHOST}}` | Conexión a la base |
| `DB_PORT` | `${{MySQL.MYSQLPORT}}` | |
| `DB_USER` | `${{MySQL.MYSQLUSER}}` | |
| `DB_PASSWORD` | `${{MySQL.MYSQLPASSWORD}}` | |
| `DB_NAME` | `${{MySQL.MYSQLDATABASE}}` | Base de este residencial |
| `NODE_ENV` | `production` | |
| `SESSION_SECRET` | texto aleatorio de 64 caracteres, **distinto en cada cliente** | Firma de sesiones |
| `TRUST_PROXY` | `1` | IP real detrás del proxy de Railway |
| `USE_BCRYPT` | `true` | Solo contraseñas cifradas |
| `FRONTEND_ORIGIN` | `https://lasbrisas.nexus-residencial.com` | CORS y enlaces de los correos |
| `PUBLIC_LANDING` | `false` | Abre directo el inicio de sesión (sin la página comercial) |
| `SMTP_USER` | `avisos.lasbrisas@gmail.com` | Correos (opcional) |
| `SMTP_PASS` | clave de aplicación de 16 letras | Correos (opcional) |
| `EMAIL_FROM_NAME` | `Residencial Las Brisas` | Remitente de los correos |
| `BOOTSTRAP_RESIDENCIAL_NOMBRE` | `Residencial Las Brisas` | Solo para el primer arranque |
| `BOOTSTRAP_ADMIN_NOMBRE` | `Ana López` | Solo para el primer arranque |
| `BOOTSTRAP_ADMIN_CORREO` | `ana@lasbrisas.gt` | Solo para el primer arranque |
| `BOOTSTRAP_ADMIN_PASSWORD` | contraseña temporal (≥ 10 caracteres) | Solo para el primer arranque |
| `BOOTSTRAP_CONTACTO_TELEFONO` | `+502 5555-0000` (opcional) | Contacto del residencial |
| `BOOTSTRAP_DIRECCION` | dirección (opcional) | |

Pagos con Recurrente (opcional): `RECURRENTE_SECRET_KEY`, `RECURRENTE_WEBHOOK_SECRET`,
`RECURRENTE_SANDBOX_ID` con las llaves **de ese residencial**. `PUBLIC_API_URL` (ej. `https://api.brisas.com`)
solo sirve para mostrar en el panel la dirección del webhook. El estado de la integración y los datos
fiscales (FEL simulada) se revisan en **Finanzas → Pagos en línea y factura**.

> Nunca copies `SESSION_SECRET`, claves de Gmail o llaves de Recurrente de un cliente a otro.

## 4. Variables del frontend

| Variable | Valor |
|---|---|
| `VITE_API_URL` | `https://api-lasbrisas.nexus-residencial.com` |

`VITE_API_URL` se usa al **construir** el frontend: si la cambias, vuelve a desplegar.

## 5. Dominios

1. Frontend → *Settings → Networking → Custom domain*: `lasbrisas.nexus-residencial.com`.
2. Backend → *Custom domain*: `api-lasbrisas.nexus-residencial.com`.
3. En el proveedor DNS de `nexus-residencial.com` crea los registros **CNAME** que Railway
   te indique para cada subdominio. El certificado HTTPS lo emite Railway.

## 6. Primer arranque

Al desplegar el backend por primera vez, con la base vacía:

1. Crea todas las tablas del sistema.
2. **No** carga datos de ejemplo (casas, usuarios demo, pagos…).
3. Crea al administrador con la contraseña cifrada.
4. Guarda el nombre y el contacto del residencial.

En los logs del backend debe aparecer:

```
Base de datos vacía: creando el esquema del residencial…
Residencial "Residencial Las Brisas" inicializado. Administrador: ana@lasbrisas.gt.
Servidor corriendo en …
```

Después:

- Entra a `https://lasbrisas.nexus-residencial.com` con el correo y la contraseña temporal.
  El administrador puede cambiarla en **Sesiones** (botón al pie del menú) o usar
  *¿Olvidó su contraseña?*.
- Puedes **borrar `BOOTSTRAP_ADMIN_PASSWORD`** de las variables. Dejar las variables
  `BOOTSTRAP_*` es seguro: si la base ya tiene usuarios reales, el arranque no cambia nada.

Seguridad del arranque:

| Situación | Qué hace |
|---|---|
| Base vacía | Crea el residencial |
| El administrador ya existe | Nada (`YA_INICIALIZADO`) |
| Hay usuarios reales | Nada; lo indica en el log |
| Solo hay datos de ejemplo | Nada, salvo que definas `BOOTSTRAP_LIMPIAR_DEMO=si` |
| Variable inválida (p. ej. contraseña corta) | Lo indica en el log y el servidor sigue |

También se puede ejecutar a mano con las mismas variables: `npm run bootstrap:residencial`.

## 7. Configuración del residencial (la hace el administrador)

En el panel de administración, en este orden:

1. **Configuración → Configuración general**: correo y teléfono de contacto.
2. **Configuración → Marca del residencial**: logo (enlace `https://`) y color. El logo
   aparece en el menú; el nombre, en el menú, el inicio de sesión, la pestaña del navegador
   y los correos.
3. **Configuración → Mantenimiento global** (dentro de las reglas financieras): tarifa mensual de mantenimiento.
4. **Configuración → Horarios de visita** y reglas financieras (día límite, recargos).
5. **Viviendas**: agregar las casas, marcar si están en venta o renta.
6. **Usuarios** y **Configurar contrato** para cada vivienda ocupada.
7. **Amenidades**: horarios de cada amenidad.

## 8. Actualizar a todos los clientes

Todos los proyectos usan el mismo repositorio, así que **un push actualiza a todos**:
Railway vuelve a desplegar cada copia y, al arrancar, el backend aplica solo los cambios de
base de datos pendientes (son aditivos y no borran datos).

Con varios clientes, es mejor no desplegar directo desde `main`:

1. Crea una rama `produccion` y conecta a ella los proyectos de los clientes.
2. Deja tu proyecto actual (el de pruebas/demos) conectado a `main`.
3. Flujo: cambios → `main` → los pruebas en tu copia → merge `main → produccion` →
   se actualizan todos los clientes.

## 9. Respaldos

- El sistema tiene **respaldos automáticos** (Configuración → Respaldos) y restauración.
- Activa además los respaldos de la base MySQL en Railway, si tu plan los incluye.
- Cada cliente se respalda y se restaura por separado.

## 10. Costos de referencia

Cada copia son tres servicios (MySQL, backend y frontend). En Railway se paga por uso de
CPU, memoria y almacenamiento; un residencial pequeño suele quedar en el orden de
**USD 10–25 al mes**. Revisa el consumo real de cada proyecto en *Usage* y ajusta el precio
de tu suscripción para cubrirlo con margen.

## 11. Dar de baja a un cliente

1. Genera y entrega un último respaldo (y las exportaciones a Excel que necesite).
2. Quita los dominios del proyecto y los registros CNAME.
3. Elimina el proyecto de Railway.

---

## Lista de verificación

- [ ] Proyecto `nexus-<subdominio>` con MySQL, backend y frontend
- [ ] Variables del backend (sección 3), con `SESSION_SECRET` nuevo
- [ ] `VITE_API_URL` en el frontend
- [ ] Dominios y CNAME
- [ ] Log: "Residencial … inicializado"
- [ ] Inicio de sesión del administrador
- [ ] Eliminada `BOOTSTRAP_ADMIN_PASSWORD`
- [ ] Marca, mantenimiento global y horarios configurados
- [ ] Correo de prueba recibido (¿Olvidó su contraseña?)
