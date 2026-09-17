/**
 * The product's words, in the language it was designed in.
 *
 * ## Why this file is the source of truth
 *
 * `Messages` is derived from this object, so every other catalogue is type-checked against it and a
 * key added here and forgotten elsewhere does not compile. Spanish is first because the copy was
 * written for a consultancy in Ecuador and the English is a rendering of it — not the other way
 * round, which is how a product ends up sounding translated in the language its users speak.
 *
 * ## What belongs here, and what does not
 *
 * Here: everything a person reads on a screen. Labels, states, empty states, errors, help text,
 * the words for stored values (ADR-025's rule — *a stored value is never rendered; a label for it
 * is*).
 *
 * Not here: project source data. A document delivered in Spanish stays Spanish, a management plan's
 * measures are quoted in the words the study used, and a parcel code is a code.
 */
export const messages = {
  common: {
    missing: "—",
    empty: "—",
    yes: "Sí",
    no: "No",
    save: "Guardar",
    cancel: "Cancelar",
    close: "Cerrar",
    back: "Volver",
    open: "Abrir",
    search: "Buscar",
    filter: "Filtrar",
    all: "Todos",
    none: "Ninguno",
    loading: "Cargando…",
    retry: "Reintentar",
    of: "de",
    version: "Versión",
    date: "Fecha",
    status: "Estado",
    actions: "Acciones",
    dayOne: "{count} día",
    dayOther: "{count} días",
    required: "Obligatorio",
    optional: "Opcional",
  },
  locale: {
    label: "Idioma",
    hint: "Cambia el idioma de la interfaz. No traduce los documentos del proyecto.",
    changed: "Idioma cambiado a {language}.",
  },
  auth: {
    title: "EIA Studio",
    subtitle: "Plataforma de estudios de impacto ambiental y social",
    email: "Correo institucional",
    password: "Contraseña",
    signIn: "Entrar",
    signInTitle: "Entrar al workspace",
    signInSubtitle:
      "Estudios de impacto ambiental y social, con trazabilidad de extremo a extremo.",
    signUpDisabled:
      "El registro público está deshabilitado. Las cuentas se aprovisionan de forma explícita por la organización.",
    provenancePromise:
      "Toda cifra publicada conserva su cadena de procedencia hasta el registro de campo.",
    signingIn: "Entrando…",
    accountMenu: "Cuenta de {name}",
    signOut: "Cerrar sesión",
    signingOut: "Cerrando sesión…",
    signOutFailed: "No pudimos cerrar la sesión. Inténtalo de nuevo.",
    signedInAs: "Sesión iniciada como {role}.",
    roleSwitchHint:
      "Para revisar el producto con otro rol, cierra sesión e inicia con la identidad correspondiente.",
    failed: "No pudimos iniciar sesión. Revisa el correo y la contraseña.",
  },
  shell: {
    organisation: "Organización",
    activeProject: "Proyecto activo",
    workspace: "Espacio de trabajo",
    portfolio: "Cartera de proyectos",
    tenantSettings: "Configuración de la organización",
    comingSoon: "PRÓXIMAMENTE",
    skipToContent: "Saltar al contenido",
    mainNavigation: "Navegación principal",
    user: "Usuario",
    noMembershipTitle: "Todavía no perteneces a ninguna organización",
    noMembershipBody:
      "Las membresías las crea un Owner o un Admin de la organización. Pide acceso a quien administra tu espacio de trabajo.",
    chooseOrganisation: "Selecciona la organización con la que quieres trabajar.",
    organisations: "Organizaciones",
    breadcrumb: "Ruta de navegación",
    noOrganisations: "Sin organizaciones",
    noProjectSelected: "Sin proyecto seleccionado",
  },
  surface: {
    commandCenter: "Centro de control",
    gis: "Cartografía y predios",
    field: "Trabajo de campo",
    social: "Análisis social",
    quality: "Control de consistencia",
    pgas: "Plan de Manejo",
    documents: "Documentos",
    reports: "Informes",
    portal: "Portal del cliente",
    intake: "Preparar proyecto",
  },
  systemState: {
    permissionDeniedTitle: "No tienes acceso a esta sección",
    permissionDeniedBody: "Tu rol {role} no incluye {restricted}.",
    permissionDeniedBody2: "Solicita acceso al coordinador del proyecto.",
    currentRole: "actual",
    notImplementedTitle: "Módulo todavía no disponible",
    notImplementedTitleWith: "{label}: la implementación aún no está disponible",
    notImplementedBody:
      "El módulo está habilitado para este proyecto. Su superficie llega en {phase}; todavía no hay datos ni acciones disponibles aquí, y no se muestran cifras de demostración en su lugar.",
    notImplementedLaterPhase: "una fase posterior",
    backToCommandCenter: "Volver al centro de control",
    noProjectTitle: "Selecciona un proyecto para continuar",
    noProjectBody:
      "Las secciones de cartografía, campo y análisis siempre operan sobre un proyecto.",
    goToPortfolio: "Ir a la cartera de proyectos",
    emptyTitle: "Sin información",
    errorTitle: "Algo falló",
    errorBody: "No se perdió ningún dato. Referencia {reference}.",
    offline: "Sin conexión",
    online: "Con conexión",
  },
  field: {
    currentOperation: "Operativo actual",
    previousOperation: "Operativo anterior",
    viewProvenance: "Ver origen",
    fromDate: " · desde {date}",
    targetDate: " · meta {date}",
    closedOperationNote:
      "Operativo cerrado. Se conserva completo — sus asignaciones, visitas y fichas enviadas siguen aquí — y no cuenta en el avance ni en las cifras del operativo actual.",
    captureChannel: "Canal de captura",
    offlineCapture: "Captura offline",
    channelSupportsOffline: "El canal declara soporte offline.",
    channelOnlineOnly: "El canal web requiere conexión al enviar; no hay cola offline.",
    campaignProgress: "Avance de la campaña",
    submittedOf: "{submitted} / {total} enviadas",
    assigned: "Asignadas",
    pending: "Pendientes",
    inProgress: "En curso",
    completed: "Completadas",
    submitted: "Enviadas",
    noCampaignsTitle: "Todavía no hay campañas de campo",
    noCampaignsBody:
      "Una campaña conecta un cuestionario publicado con las asignaciones de campo. Hasta que exista una, no hay avance que mostrar: esta superficie no inventa cifras.",
    showPreviousOne: "Ver el operativo anterior",
    showPreviousMany: "Ver los {count} operativos anteriores",
    closedOperationsNote:
      "Operativos cerrados. Se conservan completos — sus asignaciones, visitas y fichas enviadas siguen aquí — y no cuentan en el avance ni en las cifras del operativo actual.",
    workloadTitle: "Carga por técnico",
    noAssignments: "Todavía no hay asignaciones repartidas.",
    workloadCaption:
      "Asignaciones por técnico. Son recuentos: esta vista no muestra respuestas individuales.",
    technician: "Técnico",
    workloadFootnote:
      "Recuentos de trabajo, no respuestas. Abrir una ficha concreta requiere el permiso de lectura de respuestas individuales, que no todos los roles tienen.",
    myWorkTitle: "Mi trabajo",
    myWorkEmpty: "No tienes predios asignados en este proyecto.",
    myWorkEmptyNote:
      "No tienes asignaciones en campañas activas. Cuando el coordinador te asigne predios, aparecerán aquí.",
    myWorkSummary: "{total} asignaciones · {pending} por completar",
    viewSubmittedForm: "Ver ficha enviada",
    continueForm: "Continuar ficha",
    continueVisit: "Continuar visita",
    formLine: "Ficha: {status}",
    parcel: "Predio",
    openAssignment: "Abrir",
    locationOutcome: "Ubicación",
    startVisit: "Iniciar visita",
    surveyTitle: "Ficha de campo",
    visit: "Visita",
    visitLocationHint:
      "Al iniciar la visita se pedirá tu ubicación. Puedes continuar sin ella: la ficha no queda bloqueada.",
    startingVisit: "Iniciando…",
    visitCompleted: "Completada",
    visitInProgress: "En curso",
    submittedNote:
      "Esta ficha fue enviada y ya no puede editarse. Una corrección será un flujo revisado, no una edición silenciosa.",
    saved: "Guardado.",
    backToMyWork: "Volver a mi trabajo",
    saveDraft: "Guardar borrador",
    submitting: "Enviando…",
    submitForm: "Enviar ficha",
    questionRequired: "Esta pregunta es obligatoria.",
  },
  quality: {
    title: "Control de consistencia",
    lastRun: "Última revisión: {when}",
    neverRun: "Todavía no se ha ejecutado ninguna revisión",
    run: "Ejecutar revisión",
    running: "Ejecutando…",
    runDone: "Revisión ejecutada.",
    lead: "El control de consistencia señala discrepancias entre dos fuentes del expediente. No determina cuál de las dos es correcta, ni declara conformidad: esa decisión, con su justificación, es de un especialista y queda registrada de forma permanente.",
    restrictedData: "la revisión de consistencia del expediente",
    open: "Abiertos",
    underReview: "En revisión",
    highSeverity: "Severidad alta",
    accepted: "Aceptados",
    resolved: "Resueltos",
    dismissed: "Descartados",
    findings: "Hallazgos",
    findingsCount: "{count} en total",
    noFindingsAfterRun:
      "La última revisión no encontró discrepancias entre las fuentes que compara el conjunto de reglas vigente.",
    neverRunOnProject: "Todavía no se ha ejecutado ninguna revisión sobre este proyecto.",
    findingsCaption: "Hallazgos de consistencia, ordenados por estado y severidad",
    findingCode: "Código",
    finding: "Hallazgo",
    type: "Tipo",
    severity: "Severidad",
    interdisciplinary: "Revisión interdisciplinaria",
    rulesTitle: "Reglas vigentes",
    rulesNote: "Lo que esta revisión comprueba, haya encontrado algo o no",
    ruleVersion: "versión {version}",
    decisionRecorded: "Decisión registrada.",
    detectedAt: "Detectado {when} · regla {rule}",
    interdisciplinaryNote:
      "Este hallazgo contrasta criterios de más de una disciplina y no debería resolverse desde una sola.",
    evidence: "Evidencia",
    evidenceNote: "Las dos fuentes, tal como están escritas. El sistema no decide cuál rige.",
    transcribedFrom: "Transcrito de",
    passageNotMatched: " El pasaje exacto no pudo identificarse por coincidencia literal.",
    reconstructedExtract:
      "Extracto reconstruido del expediente. Sin número de página: el documento todavía no está en el sistema.",
    declaredOnProject: "Valor declarado en la ficha del proyecto.",
    whyFlagged: "Por qué se señaló",
    suggestedAction: "Acción sugerida.",
    decisionTitle: "Decisión de especialista",
    decisionNoteCanDecide:
      "Toda decisión exige una justificación y queda registrada de forma permanente.",
    decisionNoteReadOnly:
      "Tu rol puede consultar los hallazgos; decidirlos corresponde a un revisor.",
    decision: "Decisión",
    justification: "Justificación",
    justificationPlaceholder: "Qué se contrastó y con qué criterio se decide.",
    justificationHint: "Mínimo 12 caracteres. Se conserva de forma permanente y con tu nombre.",
    recording: "Registrando…",
    recordDecision: "Registrar decisión",
    noTransitions: "Este hallazgo no admite más transiciones desde su estado actual.",
    reviewerOnly: "Solo un rol con permiso de revisión puede registrar una decisión.",
    historyTitle: "Historial de decisiones",
    historyEmptyNote: "Todavía nadie ha decidido sobre este hallazgo",
    historyCount: "{count} decisión(es)",
    historyEmptyBody:
      "Cuando alguien decida, la decisión y su justificación quedarán aquí. No se editan ni se borran: un cambio de criterio es una decisión nueva.",
    reviewer: "Revisor",
    evidenceRole: {
      SOURCE_A: "Fuente A",
      SOURCE_B: "Fuente B",
      CONTEXT: "Contexto",
    },
    decisionOption: {
      START_REVIEW: "Tomar para revisión",
      ACCEPT: "Aceptar el hallazgo",
      DISMISS: "Descartar el hallazgo",
      RESOLVE: "Marcar como resuelto",
      REQUEST_INTERDISCIPLINARY: "Solicitar revisión interdisciplinaria",
      REOPEN: "Reabrir",
    },
    decisionHelp: {
      START_REVIEW: "Queda a tu nombre mientras lo revisas.",
      ACCEPT: "La discrepancia es real. Aceptarla no dice cuál de las dos fuentes rige.",
      DISMISS: "Las fuentes son consistentes, o la regla las leyó mal.",
      RESOLVE: "Aceptado y ya corregido en el expediente.",
      REQUEST_INTERDISCIPLINARY: "Necesita el criterio de otra disciplina antes de decidirse.",
      REOPEN: "Hay información nueva, o la decisión anterior debe revisarse.",
    },
    severityLabel: {
      high: "Alta",
      medium: "Media",
      low: "Baja",
    },
    state: {
      OPEN: "Abierto",
      UNDER_REVIEW: "En revisión",
      ACCEPTED: "Aceptado",
      DISMISSED: "Descartado",
      RESOLVED: "Resuelto",
    },
    findingType: {
      NUMERICAL_MISMATCH: "Numérica",
      GEOGRAPHICAL_MISMATCH: "Geográfica",
      TEMPORAL_MISMATCH: "Temporal",
      DOCUMENT_COMPLETENESS: "Completitud",
      CROSS_DOCUMENT_INCONSISTENCY: "Entre documentos",
      MISSING_EVIDENCE: "Evidencia insuficiente",
    },
  },
  social: {
    sections: "Secciones del análisis social",
    noSubmittedResponses:
      "Todavía no hay respuestas enviadas que tabular. El análisis social lee únicamente respuestas enviadas: los borradores de campo no participan en ninguna cifra de esta superficie.",
    codingDisabled:
      "La codificación asistida no está activa en este proyecto. La tabulación determinista no depende de ella y sigue disponible en la pestaña anterior.",
    tabTabulation: "Tabulación",
    tabOpenAnswers: "Respuestas abiertas",
    codingTitle: "Codificación de respuestas abiertas",
    aiUnaffected:
      " La tabulación determinista no depende de un modelo y sigue disponible más arriba.",
    aiNotConfigured:
      "La codificación asistida no está configurada en este entorno, así que no se pueden crear ejecuciones.",
    aiFakeRefused:
      "Este entorno tiene configurado el clasificador determinista de pruebas, que no puede ejecutarse aquí: sus propuestas serían indistinguibles de las de un modelo real.",
    aiBlockedExternal:
      "El proveedor de modelos no está disponible: falta configuración externa. No se sustituye por un clasificador simulado.",
    denominator: {
      submitted: "sobre respuestas enviadas",
      answered: "sobre quienes respondieron la pregunta",
      answered_multi: "sobre quienes respondieron la pregunta (selección múltiple)",
    },
    denominatorHelp: {
      submitted: "Base: todas las respuestas enviadas de esta versión del cuestionario.",
      answered:
        "Base: respuestas enviadas que contestaron esta pregunta. Los porcentajes suman 100 %.",
      answered_multi:
        "Base: respuestas enviadas que contestaron esta pregunta. Cada persona puede elegir varias opciones, así que la suma de los porcentajes puede superar el 100 %.",
    },
    tabulationTitle: "Tabulación de preguntas cerradas",
    noClosedQuestions: "Esta versión del cuestionario no tiene preguntas cerradas tabulables.",
    deterministic: "Cálculo determinista · sin modelo de lenguaje",
    tabulationLead:
      "{template} · versión {version} · {submitted} respuestas enviadas. Las versiones no se suman entre sí: una respuesta solo se interpreta contra el cuestionario que se le hizo.",
    answeredLine: "{answered} respondieron · {unanswered} sin responder · porcentajes {rule}",
    minimum: "Mínimo",
    median: "Mediana",
    mean: "Promedio",
    maximum: "Máximo",
    option: "Opción",
    runCoding: "Ejecutar codificación asistida",
    creatingRun: "Creando ejecución…",
    runCreated: "Ejecución creada.",
    openAnswers: "Respuestas abiertas",
    proposalsReady: "Propuestas listas",
    pendingReview: "Pendientes de revisión",
    validated: "Validadas",
    agreementLabel: "Coincidencia IA · especialista",
    agreementHelp:
      "Proporción de respuestas en las que el especialista mantuvo exactamente las categorías propuestas. El especialista revisó viendo la propuesta, así que esto mide concordancia operativa, no acierto del modelo frente a una codificación independiente.",
    overrideLabel: "Corregidas por el especialista",
    confidenceLabel: "Confianza del modelo",
    confidenceHelp:
      "Valor heurístico que el modelo reporta para priorizar la revisión. No es una probabilidad calibrada, no dice qué proporción acierta y no sustituye la validación de un especialista.",
    queueNote:
      "{count} respuesta(s) en la cola de clasificación. El proceso de fondo las toma de a una; esta pantalla las muestra en cuanto terminan.",
    failedNote:
      "{count} clasificación(es) fallida(s). La tabulación determinista no se ve afectada: sigue disponible arriba.",
    validatedThemes: "Temas validados",
    validatedBase:
      "Solo cuenta lo que un especialista decidió. Base: {reviewed} respuesta(s) validada(s); {unreviewed} sin revisar quedan fuera y no se extrapolan. Una respuesta puede llevar varios temas, así que los porcentajes pueden sumar más de 100 %.",
    noValidatedCodings: "Todavía no hay codificaciones validadas.",
    provisionalTitle: "Distribución provisional de la IA",
    provisionalChip: "Provisional · sin validar",
    provisionalNote:
      "Lo que el modelo propuso, antes de cualquier decisión humana. Se muestra aparte y con su propia base ({count} propuestas) para que no se confunda con el resultado validado.",
    noProposals: "Sin propuestas.",
    schemeTitle: "Esquema de codificación",
    reconstructed: "Reconstruido",
    schemeVersion: "Versión {version}.",
    schemeTechnical: "Detalle técnico del esquema",
    schemeFingerprint:
      "Huella de la definición: {hash}. Dos codificaciones hechas contra la misma huella se hicieron contra el mismo esquema.",
    runsTitle: "Codificaciones asistidas",
    runsCount: "{count} ejecución(es)",
    runsNote:
      "Cada vez que se pidió al modelo que propusiera categorías, y qué devolvió. Son propuestas: ninguna entra en un resultado sin la decisión de un especialista.",
    runWhen: "Cuándo",
    runProposals: "Propuestas",
    runScheme: "Esquema",
    runProposalsOf: "{succeeded} de {queued}",
    runFailed: " · {count} sin resultado",
    runsTechnical: "Detalle técnico de las ejecuciones",
    requestedModel: "Modelo solicitado",
    resolvedModel: "Modelo que respondió",
    adapter: "Adaptador",
    promptVersion: "Instrucción (versión · huella)",
    runStatus: {
      QUEUED: "En cola",
      RUNNING: "En curso",
      COMPLETED: "Completada",
      FAILED: "Fallida",
      BLOCKED: "Bloqueada",
    },
    theme: "Tema",
    responses: "Respuestas",
    percentage: "Porcentaje",
    distribution: "Distribución",
    noOpenAnswers:
      "No hay respuestas abiertas enviadas en esta versión del cuestionario. La codificación asistida solo lee respuestas enviadas con texto.",
    inView: "{count} en vista",
    filterResponses: "Filtrar respuestas",
    filterAll: "Todas",
    filterPendingAi: "Pendientes de IA",
    filterFailed: "IA fallida",
    filterPendingReview: "Pendientes de revisión",
    filterReviewed: "Revisadas",
    filterLowConfidence: "Confianza baja",
    rowMeta: "{question} · versión {version}",
    reviewFirst: " · revisar primero",
    modelAskedForReview: "El modelo pidió revisión humana",
    proposalLabel: "Propuesta de la IA · provisional, sin validar",
    validatedLabel: "Codificación validada por especialista · {decision}",
    closeReview: "Cerrar revisión",
    reviewAndDecide: "Revisar y decidir",
    statusValidated: "Validada",
    statusProposalReady: "Propuesta lista",
    statusFailed: "Clasificación fallida",
    statusProcessing: "Procesando",
    statusQueued: "En cola",
    statusNoProposal: "Sin propuesta",
    reviewRecorded: "Revisión registrada.",
    reviewScheme: "Esquema {version} · {note}",
    categoriesOfVersion: "Categorías de esta versión",
    proposedMark: " · propuesta por la IA",
    acceptProposal: "Aceptar propuesta",
    saveCorrection: "Guardar corrección",
    atLeastOneCategory:
      "Una revisión mantiene al menos una categoría. Si nada aplica, elige la categoría residual.",
  },
  gis: {
    parcelCode: "Código",
    sector: "Sector",
    chainage: "Abscisa",
    side: "Lado",
    area: "Área",
    affectation: "Afectación",
    selection: "Selección",
    selectParcel: "Seleccionar {code}",
    tableCaption: "Predios del corredor. Selecciona un predio para resaltarlo en el mapa.",
    noMatchTitle: "Ningún predio coincide con los filtros",
    noMatchBody: "Ajusta el código, el sector o el estado para volver a ver predios del corredor.",
    searchParcel: "Buscar predio",
    noGeometryTitle: "Este proyecto aún no tiene geometría",
    noGeometryBody:
      "Carga el eje vial y los predios para activar el explorador. Hasta entonces no se muestran capas: no hay cartografía que representar.",
    searchPlaceholder: "Código, sector o abscisa",
    parcelCount: "{total} predios · {visible} en vista",
    layerProvenance: "Procedencia de la capa",
    influenceAreas: "Áreas de influencia del estudio",
    influenceNote:
      "Contorno generalizado para el dibujo; la geometría almacenada es la que entregó el estudio.",
    selectedParcel: "Predio seleccionado",
    noSector: "Sin sector",
    chainageAbbrev: "ABS",
    sideLine: "lado {side}",
    totalArea: "Área total",
    frontage: "Frente sobre la vía",
    estimatedAffectation: "Afectación estimada",
    openWorkspace: "Abrir la ficha del predio",
    viewProvenance: "Ver origen de los datos",
    selectPrompt: "Selecciona un predio en el mapa o en la tabla para ver su ficha territorial.",
    recentre: "Centrar en proyecto",
    parcelSelected: "Predio seleccionado: {code}",
    noParcelSelected: "Ningún predio seleccionado",
    mapIsVisual:
      "El mapa es una representación visual de la tabla de predios. Toda la información está disponible en la tabla, que es navegable con el teclado.",
    basemapLabel: "Fondo del mapa",
    basemapNotConfigured: "Requiere mapa de referencia configurado",
    basemapUnavailable:
      "El mapa de referencia no está disponible. Se mantiene el fondo neutro; las capas del estudio no cambian.",
    basemapCredits: "Mapa de referencia",
    parcelStatusLegend: "Estado del predio",
  },
  parcel: {
    tabSummary: "Resumen",
    tabAffectations: "Afectaciones",
    tabVisits: "Visitas",
    tabInstruments: "Instrumentos",
    tabMedia: "Fotografías",
    mediaDeniedTitle: "Fotografías: sin acceso al trabajo de campo",
    mediaDeniedBody:
      "Tu rol puede consultar el predio pero no las fotografías de sus visitas. Una fotografía de un predio puede contener a una persona, un número de casa o una placa, y por eso se rige por el mismo permiso que las respuestas individuales.",
    noMedia:
      "No hay fotografías registradas para este predio. Aparecen aquí cuando un técnico las carga desde EIA Field.",
    mediaTitle: "Fotografías de campo",
    mediaCaption: "Fotografías cargadas durante las visitas a este predio",
    mediaNever:
      "Las fotografías de campo no se publican al cliente, no se envían a ningún proveedor de modelos, no entran al expediente documental y no se dibujan en el mapa. Descargar una es una acción deliberada y queda registrada.",
    mediaKindColumn: "Tipo",
    mediaCapturedAt: "Captura",
    mediaSize: "Tamaño",
    mediaNote: "Nota del técnico",
    mediaHasLocation: "Con ubicación del técnico",
    mediaNoLocation: "Sin ubicación",
    tabQuality: "Calidad",
    sections: "Secciones del predio",
    backToExplorer: "Volver al explorador",
    location: "Ubicación",
    noGeometry:
      "Este predio no tiene geometría activa. Su ficha existe, pero no puede representarse en el mapa hasta que se cargue el polígono.",
    layerLine: "Capa: {layer} · {version}",
    viewLayerProvenance: "Ver origen de la capa",
    territorialRecord: "Ficha territorial",
    chainageMethod: "Método de abscisado",
    viewParcelProvenance: "Ver origen de los datos del predio",
    noAffectations:
      "No hay afectaciones registradas para este predio en la versión activa de la capa.",
    affectationsTitle: "Afectaciones estimadas",
    affectationsCaption: "Afectaciones estimadas del predio {code}",
    category: "Categoría",
    affectedArea: "Área afectada",
    shareOfParcel: "% del predio",
    provenanceColumn: "Origen",
    affectationsNote:
      "Las áreas se calculan sobre la geometría activa; son una estimación cartográfica, no una medición de campo ni un avalúo.",
    visitsDeniedTitle: "Visitas: sin acceso al trabajo de campo",
    visitsDeniedBody:
      "Tu rol puede consultar el predio pero no el trabajo de campo asociado. Acceder al expediente territorial no otorga por sí solo acceso a las visitas.",
    noVisits:
      "No hay visitas registradas para este predio. Cuando un técnico inicie una visita de una campaña activa, aparecerá aquí.",
    visitsTitle: "Visitas de campo",
    visitsCaption:
      "Visitas de campo registradas para este predio. Muestra el estado del trabajo, no las respuestas individuales.",
    visitStart: "Inicio",
    technician: "Técnico",
    form: "Ficha",
    visitsNoteWithAccess: "Las respuestas individuales se consultan desde el análisis social.",
    visitsNoteWithoutAccess:
      "Se muestra el estado del trabajo de campo. Ver una respuesta individual requiere un permiso que tu rol no incluye.",
    pendingTitle: "{label}: aún sin datos",
    instrumentsNote:
      "Las fichas socioeconómicas y demás instrumentos se listarán aquí cuando la bandeja de campo esté implementada.",
    qualityNote:
      "Los hallazgos del control de consistencia referidos a este predio se mostrarán aquí cuando el módulo esté implementado.",
  },
  intake: {
    title: "Preparar proyecto",
    lead: "Lo que EIA Studio necesita para operar este proyecto. No dice nada sobre si el estudio está completo ni sobre su conformidad: eso lo decide un especialista, no una lista de comprobación.",
    stageProject: "Proyecto",
    stageTeam: "Equipo",
    stageGis: "Cartografía",
    stageDocuments: "Documentos",
    stageSurveys: "Formularios",
    stageTemplates: "Plantillas",
    stageReadiness: "Preparación",
    stageActivation: "Activación",
    save: "Guardar",
    saving: "Guardando…",
    saved: "Cambios guardados.",
    readOnly: "Tu rol puede leer la preparación de este proyecto, no editarla.",
    projectName: "Nombre corto",
    officialTitle: "Título oficial del estudio",
    programmeReference: "Programa / referencia",
    locationLabel: "Ubicación",
    profile: "Perfil",
    lifecycle: "Estado",
    offlineMode: "Captura offline",
    teamEmpty: "Todavía no hay nadie asignado a este proyecto.",
    teamNote:
      "Quién está en el proyecto y con qué rol. Asignar personas es una acción de la coordinación; aquí se lee.",
    teamRole: "Rol",
    teamMember: "Persona",
    gisNote: "Las capas activas del proyecto, tal como las dejó la importación.",
    gisDatasets: "{count} versión(es) de capa activa(s)",
    gisParcels: "{count} predio(s) con geometría",
    gisEmpty:
      "Todavía no se ha importado cartografía. La importación se hace con el contrato de importación del producto; esta pantalla no convierte formatos.",
    documentsNote:
      "Cargado no es lo mismo que procesado: un documento cargado existe en el expediente, y sólo cuando termina su procesamiento pueden citarse sus pasajes.",
    documentsEmpty: "Todavía no hay documentos en el expediente de este proyecto.",
    surveysNote:
      "Una campaña resuelve sus respuestas contra una versión publicada, para siempre. Un borrador no es algo con lo que se pueda salir a campo.",
    surveysEmpty: "Todavía no hay cuestionarios en este proyecto.",
    surveyPublished: "Publicada",
    surveyDraft: "Borrador",
    surveyLanguages: "Idiomas: {languages}",
    templatesNote:
      "Lo que el perfil del proyecto trae consigo: los instrumentos que declara y el conjunto de reglas de consistencia que se ejecutará.",
    templatesInstruments: "Instrumentos declarados por el perfil",
    templatesRules: "Reglas de consistencia",
    templatesPending:
      "La edición de cuestionarios y plantillas dentro del producto llega en una fase posterior. Hasta entonces, un cuestionario se publica con las herramientas de aprovisionamiento y esta pantalla informa de lo que existe.",
    readinessOperable: "EIA Studio puede operar este proyecto.",
    readinessBlocked: "Falta algo antes de poder operar este proyecto.",
    readinessScopeNote:
      "Esta comprobación dice si el producto tiene lo que necesita. No dice que el estudio esté completo ni que cumpla nada.",
    required: "Obligatorio",
    advisory: "Informativo",
    outcomeSatisfied: "Cumplido",
    outcomeBlocked: "Falta",
    outcomeNotApplicable: "No aplica",
    activationNote:
      "Activar mueve el proyecto de planificación a trabajo de campo. Sólo cambia el estado del proyecto: no activa campañas, no asigna trabajo y no publica nada al cliente.",
    activate: "Activar el proyecto",
    activating: "Activando…",
    activated: "Proyecto activado. Su estado es ahora «en campo».",
    activationBlocked: "No se puede activar todavía: hay comprobaciones obligatorias sin cumplir.",
    alreadyActive: "Este proyecto ya salió de planificación.",
    /*
     * Keys carry no dots: a lookup walks the dotted path, so `project.identity` would be
     * unreachable. The rule key is flattened at the call site, as capability keys are.
     */
    rule: {
      project_identity: "Identificación del proyecto",
      project_coordinator: "Coordinación asignada",
      project_cartography: "Cartografía importada",
      project_questionnaire: "Cuestionario publicado",
      project_capture_channel: "Canal de captura configurado",
      project_offline_channel: "Canal compatible con la política offline",
      project_corpus: "Documentos del expediente",
      project_storage: "Almacenamiento de archivos",
    },
    ruleWhat: {
      project_identity:
        "El proyecto declara nombre corto, título oficial y ubicación, que es como se le reconoce en un entregable.",
      project_coordinator:
        "Al menos una persona con rol de coordinación: quien publica al cliente, aprueba entregables y reparte el trabajo de campo.",
      project_cartography:
        "Hay una versión de capa activa con predios con geometría. Informativo: un estudio empieza antes de que llegue su paquete GIS.",
      project_questionnaire:
        "Al menos una versión de cuestionario publicada. Las respuestas se resuelven contra una versión publicada, no contra un borrador.",
      project_capture_channel:
        "La campaña del proyecto declara por dónde se captura. Informativo: un proyecto puede prepararse antes de tener campaña.",
      project_offline_channel:
        "Si el proyecto exige captura sin conexión, su canal debe soportarla. El canal web de EIA Studio no la soporta.",
      project_corpus:
        "Hay al menos un documento en el expediente. Informativo: los documentos llegan a lo largo del estudio.",
      project_storage:
        "Este entorno puede guardar archivos. Informativo: es configuración del despliegue, no del proyecto, y el trabajo de campo no guarda archivos.",
    },
    ruleDetail: {
      missing: "Falta: {missing}",
      parcels: "{parcels} predio(s) con geometría",
      datasets: "{datasets} capa(s) activa(s)",
      published: "{published} versión(es) publicada(s)",
      drafts: "{drafts} borrador(es), ninguna publicada",
      channel: "Canal: {channel}",
      offlineMode: "Política: {offlineMode}",
      documents: "{documents} documento(s)",
    },
    /* Why storage is unavailable, as words. The resolver's own `detail` names environment
       variables and belongs in a log, not on a consultant's screen (ADR-031 §5). */
    storageReason: {
      NOT_CONFIGURED: "El almacenamiento de objetos no está configurado en este entorno.",
      MEMORY_REFUSED_IN_PERSISTENT_ENVIRONMENT:
        "Este entorno tiene configurado el almacenamiento en memoria, que no puede usarse aquí: los archivos desaparecerían con el proceso.",
      BLOCKED_EXTERNAL_CONFIG:
        "Falta configuración externa del almacenamiento: no se sustituye por un almacén temporal.",
      UNKNOWN: "El almacenamiento no está disponible en este entorno.",
    },
  },

  pgas: {
    title: "Plan de Manejo Ambiental y Social",
    notImported:
      "Este proyecto todavía no tiene cargado el capítulo del plan de manejo. Cuando se cargue, aquí aparecen sus planes, programas y medidas tal como los redactó la consultora.",
    countNote: "{plans} planes · {measures} medidas",
    intro:
      "Este es el plan que propone el estudio, leído del capítulo que entregó la consultora. EIA Studio no registra aquí su ejecución ni su cumplimiento: muestra qué medidas contiene, qué declara cada una y qué deja en blanco.",
    sourceLine: "Fuente: {file} · {measures} medidas en {plans} planes · ",
    viewProvenance: "Ver origen del dato",
    onePlanWithoutCode: "Un plan del capítulo no trae código: ",
    plansWithoutCode: "{count} planes del capítulo no traen código: ",
    headingVariants:
      "El capítulo nombra {count} columna(s) de más de una forma: {variants}. Se conservan tal como aparecen en el documento.",
    planNote: "{programmes} programa(s) · {measures} medida(s)",
    complete:
      "Las {count} medidas declaran indicador, medio de verificación, responsable, frecuencia y plazo.",
    gap: "{count} de {total} medidas no indican {field}",
    noProgramme: "Medidas sin programa declarado",
    aspect: "Aspecto ambiental",
    impact: "Impacto identificado",
    indicator: "Indicador",
    verification: "Medio de verificación",
    responsible: "Responsable",
    frequency: "Frecuencia",
    deadline: "Plazo",
    documentNumber: "N° del documento:",
    studioCode: "Código EIA Studio: {code}",
    columnsSummary: "Cómo nombra este plan sus columnas",
    columnsBody:
      "Los rótulos de arriba están normalizados para poder leer el plan. El capítulo, en este plan, escribe: {columns}. Se conserva tal cual en el dato almacenado.",
    footnote:
      "El «N° del documento» reproduce la numeración del capítulo, incluidas las repeticiones. El «Código EIA Studio» lo genera este producto para poder referenciar una medida; no es una referencia de la consultora.",
    field: {
      indicator: "indicador",
      verification: "medio de verificación",
      responsible: "responsable",
      frequency: "frecuencia",
      deadline: "plazo",
    },
  },
  portfolio: {
    newProject: "Nuevo proyecto",
    newProjectLead:
      "Crear el proyecto es la primera mitad; la segunda es prepararlo en «Preparar proyecto», que es donde se carga su información.",
    newProjectName: "Nombre del proyecto",
    newProjectSlug: "Identificador en la URL",
    newProjectSlugHelp:
      "Minúsculas, números y guiones. Aparece en la dirección del proyecto y no se cambia después.",
    newProjectProfile: "Perfil",
    newProjectProfileHelp: "Decide qué módulos tiene el proyecto. Se copia al crearlo.",
    newProjectSubmit: "Crear proyecto",
    newProjectCreating: "Creando…",
    newProjectCreated: "Proyecto {name} creado.",
    newProjectUnknownProfile: "Ese perfil no existe en esta versión del producto.",
    title: "Cartera de proyectos",
    projectsActive: "{count} proyectos activos",
    projectActive: "{count} proyecto activo",
    profileLine: "perfil {profile}",
    metricsRestrictedTitle: "Solo administración de proyectos",
    metricsRestrictedBody:
      "Tu rol {role} administra esta organización pero no incluye acceso a los datos operativos de los proyectos. Necesitas una asignación en el proyecto para ver sus cifras.",
    emptyTitle: "Aún no hay proyectos en esta organización",
    emptyBody: "Crea uno desde una plantilla de perfil o importa geometría, predios y encuestas.",
    moreEmptyTitle: "Aún no hay más proyectos en esta organización",
    moreEmptyBody:
      "Crea uno desde una plantilla de perfil o importa geometría, predios y encuestas existentes.",
    openCommandCenter: "Abrir el centro de control",
    attentionTitle: "Atención requerida",
    activityTitle: "Actividad reciente",
    activityCaption: "Actividad reciente de la organización",
    modulesTitle: "Módulos activos",
    modulesBody:
      "Lo que esta organización tiene contratado y encendido. Un módulo apagado no aparece en el menú y tampoco se abre escribiendo su dirección.",
  },
  commandCenter: {
    targetDate: "Fecha objetivo",
    projection: "Proyección",
    projectRole: "Rol en el proyecto",
    implicitAccess: "{role} · acceso implícito",
    lastUpdated: "Última actualización",
    scenarioCutoff: "Fecha de corte del escenario",
    scenarioBadge: "Escenario demo · fecha de corte: {date}",
    delayChip: "Retraso proyectado {days}",
    profileLine: "perfil {profile}",
    noMetricsTitle: "Sin métricas todavía",
    noMetricsBody: "Cuando el equipo registre avance, el control de ejecución aparecerá aquí.",
    executionControl: "Control de ejecución",
    executionNote:
      "Universo, levantamientos y consulta son cifras reales del estudio; el resto son métricas operativas de demostración, fijadas a la fecha de corte del escenario.",
    forecastTitle: "Proyección operativa",
    forecastNote: "cálculo aritmético sobre el ritmo observado · sin modelo predictivo",
    forecastStatementLate:
      "Al ritmo de los últimos {days} días, el levantamiento concluiría {delay} después de la fecha objetivo.",
    forecastStatementEarly:
      "Al ritmo de los últimos {days} días, el levantamiento concluiría {delay} antes de la fecha objetivo.",
    forecastStatementOnTime:
      "Al ritmo de los últimos {days} días, el levantamiento concluiría el mismo día de la fecha objetivo.",
    currentRate: "Ritmo actual",
    requiredRate: "Ritmo necesario",
    perDay: "pred/día",
    activeTechnicians: "Técnicos activos",
    ofAssigned: "de {count} asignados",
    pending: "Pendientes",
    parcelsUnit: "predios",
    completionsPerDay: "Levantamientos por día · últimos {days} días",
    completionsPerDayLabel: "Levantamientos por día, últimos {days} días",
    assumptions: "Supuestos:",
    algorithmVersion: "Versión del cálculo:",
    attentionTitle: "Requiere atención hoy",
    attentionCount: "{count} elementos",
    attentionEmpty:
      "Nada requiere atención hoy. Esto no sustituye la revisión técnica del expediente.",
    activityTitle: "Actividad reciente",
    activityCaption: "Actividad reciente del proyecto",
    activityTime: "Hora",
    activityActor: "Actor",
    activityAction: "Acción",
    activityObject: "Objeto",
    consultationTitle: "Consulta significativa",
    consultationComplete: "COMPLETA",
    territoryTitle: "Resumen territorial",
    openGis: "Abrir cartografía",
    parcelsInCorridor: "predios en el corredor",
    alignmentLength: " · {km} km de eje",
    mappedArea: "Superficie cartografiada",
    affectedArea: "Afectación estimada",
    withoutGeometry:
      "{without} de {total} predios aún no tienen geometría; las superficies de arriba sólo cubren los que sí la tienen.",
    fieldCampaignTitle: "Campaña de campo en curso",
    openField: "Abrir el trabajo de campo",
    formsSubmitted: "fichas enviadas · {campaign}",
    assignments: "Asignaciones",
    completed: "Completadas",
    fieldCampaignNote:
      "Operación de demostración en curso. No forma parte de las encuestas socioeconómicas del estudio concluido, que son una cifra histórica agregada del expediente.",
    scopeTitle: "Alcance de esta fase",
    scopeBody:
      "Los instrumentos del proyecto y los hallazgos de calidad llegan con los módulos de campo y control de calidad. No se muestran cifras inventadas en su lugar.",
  },
  actions: {
    noSurfaceAccess: "No tienes acceso a esta superficie.",
    noAssignmentAccess: "No tienes acceso a esta asignación.",
    checkPayload: "Revisa los datos enviados.",
    qualityRun: "Revisión ejecutada: {parts}.",
    qualityCreated: "{count} hallazgo(s) nuevo(s)",
    qualityUpdated: "{count} actualizado(s)",
    qualityReopened: "{count} reabierto(s)",
    qualitySkipped: "{count} regla(s) sin datos suficientes",
    qualityDecided: "Decisión registrada: {from} → {to}.",
    portalPublishDenied: "Tu rol permite revisar la publicación, pero no publicarla.",
    portalPublishedUnchanged:
      "Publicada la actualización {version}. Dice exactamente lo mismo que la anterior: los datos publicables no han cambiado.",
    portalPublished: "Publicada la actualización {version}. Es lo que el cliente ve desde ahora.",
    socialRunCreated: "Ejecución creada: {queued} respuestas en cola{skipped}.",
    socialRunSkipped: ", {count} omitidas",
    socialAccepted: "Propuesta aceptada y registrada como codificación validada.",
    socialCorrected: "Codificación corregida: {added} añadida(s), {removed} retirada(s).",
    reportNoResponses:
      "No hay respuestas enviadas que reportar. El capítulo se construye sobre fichas enviadas; los borradores de campo no participan en ninguna cifra.",
    reportUnchanged:
      "Versión {version} generada. Los datos no han cambiado desde la versión anterior: el contenido es idéntico.",
    reportGenerated: "Versión {version} generada a partir de los datos validados actuales.",
  },
  provenance: {
    drawerTitle: "ORIGEN DEL DATO",
    regime: "Régimen",
    origin: "Origen",
    transformations: "Transformaciones",
    granularity: "Granularidad",
    validation: "Validación humana",
    method: "Método",
    source: "Fuente",
    capturedAt: "Capturado",
    recordedAt: "Registrado",
    openDrawer: "Ver origen",
    notFoundTitle: "Registro no disponible",
    notFoundBody:
      "No existe un registro de procedencia con ese identificador en este proyecto, o no tienes acceso a él.",
    notApplicable: "No aplica",
    sourceDataset: "Fuente / dataset",
    capturedOrImported: "Capturado / importado",
    recordedIn: "Registrado en EIA Studio",
    derivedFrom: "Calculado a partir de",
  },
  documents: {
    title: "Documentos",
    lead: "El expediente del proyecto y los pasajes que respaldan cada cita.",
    code: "Código",
    documentTitle: "Título",
    kind: "Tipo",
    currentVersion: "Versión vigente",
    passages: "Pasajes",
    assistant: "Asistente documental",
    askPlaceholder: "Pregunta sobre el expediente del proyecto",
    ask: "Preguntar",
    searchStrategy: "Búsqueda léxica sobre el texto del expediente",
    noDocuments: "Todavía no hay documentos en este proyecto.",
    upload: "Cargar documento",
    uploading: "Cargando…",
    processing: "Procesando",
    ready: "Listo",
    requiresOcr: "Requiere OCR",
    failed: "Falló el procesamiento",
    uploadedNotProcessed: "Cargado · aún no indexado",
    uploadTitle: "Cargar un documento",
    uploadNote: "PDF (hasta {pdf}) o DOCX (hasta {docx})",
    uploadLead:
      "El archivo se carga tal como llega y queda como una versión del documento. Cargado no es procesado: el texto se extrae después, y hasta entonces la versión no tiene pasajes que citar.",
    uploadTarget: "¿A qué documento pertenece?",
    uploadTargetNew: "Es un documento nuevo",
    uploadTargetExisting: "Es una versión nueva de un documento existente",
    uploadExistingLabel: "Documento",
    uploadCode: "Código",
    uploadCodeHelp: "Un identificador de este proyecto, por ejemplo DOC-014.",
    uploadTitleField: "Título",
    uploadKind: "Tipo",
    uploadFile: "Archivo",
    uploadPrivacy: "Datos personales",
    uploadPrivacyHelp:
      "Lo declara quien carga el archivo; el sistema no lo deduce. Solo un documento declarado sin datos personales puede salir hacia un proveedor de modelos.",
    uploadSourceDate: "Fecha del documento",
    uploadSourceDateHelp: "La que trae el documento, si se conoce.",
    uploadSourceNote: "Procedencia",
    uploadSourceNoteHelp: "De dónde viene este archivo y quién lo entregó.",
    uploadSubmit: "Cargar",
    uploadStored: "Cargado como versión {version}. Queda pendiente de procesar.",
    uploadSameContent:
      "Este archivo ya es la versión {version} de este documento. No se creó una versión nueva.",
    uploadTransferFailed:
      "El archivo no llegó al almacenamiento. No se registró ninguna versión; se puede volver a intentar.",
    uploadNeedsFile: "Selecciona un archivo.",
    storageUnavailable:
      "En este entorno no se pueden cargar archivos: el almacenamiento de objetos no está configurado. El resto del expediente funciona igual.",
    storageUnavailableWho:
      "Es configuración del entorno, no un permiso: la activa quien administra el despliegue.",
    privacy: "Datos personales",
    state: "Estado",
    fileSize: "Tamaño",
    originalFilename: "Archivo",
    notProcessedYet:
      "Esta versión se cargó pero todavía no se ha procesado, así que no tiene pasajes que citar.",
    requiresOcrNote:
      "Este PDF no trae texto: son imágenes de páginas. El producto no inventa lo que dicen. El archivo queda disponible para descargar y consultar a mano.",
    processingFailedNote: "El procesamiento no pudo completarse. El archivo cargado sigue intacto.",
    requeue: "Procesar de nuevo",
    requeued: "En cola para procesar. El trabajador lo tomará en cuanto pueda.",
    alreadyQueued: "Ya estaba en cola.",
    queuedNote: "En cola para procesar; todavía no tiene pasajes que citar.",
    processingNote: "Procesando en este momento.",
    download: "Descargar original",
    downloadNote:
      "Se abre un enlace temporal firmado por el proveedor de almacenamiento. Caduca en minutos y la descarga queda registrada.",
    noOriginal:
      "Esta versión no tiene archivo: su texto se transcribió a mano del expediente, y el PDF original nunca entró al sistema.",
    projectDocuments: "Documentos del proyecto",
    documentsNote: "{documents} documento(s) · {passages} pasajes",
    emptyBody:
      "Este proyecto todavía no tiene documentos cargados. El asistente responde únicamente a partir de ellos, así que no tiene nada que consultar.",
    tableCaption: "Documentos del expediente, por código",
    document: "Documento",
    pages: "Páginas",
    ofVersions: " de {count}",
    detailNote: "{kind} · {pages} página(s) · {passages} pasajes",
    supersededNote:
      "Esta es una versión anterior del documento. Se conserva porque las citas hechas contra ella siguen apuntando a estas palabras; la versión vigente puede decir otra cosa.",
    chunkingNote:
      "Los pasajes son la unidad que una cita nombra; no cambian mientras exista esta versión.",
    chunkingStrategy: "Segmentación",
    passagesNote: "En el orden en que aparecen en el documento",
    passage: "Pasaje {number}",
    passagePage: " · p. {page}",
    passagePages: " · pp. {from}–{to}",
    passageSection: " · {section}",
    assistantTitle: "Consulta al expediente",
    assistantNote: "Responde únicamente con pasajes de los documentos del proyecto",
    assistantLead:
      "El asistente no responde de memoria: busca en los documentos de este proyecto y cita el pasaje exacto, con su documento, su versión y su página. Si no encuentra evidencia, lo dice.",
    questionLabel: "Pregunta al expediente",
    questionPlaceholder: "¿Cuántos predios afectados declara el expediente?",
    searching: "Buscando…",
    consult: "Consultar",
    citationPassage: " · pasaje {number}",
    retrievalStrategy: {
      "full-text": "Búsqueda léxica",
    },
    retrievalStrategyHelp: {
      "full-text":
        "Los pasajes se seleccionan por las palabras que contienen, no por su significado. Una pregunta formulada con otras palabras que el documento puede no encontrar nada, aunque el documento lo diga.",
    },
    review: {
      title: "Revisión asistida",
      lead: "Un modelo lee pasajes del expediente y propone qué podría querer revisar un especialista. No detecta nada: propone, y una persona decide.",
      distinction:
        "Esto no es el Control de consistencia. Allí una regla determinista compara dos valores y el resultado se puede rehacer a mano. Aquí un modelo sugiere, y ninguna sugerencia entra en un informe hasta que un especialista la acepta.",
      lensLabel: "Enfoque de la revisión",
      lensHelp:
        "Cada enfoque busca un tipo de contraste y se limita a él. No existe una revisión general del estudio.",
      run: "Iniciar revisión",
      running: "Iniciando…",
      runsTitle: "Revisiones realizadas",
      runsCaption: "Revisiones asistidas de este proyecto, de la más reciente a la más antigua",
      runStarted:
        "Revisión en cola sobre {sources} documento(s). Los candidatos aparecerán aquí cuando termine.",
      runStatus: "Estado",
      runLens: "Enfoque",
      runSources: "Documentos",
      runPassages: "Pasajes",
      runCandidates: "Candidatos",
      runRefused: "Descartados por el sistema",
      runRefusedHelp:
        "Candidatos que el modelo devolvió y que no se guardaron: citaban un pasaje que no recibieron, o usaban lenguaje que este producto no admite. Se cuentan en lugar de ocultarse.",
      runModel: "Modelo",
      runWhen: "Fecha",
      noRuns: "Todavía no se ha hecho ninguna revisión asistida en este proyecto.",
      status: {
        QUEUED: "En cola",
        PROCESSING: "Procesando",
        COMPLETED: "Terminada",
        FAILED: "Falló",
      },
      emptyReason: {
        NO_PASSAGES:
          "La búsqueda no encontró pasajes para este enfoque, así que no se consultó a ningún modelo. No hay nada que proponer.",
        NO_CANDIDATES: "El modelo no propuso nada para este enfoque.",
      },
      candidatesTitle: "Candidatos generados por IA",
      candidatesLead:
        "Cada uno es una sugerencia con los pasajes en que se apoya. Ninguno afirma que algo esté mal.",
      noCandidates: "Todavía no hay candidatos.",
      candidate: "Candidato generado por IA",
      observation: "Lo observado",
      suggestedCheck: "Qué se podría verificar",
      evidence: "Pasajes citados",
      support: {
        TWO_SIDED: "Dos fuentes contrapuestas",
        SINGLE_SOURCE: "Una sola fuente",
      },
      supportHelp: {
        TWO_SIDED:
          "El candidato señala dos pasajes que no coinciden. Puede aceptarse como observación para el expediente.",
        SINGLE_SOURCE:
          "El candidato se apoya en un único pasaje, así que no muestra una discrepancia entre dos fuentes. Se puede descartar, pero no aceptar.",
      },
      role: {
        SOURCE_A: "Fuente A",
        SOURCE_B: "Fuente B",
        CONTEXT: "Contexto",
      },
      state: {
        PROPOSED: "Propuesto por IA",
        ACCEPTED: "Aceptado por especialista",
        DISMISSED: "Descartado por especialista",
      },
      decide: "Decidir",
      accept: "Aceptar",
      dismiss: "Descartar",
      reopen: "Reabrir",
      justification: "Justificación",
      justificationHelp:
        "Queda registrada, atribuida y permanente. Una decisión no se edita: un cambio de opinión es otra decisión.",
      justificationTooShort: "La justificación es obligatoria (mínimo 12 caracteres).",
      submitDecision: "Registrar decisión",
      decisionsTitle: "Decisiones",
      decidedBy: "{decision} · {when}",
      acceptRefusedSingleSource:
        "Este candidato se apoya en un solo pasaje. Aceptarlo afirmaría una discrepancia entre dos fuentes que no se ha mostrado.",
      corpusTitle: "Documentos revisados",
      corpusNote:
        "La revisión lee la versión vigente de cada documento. Una versión anterior se conserva para que las citas hechas contra ella sigan resolviendo, pero no se revisa.",
      refusedTitle: "Revisión rechazada",
      refusedLead:
        "No se envió nada a ningún modelo. La revisión se rechaza completa en lugar de omitir los documentos bloqueados: informar sobre menos de lo que se pidió, sin decirlo, sería peor que no revisar.",
      refusedReason: {
        PRIVACY_NOT_AI_SAFE: "declarado con datos personales o pendiente de revisión",
        CONTAINS_PII: "marcado como documento con datos personales",
        NOT_READABLE: "todavía no tiene texto procesado",
      },
      refusedDocument: "{code}: {reason}",
      unavailable: {
        NOT_CONFIGURED:
          "La revisión asistida no está configurada en este entorno. El resto de Documentos funciona igual.",
        FAKE_REFUSED_IN_PERSISTENT_ENVIRONMENT:
          "Este entorno tiene configurado el revisor determinista de pruebas, que no puede ejecutarse aquí: sus candidatos serían indistinguibles de los de un modelo real.",
        BLOCKED_EXTERNAL_CONFIG:
          "El proveedor de modelos no está disponible: falta configuración externa. No se sustituye por un revisor simulado.",
      },
      lens: {
        numerical_consistency: "Cifras entre documentos",
        dates_chronology: "Fechas y cronología",
        project_identity: "Identidad del proyecto",
        locations_institutions: "Lugares e instituciones",
        social_conclusions_support: "Conclusiones sociales y su respaldo",
        management_plan_application_area: "Plan de manejo y lugar de aplicación",
        general_cross_document: "Contraste general entre documentos",
      },
    },
    narrativeUnavailable: {
      no_evidence:
        "No se encontraron pasajes del expediente relacionados con esta pregunta. El asistente responde únicamente a partir de los documentos del proyecto: cuando no hay evidencia, no hay respuesta.",
      generator_unavailable: "El generador de texto no está disponible en este entorno.",
      not_configured:
        "La redacción asistida no está configurada en este entorno, así que no se genera un párrafo. Los pasajes citados son la evidencia y se muestran completos.",
      fake_refused:
        "Este entorno tiene configurado el generador determinista de pruebas, que no puede ejecutarse aquí: su texto sería indistinguible del de un modelo real. Los pasajes citados son la evidencia y se muestran completos.",
      blocked_external_config:
        "El proveedor de modelos no está disponible: falta configuración externa. No se sustituye por un generador simulado. Los pasajes citados son la evidencia y se muestran completos.",
    },
  },
  templates: {
    title: "Plantillas del entregable",
    lead: "Los formatos .docx de la consultora, versionados, validados y activados antes de generar nada.",
    notAvailable: "Dato no disponible",
    distinction:
      "Una plantilla se rellena con datos validados del proyecto. Lo que el proyecto no tiene no se rellena con cero: se marca como dato no disponible, y si es un campo sin el cual el documento no puede ser honesto, no se genera el documento.",
    noTemplates: "Todavía no hay plantillas en este proyecto.",
    code: "Código",
    name: "Nombre de la plantilla",
    kind: "Tipo",
    purpose: "Para qué sirve",
    kindLabel: {
      cover: "Carátula",
      chapter: "Capítulo",
      annex: "Anexo",
    },
    versions: "Versiones",
    versionLabel: "Versión",
    locale: "Idioma",
    state: "Estado",
    uploadedAt: "Cargada",
    stateLabel: {
      UPLOADED: "Cargada · sin leer",
      VALIDATED: "Leída · sin activar",
      ACTIVE: "Activa",
      SUPERSEDED: "Sustituida",
    },
    localeLabel: {
      "es-EC": "Español (Ecuador)",
      en: "Inglés",
    },
    localeNote:
      "El español y el inglés son versiones distintas de la misma plantilla, nunca una traducción automática de la otra: el registro y la redacción legal de un entregable son de quien lo firma.",
    newTemplate: "Registrar una plantilla",
    newTemplateLead:
      "Primero se registra el nombre y para qué sirve; después se carga el archivo como versión.",
    codeHelp: "Un identificador de este proyecto, por ejemplo TPL-CARATULA.",
    purposeHelp: "En las palabras de la consultora. No se genera ni se traduce.",
    create: "Registrar",
    created: "Plantilla {code} registrada. Ya se le puede cargar una versión.",
    uploadVersion: "Cargar una versión",
    uploadVersionLead:
      "Un .docx. No se aceptan .doc ni .docm: un archivo con macros no entra, se llame como se llame.",
    uploadTemplateField: "Plantilla a versionar",
    uploadFile: "Archivo .docx",
    uploadLocale: "Idioma de esta versión",
    upload: "Cargar versión",
    uploading: "Cargando…",
    uploaded: "Cargada como {version}. Revisa los marcadores antes de activarla.",
    uploadAnswered: "Este archivo ya era la versión {version} de esta plantilla en este idioma.",
    uploadFailed: "El archivo no llegó al almacenamiento. No se registró ninguna versión.",
    needsFile: "Selecciona un archivo .docx.",
    manifestTitle: "Marcadores encontrados",
    supported: "Reconocidos",
    unknown: "No reconocidos",
    required: "Obligatorios",
    containers: "Repeticiones",
    tagCount: "{count} marcador(es) en total",
    unknownBlocks:
      "Mientras haya marcadores no reconocidos la versión no se puede activar. No se ignoran ni se imprimen en blanco: un documento con un hueco donde su autor esperaba una cifra es peor que un error.",
    vocabularyTitle: "Vocabulario disponible",
    vocabularyLead:
      "Los únicos marcadores que este producto sustituye. Cada uno nombra un dato determinista o validado; no hay marcadores de datos personales, propuestas de IA ni identificadores internos.",
    vocabularySourceFor: {
      "project.name": "El nombre corto con el que se navega el proyecto.",
      "project.official_title": "El título del estudio, tal como consta en su portada.",
      "project.locality": "La línea de ubicación del proyecto.",
      "project.programme_reference": "El programa al que pertenece el estudio.",
      "territory.corridor_length_km": "Una medición registrada, con su ficha de procedencia.",
      "territory.parcel_universe": "El universo confirmado de predios, no el estimado.",
      "social.surveys_complete": "Fichas enviadas, contadas de forma determinista.",
      "social.consultation_participants": "La asistencia tal como la registra el acta.",
      "pgas.plans": "Planes del Plan de Manejo, de la importación vigente.",
      "pgas.programmes": "Programas distintos entre las medidas de la importación vigente.",
      "pgas.measures": "Medidas del Plan de Manejo, de la importación vigente.",
      "generation.date": "El momento en que se generó el documento; nunca la fecha del estudio.",
      "generation.locale": "El idioma en que se generó, para que el lector sepa qué versión tiene.",
      "generation.draft_banner":
        "Un texto de este producto: «BORRADOR — NO ES UN ENTREGABLE APROBADO». La plantilla debe incluirlo.",
    },
    vocabularyKey: "Marcador",
    vocabularySource: "De dónde sale",
    vocabularyAbsence: "Si no hay dato",
    absenceLabel: {
      BLOCKS: "No se genera el documento",
      DECLARED: "Se imprime «Dato no disponible»",
    },
    validationError: "No se pudo leer el archivo: {error}",
    revalidate: "Volver a leer",
    revalidated: "Archivo leído de nuevo.",
    activate: "Activar",
    activating: "Activando…",
    activated: "Versión activada. Ya se pueden generar documentos con ella.",
    activateHelp:
      "Activar es una decisión sobre el estudio, no un hecho sobre el archivo: desde ese momento un entregable puede nombrarla y la versión queda congelada.",
    generate: "Generar documento",
    generating: "Generando…",
    generated: "Documento generado. Es un borrador y lo dice en su portada.",
    generatedTitle: "Documentos generados",
    generatedLead:
      "Cada uno conserva de qué plantilla, de qué versión y con qué datos se hizo. No se editan: volver a generar produce otro.",
    noGenerated: "Todavía no se ha generado ningún documento.",
    generatedAt: "Generado",
    generatedTemplate: "Plantilla",
    generatedSize: "Tamaño",
    generatedAbsent: "Datos no disponibles",
    generatedAbsentNote:
      "Marcadores que se imprimieron como «Dato no disponible» porque el proyecto no tiene ese dato.",
    download: "Descargar",
    downloadNote:
      "Se abre un enlace temporal firmado por el proveedor de almacenamiento. Caduca en minutos y la descarga queda registrada.",
    draftBanner: "BORRADOR — NO ES UN ENTREGABLE APROBADO",
    draftNote:
      "Todo documento generado lleva este aviso, y la plantilla tiene que incluir el marcador que lo imprime. No existe un flujo de aprobación en este producto.",
    storageUnavailable:
      "En este entorno no se pueden cargar plantillas: el almacenamiento de objetos no está configurado.",
  },
  reports: {
    title: "Informes",
    draftBanner: "Borrador, no entregable.",
    generate: "Generar versión",
    generating: "Generando…",
    noVersions: "Todavía no se ha generado ninguna versión",
    versionsCount: "{count} versión(es)",
    draftBannerFull:
      "Borrador, no entregable. Cada versión se construye a partir de datos validados — tabulación determinista, codificaciones validadas por especialista, hallazgos de consistencia decididos y documentos citados por versión — y ninguna afirmación constituye una conclusión normativa. Las propuestas automáticas sin validar no entran en ninguna cifra.",
    immutableNote:
      "Una versión no se edita. Cuando cambian los datos validados se genera una versión nueva, y la anterior conserva exactamente lo que decía.",
    versionsCaption: "Versiones del capítulo social",
    generatedAt: "Generada",
    questionnaire: "Cuestionario",
    figures: "Cifras",
    narrative: "Redacción",
    downloadColumn: "Descarga",
    current: " · vigente",
    noNarrative: "sin redacción",
    download: "Descargar",
    versionTitle: "Capítulo social · {version}",
    versionNote: "Cuestionario {questionnaire} · {facts} cifras",
    downloadDocx: "Descargar .docx",
    draftShort:
      "Borrador, no entregable. Ninguna afirmación de esta versión constituye una conclusión normativa.",
    supersededNote:
      "Esta es una versión anterior. Se conserva porque dice lo que decía cuando se generó; la versión vigente puede decir otra cosa.",
    regimesPresent: "Regímenes presentes: {regimes}.",
    narrativeModel: " Redacción asistida: {model}.",
    noNarrativeModel:
      " Sin redacción asistida: las cifras y sus fuentes son el contenido de esta versión.",
    restrictedData: "los borradores de informe del proyecto",
    sourceKind: {
      metric: "Cálculo determinista",
      human_review: "Codificación validada por especialista",
      quality_finding: "Hallazgo de consistencia",
      document_chunk: "Pasaje citado del expediente",
      provenance: "Registro de procedencia",
    },
    sourceMetric: "{label} · {metric} — {method}",
    sourceHumanReview: "{label} · {reviews} codificación(es) validada(s), taxonomía {taxonomy}",
    sourceFinding: "{label} · {code} ({state})",
    sourceDocument: "{label} · {code} {version}{page}",
    sourcePage: " · p. {page}",
    sourceProvenance: "{label} · {regime} · {transformations}",
  },
  portal: {
    title: "Portal del cliente",
    clientView: "Vista del cliente",
    publish: "Publicar actualización",
    publishing: "Publicando…",
    history: "Historial de publicaciones",
    prepare: "Preparar actualización",
    notPublished: "No se publica",
    whatClientSees: "Lo que ve el cliente",
    nothingPublished: "Todavía no se ha publicado nada",
    publishFirst: "Publicar la primera actualización",
    portalLead:
      "El portal es una publicación, no un reflejo del workspace. Entre una publicación y la siguiente, lo que el cliente ve no cambia: la consultora decide qué información sale y cuándo. La vista del cliente todavía no está compartida con nadie fuera de la organización.",
    draftCount: "{count} cifra(s) publicable(s)",
    draftLead:
      "Esto es lo que diría una actualización publicada ahora mismo. Se construye a partir de las cifras agregadas verificadas del estudio y de la cartografía publicada; nada se redacta a mano.",
    noPublications: "Sin publicaciones",
    publicationsCount: "{count} publicación(es)",
    historyEmpty:
      "Cuando publiques una actualización aparecerá aquí, con su fecha y quién la publicó. Una publicación no se edita: una corrección es una publicación nueva.",
    historyCaption: "Publicaciones del portal del cliente",
    publishedAt: "Publicada",
    publishedBy: "Publicó",
    figures: "Cifras",
    view: "Ver",
    previewStrip: "Vista previa interna · este enlace aún no está compartido con el cliente",
    clientBrand: "Informe de avance para el cliente",
    noCartography: "No se ha publicado cartografía del proyecto.",
    mapAlignment: "Trazado: {label}.",
    mapAreas: "Áreas delimitadas: {labels}.",
    lastPublished: "Última actualización publicada:",
    summaryTitle: "Resumen del estudio",
    summaryEmpty: "No se ha publicado todavía ninguna cifra de resumen para este estudio.",
    territoryTitle: "Territorio",
    participationTitle: "Participación y componente social",
    participationEmpty: "No se ha publicado todavía información del componente social.",
    managementPlanTitle: "Plan de Manejo Ambiental",
    measureOne: "1 medida",
    measureMany: "{count} medidas",
    followUpTitle: "Seguimiento",
    followUpEmpty: "No se ha publicado todavía información de avance operativo.",
    deliverablesTitle: "Entregables",
    deliverablesEmpty:
      "No hay entregables publicados. Cuando la consultora apruebe un documento para su entrega, aparecerá aquí.",
    noPublicationTitle: "Todavía sin publicaciones",
    noPublicationBody:
      "Todavía no se ha publicado ninguna actualización para este proyecto. La consultora publica una actualización cuando decide qué información compartir.",
    viewingOlder: "Estás viendo una publicación anterior ({version}).",
    backToManagement: "Volver a la gestión de publicaciones",
  },
  vocabulary: {
    tenantRole: {
      OWNER: "Titular de la organización",
      ADMIN: "Administración",
      MEMBER: "Equipo",
    },
    projectRole: {
      COORDINATOR: "Coordinación de proyecto",
      PROJECT_DATA_MANAGER: "Gestor de información",
      SOCIAL_SPECIALIST: "Especialista social",
      ENVIRONMENTAL_SPECIALIST: "Especialista ambiental",
      GIS_SPECIALIST: "Cartografía / SIG",
      FIELD_TECHNICIAN: "Técnico de campo",
      REVIEWER: "Revisión",
      VIEWER: "Consulta",
    },
    /*
     * Keys carry no dots: a lookup walks the dotted path, so `core.projects` would be unreachable.
     * The capability key is mapped to this shape at the call site, exactly as `mobile.commandType`
     * does for the sync protocol's own wire names.
     */
    capability: {
      core_projects: "Proyectos y planificación",
      core_documents: "Documentos del expediente",
      gis_maps: "Cartografía",
      gis_parcels: "Predios y afectaciones",
      field_surveys: "Trabajo de campo",
      social_analytics: "Análisis social",
      social_ai_coding: "Codificación asistida de respuestas abiertas",
      quality_document_gate: "Control de consistencia",
      quality_rag_assistant: "Asistente del expediente",
      reports_social_generator: "Generación de informes",
      client_portal: "Portal del cliente",
      climate_analytics: "Análisis climático",
      compliance_pma: "Plan de Manejo",
      audit_environmental: "Auditoría ambiental",
    },
    requirement: {
      rule_affectation_count: {
        title: "Número de predios afectados",
        what: "Dos documentos del expediente declaran totales distintos de predios con afectación.",
        whyFlagged:
          "El total de predios afectados sostiene el presupuesto de indemnizaciones y el alcance de la consulta. Dos cifras distintas para el mismo universo hacen que ambas queden en duda.",
        suggestedAction:
          "Contrastar los dos documentos y determinar cuál de las dos cifras rige. Corregir la otra en una nueva versión del documento, dejando constancia del criterio.",
      },
      rule_territorial_institution: {
        title: "Institución ajena al territorio del proyecto",
        what: "El expediente menciona una institución de una jurisdicción distinta a la del proyecto.",
        whyFlagged:
          "Una institución de otra provincia en un documento del expediente sugiere texto reutilizado de otro estudio. Afecta a la validez de lo que ese apartado afirma sobre este territorio.",
        suggestedAction:
          "Verificar si la mención corresponde a este proyecto. Si procede de otro expediente, corregir el apartado y revisar qué más pudo copiarse con él.",
      },
      rule_consultation_planned_vs_actual: {
        title: "Fecha de consulta planificada frente a la realizada",
        what: "La fecha de la consulta que consta en la planificación no coincide con la fecha en que se realizó.",
        whyFlagged:
          "Una diferencia entre lo planificado y lo ejecutado no es por sí misma un problema: los procesos participativos se reprograman. Se señala para que quede trazada y explicada en el expediente, no para calificarla.",
        suggestedAction:
          "Registrar el motivo de la reprogramación y comprobar que la convocatoria y el acta corresponden a la fecha realizada.",
      },
      rule_vulnerability_conclusion: {
        title: "Conclusión sobre grupos vulnerables frente al capítulo social",
        what: "Un documento del expediente concluye que no hay grupos en situación de vulnerabilidad, mientras que el capítulo social del mismo expediente reporta casos.",
        whyFlagged:
          "Los dos apartados describen la misma población. Requiere revisión de especialista: puede tratarse de definiciones distintas de vulnerabilidad, de un alcance temporal distinto, o de una conclusión que el capítulo social no sostiene. El sistema no determina cuál.",
        suggestedAction:
          "Revisión interdisciplinaria entre el área social y la legal: contrastar la definición usada en cada documento y dejar constancia del criterio que rige.",
      },
      rule_pgas_place_vs_influence_area: {
        title: "Área de aplicación del plan frente a la cartografía",
        what: "Un plan de manejo declara aplicarse en un área de influencia que la cartografía del proyecto no contiene.",
        whyFlagged:
          "Una medida se ejecuta y se fiscaliza sobre un área concreta. Si el plan la nombra y la cartografía no la delimita, no hay forma de saber dónde debe aplicarse ni de verificar después que se aplicó allí.",
        suggestedAction:
          "Contrastar el capítulo del plan con las capas entregadas: o el plan nombra un área que debe delimitarse, o la cartografía la tiene con otro nombre. Dejar constancia de cuál de las dos rige.",
      },
      rule_project_identity: {
        title: "Identificación del proyecto en el expediente",
        what: "Un identificador del proyecto que consta en el expediente no coincide con el declarado en la ficha del proyecto.",
        whyFlagged:
          "Nombre, ubicación y código identifican el expediente ante la autoridad. Una discrepancia entre documentos del mismo expediente deja sin resolver a qué proyecto se refiere cada uno.",
        suggestedAction:
          "Verificar el identificador correcto con la ficha del proyecto y unificar las menciones en una nueva versión del documento.",
      },
    },
    lifecycle: {
      planning: "En planificación",
      field: "En campo",
      analysis: "En análisis",
      review: "En revisión",
      delivered: "Entregado",
      closed: "Cerrado",
    },
    profile: {
      road_eia_social: "EIA social vial",
    },
    profileDescription: {
      road_eia_social:
        "Corredor vial con predios frentistas, abscisado, ficha socioeconómica por predio, consulta significativa, plan de manejo ambiental y social, y generación de capítulo social.",
    },
    attentionSeverity: {
      high: "Alta",
      medium: "Media",
      low: "Baja",
    },
    parcelStatus: {
      confirmed: "Confirmado",
      estimated: "En verificación",
      not_located: "No localizado",
      excluded: "Excluido",
    },
    parcelStatusNote: {
      confirmed: "Predio frentista confirmado en el universo del estudio",
      estimated: "Geometría estimada; el predio aún no se confirma",
      not_located: "No se pudo ubicar el predio en el corredor",
      excluded: "Fuera del universo de análisis",
    },
    layerLegend: {
      REAL_BASE_MAP: "Cartografía base real",
      RECONSTRUCTED_ALIGNMENT: "Eje reconstruido",
      SYNTHETIC_PARCELS: "Predios simulados",
      OFFICIAL_IMPORTED_ALIGNMENT: "Eje vial del estudio",
      OFFICIAL_CADASTRE: "Catastro oficial",
      FIELD_CAPTURED: "Levantado en campo",
      IMPORTED_STUDY_LAYER: "Capa del estudio",
      STUDY_DELIMITED_AREA: "Área delimitada por el estudio",
    },
    layerLegendNote: {
      REAL_BASE_MAP: "hidrografía, poblados y localización general",
      RECONSTRUCTED_ALIGNMENT: "eje aproximado, dibujado hasta recibir el GIS oficial",
      SYNTHETIC_PARCELS: "polígonos generados · no es catastro",
      OFFICIAL_IMPORTED_ALIGNMENT: "eje vial del paquete GIS oficial",
      OFFICIAL_CADASTRE: "capa catastral oficial importada",
      FIELD_CAPTURED: "geometría levantada en campo",
      IMPORTED_STUDY_LAYER: "levantamiento predial del estudio · no es catastro oficial",
      STUDY_DELIMITED_AREA: "área de influencia delimitada por el estudio",
    },
    sourceTypeNote: {
      REAL_AGGREGATE: "Cifra verificable del expediente, sin datos identificables.",
      RECONSTRUCTED: "Valor derivado de fuentes reales con un método declarado.",
      ANONYMIZED: "Agregado de registros reales, sin identificadores.",
      SYNTHETIC: "Generado para la demostración. No es historia del proyecto.",
    },
    affectationCategory: {
      right_of_way: "Franja de derecho de vía",
      access: "Acceso",
      infrastructure: "Infraestructura",
      crops: "Cultivos",
      other: "Otra",
    },
    chainageMethod: {
      frontage_midpoint: "Punto medio del frente sobre la vía",
      centroid_projection: "Proyección del centroide sobre el eje",
      access_point: "Punto de acceso declarado",
      declared: "Declarada en ficha de campo",
    },
    basemapMode: {
      none: "Sin fondo",
      map: "Mapa",
      satellite: "Satélite",
      terrain: "Relieve",
    },
    reviewDecision: {
      ACCEPTED: "Aceptada",
      CORRECTED: "Corregida",
    },
    regime: {
      HISTORICAL_OBSERVED: "Histórico observado",
      LIVE_OPERATIONAL: "Operacional en vivo",
      DEMO_SIMULATION: "Simulación de demostración",
    },
    origin: {
      FIELD_CAPTURE: "Captura en campo",
      IMPORTED_DOCUMENT: "Documento importado",
      IMPORTED_DATASET: "Dataset importado",
      SYSTEM_GENERATED: "Generado por el sistema",
    },
    transformation: {
      ORIGINAL: "Original",
      RECONSTRUCTED: "Reconstruido",
      DERIVED: "Derivado",
      ANONYMIZED: "Anonimizado",
    },
    granularity: {
      INDIVIDUAL: "Individual",
      AGGREGATE: "Agregado",
    },
    sourceType: {
      REAL_AGGREGATE: "Dato histórico",
      RECONSTRUCTED: "Dato calculado",
      ANONYMIZED: "Agregado sin datos personales",
      SYNTHETIC: "Simulación operativa",
    },
    validationState: {
      VALIDATED: "VALIDADO",
      PARTIAL: "PARCIAL",
      PENDING: "PENDIENTE",
      NOT_REQUIRED: "NO REQUIERE",
      SPECIALIST_REQUIRED: "REQUIERE ESPECIALISTA",
    },
    parcelSide: {
      left: "Izquierdo",
      right: "Derecho",
      both: "Ambos",
    },
    assignmentStatus: {
      PENDING: "Pendiente",
      IN_PROGRESS: "En curso",
      COMPLETED: "Completada",
      CANCELLED: "Cancelada",
    },
    campaignStatus: {
      DRAFT: "Borrador",
      ACTIVE: "En campo",
      CLOSED: "Cerrada",
    },
    visitStatus: {
      IN_PROGRESS: "En curso",
      COMPLETED: "Completada",
    },
    instanceStatus: {
      IN_PROGRESS: "Borrador",
      SUBMITTED: "Enviada",
    },
    locationOutcome: {
      captured: "Ubicación capturada",
      denied: "Permiso de ubicación denegado",
      unavailable: "Ubicación no disponible en el dispositivo",
      not_attempted: "Ubicación no solicitada",
    },
    offlineMode: {
      disabled: "Sin captura offline",
      optional: "Captura offline opcional",
      required: "Captura offline obligatoria",
    },
    captureChannel: {
      NATIVE_WEB: "Captura web de EIA Studio",
      EIA_FIELD_MOBILE: "EIA Field (aplicación móvil)",
    },
    offlineModeDescription: {
      disabled:
        "El proyecto captura en línea. El canal web de EIA Studio es válido para sus campañas.",
      optional:
        "La captura en línea sigue siendo válida. Un canal con soporte offline puede usarse cuando esté configurado, pero no es obligatorio.",
      required:
        "Una campaña no puede activarse si su canal de captura no declara soporte offline. El canal web de EIA Studio no lo tiene todavía.",
    },
    captureChannelNote: {
      NATIVE_WEB: "Formulario web responsivo. Requiere conexión al enviar; no hay cola offline.",
      EIA_FIELD_MOBILE:
        "Aplicación Android/iOS. Descarga el trabajo asignado, captura sin conexión y sincroniza cuando vuelve la señal; una orden reenviada no duplica nada.",
    },
    documentKind: {
      report: "Informe",
      annex: "Anexo",
      minutes: "Acta",
      plan: "Plan",
      legal: "Componente legal",
      other: "Otro",
    },
    textSource: {
      RECONSTRUCTED_EXCERPT: "Extracto reconstruido del expediente",
      PLAIN_TEXT: "Texto plano cargado",
      PDF_TEXT: "Texto extraído de un PDF",
      DOCX_TEXT: "Texto extraído de un DOCX",
      PENDING_EXTRACTION: "Sin procesar",
    },
    documentProcessing: {
      UPLOADED: "Cargado",
      QUEUED: "En cola",
      PROCESSING: "Procesando",
      READY: "Listo",
      REQUIRES_OCR: "Requiere OCR",
      FAILED: "Falló",
    },
    documentPrivacy: {
      NO_PERSONAL_DATA_KNOWN: "Sin datos personales identificados",
      CONTAINS_PERSONAL_DATA: "Contiene datos personales identificados",
      REVIEW_REQUIRED: "Requiere revisión",
    },
    mediaKind: {
      parcel: "Predio",
      affectation: "Afectación",
      access: "Acceso",
      other: "Otra",
    },
    mediaState: {
      PENDING_UPLOAD: "Pendiente de subida",
      UPLOADING: "Subiendo",
      UPLOADED: "Subida",
      FAILED: "Falló la subida",
    },
  },
  mobile: {
    appName: "EIA Field",
    signInHint:
      "Inicia sesión con conexión una vez. Después podrás trabajar sin señal hasta que venza el trabajo descargado.",
    myWork: "Mi trabajo",
    parcel: "Predio",
    chainageAbbrev: "ABS",
    noAssignments: "Sin predios asignados",
    noAssignmentsBody:
      "Descarga tu trabajo cuando tengas señal. Si crees que deberías tener predios asignados, habla con la coordinación del proyecto.",
    searchPlaceholder: "Buscar por predio, sector o abscisa",
    syncNow: "Sincronizar ahora",
    syncing: "Sincronizando…",
    refreshWork: "Actualizar trabajo asignado",
    workUpdated: "Trabajo actualizado.",
    photographs: "Fotografías",
    photographsNote:
      "Se guardan en el teléfono al momento de tomarlas y se envían cuando hay señal. El archivo local no se borra hasta que el servidor confirma que la fotografía quedó registrada.",
    noPhotographs: "Todavía no has tomado fotografías en esta visita.",
    cameraDenied:
      "No se concedió el permiso de cámara. Puedes continuar la visita sin fotografías.",
    captureFailed: "No se pudo guardar la fotografía. Inténtalo otra vez.",
    startVisit: "Iniciar visita",
    startingVisit: "Iniciando…",
    continueSurvey: "Continuar ficha",
    saveDraft: "Guardar borrador",
    draftSaved: "Borrador guardado en el dispositivo.",
    submitOnDevice: "Enviar en el dispositivo",
    submittedOnDevice:
      "Enviada en el dispositivo. Queda pendiente de sincronización hasta que haya señal.",
    readOnlyNotice:
      "Esta ficha ya fue enviada en el dispositivo. No se edita aquí: una corrección es una decisión de la coordinación, no un cambio silencioso en el teléfono.",
    validationFailed: "Faltan respuestas o hay valores no válidos: {details}",
    syncCentre: "Centro de sincronización",
    pendingCommands: "Órdenes pendientes",
    nothingPending: "Nada pendiente. Todo lo capturado está en el servidor.",
    queued: "En cola",
    attempts: "{count} intento(s)",
    needsReview: "Requieren revisión",
    needsReviewBody:
      "Tu trabajo local se conservó completo. La coordinación del proyecto debe resolver estos casos.",
    lastSync: "Última sincronización: {when}",
    neverSynced: "Todavía no se ha sincronizado desde este dispositivo.",
    pendingCount: "{count} por sincronizar",
    allSynced: "Todo sincronizado",
    noPending: "Sin pendientes",
    settings: "Ajustes",
    diagnostics: "Diagnóstico",
    appVersion: "Versión de la aplicación: {version}",
    environment: "Entorno: {environment}",
    localSchema: "Esquema local: v{version}",
    pendingToSync: "Pendientes de sincronizar: {count}",
    downloadedWork: "Trabajo descargado",
    diagnosticsPrivacy:
      "Este diagnóstico no incluye respuestas, identificadores de personas ni credenciales.",
    signOutBlocked:
      "Hay {count} elemento(s) sin sincronizar. Sincroniza antes de cerrar sesión: al cerrarla se borra el trabajo guardado en este dispositivo.",
    signOutHint: "Borra la sesión y los datos guardados en este dispositivo.",
    offlineExpired:
      "El trabajo descargado venció. Conéctate para renovarlo; lo que ya capturaste sigue guardado y se sincronizará.",
    offlineExpiring: "El trabajo descargado vence pronto. Conéctate antes de salir a campo.",
    assignmentRevoked:
      "Esta asignación ya no aparece en tu trabajo del servidor. Lo que capturaste aquí se conservó y la coordinación debe revisarlo.",
    surveyUnavailable: "Ficha no disponible",
    surveyUnavailableBody: "Inicia la visita desde el predio para abrir la ficha.",
    parcelUnavailable: "Predio no disponible",
    storageFailedTitle: "No se pudo abrir el almacenamiento local",
    storageFailedBody:
      "EIA Field guarda el trabajo de campo cifrado en el dispositivo. Si no puede cifrarlo, no lo guarda: pide una compilación de desarrollo (no Expo Go) o reinstala la aplicación.",
    noContext: "Sin contexto adicional",
    questions: "{count} preguntas",
    photo: "Fotografía",
    addPhoto: "Añadir fotografía",
    photoPending: "Fotografía pendiente de subida",
    photoUploaded: "Fotografía sincronizada",
    mediaPendingWarning:
      "La ficha se envió, pero falta subir {count} fotografía(s). No está completa en el servidor hasta que suban.",
    localSurveyState: {
      NOT_STARTED: "Sin empezar",
      DRAFT: "Borrador en el dispositivo",
      READY_TO_SYNC: "Enviada en el dispositivo · pendiente de sincronización",
      SYNCING: "Sincronizando",
      SYNCED: "Sincronizada",
      SYNC_ERROR: "Error de sincronización",
      CONFLICT: "Requiere revisión",
    },
    conflictReason: {
      assignment_reassigned: "La asignación ya no es tuya. Tu trabajo local se conservó.",
      assignment_cancelled: "La asignación fue cancelada. Tu trabajo local se conservó.",
      survey_version_changed: "El cuestionario cambió en el servidor después de tu descarga.",
      campaign_closed: "La campaña fue cerrada.",
      submitted_server_side: "Esta ficha ya estaba enviada en el servidor.",
    },
    /*
     * Keys carry no dots: lookup is by dotted path, so a segment containing one would be
     * unreachable. The command type is mapped to these names at the call site.
     */
    commandType: {
      visitStart: "Inicio de visita",
      surveyUpsertDraft: "Borrador de ficha",
      surveySubmit: "Envío de ficha",
      visitFinish: "Cierre de visita",
      mediaDeclare: "Fotografía de campo",
    },
  },
} as const;

/**
 * The shape every catalogue must have, with the Spanish strings widened to `string`.
 *
 * `as const` above is what makes the keys exact; without the widening a translator would have to
 * repeat the Spanish text verbatim to satisfy the type, which is the opposite of the point. The
 * structure is required, the words are not.
 */
type Widen<T> = { readonly [K in keyof T]: T[K] extends string ? string : Widen<T[K]> };

export type Messages = Widen<typeof messages>;
