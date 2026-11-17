---
title: "NexusResidencial — Documento de conclusiones"
subtitle: "Entrega final del proyecto · CC3091 Ingeniería de Software 2"
author: "Arodi Chávez · Diana Sosa · Diego Reyes · Denil Parada · Emilio Chen · Luis Estrada"
date: "Universidad del Valle de Guatemala · Noviembre 2026"
lang: es
---

# 0. Resumen

NexusResidencial es una plataforma web para administrar residenciales: control de visitas con código QR, cobros y pagos en línea, reservas de amenidades, permisos entre propietario e inquilino, comunicados y reportes. El proyecto inició en **enero de 2026** con Design Thinking (Ingeniería de Software 1), pasó por la modelación del sistema y se construyó en **10 sprints de Scrum entre abril y octubre**, más una etapa de cierre en noviembre. Hoy está desplegado en `nexus-residencial.com` (Railway), con los pagos con tarjeta conectados a Recurrente en **modo de pruebas (sandbox)**.

| Indicador | Valor |
|---|---|
| Historias de usuario planteadas al inicio (backlog de IS1, únicas) | 63 |
| Puntos de historia planteados (backlog original) | **294** |
| Puntos de historia realizados en los 10 sprints | **567** |
| Indicador de éxito sobre el alcance original (286 / 294) | **97.3 %** |
| Indicador de éxito con la fórmula de la guía (567 × 100 / 294) | **192.9 %** |
| Presupuesto estimado / ejecutado | Q1,320,000 / Q1,320,000 (100 %) |
| Pruebas automatizadas al cierre | 1,630 (backend 1,052 · frontend 578) |

La sección 8 explica de dónde salen estos números y qué tan exactos son.

---

# 1. Requisitos funcionales identificados en el análisis

Los requisitos funcionales se definieron en la etapa de modelación (Corte 3, 16 de marzo de 2026) y se consolidaron en el informe final de Ingeniería de Software 1 (27 de mayo de 2026, sección IX). La tabla indica para cada uno **en qué sprint se implementó** y su estado final.

| # | Requisito funcional (análisis) | Sprint | Estado |
|---|---|---|---|
| | **Control de accesos** | | |
| RF1 | El residente genera un código QR único por cada visita autorizada | S2 (reforzado en S7: no se puede reutilizar) | Cumplido |
| RF2 | El guardia escanea el QR y ve el estado de la autorización | S2, S3 | Cumplido |
| RF3 | Se registra la hora de entrada y salida de cada visitante | Entrada S2 · salida S7 | Cumplido |
| RF4 | Las autorizaciones se actualizan en tiempo real en la garita | S3 | Cumplido (actualización periódica cada pocos segundos, no WebSockets) |
| RF5 | Se notifica al residente cuando su visita ingresa | S3, S4 (push al celular en el cierre) | Cumplido |
| RF6 | El guardia registra manualmente a un visitante que no está en el sistema | S2 (código manual) · cierre (acceso de emergencia) | **Modificado**: por seguridad el guardia no crea visitas; puede escribir el código a mano y, fuera de horario, el residente pide un acceso de emergencia que aprueba el administrador |
| | **Gestión de pagos** | | |
| RF7 | El residente consulta su estado de cuenta actualizado | S6 | Cumplido |
| RF8 | El residente hace pagos electrónicos e ingresa el monto | S6 (simulado) · S9 (Recurrente) | **Modificado**: se paga el monto exacto pendiente, con tarjeta, en sandbox |
| RF9 | Se genera un comprobante digital descargable | S6 · S9 | Cumplido |
| RF10 | Notificaciones automáticas antes de la fecha límite | S6 · S9 | Cumplido |
| RF11 | Reportes mensuales de pagos y morosidad | S5 · S6 · S9 | Cumplido |
| | **Gestión de amenidades** | | |
| RF12 | Reservar una amenidad eligiendo fecha y hora disponible | S2 | Cumplido |
| RF13 | No permitir conflictos entre reservas | S2 (reforzado en S10) | Cumplido |
| RF14 | Mensaje de confirmación al completar una reserva | S2 | Cumplido |
| | **Gestión de permisos** | | |
| RF15 | El residente asigna permisos al inquilino | S4 | Cumplido |
| RF16 | El inquilino ve sus permisos asignados | S4 | Cumplido |
| RF17 | El inquilino envía solicitudes de permisos al residente | S2, S4 | Cumplido |
| RF18 | Se muestra el horario permitido de cada proveedor frecuente | S3, S4 (reforzado en S10) | Cumplido |
| RF19 | El inquilino activa o desactiva un proveedor con un toque | S3 | Cumplido |
| | **Panel administrativo** | | |
| RF20 | Panel con accesos, pagos y registros | S1, S3, S9 | Cumplido |
| RF21 | Historial de accesos por fecha y usuario | S3 | Cumplido |
| RF22 | Estadísticas de accesos de garita | S3, S4 | Cumplido |
| RF23 | Configurar fechas límite de pago y horario de visitas | S5 | Cumplido |

**Resultado:** 21 de 23 requisitos funcionales se cumplieron como se plantearon y 2 se modificaron (RF6 y RF8). Ninguno quedó sin atender.

El **Anexo A** detalla las 63 historias de usuario del backlog original con su sprint y estado.

---

# 2. Requisitos que no se identificaron al inicio y se agregaron después

Estos requisitos no estaban en el análisis de IS1. Aparecieron por las revisiones técnicas (RTF), por la retroalimentación de usuarios y del Neurolab, o al convertir el proyecto en un producto que se pueda vender a cualquier residencial.

| Sprint | Requisitos agregados | Por qué surgieron |
|---|---|---|
| S2 | Registro rápido de visitas con visitantes frecuentes | Uso real: el residente repite visitantes |
| S5 | Respaldos automáticos programados; exportación de reportes a PDF y Excel | El RNF de respaldos pedía automatizarlos; la administración necesitaba los reportes fuera del sistema |
| S6 | Detalle de cargos y pagos, historial financiero del inquilino, pagos en tiempo real para administración, historial completo de reservas, bloqueo de reservas por sanciones, recordatorios de reservas y disponibilidad general de amenidades | Al construir el módulo financiero se vio que el estado de cuenta solo no bastaba |
| S7 | Cierre de sesión por inactividad reforzado, actualización inmediata de permisos, control de reutilización de QR, validación de placas, fechas y horarios, botones sin función y mensajes de error claros | Hallazgos de la RTF del Sprint 6 (2 críticos y 16 severos) |
| S8 | Centro de notificaciones, auditoría de operaciones sensibles, sesiones activas, recuperación de contraseña y configuración general del residencial | Seguridad y operación diaria |
| S9 | Pasarela de pago real (Recurrente), confirmación de transacciones, pagos fallidos, conciliación, reembolsos, notificaciones de pago, dashboard financiero, exportación avanzada, historial del residente, refactorización y seguridad | Pasar de pagos simulados a pagos con tarjeta |
| S10 | Cambio de contraseña propio con límite de intentos, pagos idempotentes, visitas que conservan su historial y visibilidad compartida entre guardias y administradores | Hallazgos de la RTF 2 (11 casos fallidos, 4 críticos) |
| Cierre (nov) | Contratos de vivienda (venta o renta, enganche, plazo y día de pago), mapa 3D de viviendas, CRUD de amenidades, reportes de fallas con foto, roles personalizados por módulo, panel de indicadores, comunidad (votaciones, documentos y directorio), importación desde Excel, marca propia por residencial, configuración inicial guiada, app instalable (PWA) con notificaciones push, alertas de QR expirado y de visita excedida, acceso de emergencia y botón principal "Autorizar una visita" (hallazgo H2 del Neurolab) | Convertir el sistema en un producto para cualquier residencial, más la retroalimentación del Neurolab y de usuarios |

---

# 3. Requisitos funcionales que no se implementaron

| Requisito | Origen | Por qué no se implementó |
|---|---|---|
| Validar códigos de autorización sin conexión (HU58) | Backlog IS1 | Exige guardar datos de visitas en el dispositivo del guardia; se priorizó la seguridad (un QR copiado sin conexión no se puede invalidar) y la estabilidad de la conexión de Railway. Queda como mejora futura. |
| Delivery con acceso limitado a un área de la residencial (HU52, parcial) | Backlog IS1 | Se implementó el tipo de visita "Delivery", pero no la restricción por zona: requeriría control físico por áreas que la garita no tiene. |
| Sanciones y recargos totalmente automáticos (HU36 y HU62, parcial) | Backlog IS1 | El sistema calcula el recargo o la sanción según las reglas, pero el administrador la aplica con un botón. Se decidió así para evitar multas injustas sin revisión humana. |
| Cobro real con dinero | Análisis (RF8) | La integración con Recurrente funciona de punta a punta, pero quedó **bloqueada en sandbox a propósito**. Activar el modo real requiere la cuenta comercial del residencial y un cambio en el código (sección 9). |
| Cobro automático mensual a la tarjeta | No se planteó | Cada pago es un cobro de una sola vez; el sistema no guarda tarjetas. Es una mejora futura que Recurrente permite. |

---

# 4. En qué sprint se implementó cada requisito

| Sprint | Fechas (2026) | Tema principal | HU | Puntos |
|---|---|---|---|---|
| 1 | 3 – 8 abr | Autenticación, roles, redirección y dashboard base | 4 | 26 |
| 2 | 9 – 22 abr | Autorización de visitas con QR, reservas, permisos del inquilino, accesos en tiempo real | 7 | 29 |
| 3 | 23 abr – 11 may | Métricas, filtros, historial, notificación de llegada, proveedores frecuentes | 10 | 42 |
| 4 | 12 – 27 may | Cancelar reservas, estadísticas, alertas al guardia, permisos, reglamentos, notificaciones masivas, accesos especiales | 15 | 69 |
| 5 | 13 – 28 jul | Fechas límite y recargos, morosos, sanciones, horarios, respaldos, cierre de sesión, resumen mensual, exportaciones | 14 | 88 |
| 6 | 29 jul – 17 ago | Módulo financiero: estados de cuenta, pagos simulados, comprobantes, recordatorios e historiales | 13 | 92 |
| 7 | 18 ago – 8 sep | Corrección de la RTF del Sprint 6: seguridad, salida de visitantes, QR, validaciones, reportes | 10 | 55 |
| 8 | 20 – 29 sep | Notificaciones, auditoría, sesiones activas, recuperación de contraseña, configuración | 5 | 21 |
| 9 | 30 sep – 13 oct | Pagos con Recurrente, conciliación, reembolsos, dashboard financiero, refactorización y seguridad | 15 | 88 |
| 10 | 17 – 27 oct | Corrección de la RTF 2 (8 historias correctivas) y Neurolab | 8 | 57 |
| **Total** | | | **101** | **567** |
| Cierre | 28 oct – 13 nov | Producto vendible y presentación final (ver sección 2) | Fuera de Jira | — |

*Las fechas de inicio de los sprints 5, 7, 8 y 9 se tomaron de la fecha de cierre del sprint anterior y del historial de commits del repositorio.*

---

# 5. Tecnología utilizada y en qué etapa se usó

## 5.1 Frameworks de desarrollo y persistencia

| Tecnología | Uso | Etapa |
|---|---|---|
| **React 18 + TypeScript + Vite** | Interfaz web para los 4 roles | Seleccionado en la modelación (Corte 3); usado desde S1 |
| **Tailwind CSS 4** | Estilos y diseño adaptable a celular | S1 en adelante; rediseño en S9 y en el cierre |
| **Node.js + Express 5** | API y lógica de negocio | Seleccionado en Corte 3; usado desde S1 |
| **MySQL** (librería `mysql2`) | Persistencia relacional con transacciones | Seleccionado en Corte 3 (frente a PostgreSQL y MongoDB); usado desde S1 |
| **Docker y Docker Compose** | Entorno local reproducible (base, API y frontend) | S1 en adelante |
| **Railway** | Hospedaje en la nube de frontend, API y MySQL; plan Pro para correo SMTP | Despliegue en IS2; producción con dominio propio en el cierre |
| **Recurrente** | Pasarela de pago guatemalteca (sandbox) | S9 |
| **Three.js** | Mapa 3D de viviendas | Cierre |
| **Web Push (VAPID) y PWA** | App instalable y notificaciones al celular | Cierre |
| **PDFKit, ExcelJS, Nodemailer** | Comprobantes y reportes PDF, exportación a Excel, correos | S5, S6, S8 |

La comparación de alternativas está en `Tecnología Usada/` del portafolio: React + Node.js frente a Angular + Spring Boot y Vue + Django; MySQL frente a PostgreSQL y MongoDB.

## 5.2 Herramientas de prueba automatizada

| Herramienta | Uso | Etapa |
|---|---|---|
| **Jest + Supertest** | Pruebas unitarias y de rutas del backend | S6 en adelante |
| **node:test** | Pruebas del backend, incluidas suites de integración contra MySQL real aislado | S6 en adelante; suites MySQL en S9 y S10 |
| **Vitest + Testing Library** | Pruebas de componentes y vistas del frontend | S6 en adelante |
| **Playwright** | Recorridos automáticos por rol, capturas y verificación visual | S10 y cierre |

Al cierre del proyecto hay **1,630 pruebas automatizadas**: 920 con Jest, 132 con node:test, 15 suites de integración contra MySQL y 578 con Vitest.

## 5.3 Herramientas para probar la experiencia de usuario

| Herramienta | Uso | Etapa |
|---|---|---|
| Design Thinking: AEIOU, "¿Qué, cómo y por qué?", entrevistas, mapas de empatía | Entender a administrador, residente, inquilino y guardia | Enero – febrero (IS1) |
| Prototipos en Figma y Design Studio | Validar pantallas antes de programar | Febrero – marzo (IS1) |
| Muestra del producto a usuarios y al Product Owner | Comentarios de residentes en cada sprint | S2 en adelante |
| **Neurolab UVG**: seguimiento ocular, sensor GSR Shimmer (estrés), cuestionario SUS y entrevista | 6 voluntarios, 3 roles, 15 de octubre de 2026 | S10 |
| Revisiones técnicas formales (RTF 1 y RTF 2) | Encontrar defectos funcionales y de interfaz | S6 y S9 |

## 5.4 Herramientas de integración continua

| Herramienta | Uso | Etapa |
|---|---|---|
| **GitHub** (ramas y pull requests) | Control de versiones; desde S10 los seis integrantes integran por pull request | Todo el proyecto |
| **Jira** | Backlog, sprints, burndown y velocidad | S1 – S10 |
| **Railway, despliegue automático** | Cada merge a `main` se publica solo en producción (despliegue continuo) | IS2 y cierre |

**No hubo integración continua automatizada.** El repositorio nunca tuvo un flujo de GitHub Actions que corra las pruebas en cada pull request; se ejecutaban a mano antes de integrar. Fue un acuerdo de la retrospectiva del Sprint 10 que no se llegó a cumplir.

---

# 6. Presupuesto: estimado, ejecutado y porcentaje por sprint

**Presupuesto inicial calculado:** **Q1,320,000.00**. Es el resultado de 6 desarrolladores × Q20,000 al mes × 11 meses (enero a noviembre de 2026), con el salario tomado del punto medio del rango de mercado (Q15,000 – Q25,000).

- **Método formal de comparación:** Puntos de Casos de Uso (Karner).
- **Estimación de IS2 (Sprint 5):** dio **24,352 horas-hombre**, sobre ~120 historias extrapoladas desde una muestra. El equipo explicó entonces que asumía dedicación de tiempo completo.
- **Recálculo con los casos de uso reales al cierre:** **6,931 horas-hombre**, que equivalen a **Q1,299,600**. La diferencia con el presupuesto es de 1.5 %.

**Monto ejecutado al final:** **Q1,320,000.00 (100 %)**. El costo se reconoce por mes de trabajo del equipo, igual que en todos los informes de sprint.

Para repartirlo por sprint se usó la duración en días de cada etapa: Q1,320,000 ÷ 334 días = Q3,952 por día.

| Etapa | Fechas (2026) | Días | Monto | % del total | % acumulado |
|---|---|---|---|---|---|
| Análisis y diseño (Design Thinking y modelación) | 1 ene – 2 abr | 92 | Q363,593 | 27.5 % | 27.5 % |
| Sprint 1 | 3 – 8 abr | 6 | Q23,713 | 1.8 % | 29.3 % |
| Sprint 2 | 9 – 22 abr | 14 | Q55,329 | 4.2 % | 33.5 % |
| Sprint 3 | 23 abr – 11 may | 19 | Q75,090 | 5.7 % | 39.2 % |
| Sprint 4 | 12 – 27 may | 16 | Q63,234 | 4.8 % | 44.0 % |
| Receso entre semestres | 28 may – 12 jul | 46 | Q181,796 | 13.8 % | 57.8 % |
| Sprint 5 | 13 – 28 jul | 16 | Q63,234 | 4.8 % | 62.6 % |
| Sprint 6 | 29 jul – 17 ago | 20 | Q79,042 | 6.0 % | 68.6 % |
| Sprint 7 | 18 ago – 8 sep | 22 | Q86,946 | 6.6 % | 75.1 % |
| Sprint 8 | 9 – 29 sep | 21 | Q82,994 | 6.3 % | 81.4 % |
| Sprint 9 | 30 sep – 13 oct | 14 | Q55,329 | 4.2 % | 85.6 % |
| Sprint 10 | 14 – 27 oct | 14 | Q55,329 | 4.2 % | 89.8 % |
| Cierre (producción, presentación y entrega) | 28 oct – 30 nov | 34 | Q134,371 | 10.2 % | 100.0 % |
| **Total** | | **334** | **Q1,320,000** | **100 %** | |

**Lectura del presupuesto:**

- **Los 10 sprints consumieron el 48.5 % del presupuesto** (Q640,240). El análisis y diseño se llevó el 27.5 % y el cierre el 10.2 %.
- **El modelo cobra el receso entre semestres (13.8 %)** porque reconoce el salario por mes, igual que los informes de sprint. Sin el receso, el costo real de trabajo sería **Q1,138,204 (86.2 %)**.
- **El presupuesto se cumplió sin sobrecosto.** El Sprint 8 reportó 81.8 % ejecutado y esta tabla da 81.4 % a la misma fecha, así que ambos cálculos coinciden.

---

# 7. Requisitos no funcionales y grado de cumplimiento

| Categoría | Requisito y métrica | Cumplimiento | Evidencia |
|---|---|---|---|
| Rendimiento | Pantallas principales ≤ 3 s | **Cumplido (no medido formalmente)** | Las vistas cargan en menos de un segundo en las pruebas manuales y del Neurolab; no hay medición instrumentada en producción |
| Rendimiento | Verificación en garita ≤ 2 s | **Cumplido** | Validar un QR es una consulta indexada; en las pruebas y el Neurolab la respuesta es inmediata |
| Rendimiento | Reportes financieros ≤ 5 s | **Cumplido** | Los PDF se generan al momento desde la base, sin almacenarse |
| Rendimiento | ≥ 100 usuarios concurrentes | **No verificado** | No se hicieron pruebas de carga reales; fue un acuerdo pendiente desde el Sprint 7 |
| Seguridad | 100 % de accesos con login | **Cumplido** | Sesiones firmadas con HMAC-SHA256 y tabla de sesiones activas; las pruebas comprueban que sin sesión se responde 401 |
| Seguridad | Contraseñas cifradas (bcrypt) | **Cumplido** | bcrypt costo 12; las cuentas heredadas en texto plano se migran al cambiar la contraseña |
| Seguridad | HTTPS obligatorio | **Cumplido** | Dominio propio con certificado de Railway |
| Seguridad | Auditoría de acciones críticas | **Cumplido en lo principal** | Tabla de auditoría para pagos, permisos, contraseñas y configuración (S8) |
| Seguridad | Control de acceso por rol (RBAC) | **Cumplido y ampliado** | 4 roles base más roles personalizados por módulo (cierre) |
| Disponibilidad | ≥ 99 % mensual | **No medido** | Railway mantiene el servicio activo, pero no hay monitoreo de disponibilidad |
| Disponibilidad | Garita sin caídas en horario operativo | **No medido** | Ídem |
| Disponibilidad | Respaldo automático cada 24 h | **Cumplido** | Respaldos programables (diario, semanal o mensual) y restauración validada (S5) |
| Usabilidad | Tarea principal en ≤ 3 intentos | **Cumplido en general** | Neurolab: 18 de 18 tareas completadas; el residente pidió ayuda en un caso (hallazgo H2, corregido en el cierre) |
| Usabilidad | Autorizar visita en ≤ 5 pasos | **Cumplido** | Botón principal "Autorizar una visita" y formulario de una pantalla |
| Usabilidad | 100 % de errores con mensaje claro | **Cumplido** | S7 HU12 y S10 HU-C02 |
| Usabilidad | Consistencia visual | **Cumplido** | Rediseño de todas las vistas (S9 HU33) y componentes compartidos |
| Escalabilidad | Agregar residencias sin afectar rendimiento | **Cumplido con un modelo de copia por cliente** | Cada residencial tiene su propio proyecto y base en Railway; guía de alta y configuración inicial guiada |
| Mantenibilidad | Código con estándares documentados | **Cumplido** | Documentación por historia en `docs/`, documento técnico y 1,630 pruebas |
| Mantenibilidad | Actualizar sin perder datos | **Cumplido** | Migraciones incrementales al iniciar el servidor; respaldos antes de cambios |

**Resumen:** de 19 requisitos no funcionales, 15 se cumplieron, 1 se cumplió en lo principal y 3 no se midieron: la concurrencia de 100 usuarios y los dos de disponibilidad. Lo que faltó en todos los casos fue **medir**, no implementar.

---

# 8. Puntos de historia e indicador de éxito

## 8.1 Puntos planteados al inicio (Ingeniería de Software 1)

El backlog de IS1 (informe del Sprint 1, 8 de abril de 2026) tenía **69 historias numeradas**. Al quitar las 8 repetidas quedan **63 historias únicas**. Cuatro de ellas (interfaz amigable, disponibilidad 24 h, seguridad y tiempo real) se reclasificaron como requisitos no funcionales y no llevan puntos.

El backlog original **no tenía puntos asignados**: los puntos se estimaban con Planning Poker al planificar cada sprint. Por eso los puntos planteados se reconstruyeron así:

- **Para cada historia original implementada:** los puntos que el equipo le asignó en Jira al planificarla.
- **Para la historia eliminada:** la misma escala relativa (3, 5 u 8 puntos).
- **Dos datos estimados por falta de detalle:** el reparto por historia del Sprint 2 (el informe solo da el total, 29) y qué parte de los 92 puntos del Sprint 6 corresponde a historias originales.

| Concepto | Historias | Puntos |
|---|---|---|
| **Planteados al inicio (backlog IS1)** | 63 (59 con puntos) | **294** |
| Realizados tal como se plantearon | 54 | 262 |
| Realizados con modificaciones | 4 | 24 |
| **Realizados del alcance original (subtotal)** | 58 | **286** |
| Eliminados | 1 (validación sin conexión) | 8 |
| Reclasificados como requisitos no funcionales | 4 | 0 |
| **Agregados nuevos** (S2, S6 – S10) | 47 historias de sprint | **281** |
| **Total realizado en los 10 sprints** | 101 historias de sprint | **567** |

*Las 4 historias modificadas son: recargos aplicados con un botón (HU36, 8 puntos), sanciones aplicadas con un botón (HU62, 8), delivery sin restricción de área (HU52, 5) y aviso al inquilino cuando la visita llega, no antes (HU56, 3). Las filas de agregados y total cuentan historias de sprint en Jira, que no equivalen una a una a las historias del backlog original: una historia original pudo repartirse en varias de sprint.*

## 8.2 Indicador de porcentaje de éxito

Con la fórmula de la guía:

> **(Total de puntos realizados × 100) / Total de puntos planteados = (567 × 100) / 294 = 192.9 %**

Este valor pasa de 100 % porque cuenta los 281 puntos agregados durante el proyecto. Para medir el cumplimiento de lo prometido al inicio, el equipo usa también:

> **Puntos realizados del alcance original × 100 / puntos planteados = (286 × 100) / 294 = 97.3 %**

**Conclusión:** se entregó el 97.3 % del alcance original y, además, casi el mismo volumen de trabajo nuevo. La mitad del esfuerzo fue trabajo que no se previó en el análisis: correcciones de calidad y seguridad, pagos reales y funciones de producto. A esto se suma el trabajo del cierre de noviembre, que no se registró en Jira y por lo tanto no aparece en los 567 puntos.

---

# 9. Próximos pasos para poner el sistema en producción real

El sistema ya está publicado, pero falta lo siguiente para operar con un residencial que pague y cobre dinero real.

| # | Paso | Detalle |
|---|---|---|
| 1 | **Activar pagos reales** | El residencial abre su cuenta comercial en Recurrente (4.5 % + Q2 por pago). Se cambia el código, que hoy rechaza a propósito todo lo que no sea sandbox, se cargan las llaves reales en Railway y se prueba con un cobro pequeño. |
| 2 | **Facturación electrónica (FEL)** | Contratar un certificador autorizado por la SAT y conectar el módulo, que ya está preparado en modo simulado. |
| 3 | **Integración continua** | Configurar GitHub Actions para correr las 1,630 pruebas en cada pull request y bloquear el merge si fallan. Versionar los datos que necesitan las suites heredadas (hu16, hu17, hu18, hu19, finalaudit). |
| 4 | **Pruebas de carga** | Medir 100 usuarios simultáneos (por ejemplo, con k6) y documentar tiempos reales de garita y reportes. |
| 5 | **Monitoreo y alertas** | Monitor de disponibilidad para el dominio y la API, alertas de errores y registro centralizado, para medir el RNF de 99 %. |
| 6 | **Respaldos fuera del servidor** | Copiar los respaldos automáticos a almacenamiento externo (S3 o R2) y probar una restauración completa cada mes. |
| 7 | **Piloto con un residencial** | Alta con la guía `NUEVO-RESIDENCIAL.md`, importación desde Excel, capacitación de administrador y guardias, y un mes de acompañamiento. |
| 8 | **Aspectos legales y comerciales** | Contrato de servicio, política de privacidad revisada por un abogado, términos de uso, y precios (Q10 por vivienda, mínimo Q800 al mes) validados con clientes. |
| 9 | **Mejoras de UX pendientes** | Repetir el Neurolab para medir el efecto de H2 y H3, modo oscuro sugerido por usuarios y validación de QR sin conexión. |
| 10 | **Escalar** | Desde ~30 clientes, pasar a un modelo multi-residencial (una base con identificador de residencial) para bajar el costo de Railway por cliente. |

---

# Anexo A. Historias del backlog original (IS1): estado y sprint

| HU | Historia (resumen) | Estado | Sprint |
|---|---|---|---|
| 1 | Admin: ver todos los accesos en un panel | Realizada | S2, S3 |
| 2 | Admin: historial de ingresos y autorizaciones | Realizada | S3, S4 |
| 3 | Residente: autorizar visitas desde el sistema | Realizada | S2 |
| 4 | Residente: autorizaciones registradas para el guardia | Realizada | S2 |
| 5 | Inquilino: solicitar permisos al propietario | Realizada | S2, S4 |
| 6 | Inquilino: saber qué accesos puede gestionar | Realizada | S3 |
| 7 | Guardia: verificar autorizaciones en tiempo real | Realizada | S2 |
| 8 | Guardia: ver datos del visitante rápido | Realizada | S2 |
| 9 | Residente: autorizaciones sincronizadas con garita | Realizada | S2, S3 |
| 10 | Admin: reportes mensuales de pagos y mora | Realizada | S5, S6 |
| 11 | Admin: recordatorios automáticos de pago | Realizada | S6 |
| 12 | Residente: estado de cuenta en tiempo real | Realizada | S6 |
| 13 | Residente: comprobante oficial de pago | Realizada | S6 |
| 14 | Residente: aviso de fecha límite de pago | Realizada | S6 |
| 15 | Residente: reservar con calendario | Realizada | S2 |
| 16 | Residente: cancelar o modificar reserva | Realizada | S4 |
| 17 | Inquilino: ver permisos asignados | Realizada | S4 |
| 18 | Inquilino: solicitar autorización digital | Realizada | S4 |
| 19 | Inquilino: proveedores frecuentes con reglas | Realizada | S3 |
| 20 | Guardia: estado Aprobado / Pendiente / Rechazado | Realizada | S2 |
| 21 | Guardia: buscar por casa o placa | Realizada | S3 |
| 22 | Guardia: hora de ingreso y salida automática | Realizada | S2 (ingreso), S7 (salida) |
| 23 | Guardia: diferenciar visita, delivery y proveedor | Realizada | S5 |
| 24 | Residente: historial de visitas | Realizada | S3 |
| 25 | Admin: estadísticas por día y hora | Realizada | S3, S4 |
| 26 | Residente: reglamentos en un solo lugar | Realizada | S4 |
| 27 | Admin: historial de reservas y sanciones | Realizada | S5, S6 |
| 28 | Residente: notificación de llegada de visita | Realizada | S3, S4 |
| 29 | Admin: interfaz amigable | Reclasificada como RNF | S7, S10, Neurolab |
| 30 | Guardia: sistema disponible 24 h | Reclasificada como RNF | Railway |
| 31 | Admin: sistema seguro e inalterable | Reclasificada como RNF | S7, S8, S10 |
| 32 | Admin: actualización en tiempo real | Reclasificada como RNF | S3 |
| 33 | Admin: evitar abuso de amenidades | Realizada | S5 |
| 34 | Residente: aviso cuando ocurre un error | Realizada | S7 |
| 35 | Residente: confirmación de reserva | Realizada | S2 |
| 36 | Admin: fechas límite y recargos automáticos | Modificada (recargo con un botón) | S5 |
| 42 | Inquilino: gestionar visitas según permisos | Realizada | S2, S3 |
| 43 | Admin: gestionar roles | Realizada (ampliada con roles personalizados) | S1, cierre |
| 44 | Usuario: iniciar sesión según rol | Realizada | S1 |
| 46 | Admin: ver residentes morosos | Realizada | S5 |
| 47 | Residente: ver lugares y horas para reservar | Realizada | S2, S6 |
| 48 | Admin: aprobar accesos especiales | Realizada | S4 |
| 49 | Admin: horarios generales de visita | Realizada | S5 |
| 50 | Admin: notificaciones masivas segmentadas | Realizada | S4 |
| 51 | Admin: historial de cambios en permisos | Realizada | S4 |
| 52 | Residente: delivery con acceso limitado | Modificada (sin restricción de área) | S5 |
| 53 | Residente: ver si la visita ya ingresó | Realizada | S3, S4 |
| 54 | Residente: programar visitas futuras | Realizada | S2 |
| 55 | Residente: adjuntar información a la visita | Realizada | S5 |
| 56 | Inquilino: alerta cuando la visita está por llegar | Modificada (aviso al llegar) | S3 |
| 57 | Inquilino: proveedores con validación del propietario | Realizada | S3, S4 |
| 58 | Guardia: validar sin conexión | **Eliminada** | — |
| 59 | Guardia: foto opcional del visitante | Realizada | S2 |
| 60 | Admin: dashboard general | Realizada | S1, S3 |
| 61 | Guardia: aviso de autorización cancelada | Realizada | S4 |
| 62 | Admin: sanciones automáticas por amenidades | Modificada (sanción con un botón) | S5 |
| 63 | Admin: amenidades con mayor demanda | Realizada | S4 |
| 64 | Usuario: redirección por rol | Realizada | S1 |
| 65 | Residente: resumen mensual | Realizada | S5 |
| 66 | Residente: usuarios autorizados en la vivienda | Realizada | S5 |
| 67 | Inquilino: confirmación de acciones | Realizada | S7, S10 |
| 68 | Admin: restaurar respaldos | Realizada | S5 |
| 69 | Usuario: cierre de sesión por inactividad | Realizada | S5, S7 |

*Las historias 37 a 41, la segunda numeración de 43 y 44, y la 45 repiten a otras (1, 10, 28, 16, 18, 35, 33 y 22) y no se cuentan dos veces.*
