/**
 * chat-router.js — router de intención v2 (port puro a JS del chat_router Deluge).
 *
 * Mueve la CAPA DE REGLAS al widget: lógica pura, sin DOM, sin ZOHO, sin fetch,
 * sin localStorage y sin async. El Deluge se queda con validación/saneo/Zia.
 *
 * Script clásico UMD (sin ES modules): expone window.ChatRouter en el browser y
 * module.exports en Node (los tests usan require). En Node toma los datos con
 * require("./chat-router-data.js"); en browser los lee de window.ChatRouterData.
 *
 * Port fiel de las funciones de `deluge/core/chat_router.deluge` (rama
 * feature/router-v2). Diferencias deliberadas (ver README/reporte):
 *   - load_gazetteer() NO existe aquí: los lugares llegan como argumento `places`
 *     (el widget los carga por Client API). Sin lugares, degrada igual que un
 *     gazetteer vacío.
 *   - finalize_params() NO resuelve period→startDate/endDate (eso es chat_common
 *     en Deluge): conserva `period` y marca `needsResolve: true` para el servidor.
 *     apply_report_scan_mode() también es server-side y se omite.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./chat-router-data.js"));
  } else {
    root.ChatRouter = factory(root.ChatRouterData);
  }
})(typeof self !== "undefined" ? self : this, function (ChatRouterData) {
  "use strict";

  var DEFAULT_PLACES = { offices: [], cities: [], countries: [] };

  // ==========================================================================
  // Texto
  // ==========================================================================
  // Port de normalize_text: minúsculas, sin acentos, solo [a-z0-9] y espacios,
  // con UN espacio de borde (permite buscar palabras completas con " palabra ").
  // Nota: la ñ se pliega a n (igual que el Deluge) para que "España" normalice
  // a "espana" y case con la alias table (place_alias_table).
  function normalizeText(s) {
    if (s === null || s === undefined) return "  ";
    var t = String(s).toLowerCase();
    t = t.split("á").join("a")
         .split("é").join("e")
         .split("í").join("i")
         .split("ó").join("o")
         .split("ú").join("u")
         .split("ü").join("u")
         .split("ñ").join("n");
    t = t.replace(/[^a-z0-9]/g, " ");
    t = t.replace(/ +/g, " ");
    t = t.trim();
    return " " + t + " ";
  }

  // Port de has_kw: "raiz*" → empieza por raiz ; cualquier otra cosa → palabra/frase completa.
  function hasKw(padded, kw) {
    var needle;
    if (kw.slice(-1) === "*") {
      needle = " " + kw.slice(0, kw.length - 1);
    } else {
      needle = " " + kw + " ";
    }
    return padded.indexOf(needle) !== -1 ? 1 : 0;
  }

  function hasAny(padded, kws) {
    for (var i = 0; i < kws.length; i++) {
      if (hasKw(padded, kws[i]) === 1) return 1;
    }
    return 0;
  }

  // Port de match_place: candidato cuyo texto normalizado aparece como
  // palabra/frase completa. Gana el más largo ("new york" > "york").
  function matchPlace(padded, cands) {
    var best = "";
    var bestLen = 0;
    if (!cands) return "";
    for (var i = 0; i < cands.length; i++) {
      var c = cands[i];
      if (c === null || c === undefined) continue;
      var n = normalizeText(String(c));
      var core = n.trim();
      if (core.length < 3) continue;
      if (padded.indexOf(n) !== -1 && n.length > bestLen) {
        best = String(c);
        bestLen = n.length;
      }
    }
    return best;
  }

  // ==========================================================================
  // Extractores deterministas
  // ==========================================================================
  // Port de extract_tracking: token tipo ABC123456 / P-123456 / 99887766
  // (≥6 chars, ≥4 dígitos seguidos) en el texto ORIGINAL.
  function extractTracking(original) {
    if (original === null || original === undefined) return "";
    var parts = String(original).replace(/ +/g, " ").split(" ");
    for (var i = 0; i < parts.length; i++) {
      var raw = parts[i];
      var tk = raw.replace(/^[^A-Za-z0-9]+/, "").replace(/[^A-Za-z0-9]+$/, "");
      if (tk.length >= 6 && /^[A-Za-z]{0,4}-?[0-9]{4,}[A-Za-z0-9-]*$/.test(tk)) {
        return tk;
      }
    }
    return "";
  }

  function escapeRegExp(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  // Port de extract_entities. `places` sustituye al gazetteer de Creator.
  function extractEntities(original, padded, places) {
    var gaz = places || DEFAULT_PLACES;
    var offices = gaz.offices || [];
    var cities = gaz.cities || [];
    var countries = gaz.countries || [];
    var e = {};

    // --- tracking vs teléfono: un número solo es teléfono si hay contexto de teléfono/contacto ---
    var phone = "";
    var phoneCtx = hasAny(padded, ["tel", "telefono", "celular", "movil", "phone", "whatsapp", "contacto*"]);
    var digits = String(original == null ? "" : original).replace(/[^0-9]/g, "");
    if (phoneCtx === 1 && digits.length >= 7) {
      phone = digits.slice(0, 10);
    }
    e.phone = phone;
    e.tracking = extractTracking(original);

    // --- tipos de servicio (valores canónicos); se "consume" lo ya reconocido para que
    //     "online store" no produzca además "Store" ---
    var types = [];
    var work = padded;
    for (var i = 0; i < ChatRouterData.SERVICE_TYPES.length; i++) {
      var entry = ChatRouterData.SERVICE_TYPES[i];
      var parts = entry.split("=");
      var kw = parts[0];
      var val = parts[1];
      if (hasKw(work, kw) === 1) {
        if (types.indexOf(val) === -1) types.push(val);
        if (kw.slice(-1) === "*") {
          var stem = kw.slice(0, kw.length - 1);
          work = work.replace(new RegExp(" " + escapeRegExp(stem) + "[a-z0-9]*", "g"), " ");
        } else {
          work = work.split(" " + kw + " ").join(" ");
        }
      }
    }
    e.types = types;

    // --- periodo (enum). Meses concretos NO se mapean ---
    var period = "";
    var perTable = ChatRouterData.PERIODS;
    for (var j = 0; j < perTable.length; j++) {
      if (period === "") {
        var pp = perTable[j].split("=");
        if (hasKw(padded, pp[0]) === 1) period = pp[1];
      }
    }
    e.period = period;

    // --- límite ("top 5", "5 clientes", "primeros 10") y meses ("últimos 3 meses") ---
    var limit = "";
    var months = "";
    var toks = padded.trim().split(" ");
    var nTok = toks.length;
    for (var k = 0; k < toks.length; k++) {
      var tk = toks[k];
      var nxt = k + 1 < nTok ? toks[k + 1] : "";
      if ((tk === "top" || tk === "primeros" || tk === "primeras") && /^[0-9]+$/.test(nxt)) {
        limit = nxt;
      }
      if (limit === "" && /^[0-9]+$/.test(tk) &&
          (nxt === "clientes" || nxt === "principales" || nxt === "mejores" || nxt === "frecuentes")) {
        limit = tk;
      }
      if (months === "" && /^[0-9]+$/.test(tk) && (nxt === "meses" || nxt === "mes")) {
        months = tk;
      }
    }
    e.limit = limit;
    e.months = months;

    // --- lugares contra tus registros ---
    var office = matchPlace(padded, offices);
    var place = matchPlace(padded, cities);
    var country = matchPlace(padded, countries);
    if (country === "") {
      for (var a = 0; a < ChatRouterData.PLACE_ALIASES.length; a++) {
        var ali = ChatRouterData.PLACE_ALIASES[a].split("=");
        if (country === "" && hasKw(padded, ali[0]) === 1) country = ali[1];
      }
    }
    // Convención de desambiguación (ver README): un mismo texto puede ser nombre de
    // oficina Y ciudad (p. ej. "Miami"). Con el término "oficina/sucursal/office" se
    // interpreta como OFICINA; sin ese término → CIUDAD (destino).
    if (office !== "" && place !== "" && normalizeText(office) === normalizeText(place)) {
      if (hasAny(padded, ["oficina*", "sucursal*", "office*"]) === 1) {
        place = "";
      } else {
        office = "";
      }
    }
    e.office = office;
    e.place = place;
    e.country = country;
    return e;
  }

  // ==========================================================================
  // Scoring
  // ==========================================================================
  // Port de score_tools (usa ChatRouterData.KEYWORDS por defecto).
  function scoreTools(padded, ents, keywords) {
    var table = keywords || ChatRouterData.KEYWORDS;
    var scores = new Map();
    var tools = Object.keys(table);
    for (var i = 0; i < tools.length; i++) {
      var tool = tools[i];
      var list = table[tool];
      var s = 0;
      for (var j = 0; j < list.length; j++) {
        var entry = list[j];
        var neg = 0;
        var body = entry;
        if (entry.charAt(0) === "!") {
          neg = 1;
          body = entry.slice(1);
        }
        var parts = body.split("=");
        var w = parseInt(parts[1], 10);
        if (hasKw(padded, parts[0]) === 1) {
          s = neg === 1 ? s - w : s + w;
        }
      }
      scores.set(tool, s);
    }

    var types = ents.types;
    var hasPlace = ents.place !== "" || ents.country !== "";

    // --- top clientes: 3 tools hermanas; las separa el TIPO de servicio mencionado ---
    scores.set("report_top_customers", 0);
    scores.set("report_top_package_customers", 0);
    scores.set("report_top_remittance_customers", 0);
    var hasClient = hasKw(padded, "cliente*");
    var hasTop = hasAny(padded, ["top", "mas frecuente*", "frecuente*", "principales", "mejores", "mas envian", "mas compran"]);
    if (hasClient === 1 && hasTop === 1) {
      var pkg = hasAny(padded, ["paqueter*", "package*", "libras", "pounds", "peso"]);
      var rem = types.indexOf("Remittance") !== -1 ? 1 : 0;
      var gen = (types.indexOf("Locker") !== -1 || types.indexOf("Store") !== -1 ||
                 types.indexOf("Recharge") !== -1 || types.indexOf("Online Store") !== -1 ||
                 types.indexOf("Other Services") !== -1) ? 1 : 0;
      scores.set("report_top_package_customers", 6 + 4 * pkg);
      scores.set("report_top_remittance_customers", 6 + 4 * rem);
      scores.set("report_top_customers", 6 + 4 * gen);
    }

    // --- "tienen servicio en <país>" (singular) es cobertura ---
    if (ents.country !== "" && hasKw(padded, "servicio en") === 1) {
      scores.set("check_coverage", scores.get("check_coverage") + 2);
    }

    // --- catálogo general vs búsqueda filtrada: con tipo o lugar, nunca es el catálogo ---
    if (types.length > 0 || hasPlace === true) {
      var lst = scores.get("list_service_types") - 8;
      if (lst < 0) lst = 0;
      scores.set("list_service_types", lst);
      if (hasKw(padded, "servicios") === 1) {
        scores.set("search_services", scores.get("search_services") + 3);
      }
    }

    // --- "cuántos paquetes por oficina" es un reporte, no find_offices ---
    var reportish = hasAny(padded, ["cuantos", "cuantas", "reporte", "estadistica*", "resumen", "total*", "promedio", "libras", "pounds", "lbs", "peso"]);
    var pkgword = hasAny(padded, ["paquete*", "enviaron", "envio*", "cajas", "libras", "peso"]);
    var locword = hasAny(padded, ["oficina*", "sucursal*", "office*", "ciudad", "city"]);
    var perword = ents.period !== "" ? 1 : 0;
    if (reportish === 1) {
      var fo = scores.get("find_offices") - 5;
      if (fo < 0) fo = 0;
      scores.set("find_offices", fo);
    }
    var skip = hasAny(padded, ["aere*", "maritim*", "demora*", "atrasad*", "retras*", "escan*", "sin escan*", "no escan*", "cliente*"]);
    if (pkgword === 1 && locword === 1 && (perword === 1 || reportish === 1) && skip === 0) {
      scores.set("report_pounds_shipped", scores.get("report_pounds_shipped") + 6);
    }
    return scores;
  }

  // Port de rank_tools: orden desc por score (selección repetida). Empates: orden de inserción.
  function rankTools(scores) {
    var ranked = [];
    var used = {};
    var keys = [];
    scores.forEach(function (_v, k) { keys.push(k); });
    for (var step = 0; step < keys.length; step++) {
      var bestTool = "";
      var bestScore = -1;
      scores.forEach(function (sc, k) {
        if (!used[k] && sc > bestScore) {
          bestScore = sc;
          bestTool = k;
        }
      });
      if (bestTool !== "") {
        used[bestTool] = true;
        ranked.push({ tool: bestTool, score: bestScore });
      }
    }
    return ranked;
  }

  // Port de detect_smalltalk.
  function detectSmalltalk(padded) {
    if (hasAny(padded, ["bitcoin", "transferencia", "efectivo", "tarjeta", "pagar", "pago", "pagos", "metodos de pago"]) === 1) {
      return "payment";
    }
    if (hasAny(padded, ["gracias", "muchas gracias"]) === 1) {
      return "thanks";
    }
    if (hasAny(padded, ["adios", "chao", "hasta luego"]) === 1) {
      return "bye";
    }
    if (hasAny(padded, ["hola", "buenos dias", "buenas tardes", "buenas noches", "saludos", "que hacen", "quienes son"]) === 1) {
      return "greet";
    }
    return "";
  }

  // Port de previous_user_message: salta el mensaje actual y devuelve el anterior "user".
  function previousUserMessage(history, current) {
    if (!history) return "";
    var skippedCurrent = false;
    for (var i = 0; i < history.length; i++) {
      var m = history[i];
      if (m && m.role === "user") {
        var c = m.content;
        if (c !== null && c !== undefined) {
          if (skippedCurrent === false && String(c) === current) {
            skippedCurrent = true;
          } else {
            return String(c);
          }
        }
      }
    }
    return "";
  }

  // ==========================================================================
  // Decisión por reglas (sin LLM)
  // ==========================================================================
  // Port de rules_core.
  function rulesCore(original, places) {
    var cfg = ChatRouterData.CONFIG;
    var padded = normalizeText(original);
    var ents = extractEntities(original, padded, places);
    var scores = scoreTools(padded, ents);
    var ranked = rankTools(scores);
    var t1 = ranked[0].score;
    var t2 = ranked[1] ? ranked[1].score : 0;
    var n1 = ranked[0].tool;
    var out = { padded: padded, ents: ents, ranked: ranked };

    // 1) smalltalk (solo si ninguna tool tiene señal)
    if (t1 < cfg.smalltalkMax) {
      var st = detectSmalltalk(padded);
      if (st !== "") {
        out.decision = "smalltalk";
        out.smalltalk = st;
        out.via = "rule:smalltalk";
        return out;
      }
    }
    // 2) número de seguimiento / teléfono
    if (ents.tracking !== "" && ents.phone === "") {
      out.decision = "tool";
      out.tool = "track_package";
      out.via = "rule:tracking";
      return out;
    }
    if (ents.phone !== "") {
      out.decision = "tool";
      out.tool = "find_contacts";
      out.via = "rule:phone";
      return out;
    }
    // 3) "top clientes" sin tipo de servicio → pedir el tipo (sin LLM)
    if (t1 >= 6 &&
        (n1 === "report_top_customers" || n1 === "report_top_package_customers" || n1 === "report_top_remittance_customers") &&
        ents.types.length === 0) {
      out.decision = "clarify_top";
      out.via = "rule:top_no_type";
      return out;
    }
    // 4) ganador claro: score alto Y margen sobre la segunda
    if (t1 >= cfg.high && (t1 - t2) >= cfg.margin) {
      out.decision = "tool";
      out.tool = n1;
      out.via = "rule:score";
      return out;
    }
    // 5) hay señal pero dudosa → LLM con candidatas; sin señal → LLM con todas
    out.decision = t1 >= 1 ? "llm_shortlist" : "llm_all";
    return out;
  }

  // Condición de follow-up compartida (port del tramo final de decide_rules).
  function followupSignal(core, cfg) {
    var t1 = core.ranked[0].score;
    if (t1 >= cfg.followupMax) return false;
    var padded = core.padded;
    var ents = core.ents;
    var startsFollow = 0;
    if (padded.indexOf(" y ") === 0 || padded.indexOf(" tambien ") === 0 ||
        padded.indexOf(" ahora ") === 0 || padded.indexOf(" entonces ") === 0) {
      startsFollow = 1;
    }
    var entAny = 0;
    if (ents.types.length > 0 || ents.period !== "" || ents.place !== "" ||
        ents.office !== "" || ents.country !== "" || ents.limit !== "") {
      entAny = 1;
    }
    var nWords = padded.trim().split(" ").length;
    return startsFollow === 1 || (nWords <= 5 && entAny === 1);
  }

  // Port de decide_rules.
  function decideRules(original, history, places) {
    var cfg = ChatRouterData.CONFIG;
    var core = rulesCore(original, places);
    var d = core.decision;
    if (d !== "llm_shortlist" && d !== "llm_all") return core;
    if (core.ranked[0].score >= cfg.followupMax) return core;
    var prevMsg = previousUserMessage(history, original);
    if (prevMsg === "") return core;
    if (followupSignal(core, cfg)) {
      var prevCore = rulesCore(prevMsg, places);
      if (prevCore.decision === "tool") {
        core.decision = "tool";
        core.tool = prevCore.tool;
        core.via = "followup";
        core.prevMessage = prevMsg;
      }
    }
    return core;
  }

  // ==========================================================================
  // Params 100% deterministas (el LLM ya NO extrae params)
  // ==========================================================================
  // Port de extract_contact_name.
  function extractContactName(original) {
    if (original === null || original === undefined) return "";
    var parts = String(original).replace(/ +/g, " ").split(" ");
    var fillers = ["de", "del", "el", "la", "llamado", "llamada", "que", "se", "a", "para", "con", "un", "una", "busca", "buscar"];
    var stops = ["telefono", "tel", "documento", "doc", "cedula", "pasaporte", "dni", "numero", "celular", "phone", "movil"];
    var started = false;
    var name = "";
    var count = 0;
    for (var i = 0; i < parts.length; i++) {
      var raw = parts[i];
      var tk = raw.replace(/^[^A-Za-z0-9À-ÿ]+/, "").replace(/[^A-Za-z0-9À-ÿ]+$/, "");
      var nt = normalizeText(tk).trim();
      if (started === false) {
        if (/^contacto.*/.test(nt)) started = true;
        continue;
      }
      if (tk === "") continue;
      if (stops.indexOf(nt) !== -1 || /.*[0-9].*/.test(nt)) return name;
      if (count === 0 && fillers.indexOf(nt) !== -1) continue;
      if (count < 4) {
        name = name === "" ? tk : name + " " + tk;
        count = count + 1;
      }
    }
    return name;
  }

  // Port de extract_document.
  function extractDocument(original) {
    if (original === null || original === undefined) return "";
    var parts = String(original).replace(/ +/g, " ").split(" ");
    var markers = ["documento", "doc", "cedula", "pasaporte", "dni"];
    var armed = false;
    for (var i = 0; i < parts.length; i++) {
      var raw = parts[i];
      var tk = raw.replace(/^[^A-Za-z0-9]+/, "").replace(/[^A-Za-z0-9]+$/, "");
      var nt = normalizeText(tk).trim();
      if (armed === true && tk.length >= 5 && /^[A-Za-z0-9-]+$/.test(tk)) return tk;
      armed = markers.indexOf(nt) !== -1;
    }
    return "";
  }

  // Port de build_params.
  function buildParams(tool, ents, padded, original) {
    var p = {};
    var types = ents.types;
    var firstType = types.length > 0 ? types[0] : "";
    var generalTypes = [];
    for (var i = 0; i < types.length; i++) {
      var ty = types[i];
      if (ty === "Locker" || ty === "Store" || ty === "Recharge" || ty === "Online Store" || ty === "Other Services") {
        generalTypes.push(ty);
      }
    }
    var period = ents.period;
    var office = ents.office;
    var place = ents.place;
    var country = ents.country;
    var limit = ents.limit;

    if (tool === "track_package") {
      if (ents.tracking !== "") p.trackingNumber = ents.tracking;
    }
    if (tool === "search_services") {
      if (firstType !== "") p.serviceType = firstType;
      if (place !== "") p.destination = place;
      else if (country !== "") p.destination = country;
    }
    if (tool === "find_offices") {
      if (place !== "") p.city = place;
      if (country !== "") p.country = country;
    }
    if (tool === "check_coverage") {
      if (country !== "") p.country = country;
      if (firstType !== "") p.serviceType = firstType;
    }
    if (tool === "find_contacts") {
      if (ents.phone !== "") p.phone = ents.phone;
      var nm = extractContactName(original);
      if (nm !== "") p.name = nm;
      var dc = extractDocument(original);
      if (dc !== "") p.document = dc;
    }
    if (tool === "report_top_customers") {
      if (generalTypes.length > 0) p.serviceType = generalTypes.slice();
    }
    if (tool === "report_top_package_customers") {
      if (hasAny(padded, ["libras", "pounds", "peso", "weight"]) === 1) p.measure = "pounds";
      if (generalTypes.length > 0) p.serviceType = generalTypes[0];
      else if (hasAny(padded, ["todos los tipos", "todo tipo", "todos los servicios"]) === 1) p.serviceType = "all";
    }
    // limit / office / city / period (tools de ranking)
    if (tool === "report_top_customers" || tool === "report_top_package_customers" || tool === "report_top_remittance_customers") {
      if (limit !== "") p.limit = limit;
      if (office !== "") p.office = office;
      if (place !== "") p.city = place;
      if (period !== "") p.period = period;
    }
    if (tool === "report_pounds_shipped" || tool === "report_daily_average") {
      if (period !== "") p.period = period;
      if (office !== "") p.office = office;
      if (country !== "") p.country = country;
    }
    if (tool === "report_monthly_comparison") {
      if (period !== "") p.period = period;
      if (ents.months !== "") p.months = ents.months;
      if (office !== "") p.office = office;
    }
    if (tool === "report_shipping_type_frequency" || tool === "report_merchandise_type" || tool === "report_unscanned_packages") {
      if (limit !== "") p.limit = limit;
      if (office !== "") p.office = office;
    }
    if (tool === "report_delayed_packages") {
      if (country !== "") p.destCountry = country;
    }
    return p;
  }

  // Port de validate_required: devuelve el texto de clarify o "" si todo ok.
  function validateRequired(tool, params) {
    var texts = ChatRouterData.SMALLTALK;
    if (tool === "track_package") {
      var tn = params.trackingNumber;
      if (tn === null || tn === undefined || String(tn) === "") return texts.noTracking;
    }
    if (tool === "report_top_customers") {
      var st = params.serviceType;
      var ok = false;
      if (st !== null && st !== undefined) {
        if (Object.prototype.toString.call(st) === "[object Array]" && st.length >= 1) ok = true;
      }
      if (ok === false) return texts.noTopType;
    }
    return "";
  }

  // Port de finalize_params SIN resolver period→fechas (eso vive en chat_common
  // del servidor). Conserva `period` y marca `needsResolve: true` para que el
  // backend resuelva startDate/endDate. apply_report_scan_mode también es
  // server-side y se omite aquí.
  function finalizeParams(tool, params, userPrompt) {
    var p = {};
    for (var k in params) {
      if (Object.prototype.hasOwnProperty.call(params, k)) p[k] = params[k];
    }
    if (p.period !== null && p.period !== undefined && String(p.period) !== "") {
      p.needsResolve = true;
    }
    return p;
  }

  // ==========================================================================
  // LLM: elección cerrada (el modelo responde un NÚMERO)
  // ==========================================================================
  // Port de shortlist_options.
  function shortlistOptions(ranked) {
    var cfg = ChatRouterData.CONFIG;
    var opts = [];
    var floorScore = ranked[0].score - cfg.shortlistWindow;
    if (floorScore < 1) floorScore = 1;
    for (var i = 0; i < ranked.length; i++) {
      if (ranked[i].score >= floorScore && opts.length < cfg.shortlistSize) {
        opts.push(ranked[i].tool);
      }
    }
    return opts;
  }

  // Port de all_options.
  function allOptions(ranked) {
    var opts = [];
    for (var i = 0; i < ranked.length; i++) opts.push(ranked[i].tool);
    return opts;
  }

  // Port de build_choice_prompt.
  function buildChoicePrompt(userPrompt, options, withExamples) {
    var blurbs = ChatRouterData.TOOL_BLURBS;
    var examples = ChatRouterData.TOOL_EXAMPLES;
    var p = "Clasifica la consulta de un cliente de una agencia de paquetería, remesas y recargas.\n";
    p = p + "Elige UNA opción y responde SOLO con su número, sin texto adicional.\n\n";
    p = p + "Opciones:\n";
    var n = 0;
    for (var i = 0; i < options.length; i++) {
      var o = options[i];
      n = n + 1;
      p = p + n + ". " + o + " - " + blurbs[o] + "\n";
      if (withExamples === 1) {
        var ex = examples[o];
        if (ex !== null && ex !== undefined) {
          for (var j = 0; j < ex.length; j++) {
            p = p + "   ej: " + ex[j] + "\n";
          }
        }
      }
    }
    n = n + 1;
    p = p + n + ". ninguna - la consulta no encaja con ninguna opción (otro tema)\n\n";
    p = p + "Consulta: " + userPrompt + "\n";
    p = p + "Número:";
    return p;
  }

  // Port de parse_choice.
  function parseChoice(raw, options) {
    if (raw === null || raw === undefined) return "";
    var txt = String(raw).toLowerCase();
    var nOpts = options.length;
    var cleaned = txt.replace(/[^a-z0-9_ ]/g, " ").replace(/ +/g, " ").trim();
    var toks = cleaned.split(" ");
    for (var i = 0; i < toks.length; i++) {
      var tk = toks[i];
      if (/^[0-9]{1,2}$/.test(tk)) {
        var idx = parseInt(tk, 10);
        if (idx >= 1 && idx <= nOpts) return options[idx - 1];
        if (idx === nOpts + 1) return "ninguna";
      }
    }
    for (var j = 0; j < options.length; j++) {
      if (txt.indexOf(options[j]) !== -1) return options[j];
    }
    if (txt.indexOf("ninguna") !== -1) return "ninguna";
    return "";
  }

  // Port de route_info (debug).
  function routeInfo(via, ranked, llmChoice) {
    var top = "";
    var n = 0;
    for (var i = 0; i < ranked.length; i++) {
      if (n < 3) top = top + ranked[i].tool + "=" + ranked[i].score + " ";
      n = n + 1;
    }
    return { via: via, top: top.trim(), llm: llmChoice };
  }

  // ==========================================================================
  // Fachada pública
  // ==========================================================================
  function placesFromEnts(ents) {
    var out = {};
    if (ents.office) out.office = ents.office;
    if (ents.place) out.city = ents.place;
    if (ents.country) out.country = ents.country;
    if (ents.place) out.place = ents.place;
    return out;
  }

  function mergeParams(prev, cur) {
    var merged = {};
    var k;
    for (k in prev) if (Object.prototype.hasOwnProperty.call(prev, k)) merged[k] = prev[k];
    for (k in cur) if (Object.prototype.hasOwnProperty.call(cur, k)) merged[k] = cur[k];
    return merged;
  }

  // ChatRouter.route(text, { places, lastIntent, history }) →
  //   { tool, params, via, candidates, placesText, text?, smalltalk?, route, ranked }
  // via ∈ "rule" | "followup" | "smalltalk" | "llm_shortlist" | "llm_all" | "clarify".
  // No llama a Zia: cuando las reglas dudan devuelve via llm_* con candidates para
  // que el servidor haga la elección cerrada.
  function route(text, options) {
    options = options || {};
    var places = options.places || (ChatRouterData.PLACES || DEFAULT_PLACES);
    var history = options.history || [];
    var lastIntent = options.lastIntent || null;
    var cfg = ChatRouterData.CONFIG;
    var texts = ChatRouterData.SMALLTALK;

    var d = decideRules(text, history, places);
    var decision = d.decision;
    var via = d.via;
    var ranked = d.ranked;
    var ents = d.ents;
    var padded = d.padded;

    if (decision === "smalltalk") {
      return {
        tool: "",
        params: {},
        via: "smalltalk",
        text: texts[d.smalltalk] || "",
        smalltalk: d.smalltalk,
        candidates: [],
        placesText: placesFromEnts(ents),
        ranked: ranked,
        route: routeInfo(via, ranked, ""),
      };
    }
    if (decision === "clarify_top") {
      return {
        tool: "",
        params: {},
        via: "clarify",
        text: texts.topNoType || "",
        candidates: [],
        placesText: placesFromEnts(ents),
        ranked: ranked,
        route: routeInfo(via, ranked, ""),
      };
    }

    var tool = "";
    var outVia = "";
    var params = null;

    if (decision === "tool") {
      tool = d.tool;
      outVia = via === "followup" ? "followup" : "rule";
      params = buildParams(tool, ents, padded, text);
      if (outVia === "followup") {
        // params del mensaje previo, pisados por los del actual
        var prevMsg = d.prevMessage;
        var prevPadded = normalizeText(prevMsg);
        var prevEnts = extractEntities(prevMsg, prevPadded, places);
        var prevParams = buildParams(tool, prevEnts, prevPadded, prevMsg);
        params = mergeParams(prevParams, params);
      }
    } else {
      // Reglas dudosas: el JS no llama al LLM.
      outVia = decision; // "llm_shortlist" | "llm_all"
      if (lastIntent && lastIntent.tool && followupSignal(d, cfg)) {
        tool = lastIntent.tool;
        outVia = "followup";
        var curParams = buildParams(tool, ents, padded, text);
        params = mergeParams(lastIntent.params || {}, curParams);
      }
    }

    if (!tool) {
      return {
        tool: "",
        params: {},
        via: outVia,
        candidates: outVia === "llm_shortlist" ? shortlistOptions(ranked) : [],
        placesText: placesFromEnts(ents),
        ranked: ranked,
        route: routeInfo(via, ranked, ""),
      };
    }

    var req = validateRequired(tool, params);
    if (req !== "") {
      return {
        tool: "",
        params: {},
        via: "clarify",
        text: req,
        candidates: [],
        placesText: placesFromEnts(ents),
        ranked: ranked,
        route: routeInfo(via, ranked, ""),
      };
    }

    var finalParams = finalizeParams(tool, params, text);
    return {
      tool: tool,
      params: finalParams,
      via: outVia,
      candidates: [],
      placesText: placesFromEnts(ents),
      ranked: ranked,
      route: routeInfo(via, ranked, ""),
    };
  }

  // API pública + internos expuestos para test/inspección (los datos viven en ChatRouterData).
  return {
    route: route,
    // helpers del port (usados por los tests nativos)
    normalizeText: normalizeText,
    hasKw: hasKw,
    hasAny: hasAny,
    matchPlace: matchPlace,
    extractTracking: extractTracking,
    extractContactName: extractContactName,
    extractDocument: extractDocument,
    extractEntities: extractEntities,
    scoreTools: scoreTools,
    rankTools: rankTools,
    detectSmalltalk: detectSmalltalk,
    previousUserMessage: previousUserMessage,
    rulesCore: rulesCore,
    decideRules: decideRules,
    buildParams: buildParams,
    validateRequired: validateRequired,
    finalizeParams: finalizeParams,
    shortlistOptions: shortlistOptions,
    allOptions: allOptions,
    buildChoicePrompt: buildChoicePrompt,
    parseChoice: parseChoice,
    routeInfo: routeInfo,
  };
});
