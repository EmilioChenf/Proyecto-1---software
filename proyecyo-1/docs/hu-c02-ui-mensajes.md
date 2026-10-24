# HU-C02 — Corrección de interfaz, navegación y mensajes de validación

Responsable de la historia: Luis Adrian Estrada.

## C02.1 / C02.2 — Sidebar duplicado

**Causa real.** Tailwind v4 genera sus utilidades dentro de `@layer utilities`, pero `components/admin/adminTheme.css` se importaba **sin capa**. En la cascada CSS, los estilos sin capa ganan a cualquier estilo con capa, sin importar especificidad ni orden. Por eso `.nd-collapse{display:flex}` anulaba `hidden` en el botón "Contraer menú lateral" (`hidden lg:flex`), que debería existir solo desde `lg` (1024 px CSS).

Por debajo de 1024 px CSS (móvil, tablet o escritorio con zoom: 1440 px al 150 % equivale a 960 px CSS) el drawer abierto mostraba **dos controles**: el "Cerrar menú" de la barra superior y el chevron de contraer, que además no hacía nada en ese modo porque solo cambia clases `lg:`. Lo mismo afectaba a `.nd-badge` frente a `lg:hidden`. El `!w-9` del botón era un parche anterior contra esta misma cascada.

**Corrección.**

- `.nd-collapse` y `.nd-badge`, que son las clases del tema que se combinan con utilidades de visibilidad responsive, pasan a `@layer components`. Así las utilidades deciden su visibilidad.
- El archivo declara el orden de capas de Tailwind (`@layer theme, base, components, utilities;`). `main.tsx` importa `App`, y con él este CSS, **antes** que `styles/index.css`; sin la declaración, `components` quedaría por debajo de `base`.
- Las reglas `.nd-content …` (tarjetas, foco de campos, tablas) siguen sin capa a propósito: están diseñadas para imponerse a las utilidades de cualquier vista. Moverlas habría sido un cambio visual masivo.
- No hay hacks por resolución: los controles usan el mismo punto de corte de Tailwind (`lg`) en ambos layouts (`AdminLayout` y `RoleSidebarLayout`, este último usado por residente, inquilino y guardia).

**Guardas.**

- `src/components/admin/adminTheme.layers.test.ts` falla si una clase del tema definida sin capa con `display` se combina con una utilidad de visibilidad responsive. Comprobado con una mutación: devolver `.nd-collapse` al CSS sin capa la hace fallar.
- `src/components/layout/sidebarControls.test.tsx` verifica que los 4 layouts tienen un control de cada tipo, con puntos de corte complementarios, y que el menú abre y cierra.

## C02.8 — Resoluciones y zoom (navegador real)

`frontend/scripts/ui-responsive-check.mjs` controla Edge/Chrome headless por CDP, sin dependencias nuevas. jsdom no aplica la cascada de capas. El script recorre los 4 roles en 375, 768, 1024, 1440 y 1920 px, y en 1440 al 125 % y 150 % y 1920 al 200 %. Cuenta los controles de navegación **visibles** con el menú cerrado y abierto.

| Ejecución | Casos | Con controles duplicados |
|---|---:|---:|
| Antes (`develop` `eb709994`) | 32 | **16** (todos los casos por debajo de 1024 px CSS, en los 4 roles) |
| Después (esta rama) | 32 | **0** |

Resultados completos: `hu-c02-evidencias/antes-resultados.json` y `despues-resultados.json`. Se conserva una muestra de capturas (residente y admin) para no inflar el repositorio.

```bash
cd frontend
VITE_API_URL=http://127.0.0.1:9 npx vite --port 5192 --strictPort --host 127.0.0.1
node scripts/ui-responsive-check.mjs --url http://127.0.0.1:5192 --out ../docs/hu-c02-evidencias --label despues
```

## C02.3 / C02.6 — SweetAlert2

Dependencia: `sweetalert2` **11.26.25** (versión exacta, MIT). Helper único: `src/utils/feedback.ts`.

| Función | Uso | Presentación |
|---|---|---|
| `confirmAction` | Confirmar una acción (`tone: "danger"` para destructivas) | Modal, "Cancelar" a la izquierda y con el foco en acciones destructivas |
| `notifySuccess` | Resultado correcto de una acción | Toast arriba a la derecha (3,5 s), no bloquea |
| `notifyError` | Error de una **acción** (no de campos) | Modal con el mensaje saneado |
| `notifyWarning` | Advertencia que debe leerse | Modal |

Reglas aplicadas:

- **Seguridad.** Solo se usan `titleText` y `text`. En SweetAlert2, `title` y `html` se interpretan como HTML, y los mensajes incluyen nombres de usuarios y visitantes. Una prueba lo detectó durante el desarrollo.
- Los mensajes pasan por `getErrorMessage`, que ya existía: nunca muestran SQL, rutas ni detalles internos. Un 401 no abre alerta, porque la app ya cierra la sesión.
- No se apila el mismo mensaje dos veces. `heightAuto: false` evita que SweetAlert2 altere `html`/`body` y rompa el layout.
- **Sin duplicados.** Una acción informa por SweetAlert2 **o** en la página, nunca por ambos. Los errores de carga de una vista siguen en su `Alert` en línea. Los errores de un formulario o modal siguen dentro del formulario.

## C02.4 / C02.5 — Validaciones dentro del formulario y campos inválidos

- `Input` (componente compartido) marca `aria-invalid` con borde rojo, fondo suave y anillo. Todos los formularios que ya usaban `aria-invalid` lo heredan: cambio de contraseña (HU-C01), viviendas, visitas, accesos especiales.
- `FieldError` (`components/ui/field-error.tsx`) muestra el error junto al campo con icono y texto (no solo color), enlazado con `aria-describedby`.
- `adminTheme.css` mantiene el rojo también con foco dentro de `.nd-content`; antes, la regla de foco imponía el color de acento.
- `UserFormModal` (modal largo con mapa de viviendas):
  - marca cada campo y enfoca el primer error, con lo que el modal se desplaza hasta él;
  - un error del servidor se ubica en su campo: `errores[]`, correo duplicado (409) y conflicto de vivienda;
  - el resto se muestra una sola vez dentro del modal, como `role="alert"`, con un título claro.

## C02.7 — Superficies cubiertas

| Superficie | Confirmación | Éxito | Error | Validación en el formulario |
|---|---|---|---|---|
| Usuarios (admin): eliminar | SweetAlert2 (destructiva) | Toast | SweetAlert2 | — |
| Usuarios (admin): crear/editar (modal) | — | Toast | Dentro del modal, junto al campo | Sí (`UserFormModal`) |
| Usuarios: configuración contractual | — | Toast | (asistente existente) | — |
| Visitas del residente: eliminar visita / visitante frecuente | SweetAlert2 (destructiva) | Toast | SweetAlert2 | — |
| Visitas del inquilino: eliminar visita | SweetAlert2 (destructiva) | Toast | SweetAlert2 | — |
| Respaldos: restaurar | SweetAlert2 (destructiva) | Panel de progreso existente | Panel existente | — |
| Cuenta del inquilino: pagar cuota | SweetAlert2 con desglose | Panel con comprobante (se conserva) | En la página (existente) | — |
| Cambio de contraseña (HU-C01) | — | Sin cambios | Sin cambios | Hereda el estilo inválido de `Input` |

Ya no queda ningún `window.confirm` en la aplicación. Los demás mensajes históricos no relacionados con C02 no se convirtieron.

**Verificación en navegador real**: `frontend/scripts/ui-feedback-check.mjs` simula la API en el propio navegador con CDP (`Fetch.fulfillRequest`), sin backend ni datos reales. Recorre la gestión de usuarios en escritorio (1440 px) y móvil (375 px): confirmación con el foco en "Cancelar", nombre con HTML mostrado como texto, `body`/`html` intactos, error del servidor en SweetAlert2 sin duplicarse en la página, éxito como toast, campos inválidos marcados en el modal y correo duplicado junto a su campo, sin SweetAlert2. **16/16 comprobaciones**: `hu-c02-evidencias/swal-resultados.json` y capturas `swal-*` / `modal-*`.

## C02.9 — REG-UI-03 / REG-UI-04

**No existen** en el repositorio ni en la documentación del proyecto. Las únicas pruebas de regresión documentadas son REG-01, REG-02 y REG-03 de la Tarea 5 (`docs/tarea5-pruebas/pruebas-regresion.md`, sin versionar en el worktree principal). Ninguna es de interfaz. No se inventó su contenido. Como equivalentes para los defectos demostrados en C02 se añadieron:

- `adminTheme.layers.test.ts` + `sidebarControls.test.tsx` + `ui-responsive-check.mjs` (sidebar, responsive y zoom);
- `feedback.test.ts` (SweetAlert2 real en jsdom), `UsersManagement.c02.test.tsx`, `ResidenteVisitsView.c02.test.tsx`, `InquilinoAccountView.payment.test.tsx` (confirmaciones, éxito y error);
- `UserFormModal.c02.test.tsx` + `ui-feedback-check.mjs` (errores dentro del modal y campos inválidos).

## Riesgos conocidos

- Algunas versiones antiguas de `sweetalert2` incluyeron comportamiento dirigido a dominios concretos. Se revisó el build instalado (11.26.25, `dist/sweetalert2.esm.all.js` y `dist/sweetalert2.all.js`): no contiene comprobaciones de `location.host`, de idioma ni de audio. Al actualizar la dependencia conviene repetir esa revisión.
- El cambio de capa solo afecta a `.nd-collapse` y `.nd-badge`. Con el tema en capa, `nd-badge` vuelve a ocultarse en el sidebar contraído, que era la intención original de `lg:hidden`.


## Revisión adicional — 23 de octubre de 2026

Se corrigieron defectos que seguían presentes en la navegación y la recuperación de acceso:

- El botón de cierre móvil permanece por encima del fondo del menú. El panel comienza debajo de la barra superior y la marca del escritorio se oculta en móvil, evitando superposiciones.
- Los cuatro roles comparten `useMobileDrawer`: foco inicial en el enlace activo, recorrido de Tab dentro del menú, cierre con Escape, bloqueo temporal del contenido de fondo y del desplazamiento. Al cerrar o desmontar se restaura el estado anterior; al ampliar a escritorio se cierra el panel móvil.
- Administración también cierra el menú al pulsar la ruta actual. El historial de sanciones marca solo su propio enlace y el módulo de finanzas aparece en su grupo correspondiente. Los enlaces conservan nombres accesibles al contraer el menú.
- Inicio de sesión enfoca el primer campo inválido, limpia el error al editar y bloquea los campos durante el envío. Los errores del servidor usan el saneamiento compartido.
- Recuperación de contraseña muestra los errores junto al correo, enfoca el campo y normaliza la dirección antes del envío.
- Restablecimiento muestra los requisitos y errores de cada contraseña, enfoca el primer error y ofrece solicitar otro enlace cuando falta el código. Impide enviar un enlace incompleto o reutilizar el formulario después del éxito.
- `Input` admite referencias mediante `forwardRef`, necesario para enfocar los campos con React 18.

Validación: **536/536 pruebas del frontend aprobadas (87 archivos)** y compilación de producción correcta. En Node con Web Storage experimental se ejecutó `NODE_OPTIONS=--no-experimental-webstorage npm run test:run` para que jsdom aporte su propio almacenamiento.

Revisión visual en el navegador integrado: recuperación vacía con mensaje y foco, menús de administrador y residente a 375 px, cierre con Escape y al pulsar Dashboard, y menú de administrador a 1024 px con contracción y etiquetas accesibles. Los layouts se renderizaron en una vista temporal con sesión ficticia, sin backend ni datos reales. La matriz CDP histórica no se volvió a ejecutar porque Chrome no expuso su puerto de depuración en este entorno. Las nuevas pruebas cubren también foco circular, restauración al desmontar y cambio a escritorio.
