---
title: "NexusResidencial — Reflexión del equipo de desarrollo"
subtitle: "Entrega final del proyecto · CC3091 Ingeniería de Software 2"
author: "Arodi Chávez · Diana Sosa · Diego Reyes · Denil Parada · Emilio Chen · Luis Estrada"
date: "Universidad del Valle de Guatemala · Noviembre 2026"
lang: es
---

# 1. Nuestro proceso como línea del tiempo

Para responder las preguntas de la guía, dividimos el año en ocho etapas. En cada una revisamos cómo trabajamos, apoyados en lo que escribimos en las retrospectivas de los informes de sprint.

| # | Etapa | Fechas (2026) | Qué hicimos | Cómo trabajamos |
|---|---|---|---|---|
| 1 | Design Thinking | Ene – feb | Brief, usuarios y usuarios extremos, AEIOU, "¿Qué, cómo y por qué?", ideación y Design Studio | Mucha unidad: todos entrevistamos, discutimos y votamos ideas juntos |
| 2 | Modelación | Mar | Prototipos en Figma, historias de usuario, casos de uso, requisitos no funcionales, diagramas y selección de tecnología | Trabajo repartido por secciones; un documento que unía las partes de todos |
| 3 | Primeros sprints (IS1) | Abr – may | Sprints 1 a 4: login, visitas con QR, reservas, permisos, métricas | Aprendimos Scrum en la práctica. Sprint 1 empezó sin alcance definido; del 2 al 4 mejoró la planificación |
| 4 | Receso entre semestres | Jun – jul | Pausa; retomamos con el Sprint 5 | Perdimos ritmo y contexto; costó retomar |
| 5 | Expansión (IS2) | Jul – ago | Sprints 5 y 6: finanzas, sanciones, respaldos, módulo financiero (88 y 92 puntos) | Nuestra mayor velocidad, pero la integración se concentraba al final |
| 6 | Crisis de calidad | Ago – sep | La RTF del Sprint 6 encontró 40 defectos (2 críticos y 16 severos); sprints 7 y 8 para corregirlos | El momento de más tensión: mucho trabajo de corrección y merges complicados |
| 7 | Pagos reales y RTF 2 | Sep – oct | Sprint 9 (Recurrente, conciliación, reembolsos) y Sprint 10 (corregir 11 casos fallidos de la RTF 2, 4 críticos); Neurolab | Maduramos: por primera vez los seis integramos por pull request |
| 8 | Cierre y producto | Oct – nov | El sistema pasó de ser "para Colonia Sion" a un producto para cualquier residencial; presentación final del 13 de noviembre | Un esfuerzo final grande, con carga muy desigual entre integrantes |

---

# 2. Las preguntas que nos hicimos como equipo

## ¿Trabajamos de la misma forma en todo el proceso?

**No.** Hubo tres formas de trabajar muy distintas:

1. **Etapas 1 y 2 (enero – marzo): trabajo de grupo.** Las decisiones se tomaban en reuniones donde todos opinaban. El producto era un documento, y era fácil repartir secciones y luego unirlas.
2. **Etapas 3 a 6 (abril – septiembre): cada quien su historia.** Cada integrante tomaba historias en Jira y las programaba por su cuenta. Esto nos dio velocidad (de 26 a 92 puntos por sprint), pero creó islas: integrábamos al final del sprint, había merges locales sin pull request y cada módulo seguía sus propias reglas. La RTF del Sprint 6 mostró el costo: 40 defectos, varios por diferencias entre lo que hacía el frontend y lo que validaba el backend.
3. **Etapas 7 y 8 (septiembre – noviembre): más proceso.** Ramas, pull requests, pruebas automatizadas antes de integrar y evidencias versionadas en el repositorio. Fue más lento al principio, pero el Sprint 10 corrigió los 11 fallos de la RTF 2 con pruebas que los respaldan.

## ¿En qué momentos hubo más unidad, apoyo y comprensión?

- **En el Design Thinking.** Todos entendíamos el problema igual, porque lo descubrimos juntos en las entrevistas. Fue la etapa con más conversación y menos conflicto.
- **Del Sprint 2 al Sprint 4.** En la retrospectiva del Sprint 4 escribimos que hubo "comunicación constante entre los integrantes y una mejor distribución de responsabilidades según las fortalezas de cada miembro". Cuando el Sprint 3 se extendió media semana, nos reorganizamos sin problemas.
- **En el Sprint 10 y el Neurolab.** Preparar el protocolo y atender a los voluntarios nos obligó a coordinarnos en vivo, y fue la primera vez que los seis integramos por pull request.

## ¿En qué momentos hubo más desunión?

- **Sprint 1.** Las historias se cargaron en Jira 4 días después de iniciado el sprint y el avance se registró hasta el último día (la gráfica pasó de 0 a 26 puntos de golpe). No había acuerdos claros sobre quién hacía qué.
- **Sprints 6 y 7.** La integración se dejaba para el final y algunas historias avanzaron sin pull request o con merges locales inconclusos, como anotamos en la retrospectiva del Sprint 7. Cuando la RTF encontró defectos graves, hubo frustración por tener que rehacer trabajo que se daba por terminado.
- **Distribución de la carga en los sprints 9 y 10 y en el cierre.**
  - En el Sprint 9, una persona fue responsable de 5 de 15 historias; en el Sprint 10, de 3 de 8 (26 de 57 puntos).
  - En el historial del repositorio, más de la mitad de los commits del año son de un solo integrante.
  - Ya en la retrospectiva del Sprint 9 acordamos "distribuir de forma más equilibrada las historias y Story Points", y no lo logramos del todo.
- **Jira desactualizado.** En el Sprint 10 la gráfica estuvo plana del 17 al 22 de octubre y el 60 % de los puntos se cerró el último día. Eso hacía difícil saber cómo iba cada quien.

## ¿Cómo afectaron estos momentos nuestra productividad?

- **La unidad del inicio nos dio un buen análisis.** El 97.3 % del alcance original se pudo construir porque los requisitos estaban bien entendidos.
- **Las islas de los sprints 5 y 6 dieron velocidad aparente** (88 y 92 puntos) pero generaron deuda. Los sprints 7 y 8 (55 y 21 puntos) se dedicaron casi por completo a corregir, así que parte de esa velocidad la pagamos después.
- **La carga desigual hizo que el cierre dependiera de pocas personas.** Funcionó, pero es un riesgo: si esa persona se enfermaba, el proyecto se detenía, y el resto del equipo conoce menos partes del código.
- **Actualizar Jira tarde hizo que nuestras métricas no reflejaran el trabajo real.** Los burndown "en escalón" se ven mal aunque el trabajo sí se hizo.

## ¿Cómo maduramos como equipo?

| Antes | Después |
|---|---|
| Alcance definido tarde (Sprint 1) | Planning Poker y alcance cerrado antes de iniciar (desde el Sprint 2) |
| Pruebas al final, si había tiempo | 1,630 pruebas automatizadas y suites contra MySQL aislado |
| La seguridad se revisó tarde: el backend confiaba en cabeceras que el navegador podía falsificar | Sesiones firmadas, límite de intentos y revisión de seguridad por endpoint |
| Merges locales sin revisión | Ramas y pull requests para todos (Sprint 10) |
| "Funciona en mi máquina" | Producción en Railway con dominio propio, correo y despliegue automático |
| Diseñar para un residencial (Colonia Sion) | Diseñar un producto para cualquier residencial, con modelo de negocio |
| UX por intuición | UX medida con eye tracking, GSR y SUS en el Neurolab |

## ¿Cuáles fueron los mejores aspectos del trabajo en equipo?

1. **Cumplimos todos los sprints.** Los 10 cerraron con el 100 % de los puntos comprometidos.
2. **Aceptar la crítica y corregir.** Las dos RTF fueron duras, y en vez de defendernos convertimos cada hallazgo en una historia con pruebas.
3. **Aprender tecnología nueva por nuestra cuenta:** pasarela de pagos, notificaciones push, aplicación instalable, 3D y despliegue en la nube.
4. **Salir del aula.** Entrevistas reales, usuarios que probaron el sistema en cada sprint y un estudio en el Neurolab.
5. **Documentar.** Cada historia importante tiene su documento en `docs/` y cada sprint su informe.

## ¿Qué aspectos habría que mejorar?

1. **Repartir la carga de forma equilibrada** y en parejas para las historias grandes, así varias personas conocen cada módulo.
2. **Integrar todos los días, no al final del sprint:** al menos un commit diario y un pull request abierto desde el primer día de cada historia.
3. **Actualizar Jira en tiempo real**, al empezar y al terminar cada subtarea, y revisar el tablero en cada reunión diaria.
4. **Revisar seguridad desde el diseño**, no después de una auditoría.
5. **Automatizar la integración continua.** Lo acordamos en el Sprint 10 y no lo hicimos.
6. **Medir los requisitos no funcionales**, como carga, disponibilidad y tiempos, en vez de suponerlos.
7. **Cumplir los acuerdos de la retrospectiva.** Varios se repitieron de un sprint a otro (registrar los LOGT a diario, distribuir mejor la carga, actualizar Jira), señal de que no les dimos seguimiento.

---

# 3. Reflexión sobre el desempeño del equipo durante casi un año

## ¿En qué medida logramos los resultados?

**Logramos el resultado principal.** Hay un sistema funcionando en internet que resuelve los problemas que encontramos en las entrevistas:

- La visita entra con un QR, no con una llamada.
- El residente ve y paga su cuenta en línea.
- Las reservas no chocan.
- El administrador tiene reportes y control.

De 23 requisitos funcionales, 21 se cumplieron como se plantearon y 2 se modificaron. Del backlog original solo se eliminó una historia.

**Hay resultados que no logramos o logramos a medias, y queremos decirlo claramente:**

- **No cobramos dinero real.** Los pagos funcionan en sandbox; activar el modo real requiere trabajo adicional y la cuenta comercial de un cliente.
- **No medimos la carga ni la disponibilidad**, dos requisitos no funcionales que nosotros mismos planteamos.
- **No configuramos integración continua.**
- **Algunas suites de pruebas heredadas** siguen fallando o no se pueden ejecutar por falta de datos versionados.
- **Una parte importante del trabajo de cierre se hizo fuera de Jira**, así que no está reflejada en las métricas del proceso.
- **La planificación por sprints no anticipó** que casi la mitad del esfuerzo sería corrección y trabajo nuevo.

## Aspectos buenos del desempeño

- **Constancia:** cerramos 10 de 10 sprints con el compromiso completo.
- **Velocidad creciente:** pasamos de 26 a un promedio cercano a 57 puntos por sprint.
- **Calidad final:** pasamos de 40 defectos en la RTF del Sprint 6 a corregir todos los de la RTF 2, con pruebas que lo demuestran.
- **Visión de producto:** al final el equipo pensó en costos, precios, competencia y escalabilidad, no solo en código.

## Aspectos a mejorar del desempeño

- **Equidad en la carga de trabajo** y **comunicación del avance real** (Jira y reuniones diarias).
- **Disciplina técnica desde el inicio:** pruebas, seguridad e integración continua deberían haber existido desde el Sprint 1, no desde el 7.
- **Cumplir lo que acordamos en cada retrospectiva.**

## Incorporación de nuevos miembros

**El equipo fue el mismo durante todo el proyecto**: seis integrantes desde enero hasta noviembre, así que no tuvimos que integrar a nadie nuevo. Lo más parecido fue **reintegrarnos después del receso** entre semestres. En el Sprint 5 tuvimos que volver a entender código que no tocábamos desde mayo, y eso nos enseñó el valor de documentar cada historia.

---

# 4. Evaluación del proyecto con el indicador de éxito

| Indicador | Valor |
|---|---|
| Puntos planteados al inicio (backlog IS1) | 294 |
| Puntos realizados del alcance original | 286 |
| Puntos realizados en total (10 sprints) | 567 |
| **Indicador de la guía:** 567 × 100 / 294 | **192.9 %** |
| **Indicador sobre el alcance original:** 286 × 100 / 294 | **97.3 %** |

## ¿Se cumplieron los objetivos?

**Sí, en lo esencial.** El objetivo era digitalizar la gestión de un residencial: accesos, pagos, amenidades, permisos y comunicación. Se cumplió, y además se convirtió en un producto que se puede ofrecer a cualquier residencial. El 97.3 % del alcance original quedó construido.

No se cumplió por completo el objetivo de **producción real**: el sistema está publicado, pero no cobra dinero real ni tiene monitoreo, pruebas de carga ni integración continua.

## ¿Los puntos realizados son suficientes para dar por terminado el proyecto?

**Para el proyecto académico, sí:** el alcance comprometido está completo y se superó. **Para un producto comercial, todavía no.**

El 192.9 % no significa que "hicimos el doble y sobró". Significa que **el alcance real era casi el doble de lo que estimamos**. Mucho de lo agregado era necesario para que el sistema fuera seguro y confiable: autenticación firmada, recuperación de contraseña, auditoría, pagos idempotentes y correcciones de las RTF. Que no lo hayamos previsto en el análisis es una lección de estimación, no solo un mérito. Los próximos pasos del documento de conclusiones son el trabajo que falta.

## ¿Qué tan diferente fue la planificación original de la ejecución?

**Muy diferente en el camino, parecida en el destino.**

| Aspecto | Plan original | Ejecución real |
|---|---|---|
| Alcance | 63 historias, ~294 puntos | 567 puntos en sprints, más el trabajo del cierre |
| Pagos | Pagos electrónicos (sin definir cómo) | Simulados en el Sprint 6, Recurrente en sandbox en el Sprint 9 |
| Calidad | Sin sprints de corrección | Sprints 7, 8 y 10 dedicados casi por completo a corregir hallazgos |
| Cliente | Colonia Sion | Producto para cualquier residencial (multi-cliente) |
| Esfuerzo estimado | 24,352 horas-hombre (UCP, extrapolado) | 6,931 horas-hombre recalculadas con los casos de uso reales; costo de Q1,320,000 cumplido al 100 % |
| Tiempo | 11 meses, 10 sprints | 11 meses, 10 sprints, más un cierre intenso fuera de Jira |
| Integración continua | Prevista | No se configuró |

**Conclusión del equipo:** consideramos que el proyecto **fue exitoso**. Cumplimos lo prometido al inicio (97.3 %), entregamos un sistema que funciona en internet y lo validamos con usuarios reales y en el Neurolab.

También reconocemos que el éxito tuvo un costo: carga desigual, trabajo concentrado al final y acuerdos de retrospectiva que no cumplimos. Si empezáramos de nuevo, mantendríamos la forma en que descubrimos el problema y la constancia de los sprints. Cambiaríamos tres cosas desde el primer día: repartir el trabajo en parejas, integrar todos los días con pruebas automáticas y medir lo que prometemos.
