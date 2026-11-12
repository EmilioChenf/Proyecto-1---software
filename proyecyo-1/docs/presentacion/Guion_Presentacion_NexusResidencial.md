---
title: "Guion de la presentación final — NexusResidencial"
subtitle: "Pitch con demostración en vivo · 14 minutos · 6 integrantes"
lang: es
---

# Cómo usar este guion

- La presentación es `presentacion.html` (Chrome). **Flechas / clic** avanzar, **F** pantalla completa, **N** muestra el guion en pantalla, **T** cronómetro.
- **No lean**: aprendan la idea de cada slide y díganla con sus palabras.
- **Relevos**: cada quien termina con su frase de relevo; el siguiente arranca sin pausa.
- **Tiempo total: 14 minutos.** Si van tarde, recorten en las slides de 4 tarjetas, nunca en la demo ni en UX.
- **Pestañas para la demo:** en el mismo navegador abran una pestaña por rol (administrador, guardia, residente e inquilino) e inicien sesión en cada una; cada pestaña conserva su rol aunque se recargue. Háganlo unos 10 minutos antes: tras 30 minutos sin tocar una pestaña, el sistema cierra esa sesión por seguridad.
- **Todo lo que se dice existe en producción** (`nexus-residencial.com`). No mencionar funciones que no estén ahí.

| # | Integrante | Sección | Tiempo | Criterio de la rúbrica |
|---|---|---|---|---|
| 1 | Luis Estrada | Apertura e hilo narrativo | 0:00 – 2:00 | Criterio 1 (hilo narrativo, 1.12 pts) |
| 2 | Diana Sosa | Problemática del cliente | 2:00 – 4:00 | Criterio 2 (problemática del cliente, 0.96 pts) |
| 3 | Arodi Chávez | Valor e impacto de negocio | 4:00 – 6:00 | Criterio 3 (valor e impacto, 0.80 pts) |
| 4 | Emilio Chen | Demo EN VIVO y cómo lo probamos (Neurolab) | 6:00 – 9:40 | Criterio 4 (solución, demo y pruebas con usuarios, 2.56 pts) |
| 5 | Diego Reyes | Resultados UX y calidad | 9:40 – 11:30 | Criterio 4 (resultados de usuarios y mejoras) |
| 6 | Denil Parada | Arquitectura, justificación tecnológica y cierre | 11:30 – 14:00 | Criterio 5 (tecnología, 0.80 pts) + cierre del criterio 1 |

# Preparación de la demo en vivo (hacer el día anterior y 15 min antes)

1. **Equipos:** laptop conectada al proyector + celular del guardia con datos móviles (por si falla el WiFi del salón).
2. **Cuentas de producción listas** (usar cuentas de demostración, nunca datos reales):
   - Laptop, una pestaña por rol en la misma ventana: **residente** (con vivienda, saldo y alguna reserva), **inquilino**, **administrador** (Dashboard, Viviendas e Indicadores) y **guardia**.
   - Celular: **guardia** en *Control de acceso* para escanear con la cámara (o usar la pestaña del guardia en la laptop con *Código manual*).
3. **Horario:** la presentación debe caer dentro del horario de visitas (por defecto 06:00–22:00). La visita se crea con **inicio = hora actual** (el sistema da 10 minutos de margen) y fin una hora después.
4. **Ensayo:** hacer el flujo completo una vez antes de entrar (crear visita → escanear). Borrar o cancelar esa visita de prueba.
5. **Pantalla:** zoom del navegador al 110–125 % para que el jurado lea; desactivar notificaciones del sistema operativo.
6. **Plan B:** si falla internet o la cámara, Emilio usa las slides 11–14 (son capturas del mismo flujo) o escribe el código del QR en *Código manual*.
7. **Tiempo de la demo: 3 minutos.** Si se pasa, saltar el paso de Pagos (slide 13).

# Luis Estrada — Apertura e hilo narrativo (0:00 – 2:00)

**Objetivo:** Abrir con el video, plantear la pregunta “¿Quién entró?” y anunciar el recorrido.

**Cuenta para:** Criterio 1 (hilo narrativo, 1.12 pts)

**Antes de hablar:** la slide 1 es el video de lanzamiento (21 s, con música). Si aparece el botón ▶ Reproducir video, tóquenlo. Luis se para al frente, lo deja correr sin hablar y al terminar avanza.

## Slide 1 · 0:00 · Video de lanzamiento (/brag)

(Sin hablar: dejar correr el video de 21 segundos. Al terminar, avanzar.)

## Slide 2 · 0:25 · Ingeniería de Software 1 · Proyecto final

Buenos días. Somos NexusResidencial, un software para administrar residenciales: visitas con QR, cobros y la convivencia de toda la comunidad en una sola app. Somos seis: Diana, Arodi, Emilio, Diego, Denil y yo, Luis. (Pausa de 2 segundos.) Vuelvo a la pregunta del video.

## Slide 3 · 0:45 · Martes · 22:00 · garita

Martes, 10 de la noche. Un visitante entra al residencial y nadie anota bien su nombre. Al día siguiente un vecino pregunta: ¿quién entró anoche? ¿Lo autorizó alguien? En la mayoría de residenciales nadie puede responder con certeza: la respuesta está en una libreta, en un chat de WhatsApp o en la memoria del guardia. Eso fue lo que escuchamos una y otra vez en nuestras entrevistas.

## Slide 4 · 1:15 · El hilo de hoy

Hoy les contamos cómo pasamos de esa libreta en garita a un software que ya está en producción y que se puede vender a cualquier residencial. Lo hicimos en 11 meses: primero Design Thinking, entrevistando a administradores, residentes, inquilinos y guardias, y después 11 sprints de Scrum. Vamos a ver el problema, el valor para el negocio, la solución funcionando con pruebas reales de usuarios, y por qué la construimos así. Diana nos cuenta quién es el cliente.

**Frase de relevo:** “…Diana nos cuenta quién es el cliente.”

**Preguntas que te pueden tocar:**

- ¿Cuánto duró el proyecto? → 11 meses: enero–marzo Design Thinking; 16 de marzo–27 de octubre, 11 sprints.
- ¿Para quién es? → Para cualquier residencial o empresa administradora; lo paga la administración.

# Diana Sosa — Problemática del cliente (2:00 – 4:00)

**Objetivo:** Dejar claro QUIÉN paga (la administración), QUIÉN usa (4 perfiles) y QUÉ duele (3 problemas + consecuencias).

**Cuenta para:** Criterio 2 (problemática del cliente, 0.96 pts)

## Slide 5 · 2:00 · El cliente

Nuestro cliente directo es la administración del residencial: es quien contrata el sistema. Pero el problema lo viven cuatro perfiles: el administrador, que lleva finanzas, contratos y accesos; el residente, que paga cuotas, autoriza visitas y reserva amenidades; el inquilino, que vive ahí pero depende de los permisos del propietario; y el guardia, que controla físicamente quién entra. Lo comprobamos entrevistando a los cuatro perfiles durante la fase de Design Thinking. Y es un mercado que crece: los condominios y la vivienda vertical son hoy la tendencia dominante de construcción en Guatemala, y cada uno necesita administrarse.

## Slide 6 · 2:40 · Cómo funciona hoy

Hoy estos residenciales funcionan con libreta, Excel, llamadas y WhatsApp. Eso genera tres problemas críticos. Primero, acceso inseguro: el guardia no tiene forma de verificar que el visitante fue realmente autorizado. Segundo, finanzas opacas: el residente no sabe en tiempo real cuánto debe ni por qué lo multaron, y el administrador calcula vencimientos y penalizaciones a mano. Tercero, cero trazabilidad: nadie puede responder quién modificó un contrato o quién entró el martes a las 10 de la noche.

## Slide 7 · 3:20 · Las consecuencias (lo que nos dijeron en las entrevistas)

Las consecuencias son concretas. Residentes que disputan sanciones porque nunca recibieron aviso. Visitantes que entran sin una autorización verificable. Amenidades usadas sin reserva y sin responsable. E inquilinos que se enteran tarde porque la información no les llega. Todo esto son horas de trabajo administrativo perdidas cada semana y una percepción de desorden que afecta la convivencia y el valor de la propiedad. Arodi nos explica cuánto vale resolver esto.

**Frase de relevo:** “…Arodi nos explica cuánto vale resolver esto.”

**Preguntas que te pueden tocar:**

- ¿Qué evidencia tienen? → Entrevistas, mapas de empatía e insights de Design Thinking con los 4 perfiles (feb 2026).
- ¿Por qué ahora? → Los condominios y la vivienda vertical son la tendencia de construcción en Guatemala (E&N 2025).

# Arodi Chávez — Valor e impacto de negocio (4:00 – 6:00)

**Objetivo:** Comparar antes vs después con métricas, decir los supuestos, el modelo de negocio, los costos reales y cuánto cuesta pagar con tarjeta.

**Cuenta para:** Criterio 3 (valor e impacto, 0.80 pts)

## Slide 8 · 4:00 · Valor: antes vs después

¿Qué cambia para el residencial? Comparemos. Autorizar una visita hoy es una llamada y una anotación en libreta, unos 3 minutos; con NexusResidencial el residente genera un QR y garita lo valida en segundos. Con 40 visitas diarias en un residencial de 150 casas, eso es cerca de hora y media diaria de garita. Los cobros: el administrador dedica unas 8 horas al mes a calcular multas; ahora las cuotas y recordatorios salen solos y los recargos y sanciones se calculan con un clic según las reglas del residencial. La morosidad se ve mes a mes. Y la trazabilidad pasa de nada a 100 % de accesos registrados. Estos números son estimaciones con los supuestos que ven abajo.

## Slide 9 · 4:45 · Modelo de negocio

El modelo es suscripción: Q10 por vivienda al mes, más Q2,500 de instalación. Un residencial de 150 casas paga Q1,500 al mes; operarlo cuesta el plan Pro de Railway, 20 dólares al mes, que es el que permite enviar los correos de recuperación y de avisos por Gmail, más el dominio, 11 dólares al año. El correo y los avisos push no cuestan. Con soporte, el margen es de 56 por ciento. Estamos en el rango del mercado, alrededor de un dólar con treinta por unidad, pero con QR de garita, pagos en quetzales y mapa 3D. Beneficia a la administración, que deja el trabajo manual; a residentes e inquilinos, que ganan transparencia; y a garita. Nuestro desarrollo costó Q1,320,000; con 60 clientes se recupera en unos dos años.

## Slide 10 · 5:25 · ¿Cuánto cuesta pagar con tarjeta?

¿Y cuánto cuesta que un residente o inquilino pague con tarjeta? Recurrente cobra 4.5 % más Q2 por cada pago exitoso, sin mensualidad. Si alguien paga su mantenimiento de Q500, la comisión es de Q24.50 y al residencial le llegan Q475.50. Hoy el sistema funciona en el sandbox de Recurrente: es el modo de pruebas, con tarjetas de prueba, sin dinero real y sin comisión. Para cobrar de verdad, el residencial abre su cuenta comercial y cambiamos las llaves. El residencial decide si absorbe la comisión o la contempla en su cuota. Emilio les muestra el sistema, en vivo.

**Frase de relevo:** “…Emilio les muestra el sistema, en vivo.”

**Preguntas que te pueden tocar:**

- ¿De dónde salen los números? → Supuestos explícitos: 150 casas, 40 visitas/día, 3 min vs <1 min por visita.
- ¿Quién paga la comisión de Recurrente? → El residencial decide: la absorbe o la contempla en su cuota (4.5 % + Q2; Q500 → Q24.50). El sandbox no cuesta.
- ¿Cuánto cuesta operarlo? → Railway Pro USD 20/mes + dominio USD 11/año ≈ USD 251/año.
- ¿Cuándo recuperan la inversión? → Con 60 clientes ~2.2 años; con 30, ~4.4 años (doc. técnico, sección 10).

# Emilio Chen — Demo EN VIVO y cómo lo probamos (Neurolab) (6:00 – 9:40)

**Objetivo:** Mostrar en vivo visita → QR → garita → cobros → administración, y presentar cómo se probó con usuarios en el Neurolab.

**Cuenta para:** Criterio 4 (solución, demo y pruebas con usuarios, 2.56 pts)

## Slide 11 · 6:00 · Demo en vivo · 1 · el residente autoriza una visita

EN VIVO (laptop, pestaña del RESIDENTE). Esta slide queda de respaldo. Digo: “Soy residente y viene un amigo a visitarme.” Toco “Autorizar una visita” → nombre “Visita del jurado”, DPI de 13 dígitos → Siguiente → fecha de hoy, inicio = hora actual, fin = una hora después → Siguiente → “Autorizar visita”. Aparece el QR con los botones Descargar y Compartir: “Esto se lo mando por WhatsApp. El QR no lleva datos personales, solo un código aleatorio de un solo uso.”

## Slide 12 · 6:45 · Demo en vivo · 2 · garita valida en segundos

EN VIVO (celular del GUARDIA, sesión abierta en Control de acceso). Digo: “Ahora soy el guardia.” Toco “Iniciar cámara” y apunto al QR proyectado. Sale “Visita autorizada e ingreso registrado” con nombre, DPI, casa y horario. Opcional (10 s): escanear otra vez → “Este QR ya fue utilizado”: “No se puede reutilizar.” Cierro: “Si la visita no llega a tiempo, al minuto de vencer su hora el residente recibe un aviso en la app, push y correo de que el QR expiró y debe crear otro. Si entra y se queda más de lo autorizado, garita y el residente reciben una alerta. Y fuera de horario, el residente pide un acceso de emergencia que aprueba la administración.” Respaldo si falla la cámara: escribir el código en “Código manual”.

## Slide 13 · 7:30 · Demo en vivo · 3 · cobros claros

EN VIVO (laptop, RESIDENTE) → menú “Mis pagos”. Digo: “El residente ve cada cuota, cuándo vence y cuánto debe.” Señalo el botón Pagar: “Paga con tarjeta en Recurrente, una pasarela guatemalteca; hoy está en modo de pruebas y para cobrar dinero real solo falta la cuenta comercial del residencial.” No completar el pago (ahorra tiempo).

## Slide 14 · 8:15 · Demo en vivo · 4 · la administración ve todo

EN VIVO (laptop, pestaña del ADMINISTRADOR ya abierta). Dashboard: “La visita que acabamos de autorizar ya aparece aquí, con el guardia que la registró.” → Viviendas: giro el mapa 3D y toco una casa. → Indicadores: morosidad mes a mes y visitas por día. Cierro con las etiquetas de la slide: “Como es un producto para vender, cada residencial crea sus roles, hace votaciones, recibe fallas con foto e importa sus datos desde Excel.” Transición: “Pero que funcione no significa que sea fácil de usar, así que lo probamos con usuarios reales.”

## Slide 15 · 9:00 · Pruebas con usuarios · Neurolab UVG · 15 oct 2026

En octubre llevamos el sistema al Neurolab de la UVG. Seis voluntarios, dos por rol: administrador, guardia y residente. No les preguntamos si les gustaba: medimos con seguimiento ocular dónde miraban, con un sensor GSR cuándo se estresaban, y al final llenaron el cuestionario de usabilidad SUS. Aquí ven el mapa de calor de un residente y su señal de estrés. Diego les muestra qué encontramos.

**Frase de relevo:** “…Diego les muestra qué encontramos.”

**Preguntas que te pueden tocar:**

- ¿Qué pasa si la visita llega tarde? → Al vencer su hora el residente recibe aviso de QR expirado (app, push y correo) y crea otra autorización.
- ¿Y si se queda más tiempo? → La salida se registra a cualquier hora y garita y residente reciben alerta de visita sin salida.
- ¿Fuera de horario (6:00–22:00)? → Acceso de emergencia con motivo, aprobado por la administración.
- ¿Cómo fue la prueba del Neurolab? → 15 de octubre de 2026, 6 voluntarios (2 por rol), seguimiento ocular, sensor GSR y cuestionario SUS.

# Diego Reyes — Resultados UX y calidad (9:40 – 11:30)

**Objetivo:** Mostrar los números del Neurolab y, sobre todo, qué cambiamos por esos resultados; cerrar con la calidad del proceso.

**Cuenta para:** Criterio 4 (resultados de usuarios y mejoras)

## Slide 16 · 9:40 · Resultados

Resultados: se completó el 94 % de las tareas y el SUS promedio fue 69.6, justo en el umbral de usabilidad aceptable. El administrador tuvo el mejor resultado, 77.5. El residente fue el que más batalló: uno de ellos tardó casi el doble y no logró pre-autorizar una visita sin ayuda. Curiosamente, en la encuesta todos decían que era fácil: el laboratorio nos mostró lo que la encuesta no.

## Slide 17 · 10:20 · Hallazgos → cambios en el producto

Cada hallazgo se volvió un cambio. El más importante, la pre-autorización difícil de encontrar: ahora es el botón principal del panel del residente y del inquilino. El filtro del historial del guardia ahora es grande y está justo sobre la tabla. Las confirmaciones se rediseñaron en toda la aplicación. El menú y la jerarquía del residente mejoraron parcialmente, y el modo oscuro que pidieron los usuarios quedó en el backlog. El siguiente paso es repetir la prueba para medir cuánto sube el SUS del residente.

## Slide 18 · 11:00 · Calidad del proceso

Y para que cada cambio no rompa lo anterior: 11 sprints con un promedio de 51 puntos, más de 1,600 pruebas automáticas que corren en backend y frontend, revisiones técnicas formales y, antes de esta entrega, recorrimos las 67 pantallas de los cuatro roles. Denil nos explica con qué está construido y por qué.

**Frase de relevo:** “…Denil nos explica con qué está construido y por qué.”

**Preguntas que te pueden tocar:**

- ¿Por qué el SUS es 69.6? → El residente batalló con la pre-autorización; por eso la volvimos el botón principal (lo acaban de ver en la demo).
- ¿Repetirán la prueba? → Sí, es el siguiente paso para medir la mejora del residente.
- ¿Cuántas pruebas automáticas? → 920 + 132 de backend y 578 de frontend.

# Denil Parada — Arquitectura, justificación tecnológica y cierre (11:30 – 14:00)

**Objetivo:** Explicar la arquitectura y cada tecnología por requisito, costo y alternativa; seguridad y escala; cerrar regresando a la pregunta inicial.

**Cuenta para:** Criterio 5 (tecnología, 0.80 pts) + cierre del criterio 1

## Slide 19 · 11:30 · Arquitectura y flujo

Así está construido. Los cuatro roles entran desde el celular o la computadora, a una app instalable. El frontend en React habla por HTTPS, con un token de sesión firmado, con nuestra API en Node.js; la API valida el rol en cada petición y guarda todo en MySQL, con una base de datos por residencial. Para pagos se conecta con Recurrente, que nos confirma cada pago con un aviso firmado; para correos usa Gmail, y para avisos al celular, Web Push. Y hay tareas que corren solas: cada 15 segundos salen correos y push, cada minuto se revisan QR expirados y visitas sin salida, y cada mes se factura. Todo vive en Railway: cada vez que hacemos merge a main, se publica la nueva versión sola.

## Slide 20 · 12:10 · Por qué esta tecnología

Cada tecnología responde a un requisito. La interfaz es React con TypeScript, instalable en el celular sin pasar por tiendas de apps. El servidor es Node.js con Express: el mismo lenguaje en todo el sistema, que el equipo ya dominaba, en lugar de Django o Spring. La base es MySQL porque los pagos necesitan transacciones: una cuota no puede quedar pagada a medias, algo que MongoDB no garantiza tan naturalmente. Desplegamos en Railway: el plan Pro cuesta 20 dólares al mes, incluye el envío de correos y publica solo cada cambio, frente a operar AWS o un servidor propio. Y cobramos con Recurrente porque es guatemalteca, cobra en quetzales y no tiene mensualidad; Stripe no opera comercios en Guatemala.

## Slide 21 · 12:50 · Seguridad y escala

Sobre seguridad: las contraseñas se guardan con bcrypt; las sesiones son tokens firmados que se pueden cerrar desde cualquier dispositivo y se cierran solas por inactividad; hay límite de intentos de inicio de sesión; todas las consultas son parametrizadas contra inyección SQL; cada cambio sensible queda auditado; los datos de tarjeta se escriben en la página de Recurrente, nunca en la nuestra; y cada residencial tiene su propia base de datos. En escala, hicimos una prueba de carga: una sola instancia atendió 280 peticiones por segundo con sesión y cero errores, del orden de 3,000 usuarios activos a la vez. Un residencial de 300 casas usa menos del 10 % de eso.

## Slide 22 · 13:25 · Martes · 22:00 · garita

Empezamos con una pregunta: martes, 10 de la noche, ¿quién entró? Hoy esa respuesta tiene nombre, hora y el guardia que lo dejó pasar. Y además el residente sabe cuánto debe, la administración ve su residencial completo y el producto está en producción, probado con usuarios reales y listo para venderse al siguiente residencial. Gracias. ¿Preguntas?

**Frase de relevo:** Cierre: “…¿Preguntas?”

**Preguntas que te pueden tocar:**

- ¿Qué pasa si dos residenciales compran? → Cada uno tiene su copia y su base de datos; el mismo código para todos; los cambios particulares se vuelven configuración.
- ¿Cuántos usuarios aguanta? → Prueba de carga: 280 peticiones/s con sesión, 0 errores ≈ 3,000 usuarios activos por instancia.
- ¿Gmail cobra por correo? → No; Railway Pro (USD 20/mes) permite enviarlos; límite ~500 destinatarios/día. Si se supera, quedan en cola y la campana y el push siguen funcionando.

# Preguntas generales del jurado

Respuestas completas en el documento técnico (sección 12). Responde quien domina el tema, en 20–30 segundos; si no se sabe, decir qué se haría.
