/**
 * chat-router-data.js — datos del router de intención (port de chat_router v2 en Deluge).
 *
 * Script clásico UMD (sin ES modules): expone window.ChatRouterData en el browser y
 * module.exports en Node (los tests usan require). NO contiene lógica: solo tablas.
 *
 * GENERADO por tools/emit-chat-router-data.js desde deluge/core/chat_router.deluge.
 * No editar a mano: para cambiar las tablas, edita el Deluge y regenera.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.ChatRouterData = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // Umbrales del router (port de chat_router.router_config()).
  var CONFIG = {
    "llmEnabled": true,
    "high": 5,
    "margin": 3,
    "fallbackMin": 3,
    "smalltalkMax": 3,
    "followupMax": 3,
    "shortlistSize": 3,
    "shortlistWindow": 4,
    "logRoutes": false
  };

  // Textos de smalltalk (port de chat_router.smalltalk_texts()).
  var SMALLTALK = {
    "payment": "Nuestra agencia acepta transferencia bancaria, efectivo y tarjeta de crédito/débito.",
    "greet": "¡Hola! Soy el asistente virtual de la agencia de paquetería, remesas y recargas. ¿En qué puedo ayudarte? Puedo ayudarte con rastreo de paquetes, servicios, cobertura, oficinas, contactos y reportes.",
    "thanks": "¡Con gusto! Si necesitas algo más sobre paquetes, remesas o recargas, aquí estoy.",
    "bye": "¡Hasta pronto! Aquí estaré cuando necesites algo de paquetería, remesas o recargas.",
    "outOfScope": "Lo siento, solo puedo ayudarte con temas de paquetería, remesas y recargas. ¿En qué puedo asistirte?",
    "generic": "No pude interpretar tu solicitud. ¿Puedes reformularla? Puedo ayudarte con temas de paquetería, remesas, recargas, cobertura, oficinas o contactos.",
    "topNoType": "¿De qué servicio quieres el reporte de clientes más frecuentes? Puedo hacerlo para paquetería, remesas, Locker, Store, Recharge, Online Store u Other Services.",
    "noTracking": "Necesito el número de seguimiento para rastrear tu paquete. ¿Puedes proporcionármelo?",
    "noTopType": "Necesito saber el tipo de servicio para generar el reporte (Locker, Store, Recharge, Online Store u Other Services). ¿Cuál quieres consultar?"
  };

  // Tabla de keywords por tool (port de chat_router.keyword_table()).
  // Convención de cada entrada: "palabra" | "frase" | "raiz*" | "!kw=peso" (resta).
  var KEYWORDS = {
    "track_package": [
      "rastre*=5",
      "tracking=5",
      "seguimiento=4",
      "estatus=2",
      "estado de mi paquete=6",
      "donde esta mi paquete=7",
      "donde esta mi caja=7",
      "localiz*=3",
      "guia=2"
    ],
    "find_offices": [
      "oficina*=5",
      "sucursal*=5",
      "horario*=2",
      "direccion*=2",
      "donde queda*=3",
      "ubicacion*=2"
    ],
    "check_coverage": [
      "cobertura=6",
      "cubren=5",
      "cubrir=4",
      "llegan=3",
      "entregan=3",
      "proveedor*=4",
      "vendor*=4",
      "zona*=2",
      "servicio en=4"
    ],
    "find_contacts": [
      "contacto*=6",
      "telefono=2",
      "celular=2",
      "documento=2",
      "remitente*=3",
      "destinatario*=3",
      "receptor*=3"
    ],
    "search_services": [
      "servicios=3",
      "servicio=1",
      "precio*=3",
      "tarifa*=3",
      "cuanto cuesta=5",
      "cuanto cobran=5",
      "costo*=3"
    ],
    "list_service_types": [
      "tipos de servicio=7",
      "tipo de servicio=7",
      "servicios ofrecen=6",
      "servicios ofrece=6",
      "servicios tienen=5",
      "servicios disponibles=6",
      "servicios hay=6",
      "que ofrecen=5",
      "que servicios=3"
    ],
    "report_pounds_shipped": [
      "libras=5",
      "lbs=5",
      "pounds=5",
      "peso=3"
    ],
    "report_daily_average": [
      "promedio diario=9",
      "promedio por dia=9",
      "promedio=3",
      "diario=4",
      "por dia=3"
    ],
    "report_monthly_comparison": [
      "comparacion mensual=9",
      "comparar mes*=7",
      "comparativo*=5",
      "mes a mes=9",
      "promedio mensual=9",
      "mensual*=4",
      "variacion*=4",
      "promedio=3"
    ],
    "report_shipping_type_frequency": [
      "aere*=5",
      "maritim*=5",
      "tipo de envio=7",
      "tipos de envio=7",
      "frecuencia de envio*=6",
      "air=3",
      "sea=3",
      "avion=3",
      "barco=3"
    ],
    "report_merchandise_type": [
      "mercancia*=7",
      "contenido*=3",
      "durables=4",
      "documentos=2",
      "medicina*=3",
      "alimento*=3",
      "courier=3"
    ],
    "report_delayed_packages": [
      "demora*=8",
      "atrasad*=8",
      "atraso*=6",
      "retras*=8",
      "tardan=4"
    ],
    "report_unscanned_packages": [
      "sin escan*=9",
      "no escan*=9",
      "escanead*=3",
      "escanear=3",
      "escaneo*=3",
      "pendientes de escan*=9"
    ]
  };

  // Tipos de servicio canónicos (port de chat_router.service_type_table()).
  var SERVICE_TYPES = [
    "tienda online=Online Store",
    "tiendas online=Online Store",
    "online store=Online Store",
    "otros servicios=Other Services",
    "other services=Other Services",
    "paqueter*=Package Receipt",
    "package*=Package Receipt",
    "remesa*=Remittance",
    "remittance*=Remittance",
    "recarga*=Recharge",
    "recharge*=Recharge",
    "locker*=Locker",
    "tienda*=Store",
    "store*=Store"
  ];

  // Periodos soportados (port de chat_router.period_table()).
  var PERIODS = [
    "mes pasado=mes_anterior",
    "mes anterior=mes_anterior",
    "pasado mes=mes_anterior",
    "este mes=este_mes",
    "mes actual=este_mes",
    "mes en curso=este_mes",
    "ultimos 7 dias=ultimos_7_dias",
    "ultima semana=ultimos_7_dias",
    "esta semana=ultimos_7_dias",
    "semana pasada=ultimos_7_dias",
    "7 dias=ultimos_7_dias",
    "ultimo mes=ultimo_mes",
    "ultimos 30 dias=ultimo_mes",
    "30 dias=ultimo_mes"
  ];

  // Alias de país (port de chat_router.place_alias_table()).
  var PLACE_ALIASES = [
    "usa=United States",
    "eeuu=United States",
    "ee uu=United States",
    "estados unidos=United States",
    "united states=United States",
    "espana=Spain"
  ];

  // Catálogo de lugares — objeto MUTABLE que el widget rellena en runtime con
  // los registros de Creator (Commercial_Office / Coverage_Location). Si queda
  // vacío, el router degrada igual que con gazetteer vacío.
  var PLACES = { offices: [], cities: [], countries: [] };

  // Descripciones de una línea por tool (port de chat_router.tool_blurbs()).
  var TOOL_BLURBS = {
    "track_package": "estado de un paquete por numero de seguimiento",
    "search_services": "buscar servicios por tipo o destino (precios, tarifas)",
    "list_service_types": "que tipos de servicio ofrece la agencia (catalogo general)",
    "find_offices": "oficinas por ciudad o pais",
    "check_coverage": "cobertura por pais y proveedores",
    "find_contacts": "buscar un contacto por nombre, telefono o documento",
    "report_top_customers": "clientes mas frecuentes de Locker, Store, Recarga, Online, Otros",
    "report_top_package_customers": "clientes mas frecuentes de paqueteria",
    "report_top_remittance_customers": "clientes que mas remesas envian",
    "report_pounds_shipped": "libras o paquetes enviados en un periodo",
    "report_daily_average": "promedio diario de libras enviadas",
    "report_monthly_comparison": "comparacion mensual de libras entre meses",
    "report_shipping_type_frequency": "paquetes por via aerea vs maritima",
    "report_merchandise_type": "distribucion de paquetes por tipo de mercancia",
    "report_delayed_packages": "cajas demoradas o atrasadas",
    "report_unscanned_packages": "cajas sin escanear"
  };

  // Ejemplos por tool para el prompt de elección (port de chat_router.tool_examples()).
  var TOOL_EXAMPLES = {
    "track_package": [
      "rastrea mi paquete ABC123456",
      "donde esta mi caja"
    ],
    "search_services": [
      "servicios de paqueteria a Madrid",
      "cuanto cuesta enviar un paquete"
    ],
    "list_service_types": [
      "que servicios ofrecen",
      "tipos de servicio"
    ],
    "find_offices": [
      "oficinas en Miami",
      "direccion de la sucursal"
    ],
    "check_coverage": [
      "cobertura en Colombia",
      "tienen servicio en Argentina"
    ],
    "find_contacts": [
      "busca el contacto Juan Perez",
      "contacto con telefono 5551234"
    ],
    "report_top_customers": [
      "top 5 clientes de Locker",
      "clientes frecuentes de recargas"
    ],
    "report_top_package_customers": [
      "top clientes de paqueteria",
      "clientes que mas envian libras"
    ],
    "report_top_remittance_customers": [
      "clientes que mas remesas envian",
      "top remesas del mes"
    ],
    "report_pounds_shipped": [
      "libras enviadas el mes pasado",
      "cuantos paquetes por oficina"
    ],
    "report_daily_average": [
      "promedio diario de libras",
      "promedio por dia"
    ],
    "report_monthly_comparison": [
      "comparacion mensual de libras",
      "mes a mes"
    ],
    "report_shipping_type_frequency": [
      "paquetes aereos vs maritimos",
      "tipo de envio"
    ],
    "report_merchandise_type": [
      "tipo de mercancia",
      "que mercancia envian mas"
    ],
    "report_delayed_packages": [
      "cajas demoradas",
      "paquetes atrasados"
    ],
    "report_unscanned_packages": [
      "cajas sin escanear",
      "paquetes no escaneados"
    ]
  };

  return {
    CONFIG: CONFIG,
    SMALLTALK: SMALLTALK,
    KEYWORDS: KEYWORDS,
    SERVICE_TYPES: SERVICE_TYPES,
    PERIODS: PERIODS,
    PLACE_ALIASES: PLACE_ALIASES,
    PLACES: PLACES,
    TOOL_BLURBS: TOOL_BLURBS,
    TOOL_EXAMPLES: TOOL_EXAMPLES,
  };
});
