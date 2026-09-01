# Handoff: EIA Studio — Intelligent Environmental Impact Assessment Workspace

## ⚠ Alcance de esta fase: ARCHITECTURE ONLY

Este paquete **no es una orden de implementación**. En esta fase el objetivo es que el equipo de desarrollo:

1. entienda el modelo de dominio multi-tenant y la navegación por capabilities;
2. defina la arquitectura de aplicación, el contrato de datos y los límites de responsabilidad;
3. proponga la estructura de proyecto y el stack, sin construir producto todavía.

**No hacer en esta fase:**

- no implementar funcionalidades de negocio;
- no crear base de datos de producción ni migraciones definitivas;
- no convertir los mockups completos a React ni portar pantalla por pantalla;
- no simplificar ni "resolver" patrones del diseño para facilitar la implementación.

Si un patrón del diseño parece costoso de implementar, **eso es una conversación, no una decisión unilateral**. Los patrones listados en «Invariantes conceptuales» son requisitos de producto, no adornos visuales.

---

## Overview

EIA Studio es una plataforma SaaS multi-tenant para consultoras ambientales. Convierte el proceso disperso de un estudio socioambiental (campo, Excel, GIS, Drive, fotografías, PDF, redacción manual) en un workflow trazable:

```
Proyecto → planificación → levantamiento de campo → predios → encuestas → validación
→ tabulación → análisis social → asistencia automatizada → control de avance
→ revisión de calidad → generación de documentos → portal de avance para cliente
```

Proyecto piloto y único proyecto real del sistema:
**Vía Puente del Amor – Los Hachos, Zamora Chinchipe, Ecuador** — 7,4 km · 141 predios frentistas · 119 levantamientos socioeconómicos · 185 participantes en consulta significativa. El estudio está **concluido**; sus cifras agregadas son históricas.

---

## About the Design Files

Los dos archivos de este bundle son **referencias de diseño escritas en HTML**: prototipos que muestran la apariencia y el comportamiento pretendidos. **No son código de producción para copiar.**

La tarea, cuando llegue la fase de implementación, será **recrear estos diseños en el entorno del codebase destino** (React, Vue, etc.) usando sus patrones y librerías establecidos. Si aún no existe codebase, elegir el framework adecuado y implementar allí. Los archivos `.dc.html` se abren directamente en un navegador.

| Archivo | Rol |
|---|---|
| `EIA Studio.dc.html` | Prototipo navegable. **Fuente de verdad de la intención funcional.** |
| `Arquitectura y Lenguaje Visual.dc.html` | Spec v0.2. **Fuente de verdad de reglas, estados, provenance, capabilities y fronteras de responsabilidad.** |
| `screenshots/` | Set canónico de 11 capturas. **Golden visual references.** |

### Visual reference hierarchy

- El **prototipo interactivo** define comportamiento y flujo.
- La **especificación v0.2** define reglas e intención arquitectónica.
- Las **capturas** son referencias visuales de oro para layout, jerarquía, densidad, tipografía y tratamiento de componentes.
- Las capturas **no pueden anular** el comportamiento funcional definido por el prototipo y la spec.

Las capturas son referencia de **fidelidad visual**, no una especificación píxel a píxel: no deduzcas de ellas valores exactos para hardcodear (un panel que mide 362 px en la imagen no es un `width: 362px`). Los valores normativos están en este README y en la spec. Sirven para detectar deriva: si tu implementación puesta al lado de la captura se siente de otro producto, algo se desvió.

Todas están tomadas de la versión aprobada, sin retoque, a **1440 px de ancho** (alto variable según el contenido de cada superficie).

| Archivo | Qué fija |
|---|---|
| `01-portfolio.png` | Shell, tenant/project context y empty state elegante con un solo proyecto real |
| `02-command-center.png` | Vista completa: header operativo, franja de KPI con badge DEMO, forecast y Attention Required |
| `03-gis-parcel-explorer.png` | Mapa + tabla + panel contextual + leyenda de estados y leyenda de provenance geoespacial |
| `04-parcel-workspace.png` | `PRED-ZAM-042`, pestaña Resumen |
| `05-social-intelligence.png` | Cola human-in-the-loop: IMMUTABLE SOURCE → AI SUGGESTED → HUMAN VALIDATED |
| `06-social-low-score.png` | Caso de confianza baja: cómo se comunica el model score |
| `07-quality-gate-list.png` | Bandeja de hallazgos |
| `08-quality-gate-detail.png` | Source A / Source B + Why flagged + Suggested action + Specialist decision |
| `09-client-portal.png` | Superficie distinta, no el workspace con campos ocultos |
| `10-tenant-capabilities.png` | Matriz de módulos habilitados / deshabilitados |
| `11-system-states.png` | Galería de los 15 estados del sistema |

FieldFlow tendrá su propio set de capturas móviles cuando se diseñe.

**Regla de precedencia ante dudas:** interpretar primero la intención funcional del prototipo; luego usar la spec v0.2 para las reglas; las capturas resuelven dudas de apariencia.

## Fidelity

**Alta fidelidad (hifi).** Colores, tipografía, espaciado, densidad y estados son definitivos para la Dirección B — Institucional, ya aprobada. La UI debe recrearse fielmente usando las librerías del codebase destino. Lo que **no** es definitivo: los datos operativos sintéticos, la geometría de los predios y el trazado del corredor (ver «Procedencia de datos»).

---

## Invariantes conceptuales (no negociables)

| # | Invariante | Implicación técnica |
|---|---|---|
| 1 | **Tenant y proyecto siempre visibles** | El shell interno nunca se colapsa; el contexto activo va en el layout, no en cada página. Toda ruta interna es `:tenant/:project/...`. |
| 2 | **Navegación gobernada por capabilities** | El conjunto de capabilities del proyecto determina rutas, ítems de nav y disponibilidad de objetos. Un módulo deshabilitado **no aparece**: nada de atenuado ni candado. |
| 3 | **Workspace interno ≠ Client Portal** | Superficies distintas, no la misma pantalla filtrada. El portal se sirve desde una **proyección agregada**, nunca desde las tablas operativas. |
| 4 | **Histórico real vs simulación operacional** | Todo dato lleva `source_type`. Lo sintético o reconstruido jamás se presenta como histórico real, ni en pantalla ni en exportaciones. |
| 5 | **Operational Forecast determinístico** | `pendientes ÷ media móvil de 5 días`. Reproducible a mano, con supuestos explícitos. No es un modelo, no se presenta como IA, no usa lenguaje probabilístico. |
| 6 | **Mapa + tabla sincronizados** | Una sola selección compartida entre ambas vistas. El GIS es operacional, no decorativo. |
| 7 | **Parcel es el workspace territorial maestro** | Visitas, instrumentos, afectaciones, media y quality checks cuelgan del predio. Todo objeto de campo nuevo declara su relación con `Parcel`. |
| 8 | **IMMUTABLE SOURCE / AI SUGGESTED / HUMAN VALIDATED** | Tres capas separadas en modelo y en UI. La respuesta original es inmutable para todos los roles y procesos, sin excepción (ni corrección ortográfica). |
| 9 | **Taxonomía versionada** | Cada clasificación queda anclada a la versión de taxonomía vigente al validar. La IA puede *proponer* categorías; nunca crearlas en silencio. |
| 10 | **Model score ≠ probabilidad calibrada** | Se muestra como `model score 0,86` + etiqueta Alta/Media/Baja. Prohibido redactarlo como «91% de acierto» o «precisión». Calibración = evaluación experimental posterior. |
| 11 | **Quality Gate no declara cumplimiento** | El sistema señala hallazgos potenciales. La calificación normativa es de un especialista, con justificación obligatoria. `Resolve` ≠ conformidad declarada por el sistema. |
| 12 | **Data Provenance transversal** | Un mismo componente drawer sirve a indicadores, tablas, predios, gráficos, clasificaciones, hallazgos e informes. Bajo demanda, nunca ruido permanente. |
| 13 | **SOURCE TYPE explícito** | `REAL_AGGREGATE` · `RECONSTRUCTED` · `ANONYMIZED` · `SYNTHETIC`. |
| 14 | **Estados del sistema** | Los 15 definidos en la spec v0.2 §10 son parte del contrato de cada superficie, no un extra. |

---

## Modelo de dominio

```
Tenant / Organization
└ Users · Memberships                    (rol por tenant)
  └ Project Assignments                  (rol por proyecto)
└ Projects                               (profile + capabilities)
  └ Project Units                        (tramos)
    └ Parcels                            ← workspace maestro
      ├ Geometry · Abscisa · Sector
      ├ Visits → Surveys → Answers
      ├ Affectations · Media
      └ Quality Checks
    ├ Documents · Versions
    ├ Findings                           (Quality Gate)
    ├ Categories · Taxonomy versions
    └ Reports · Provenance records
```

**Reglas invariantes del modelo**

- Todo registro lleva `tenant_id` y `project_id`. La pertenencia es explícita, nunca derivable por join implícito.
- Un usuario accede a datos solo vía membresía, y a un proyecto solo vía asignación dentro de esa membresía.
- Una respuesta original de encuesta nunca se sobrescribe: la codificación vive en una capa aparte y versionada.
- Toda cifra publicada conserva su cadena de procedencia hasta el registro de campo.
- El acceso de cliente se sirve desde una proyección agregada.

### Roles

Owner/Admin · Coordinador de proyecto · Especialista social · Especialista ambiental · Cartógrafo/GIS · Técnico de campo · Revisor · Cliente (read-only).

Matriz de permisos en el prototipo: **Tenant Settings › Roles y permisos** (`RW` / `R` / `A` aprobación / `—`). Los datos personales y económicos individuales son visibles solo para Especialista social y Coordinador; se registran en auditoría al exportarse; nunca cruzan al portal.

---

## Modelo de capabilities

Catálogo: `core.projects` · `core.documents` · `gis.maps` · `gis.parcels` · `field.surveys` · `social.analytics` · `social.ai_coding` · `quality.document_gate` · `quality.rag_assistant` · `reports.social_generator` · `client.portal` · `climate.analytics` · `compliance.pma` · `audit.environmental`

Perfil del piloto: `road_eia_social`.

| Sección | Capability | Estado en el piloto |
|---|---|---|
| Portfolio | `core.projects` | Diseñado |
| Command Center | `core.projects` | Diseñado |
| Documents | `core.documents` | Fase posterior |
| GIS & Predios | `gis.maps` + `gis.parcels` | Diseñado |
| Parcel Workspace | `gis.parcels` | Diseñado |
| Field Surveys | `field.surveys` | Parcial (bandeja sí, FieldFlow móvil no) |
| Social Intelligence | `social.analytics` + `social.ai_coding` | Diseñado |
| Quality Gate | `quality.document_gate` | Diseñado |
| RAG Assistant | `quality.rag_assistant` | Fase posterior |
| Reports | `reports.social_generator` | Fase posterior |
| Client Portal | `client.portal` | Diseñado |
| Climate Analytics | `climate.analytics` | Fuera de navegación |
| PMA Compliance | `compliance.pma` | Fuera de navegación |
| Environmental Audit | `audit.environmental` | Fuera de navegación |

Dos niveles de habilitación: **tenant** (Tenant Settings › Módulos) y **proyecto** (Project Settings › Modules & Capabilities). Un proyecto puede restringir, nunca ampliar, lo habilitado en el tenant.

---

## Screens / Views

Todas las medidas son las del prototipo a 1440 px de ancho, desktop-first.

### Shell interno

- **Rail izquierdo** `244 px`, fijo, `background #FFFFFF`, `border-right 1px #DCE1E5`, `position: sticky; height: 100vh`.
  - Marca (24 px cuadrado `#17506B` con gota blanca) + «EIA Studio» en Source Serif 15/600.
  - **Tenant switcher**: etiqueta `ORGANIZACIÓN` 9,5/600 tracking .14em `#7A858E`; caja `padding 8px 10px`, `border 1px #DCE1E5`, `radius 3px`, avatar 19 px `#17506B`.
  - **Project switcher**: caja `background #F0F6F9`, `border 1px #C3D6E0`, texto `#17506B` 12/500.
  - Ítems de nav: `padding 8px 10px`, 12,5 px, `radius 3px`; activo `background #F0F6F9`, `color #17506B`, `weight 600`. Badges numéricos monoespaciados a la derecha.
  - Bloque `ADMINISTRACIÓN` al fondo, separado por `border-top 1px #E8EBEE`.
- **Topbar** `height 52px`, `background #FFFFFF`, `border-bottom 1px #DCE1E5`, sticky.
  - Breadcrumb `tenant › contexto` 12 px `#5A646C`.
  - Search `max-width 400px`, `background #F4F6F7`, `border 1px #DCE1E5`, `radius 4px`, atajo `⌘K` en chip monoespaciado.
  - Notificaciones con punto `#C0492A`; avatar 26 px circular `#17506B` + nombre y rol en 9,5/600 tracking .06em.
- **Command palette** (⌘K / Ctrl+K, cierre con Esc): overlay `rgba(16,24,39,.35)`, panel `560 px`, `radius 6px`, sombra `0 18px 44px rgba(16,24,39,.22)`; lista de destinos con atajo mnemónico a la derecha.

### 1 · Portfolio

Un solo proyecto real y un empty state elegante. Nunca rellenar con proyectos ficticios.

- Cabecera: `<h1>` serif 26/600 `-.015em`; subtítulo con el perfil en chip monoespaciado `#EDF1F3`.
- Acciones: «Importar proyecto» (secundario), «Nuevo proyecto» (primario).
- Grid `1.55fr / 1fr`, `gap 20px`.
- **Tarjeta de proyecto**: miniatura `140×112` con curvas de nivel, corredor y predios; badge `ZAMORA CHINCHIPE · EC`. Título serif 17/600. Chip de estado `EN CAMPO`. Barra de avance `height 7px`, `#17506B` al 84,4%. Cuatro cifras serif 20/600 (141 · 119 · 185 · 7 hallazgos en `#9E3B22`). Chips de módulos.
- **Empty state**: `border 1px dashed #C8D0D6`, `background #FAFBFC`, círculo `+` 36 px, copy «Aún no hay más proyectos en este tenant» y acción «Desde plantilla».
- Columna derecha: «Atención requerida» (3 filas con punto de color) y «Actividad reciente».

### 2 · Project Command Center

Centro de control operacional; **no** una galería de tarjetas. Responde en <10 s: cuánto avanzamos, qué queda, si vamos a tiempo, dónde están los problemas, qué requiere atención hoy.

- **Header operativo**: nombre serif 23/600 + chips `EN CAMPO` y `RETRASO PROYECTADO 4 D`; chips de capabilities activas; meta a la derecha en grid 2×2 (fecha objetivo `20 sep 2026`, proyección `24 sep 2026` en `#9E3B22`, responsable, última actualización).
- **Franja de KPI**: un solo panel con `grid-template-columns: repeat(8,1fr)`, `gap 1px` sobre `background #EDF1F3` (hairlines, no ocho tarjetas). Cada celda: etiqueta 9,5/600, cifra serif 25/600, nota 10,5 px.
  Universo estimado 141 · confirmado 138 · visitados 126 · encuestas completas 119 · revisitas 9 · pendientes 22 · productividad 5,2 · cierre proyectado 24 sep.
  Cabecera del panel con badge **DEMO / SYNTHETIC** (`background #8A6512`, texto blanco) + nota aclaratoria + enlace «Ver origen».
- **Operational forecast**: cabecera `OPERATIONAL FORECAST` con la coletilla «cálculo aritmético sobre el ritmo observado · sin modelo predictivo». Enunciado serif 16: *«Al ritmo de los últimos 5 días, el levantamiento concluiría 4 días después de la fecha objetivo.»* Cuatro celdas: ritmo actual 5,2 · ritmo necesario 7,3 (destacada en azul) · técnicos activos 3 de 4 · pendientes 22. Serie de barras de 10 días (`height 88px`, últimos 5 días en `#17506B`, previos en `#B8CBD6`). Supuestos explícitos. Enlace «Abrir detalle del cálculo».
- **Requiere atención hoy**: máximo 6 filas `grid 8px 1.5fr 1fr 90px`; punto de severidad, título, nota, dónde vive, acción. **Cada fila navega** a su superficie (forecast → drawer de provenance, hallazgos → Quality Gate, pendientes/revisitas → GIS, respuestas → Social, sync → Field Surveys).
- **Actividad reciente**: tabla hora/actor/acción/objeto, badge DEMO.
- **Resumen territorial**: miniatura del corredor con su leyenda de procedencia + avance por tramo con abscisas; entra al GIS. Debajo: instrumentos del proyecto y consulta significativa (185, chip `COMPLETA`, «Ver origen»).

### 3 · GIS / Parcel Explorer

Layout `height: calc(100vh - 52px)`; barra de filtros → área central `flex` → panel contextual `302 px` a la derecha; tabla `246 px` bajo el mapa.

- **Barra de filtros**: búsqueda, sector, estado (activo en azul), instrumento, quality; a la derecha conteo, «Fit bounds», «Exportar selección».
- **Mapa** (`viewBox 0 0 900 430`): curvas de nivel `#DCE4E4`, río `#A8C6D2` etiquetado, corredor en **línea discontinua** `#17506B 2,6px` sobre halo `#C6D2D6 11px`, ticks de abscisa, etiquetas de poblados (Zamora, San Antonio, El Limón, Los Hachos), 24 polígonos prediales generados perpendicularmente al eje.
- **Estados prediales — color + glifo, nunca solo color**:

  | Estado | Glifo | Fill | Stroke |
  |---|---|---|---|
  | Completo | `✓` | `#DCEDE3` | `#2C6046` |
  | Visitado | `◐` | `#DCE6EA` | `#4A7F9B` |
  | Pendiente | `○` | `#F1F3F5` | `#A6AEB4` |
  | Requiere revisita | `↻` | `#FBF3E2` | `#B08519` |
  | Inconsistencia | `!` | `#FBEAE6` | `#C0492A` |
  | No localizado | `?` | `#FFFFFF` | `#8B959C` |

- **Leyenda de procedencia geoespacial (obligatoria en toda representación cartográfica, incluida la miniatura del Command Center)**:
  - `REAL BASE MAP` — hidrografía, poblados y localización general de Zamora Chinchipe.
  - `RECONSTRUCTED ALIGNMENT` — corredor aproximado, dibujado discontinuo hasta recibir el GIS oficial.
  - `SYNTHETIC PARCELS` — polígonos generados; **no son catastro**.
- **Tabla sincronizada**, columnas canónicas: código · sector · abscisa · estado (chip con glifo) · visitas · social · servicios ecosistémicos · afectación · quality · última actividad. Instrumentos con marca compacta `✓ ◐ —`. Fila seleccionada: `background #F0F6F9` + `border-left 2px #17506B`.
- **Sincronización**: seleccionar fila resalta el polígono y actualiza el panel contextual; el panel entrega a «Abrir Parcel Workspace» y a «Ver origen de los datos».

### 4 · Parcel Workspace (`PRED-ZAM-042`, DEMO / anonimizado)

- **Header**: código en monoespaciada 22/500, chip de estado, badge `DEMO · ANONIMIZADO`, vía/sector/abscisa/lado; meta a la derecha (última visita, coordenadas, quality status).
- **Seis pestañas**: Resumen · Visitas · Instrumentos · Afectaciones · Media · Quality. Layout `1fr / 300px`.
  - **Resumen**: cuatro cifras (instrumentos 2/3, visitas 2, afectación 11,4%, media 7), alertas accionables, actividad del predio.
  - **Visitas**: timeline con fecha, técnico, resultado, duración, GPS con precisión, media, instrumentos y observación de campo sobre filete gris.
  - **Instrumentos**: estado, completitud con barra, validador y «Ver origen» por fila.
  - **Afectaciones**: área total 1,84 ha · afectada 0,21 ha · 11,4% (ámbar); desglose de cercas, cultivos, accesos e infraestructura.
  - **Media**: 7 archivos con timestamp, estado de GPS (`GPS OK` / `SIN GPS` / `PEND. SYNC`) y visita asociada.
  - **Quality**: checks del predio; los abiertos enlazan a Quality Gate.
- **Estados de instrumento**: `NOT STARTED` · `IN PROGRESS` · `COMPLETE` · `NEEDS REVIEW` · `VALIDATED`. Solo **VALIDATED** alimenta analítica e informes; **COMPLETE** significa lleno, no revisado.
- Columna derecha: croquis del predio con abscisa, datos de frente/lado/uso, acciones (programar revisita, asignar técnico, ver hallazgo, marcar no localizado) y nota de protección de datos.

### 5 · Social Intelligence

Tres pestañas: Variables cerradas · Respuestas abiertas · Taxonomía.

- **Variables cerradas**: lista de variables `236 px` a la izquierda; chips de segmentación; tabla de frecuencias (categoría, frecuencia, %, barra) con `n = 119` y nota de base; cruce por tramo; bloque de abierta agregada que **solo grafica categorías HUMAN VALIDATED** y lo declara.
- **Respuestas abiertas — cola human-in-the-loop** (`290 px` cola + panel central):
  - Filtros: sin revisar · confianza baja · desacuerdo · validadas.
  - **IMMUTABLE SOURCE**: cabecera `IMMUTABLE SOURCE` + «la respuesta original nunca se modifica ni se reemplaza»; texto en serif 17 sobre `border-left 3px #C8D0D6`; metadatos monoespaciados (id, predio, fecha, instrumento).
  - **AI SUGGESTED**: contenedor con `border 1px #C3D6E0` y cabecera `#F7FAFC`; badge `AI SUGGESTED`; categoría, subcategoría, razonamiento en lenguaje llano; `model score 0,86` + chip `CONFIANZA ALTA/MEDIA/BAJA`.
  - Acciones: **Aceptar `A` · Modificar `M` · Nueva categoría `N` · Rechazar `R`**; navegación `J`/`K`. Nota: la categoría solo pasa a los cálculos cuando queda **HUMAN VALIDATED**.
  - Aviso específico de confianza baja: no preselecciona categoría, explica por qué.
  - Panel derecho: taxonomía vigente v4, atajos, progreso de sesión.
- **Taxonomía**: tabla categoría · definición · ejemplo representativo · nº respuestas · versión. Arriba, propuesta de categoría nueva con badge `PROPUESTA` y acciones «Revisar las 14» / «Descartar» — **la taxonomía no cambia de versión sin aprobación humana**.

#### Umbrales de model score (operativos, ajustables por proyecto)

| Etiqueta | Rango | Chip |
|---|---|---|
| Alta | ≥ 0,75 | verde `#EAF3EE / #2C6046` |
| Media | 0,60 – 0,74 | azul `#F0F6F9 / #17506B` |
| Baja | < 0,60 | ámbar `#FBF3E2 / #8A6512` |

Redacción permitida: «model score 0,86 · confianza Alta». Prohibida: «91% de acierto», «precisión del 91%», «probabilidad calibrada».

### 6 · Quality Gate

- **Bandeja**: cinco contadores (abiertos, en revisión, aceptados, descartados, resueltos), filtros, y tabla `hallazgo · tipo · severidad · fuente · estado · asignado · actualizado`.
  - Tipos: `Numerical mismatch` · `Geographical mismatch` · `Temporal mismatch` · `Document completeness` · `Cross-document inconsistency` · `Missing evidence`.
  - Estados: `OPEN` · `REVIEWING` · `ACCEPTED` · `DISMISSED` · `RESOLVED`.
  - Severidad: Alta `#C0492A` · Media `#B08519` · Baja `#8B959C`, siempre con punto **y** etiqueta.
- **Detalle**: cabecera con id, severidad, estado, tipo, título serif 20 y explicación; luego **Source A** y **Source B** lado a lado (documento, sección, referencia y cita literal en serif sobre filete); **Why flagged** (razonamiento + identificador de regla + fecha de detección); **Suggested action** redactada como tarea humana; **Specialist decision** con justificación obligatoria y botones Aceptar / Descartar / Resolver / Reasignar.
- Los cuatro casos del expediente están cargados: 70 vs 71 predios afectados · referencia heredada a Pichincha · hora prevista vs ejecutada de la consulta (presentada como posible reprogramación a documentar) · divergencia legal/social sobre vulnerabilidad, que muestra **Specialist interdisciplinary review required**.
- **Lenguaje**: permitido *possible inconsistency, missing information, potential mismatch, insufficient evidence, specialist review required*. Prohibido *incumplimiento, infracción, error detectado, no conforme, el sistema determina*.

### 7 · Client Portal

Superficie completamente distinta: **sin rail interno**, ancho de lectura `1080 px` centrado, cabecera propia del GAD.

- Barra superior oscura `#101827` con badge `VISTA CLIENTE` y «Acceso de solo lectura · información agregada»; enlace de regreso al workspace.
- Cabecera: eyebrow institucional, título serif 30, subtítulo, última actualización y descarga de resumen PDF.
- Avance general 78% (serif 44), chip `EN EJECUCIÓN`, barra, y cuatro cifras agregadas.
- Hitos con timeline (completado / en curso / próximo), sectores trabajados por tramo (sin identificar personas ni predios), próximos entregables, actividades recientes.
- Nota legal de cierre: no incluye datos personales, económicos individuales, claves prediales, notas internas ni resultados preliminares no validados.
- **Nunca mostrar**: nombres, teléfonos, datos económicos individuales, vulnerabilidad, claves prediales, notas internas, Quality Gate.

### 8 · Tenant Settings

Siete pestañas: Usuarios (tabla de membresías con badge DEMO) · Roles y permisos (matriz capacidad × rol) · Módulos (catálogo de 14 capabilities con toggles; extensiones apagadas) · Project templates · Seguridad · Integraciones · Branding (próximamente).

### 9 · Galería de estados

Los 15 estados con su copy definitivo, tal como deben implementarse.

---

## Interactions & Behavior

- **Navegación**: rail, breadcrumb y command palette (⌘K/Ctrl+K, Esc para cerrar) apuntan a las mismas rutas.
- **Flujo conectado demostrable**: Command Center → alerta → GIS → seleccionar fila/predio → Parcel Workspace → Quality Gate → hallazgo; y Command Center → alerta social → cola → validar respuesta.
- **Selección GIS**: estado único compartido entre mapa, tabla y panel contextual.
- **Cola de codificación**: `J`/`K` navegan, `A` acepta y avanza; la respuesta aceptada pasa a `VALIDADA` y suma al contador de sesión.
- **Quality Gate**: la fila abre el detalle en la misma superficie con «Volver a la bandeja» (no modal).
- **Provenance**: drawer lateral `420 px` desde la derecha con overlay `rgba(16,24,39,.28)`, cierre por overlay, por `×` o `Esc`.
- **Sin modales para todo**: drawers, split views y paneles contextuales antes que diálogos.
- **Hover**: filas `#FBFCFD` o `#F7FAFC`; botones secundarios `#F4F6F7`; primario `#0E3A50`.
- **Responsive**: desktop-first para gestión, analítica, documentos y GIS; tablet para trabajo técnico; mobile solo para FieldFlow y consultas rápidas (fase posterior).

## State Management

Estado del prototipo, útil como mapa de la máquina de estados de la UI:

| Estado | Valores | Efecto |
|---|---|---|
| `screen` | portfolio · command · gis · parcel · social · quality · field · tenant · portal · states | Superficie activa; `portal` sustituye todo el chrome |
| `tab` | usuarios · roles · módulos · templates · seguridad · integraciones · branding | Pestaña de Tenant Settings |
| `parcelTab` | resumen · visitas · instrumentos · afectaciones · media · quality | Pestaña del predio |
| `socialTab` | overview · open · taxonomy | Pestaña de Social Intelligence |
| `selected` | código de predio | Selección compartida mapa ↔ tabla ↔ panel |
| `qIdx` | índice de cola | Respuesta abierta en revisión |
| `validated` | lista de índices | Respuestas marcadas HUMAN VALIDATED en la sesión |
| `qOpen` | índice o `null` | Bandeja vs detalle de hallazgo |
| `prov` | clave de registro o `null` | Drawer de provenance abierto y su contenido |
| `paletteOpen` | boolean | Command palette |

En producción, `screen`/`tab` corresponden a rutas; `selected`, `qIdx` y `prov` a estado de vista; `validated` a mutaciones persistidas.

## Data Provenance — contrato del componente

Invocado siempre por un enlace discreto «Ver origen» (11 px, `#17506B`, 500). Campos del drawer:

| Campo | Contenido |
|---|---|
| `SOURCE TYPE` | `REAL_AGGREGATE` · `RECONSTRUCTED` · `ANONYMIZED` · `SYNTHETIC`, con nota contextual |
| `SOURCE / DATASET` | Documento, capa o dataset con su identificador |
| `VERSIÓN` | Del documento, la capa o la taxonomía vigente al calcular |
| `CAPTURADO / IMPORTADO` | Fecha y medio de captura |
| `MÉTODO` | Solo si es derivado: fórmula o criterio en una línea |
| `HUMAN VALIDATION` | Validado · Parcial · Pendiente · Requiere especialista, con autor y fecha |

Puntos de invocación implementados: KPI del Command Center · Operational forecast · consulta significativa · capa cartográfica · panel contextual del predio · instrumentos de la ficha · variable cerrada · respuesta abierta · detalle de hallazgo.

## Estados del sistema (los 15)

`loading` · `empty` · `error` · `offline` · `syncing` · `permission denied` · `feature disabled` · `no project selected` · `no GIS yet` · `partial GIS` · `no survey data yet` · `offline pending sync` · `no findings` · `AI unavailable` · `AI low confidence`.

Reglas: se aplican al contenedor donde ocurre el problema, no a la pantalla completa; el esqueleto de carga tiene la forma del contenido real; los registros no sincronizados no cuentan en el avance y hay que decirlo; `no findings` aclara que no sustituye la revisión técnica; `AI low confidence` no preselecciona categoría. Copy definitivo en la galería del prototipo y en la spec v0.2 §10.

## Design Tokens

### Color

| Token | Hex | Uso |
|---|---|---|
| Ink | `#101827` | Texto principal, barra del portal |
| Azul técnico | `#17506B` | Acción, selección, marca |
| Azul técnico hover | `#0E3A50` | Botón primario en hover |
| Azul suave | `#F0F6F9` | Fondo activo, avisos, AI suggestion |
| Azul borde suave | `#C3D6E0` | Borde de contenedores informativos |
| Azul mapa | `#4A7F9B` | Series de datos y cobertura |
| Verde validado | `#2C6046` | Completo, validado, aprobado |
| Verde fondo | `#EAF3EE` / borde `#CBE2D6` | Chip de éxito |
| Ámbar atención | `#B08519` · texto `#8A6512` | Revisita, confianza baja |
| Ámbar fondo | `#FBF3E2` / borde `#EFE0BF` | Chip de advertencia |
| Terracota crítica | `#C0492A` · texto `#9E3B22` | Hallazgo crítico, error |
| Terracota fondo | `#FBEAE6` / borde `#F0D3CB` | Chip crítico |
| Superficie | `#FFFFFF` | Tarjetas, tablas, paneles |
| Lienzo | `#F2F4F5` | Fondo del workspace |
| Superficie sutil | `#FAFBFC` | Cabeceras de tabla, citas |
| Borde | `#DCE1E5` | Contorno de contenedor |
| Borde fuerte | `#C8D0D6` | Botón secundario, filetes de cita |
| Hairline | `#F0F2F4` | Separador entre filas |
| Neutro chip | `#F1F3F5` / borde `#E2E6E9` | Chip neutro |
| Texto secundario | `#5A646C` | Cuerpo secundario |
| Texto tenue | `#7A858E` | Etiquetas y metadatos |
| Texto deshabilitado | `#A6AEB4` | Ítems no accionables |

### Tipografía

Source Serif 4 (titulares, cifras, citas) · Archivo (interfaz) · JetBrains Mono (códigos, abscisas, keys, scores, reglas, timestamps).

| Estilo | Tamaño / interlínea | Peso |
|---|---|---|
| Display | 38 / 44 | 600 |
| Título de pantalla | 23–26 / 32 | 600 |
| Título de tarjeta | 17 / 24 | 600 |
| Cifra destacada | 20–44 | 600 |
| Cita textual | 14–17 / 1,65 | 400 |
| Cuerpo | 12,5 / 19 | 400 |
| Etiqueta | 9,5 / 14, tracking .12em, mayúsculas | 600 |
| Mono | 10,5–11 / 16 | 400–500 |

### Espaciado, radios y sombras

- Escala: `4 · 6 · 8 · 10 · 12 · 14 · 16 · 18 · 20 · 22 · 26 · 32 · 44`.
- Padding de página `20–28px / 26–32px`; padding de tarjeta `14–20px`; celda de tabla `9–12px 16px`.
- Radios: `3px` (chips cuadrados, badges, controles del rail) · `4px` (botones, inputs, contenedores internos) · `5px` (paneles) · `6px` (portal, palette) · `11–13px` (chips redondeados) · `50%` (avatares, puntos).
- Sombras: tarjeta `0 1px 2px rgba(16,24,39,.04)` · palette `0 18px 44px rgba(16,24,39,.22)` · drawer `-14px 0 34px rgba(16,24,39,.14)`.
- Altura de fila de tabla ≈ 36 px; hover `#FBFCFD`; sin cebreado.

## Assets

Ninguno externo. La cartografía, los croquis, las miniaturas y la marca son SVG inline generados en los propios archivos. Las tipografías se cargan desde Google Fonts (Source Serif 4, Archivo, JetBrains Mono) — sustituir por las equivalentes del codebase destino si ya existe un sistema tipográfico.

**Pendiente de recibir del cliente**: el GIS oficial (eje vial y capa catastral de predios). Hasta entonces el corredor es `RECONSTRUCTED` y los predios `SYNTHETIC`, y así deben seguir declarándose.

## Files

| Archivo | Contenido |
|---|---|
| `EIA Studio.dc.html` | Prototipo navegable completo: shell, Portfolio, Command Center, GIS/Parcel Explorer, Parcel Workspace, Social Intelligence, Quality Gate, Field Surveys, Tenant Settings, Client Portal y galería de estados. |
| `screenshots/*.png` | Set canónico de 11 golden visual references a 1440 px. |
| `Arquitectura y Lenguaje Visual.dc.html` | Spec v0.2: modelo de dominio, capabilities, superficies, Command Center y forecast, GIS, Parcel, Social, Quality Gate, provenance, estados, tipografía, color, componentes, decisiones de arquitectura visual y fuera de alcance. |

Ambos se abren directamente en el navegador, sin servidor ni build.

## Fuera de alcance en esta versión del diseño

FieldFlow móvil (solo existe la bandeja de lo que llega) · Report Generator · RAG Assistant · Climate Analytics · PMA Compliance · Environmental Audit.
