/**
 * config.js — configuración, constantes y estado global.
 *
 * Script clásico (sin módulos ES): comparte el ámbito global con los demás
 * archivos de js/ y depende del ORDEN de carga definido en widget.html.
 */

// ================================================================
// 3. JS — lógica del widget
// ================================================================

// ==== 3.1  Config, constantes y estado ====
// Configuración del backend (Zoho Creator / Client API)
// appName ya apunta al link name real de esta app (copy-1-of-logistic-management-ii);
// si la app de destino difiere, reemplázalo por el suyo. Mantener los nombres de
// módulo en sincronía con deluge/config/chat_config.deluge
// IMPORTANTE: 
// - reportNames: para getAllRecords y deleteRecord (reportName/criteria) → report link names
// - formNames: para addRecord (formName param) → form link names
// Ambos tal como aparecen en el dump de la app.
const CONFIG = {
  appName: "copy-1-of-logistic-management-ii",
  // Report link names (para getAllRecords)
  chatSessionsReport: "ChatSessions_Report",
  chatMessagesReport: "ChatMessages_Report",
  chatRequestsReport: "ChatRequests_Report",
  // Form link names (para addRecord; deleteRecord usa reportName+criteria)
  chatSessionsForm: "ChatSessions",
  chatMessagesForm: "ChatMessages",
  chatRequestsForm: "ChatRequests",
  // Field link names del formulario ChatRequests en el live (pueden diferir del dump al copiar app)
  chatRequestsFields: {
    sessionId: "Session_ID",
    prompt: "Prompt",
    // Route_Hint: JSON con la decisión del router (tool/params/via) que el widget
    // resuelve en JS. Campo Long Text en ChatRequests. El backend lo consume para
    // saltarse la llamada de intención cuando viene una tool determinista.
    routeHint: "Route_Hint",
  },
  // Report link names del catálogo de lugares que alimenta ChatRouterData.PLACES
  // (fetchPlaces). AJUSTAR a los link names reales del live si difieren: el
  // backend lee los mismos módulos nativamente (Commercial_Office / Coverage_Location).
  officesReport: "Commercial_Office_Report",
  coverageReport: "Coverage_Location_Report",
  pollIntervalMs: 1500,
  pollTimeoutMs: 45000,
  forceLocal: false,
  // Plantillas de exportación por tool (layout XLSX + resolución de nombre).
  // titlePrefix: prefijo exacto de viz.title para resolver el nombre de la tool.
  // columns para tools de visualización son POSICIONALES (width/format/style);
  // los headers siempre salen del shape {labels, series}. Para track_package,
  // columns[].key mapea las claves del objeto parseado → fila única.
  EXPORT_TEMPLATES: {
    report_top_customers: {
      titlePrefix: "Clientes más frecuentes",
      filename: "export-{toolName}-{date}",
      sheetName: "Top Clientes",
      columns: [
        { key: "label", header: "Cliente", width: 24, format: "@", style: {} },
        { key: "s0", header: "Servicios", width: 12, format: "0", style: {} },
      ],
      freezePane: { ySplit: 1 },
      autoFilter: true,
      headerStyle: { bold: true, bg: "FFF3E6", color: "333333" },
    },
    track_package: {
      titlePrefix: "Paquete",
      filename: "export-{toolName}-{date}",
      sheetName: "Paquete",
      columns: [
        { key: "trackingNumber", header: "Tracking No.", width: 20 },
        { key: "status", header: "Estado", width: 14 },
        { key: "lastUpdate", header: "Última actualización", width: 24 },
        { key: "origin", header: "Origen", width: 26 },
        { key: "destination", header: "Destino", width: 26 },
      ],
      freezePane: null,
      autoFilter: false,
      headerStyle: { bold: true, bg: "FFF3E6", color: "333333" },
    },
  },
  // CDN de SheetJS (lazy: se inyecta solo al pedir XLSX por primera vez)
  SHEETJS_CDN: "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js",
  // Sugerencias UI — FUENTE ÚNICA de verdad (el backend NO las tiene).
  // El Widget SDK v1 NO expone ZOHO.CREATOR.API.invoke, así que llamar a
  // chat_config desde aquí es imposible; por eso la lista vive en el widget.
  // Cada ítem: { label, prompt, payload, order, enabled }.
  // prompt = frase natural que Zia enruta a la tool indicada en payload.
  suggestions: [
    {
      label: "Top clientes (paquetes)",
      prompt: "¿Cuáles son los clientes más frecuentes?",
      payload: { tool: "report_top_customers", params: {} },
      order: 1,
      enabled: true,
    },
    {
      label: "Top clientes (libras)",
      prompt: "¿Cuáles son los clientes que más libras han enviado?",
      payload: { tool: "report_top_package_customers", params: { measure: "pounds" } },
      order: 2,
      enabled: true,
    },
    {
      label: "Paquetes demorados",
      prompt: "Lista las cajas demoradas",
      payload: { tool: "report_delayed_packages", params: {} },
      order: 3,
      enabled: true,
    },
  ],
};

// Plantilla genérica de respaldo para tools sin entrada en EXPORT_TEMPLATES.
// Los headers/valores siempre salen del shape; sin columns no se aplican anchos.
const GENERIC_EXPORT_TEMPLATE = {
  filename: "export-{toolName}-{date}",
  sheetName: "Datos",
  freezePane: { ySplit: 1 },
  autoFilter: true,
  headerStyle: { bold: true, bg: "FFF3E6", color: "333333" },
};

const MAX_CONVERSATIONS = 50;
const STORAGE_KEY = "lm2chatbot:conversations";
const COLLAPSED_KEY = "lm2chatbot:sidebarCollapsed";

// Estados del ciclo de vida de ChatRequests. Los escribe el backend Deluge
// (chat_invoke / on_submit_chatrequests): mantener en sincronía.
const REQUEST_STATUS = Object.freeze({
  PENDING: "pending",
  PROCESSING: "processing",
  ANSWERED: "answered",
  FAILED: "failed",
});

const state = {
  currentConv: null, // conversación activa: { id, title, createdAt, updatedAt, messages }
  isLoading: false,
  // Última intención determinista resuelta por el router (solo rule/followup).
  // Alimenta los follow-ups ("¿y a Barcelona?" reusa la tool anterior).
  lastIntent: null, // { tool, params }
  // Catálogo de lugares para el router ({offices, cities, countries}), poblado
  // en init() por fetchPlaces() en modo server. null = aún no cargado.
  places: null,
  // Siempre derivado de currentConv: ya no hay un alias que pueda divergir.
  get messages() {
    return this.currentConv ? this.currentConv.messages : [];
  },
};
