/**
 * store.js — capa de persistencia: adapter local (localStorage) + historyStore (server|local).
 *
 * Script clásico (sin módulos ES): comparte el ámbito global con los demás
 * archivos de js/ y depende del ORDEN de carga definido en widget.html.
 */

// --- Capa local (localStorage) ---
// ==== 3.3  Adapter local (localStorage) ====
function localList() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((c) => c && c.id && Array.isArray(c.messages))
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  } catch (err) {
    console.error("historyStore.list", err);
    return [];
  }
}

function localSaveAll(all) {
  const trimmed = all.slice(0, MAX_CONVERSATIONS);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch (err) {
    console.error("localSaveAll", err);
  }
}

// --- Store: misma interfaz para ambas capas ---
// ==== 3.4  historyStore — capa unificada (server|local) ====
const historyStore = {
  // Única fuente de verdad: BACKEND_MODE (se resuelve en init()). Sin copia que pueda divergir.
  get mode() {
    return BACKEND_MODE;
  },
  _cache: [], // servidor: sesiones cargadas (con mensajes si se abrieron)

  async init() {
    if (this.mode !== "server") return;
    try {
      this._cache = await fetchSessions();
    } catch (err) {
      console.error("historyStore.init", err);
    }
  },

  // Recarga metadatos de sesiones conservando los mensajes ya cargados
  async refreshSessions() {
    if (this.mode !== "server") return;
    try {
      const sessions = await fetchSessions();
      const byId = new Map(this._cache.map((c) => [c.id, c]));
      this._cache = sessions.map((s) => {
        const existing = byId.get(s.id);
        return existing && existing.messages.length
          ? Object.assign({}, existing, { title: s.title, updatedAt: s.updatedAt })
          : s;
      });
    } catch (err) {
      console.error("historyStore.refreshSessions", err);
    }
  },

  list() {
    if (this.mode === "server") {
      return this._cache.slice().sort((a, b) => b.updatedAt - a.updatedAt);
    }
    return localList();
  },

  get(id) {
    if (this.mode !== "server") {
      return this.list().find((c) => c.id === id) || null;
    }
    return this._cache.find((c) => c.id === id) || null;
  },

  // Carga un hilo completo (mensajes) — en servidor hace fetch bajo demanda
  async load(id) {
    if (this.mode !== "server") return this.get(id);
    const cached = this.get(id);
    if (cached && cached.messages.length) return cached;
    const thread = await loadThread(id);
    if (!thread) return null;
    const conv = {
      id: id,
      title: thread.title || (cached && cached.title) || "",
      createdAt: cached ? cached.createdAt : 0,
      updatedAt: cached ? cached.updatedAt : 0,
      messages: thread.messages,
    };
    this._upsert(conv);
    return conv;
  },

  create(conv) {
    if (this.mode === "server") {
      this._upsert(conv); // la sesión se crea en servidor con el primer envío
      return;
    }
    const all = localList();
    all.unshift(conv);
    localSaveAll(all);
  },

  update(conv) {
    if (this.mode === "server") {
      this._upsert(conv); // servidor mantiene title/Last_Activity (refreshSessions)
      return;
    }
    const all = localList();
    const i = all.findIndex((c) => c.id === conv.id);
    if (i !== -1) all[i] = conv;
    else all.unshift(conv);
    localSaveAll(all);
  },

  // Devuelve true si se eliminó (o no existía), false si el servidor falló.
  async remove(id) {
    if (this.mode === "server") {
      try {
        const res = await deleteSessionOnServer(id);
        if (!res || res.ok === false) {
          // El servidor aún tiene la conversación: refrescar el cache
          // para reflejar la verdad (si no, "borrada" reaparece al recargar).
          console.warn("historyStore.remove: server delete failed for", id);
          await this.refreshSessions();
          return false;
        }
      } catch (err) {
        console.error("historyStore.remove", err);
        await this.refreshSessions();
        return false;
      }
      this._cache = this._cache.filter((c) => c.id !== id);
      return true;
    }
    localSaveAll(localList().filter((c) => c.id !== id));
    return true;
  },

  // Envía un mensaje y devuelve la respuesta del agente.
  // `hint` (opcional) es la decisión del router en JS ({tool, params, via});
  // solo tiene efecto en modo server (se ignora en la simulación local).
  async send(convId, prompt, hint) {
    if (this.mode !== "server") {
      await sleep(600);
      return {
        ok: true,
        reply:
          "This is a simulated response. Run the widget inside Zoho Creator to use the real backend (Client API).",
      };
    }
    return sendToServer(convId, prompt, hint);
  },

  _upsert(conv) {
    const i = this._cache.findIndex((c) => c.id === conv.id);
    if (i !== -1) this._cache[i] = conv;
    else this._cache.unshift(conv);
  },
};
