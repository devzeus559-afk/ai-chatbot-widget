/**
 * app.js — envío de mensajes, listeners, sugerencias e init. Se carga el ÚLTIMO.
 *
 * Script clásico (sin módulos ES): comparte el ámbito global con los demás
 * archivos de js/ y depende del ORDEN de carga definido en widget.html.
 */

// ================================================================
// 3.9  Envío de mensajes (sendMessage)
// ================================================================
async function sendMessage() {
  const content = chatInput.value.trim();
  if (!content || state.isLoading) return;

  ensureCurrentConversation();
  addMessage(content, "user");
  chatInput.value = "";
  chatInput.style.height = "auto";
  sendBtn.disabled = true;
  state.isLoading = true;

  showThinking();

  try {
    // Router de intención en JS: resuelve la tool determinista (si la hay) y
    // adjunta la pista al request. Si ChatRouter no está disponible se envía
    // sin hint (el backend cae a la inferencia normal).
    const hint = routePrompt(content);
    const result = await historyStore.send(state.currentConv.id, content, hint);
    removeThinking();
    if (result.ok) {
      // result.reply es el envelope JSON: {"text":"...","visualization":{...}}
      // renderMessageNode parsea internamente y renderiza texto + viz.
      addMessage(result.reply, "ai");
    } else {
      addMessage(
        result.error || "Lo siento, hubo un error al procesar tu solicitud.",
        "ai",
      );
    }
    if (BACKEND_MODE === "server") {
      // Sincronizar metadatos (título/actividad) con el servidor
      await historyStore.refreshSessions();
      renderSidebar();
    }
  } catch (err) {
    removeThinking();
    addMessage(
      "Lo siento, hubo un error al procesar tu solicitud. Por favor intenta de nuevo.",
      "ai",
    );
    console.error(err);
  } finally {
    state.isLoading = false;
    sendBtn.disabled = chatInput.value.trim() === "";
  }
}

// ================================================================
// 3.10  Eventos (listeners)
// ================================================================
// Manejar entrada de texto
chatInput.addEventListener("input", () => {
  chatInput.style.height = "auto";
  chatInput.style.height = chatInput.scrollHeight + "px";
  sendBtn.disabled = !chatInput.value.trim();
});

chatInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    if (!sendBtn.disabled) sendMessage();
  }
});

sendBtn.addEventListener("click", sendMessage);

// -------------------------------------------------------------------
// Sugerencias UI — desde CONFIG.suggestions (fuente única, ver CONFIG arriba).
// El Widget SDK v1 NO expone ZOHO.CREATOR.API.invoke, así que no hay llamada
// a API: los botones se renderizan desde el array local y disparan sendMessage
// con un prompt natural que Zia enruta a la tool correspondiente.
// -------------------------------------------------------------------
function loadSuggestions() {
  renderSuggestionButtons(CONFIG.suggestions || []);
}

function renderSuggestionButtons(suggestions) {
  const list = suggestions.slice().sort(function (a, b) {
    return (a.order || 0) - (b.order || 0);
  });
  const container = document.getElementById("suggestionsContainer");
  if (!container) return;
  container.innerHTML = "";
  list.forEach(function (s) {
    if (s.enabled === false) return; // saltar desactivadas
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "suggestion-chip";
    const icon = document.createElement("span");
    icon.className = "suggestion-icon";
    icon.textContent = s.icon || "💡";
    const label = document.createElement("span");
    label.textContent = s.label;
    btn.appendChild(icon);
    btn.appendChild(label);
    btn.addEventListener("click", function () {
      // Prompt natural enrutable por Zia (fallback: label del botón)
      useSuggestion(s.prompt || s.label);
    });
    container.appendChild(btn);
  });
}

function useSuggestion(text) {
  chatInput.value = text;
  chatInput.dispatchEvent(new Event("input"));
  sendMessage();
}

window.addEventListener("load", function () {
  loadSuggestions();
});

// -------------------------------------------------------------------
// Fin de inserción de sugerencias dinámicas
// -------------------------------------------------------------------



toggleSidebarBtn.addEventListener("click", () => {
  if (mq.matches) {
    const open = sidebar.classList.toggle("open");
    backdrop.classList.toggle("visible", open);
  } else {
    const collapsed = sidebar.classList.toggle("collapsed");
    try {
      localStorage.setItem(COLLAPSED_KEY, collapsed ? "1" : "0");
    } catch (err) {
      console.error(err);
    }
  }
});

backdrop.addEventListener("click", () => {
  sidebar.classList.remove("open");
  backdrop.classList.remove("visible");
});

newChatBtn.addEventListener("click", newChat);

conversationList.addEventListener("click", (e) => {
  const del = e.target.closest(".conversation-delete");
  const item = e.target.closest(".conversation-item");
  if (!item) return;
  if (del) {
    e.stopPropagation();
    deleteConversation(item.dataset.id);
    return;
  }
  selectConversation(item.dataset.id);
});

// Export / Import (copia de seguridad sin llamadas a API)
exportBtn.addEventListener("click", () => {
  try {
    const convs = historyStore.list();
    const blob = new Blob([JSON.stringify(convs, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "lm2chatbot-conversations.json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showToast("Exported " + convs.length + " conversations");
  } catch (err) {
    console.error("export", err);
    showToast("Export failed");
  }
});

importBtn.addEventListener("click", () => importInput.click());

importInput.addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  if (BACKEND_MODE === "server") {
    showToast("Import is only available in local mode");
    e.target.value = "";
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result);
      const arr = Array.isArray(parsed) ? parsed : parsed.conversations || [];
      const valid = arr
        .filter((c) => c && c.id && Array.isArray(c.messages))
        .slice(0, MAX_CONVERSATIONS);
      localSaveAll(valid);
      renderSidebar();
      if (!state.currentConv || !valid.some((c) => c.id === state.currentConv.id)) {
        newChat();
      }
      showToast("Imported " + valid.length + " conversations");
    } catch (err) {
      console.error("import", err);
      showToast("Import failed: invalid JSON");
    }
  };
  reader.readAsText(file);
  e.target.value = "";
});

// ================================================================
// 3.10b  Router de intención (JS) + catálogo de lugares
// ================================================================

// Resuelve la intención con ChatRouter y devuelve la pista para Route_Hint.
// Mantiene state.lastIntent (solo rule/followup) para los follow-ups.
// Devuelve null si el router no está disponible (el backend infiere solo).
function routePrompt(content) {
  if (typeof ChatRouter === "undefined" || !ChatRouter || !ChatRouter.route) {
    return null;
  }
  try {
    const history = (state.messages || [])
      .slice(-6)
      .map((m) => ({ role: m.role, content: m.content }));
    const res = ChatRouter.route(content, {
      places: state.places || undefined,
      lastIntent: state.lastIntent,
      history: history,
    });
    if (res.via === "rule" || res.via === "followup") {
      state.lastIntent = { tool: res.tool, params: res.params };
    } else {
      state.lastIntent = null;
    }
    return { tool: res.tool, params: res.params, via: res.via };
  } catch (err) {
    console.warn("[LM2Chatbot] routePrompt failed", err);
    return null;
  }
}

// v2: los report link names del gazetteer cambiaron (All_Commercial_Offices /
// All_Coverage_Locations). Bump para descartar la caché vacía que dejó la versión previa.
// v3: el gazetteer se limpia (filtro Active + descarte de basura). Bump para forzar
// el recomputo y no servir el catálogo sucio cacheado durante 24 h.
const PLACES_CACHE_KEY = "lm2chatbot:places-catalog:v3";
const PLACES_TTL_MS = 24 * 60 * 60 * 1000;

// Lee el primer campo no vacío de una lista de nombres candidatos.
function _placeField(rec, keys) {
  for (var i = 0; i < keys.length; i++) {
    var v = rec[keys[i]];
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return "";
}

// Lee un subcampo de un campo compuesto (Address.district_city).
function _placeSubField(rec, parent, child) {
  var p = rec && rec[parent];
  if (p && typeof p === "object") return p[child] || "";
  return "";
}

// Base office name: everything before the first comma.
// Office_Name is exported as "Elizabeth, New Jersey,United States, United States".
// The backend (data_access.fetch_office_id_by_name) resolves an office by that
// base name, so the gazetteer MUST store the same form: otherwise the router
// never matches "oficina Miami" against the full name and silently drops the
// office filter.
function _officeBaseName(v) {
  var s = String(v == null ? "" : v).trim();
  var i = s.indexOf(",");
  if (i > 0) return s.substring(0, i).trim();
  return s;
}

// Normaliza un valor de lugar y descarta basura de datos: colapsa espacios
// internos, recorta extremos, y devuelve "" para nombres vacíos, sin resolver
// ("null…", típico de Location_Name) o de prueba ("office test"). El casing NO
// se toca: el backend compara el nombre base tal cual lo entrega el gazetteer.
function _cleanPlace(v) {
  if (v === undefined || v === null) return "";
  var s = String(v).replace(/\s+/g, " ").trim();
  if (s === "") return "";
  if (/^null\b/i.test(s)) return "";
  if (/\btest\b/i.test(s)) return "";
  return s;
}

// Un registro inactivo no debe entrar al gazetteer. Fail-open: si el campo
// Active no viniera en la proyección del reporte, el registro se conserva.
function _isActive(rec) {
  if (!rec) return false;
  var a = rec.Active;
  if (a === undefined || a === null || a === "") return true;
  return !(a === false || a === "false" || a === 0 || a === "0");
}

// Construye {offices, cities, countries} desde oficinas + cobertura.
// Best-effort: cualquier fallo deja el catálogo sin esa fuente.
async function fetchPlaces() {
  if (BACKEND_MODE !== "server" || typeof apiGetAll !== "function") return null;

  // 1) Caché de sesión (24 h)
  try {
    const raw = sessionStorage.getItem(PLACES_CACHE_KEY);
    if (raw) {
      const cached = JSON.parse(raw);
      if (cached && cached.ts && Date.now() - cached.ts < PLACES_TTL_MS) {
        state.places = cached.data;
        return state.places;
      }
    }
  } catch (err) {
    /* caché corrupta: seguir y recargar */
  }

  const offices = new Set();
  const cities = new Set();
  const countries = new Set();
  const add = (set, v) => {
    const s = _cleanPlace(v);
    if (s !== "") set.add(s);
  };

  // 2) Oficinas: Office_Name, Address.district_city, Address.country
  let officesLoaded = false;
  try {
    const recs = await apiGetAll(CONFIG.officesReport, { limit: 200 });
    recs.forEach((rec) => {
      if (!_isActive(rec)) return;
      add(offices, _officeBaseName(_placeField(rec, ["Office_Name", "Name"])));
      add(cities, _placeSubField(rec, "Address", "district_city"));
      add(cities, _placeField(rec, ["district_city", "City"]));
      add(countries, _placeSubField(rec, "Address", "country"));
      add(countries, _placeField(rec, ["country", "Country"]));
    });
    officesLoaded = true;
  } catch (err) {
    console.error(
      "[LM2Chatbot] fetchPlaces: falló la carga de oficinas (report: " +
        CONFIG.officesReport +
        ")",
      err
    );
  }

  // 3) Cobertura: Location_Name, Address_Information1.state_province/country
  let coverageLoaded = false;
  try {
    const recs = await apiGetAll(CONFIG.coverageReport, { limit: 200 });
    recs.forEach((rec) => {
      if (!_isActive(rec)) return;
      add(cities, _placeField(rec, ["Location_Name", "Name"]));
      add(cities, _placeSubField(rec, "Address_Information1", "state_province"));
      add(countries, _placeSubField(rec, "Address_Information1", "country"));
      add(countries, _placeField(rec, ["country", "Country"]));
    });
    coverageLoaded = true;
  } catch (err) {
    console.error(
      "[LM2Chatbot] fetchPlaces: falló la carga de cobertura (report: " +
        CONFIG.coverageReport +
        ")",
      err
    );
  }

  const data = {
    offices: Array.from(offices),
    cities: Array.from(cities),
    countries: Array.from(countries),
  };

  // Diagnóstico: un gazetteer vacío ya no puede pasar desapercibido. El bug
  // original (link names inválidos) quedó invisible porque el fallo solo dejaba
  // un warn perdido; ahora los conteos se loguean y el fallo es un error.
  console.info("[LM2Chatbot] fetchPlaces: catálogo", {
    offices: data.offices.length,
    cities: data.cities.length,
    countries: data.countries.length,
  });
  if (!officesLoaded || data.offices.length === 0) {
    console.error(
      "[LM2Chatbot] fetchPlaces: catálogo de oficinas VACÍO (report: " +
        CONFIG.officesReport +
        "). El router no va a poder filtrar por oficina — revisá el report link name y sus permisos."
    );
  }
  if (!coverageLoaded) {
    console.error(
      "[LM2Chatbot] fetchPlaces: no se cargó cobertura (report: " +
        CONFIG.coverageReport +
        "). Revisá el report link name y sus permisos."
    );
  }

  state.places = data;
  // Mantener en sincronía el objeto mutable que usa el router por defecto.
  if (typeof ChatRouterData !== "undefined" && ChatRouterData && ChatRouterData.PLACES) {
    ChatRouterData.PLACES.offices = data.offices;
    ChatRouterData.PLACES.cities = data.cities;
    ChatRouterData.PLACES.countries = data.countries;
  }
  try {
    sessionStorage.setItem(PLACES_CACHE_KEY, JSON.stringify({ ts: Date.now(), data: data }));
  } catch (err) {
    /* sessionStorage lleno o no disponible: ignorar */
  }
  return data;
}

// ================================================================
// 3.11  Init (arranque)
// ================================================================
async function init() {
  // 1) Resolver el modo backend (server si la JS API de Creator está lista)
  BACKEND_MODE = await resolveBackendMode();
  // 2) Cargar el historial con el modo ya decidido
  await historyStore.init();
  renderSidebar();
  applyViewportMode();
  // 3) Nueva conversación en la pantalla de inicio en cada carga.
  //    El usuario carga una conversación anterior manualmente desde el sidebar.
  newChat();
  // 4) Catálogo de lugares para el router (fire-and-forget: no bloquea la UI).
  fetchPlaces().catch((err) => console.error("[LM2Chatbot] fetchPlaces falló de forma inesperada", err));
}

init();
