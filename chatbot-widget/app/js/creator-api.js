/**
 * creator-api.js — modo de backend y cliente de la Client API de Creator.
 *
 * BACKEND_MODE (única fuente de verdad del modo), clientApi/apiGetAll, sesiones, hilos,
 * envío con polling de ChatRequests, borrado y fallback de respuesta.
 * Script clásico (sin módulos ES): comparte el ámbito global con los demás
 * archivos de js/ y depende del ORDEN de carga definido en widget.html.
 */

// ------------------------------------------------------------------
// historyStore — adaptador de persistencia
// Capa server (Client API de Zoho Creator): ChatSessions/ChatMessages
//   para el historial y ChatRequests (job asíncrono + polling) para las
//   respuestas. La UI consume la misma interfaz: list/get/create/update/remove.
// Capa local (localStorage): sin backend — vista previa / modo local.
// ------------------------------------------------------------------
// El modo NO se decide en el parseo: el SDK (v1) expone ZOHO.CREATOR.API
// solo después de ZOHO.CREATOR.init(), así que esperamos a que resuelva
// (con timeout de respaldo para la vista previa fuera de Creator).
let BACKEND_MODE = "local";

async function resolveBackendMode() {
  if (CONFIG.forceLocal) return "local";
  if (!(window.ZOHO && ZOHO.CREATOR && typeof ZOHO.CREATOR.init === "function")) {
    return "local";
  }
  try {
    await Promise.race([
      ZOHO.CREATOR.init(),
      new Promise((r) => setTimeout(r, 3000)),
    ]);
  } catch (err) {
    console.error("ZOHO.CREATOR.init", err);
    return "local";
  }
  return ZOHO.CREATOR && ZOHO.CREATOR.API ? "server" : "local";
}

// --- Cliente mínimo sobre ZOHO.CREATOR.API (callback + promesa + timeout) ---
// El widgets SDK (version/1.0) puede invocar el callback O devolver una
// Promise, según la versión que Zoho sirva. Peor aún: algunas versiones
// ejecutan la operación (el registro se crea) pero NUNCA resuelven la
// llamada. Sin timeout el widget se cuelga para siempre en el await.
// Este wrapper resuelve con cualquiera de las dos vías + timeout.
// ==== 3.2  Adapter server (Client API) ====
function clientApi(method, config, timeoutMs) {
  return new Promise((resolve) => {
    const fn = ZOHO.CREATOR.API[method];
    if (!fn) {
      resolve({ code: 0, message: "Client API method not found: " + method });
      return;
    }
    let settled = false;
    let timer = null;
    const done = (res) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve(res || {});
      }
    };
    timer = setTimeout(
      () => done({ code: 0, timedOut: true, message: "Client API timeout: " + method }),
      timeoutMs || 8000
    );
    try {
      const maybePromise = fn(config, done);
      if (maybePromise && typeof maybePromise.then === "function") {
        maybePromise.then(
          (res) => done(res),
          (err) => done({ code: 0, message: "Client API call failed: " + ((err && err.message) || err) })
        );
      }
    } catch (err) {
      done({ code: 0, message: "Client API call failed: " + ((err && err.message) || err) });
    }
  });
}

async function apiGetAll(reportName, opts) {
  const params = { appName: CONFIG.appName, reportName: reportName, page: 1, limit: 200 };
  if (opts) {
    if (opts.page) params.page = opts.page;
    if (opts.limit) params.limit = opts.limit;
    if (opts.criteria) params.criteria = opts.criteria;
  }
  const res = await clientApi("getAllRecords", params);
  const data = res && (res.data || res.records);
  if (Array.isArray(data)) return data;
  // Reporte vacío: la REST API v2 responde 404 con code 3100
  // ("No Data Available") cuando el reporte existe pero no tiene registros.
  if (res && Number(res.code) === 3100) return [];
  throw new Error("getAllRecords(" + reportName + ") failed: " + (res && res.message));
}

const _MONTHS = {
  Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
  Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12",
};
function toTimestamp(v) {
  if (!v) return 0;
  if (typeof v === "number") return v;
  let s = String(v).trim();
  if (!s) return 0;
  // Zoho Creator formato live: "17-Aug-2026 22:35:37" → ISO numérico
  const zm = s.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})\s+(.+)$/);
  if (zm && _MONTHS[zm[2]]) {
    s = `${zm[3]}-${_MONTHS[zm[2]]}-${zm[1].padStart(2, "0")}T${zm[4]}`;
  } else if (!s.includes("T")) {
    // "2026-08-05 10:00:00" → ISO local (Creator devuelve en la timezone de la app)
    s = s.replace(" ", "T");
  }
  const t = Date.parse(s);
  return isNaN(t) ? 0 : t;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// --- Capa servidor: lectura/escritura sobre los módulos de Creator ---
async function fetchSessions() {
  const recs = await apiGetAll(CONFIG.chatSessionsReport, { limit: MAX_CONVERSATIONS });
  return recs
    .filter((r) => r.Session_ID)
    .map((r) => ({
      id: r.Session_ID,
      title: r.Title || "",
      createdAt: toTimestamp(r.Created_Time),
      updatedAt: toTimestamp(r.Last_Activity) || toTimestamp(r.Modified_Time),
      messages: [], // se cargan bajo demanda al abrir la conversación
    }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

async function loadThread(convId) {
  // Sin criteria string: el API del live rechaza Session_ID == '<uuid>'
  // con 3330 (parsea el valor como DATE-TIME). Se filtra en JS.
  const sessions = await apiGetAll(CONFIG.chatSessionsReport, { limit: 200 });
  const session = (sessions || []).find((s) => s.Session_ID === convId);
  if (!session) return null;
  const msgs = await apiGetAll(CONFIG.chatMessagesReport, {
    criteria: "Session == " + session.ID,
    limit: 200,
  });
  // IDs de Creator son strings de 19 dígitos — Number() pierde precisión.
  // Comparación string lexicográfica es cronológica para IDs de mismo largo.
  msgs.sort((a, b) => String(a.ID || "").localeCompare(String(b.ID || "")));
  return {
    title: session.Title || "",
    messages: msgs.map((m) => ({
      role: String(m.Role || "ai").toLowerCase(),
      content: m.Content || "",
    })),
  };
}

// Envía un prompt al backend: crea ChatRequests (workflow On Submit →
// chat_invoke) y hace polling del Status hasta answered/failed.
// `hint` (opcional) es la decisión del router en JS: se serializa en el campo
// Route_Hint para que chat_invoke use la tool/params sin re-inferir intención.
async function sendToServer(convId, prompt, hint) {
  const recordData = {
    [CONFIG.chatRequestsFields.sessionId]: convId,
    [CONFIG.chatRequestsFields.prompt]: prompt,
  };
  if (hint && CONFIG.chatRequestsFields.routeHint) {
    recordData[CONFIG.chatRequestsFields.routeHint] = JSON.stringify(hint);
  }
  console.log("[LM2Chatbot] sendToServer payload:", recordData);
  const res = await clientApi(
    "addRecord",
    {
      appName: CONFIG.appName,
      formName: CONFIG.chatRequestsForm,
      data: { data: recordData },
    },
    5000
  );
  console.log("[LM2Chatbot] addRecord response:", res);
  if (res && res.timedOut) {
    // El SDK creó el registro pero nunca respondió (bug observado del
    // widgets SDK): continuar al polling, filtrando Session_ID en JS.
    console.warn("[LM2Chatbot] addRecord sin respuesta del SDK; el registro suele crearse igual.");
  } else if (!res || Number(res.code) !== 3000) {
    console.error("[LM2Chatbot] addRecord failed:", res);
    throw new Error("addRecord(ChatRequests) failed: " + (res && res.message));
  }

  // Poll por ID del registro recién creado. El criteria por Session_ID
  // es frágil: el API del live parsea strings con formato de fecha como
  // DATE-TIME y rechaza con code 3330 (Invalid criteria specified).
  const createdId = res && res.data && (res.data.ID || (res.data[0] && res.data[0].ID));

  const deadline = Date.now() + CONFIG.pollTimeoutMs;
  let lastError = null;
  // ID del registro ACTUAL de esta solicitud. Si addRecord devolvió ID lo
  // usamos directo; si no (timeout del SDK), se resuelve abajo en el
  // primer poll sin depender de Created_Time.
  let pollId = createdId || null;
  while (Date.now() < deadline) {
    await sleep(CONFIG.pollIntervalMs);
    let recs;
    try {
      if (pollId) {
        // ID numérico: criteria seguro (sin parseo de fecha)
        recs = await apiGetAll(CONFIG.chatRequestsReport, {
          criteria: "ID == " + pollId,
          limit: 10,
        });
      } else {
        // Sin criteria: el live rechaza Session_ID == '<valor>' con 3330.
        // Se trae la página 1 y se filtra Session_ID en JS.
        recs = await apiGetAll(CONFIG.chatRequestsReport, { limit: 200 });
        recs = (recs || []).filter((r) => r.Session_ID === convId);
        // El live puede no exponer Created_Time en el reporte: si el sort
        // quedaba todo en cero, recs[0] era el PRIMER registro de la
        // conversación (el saludo) → respondía siempre lo mismo.
        // Identificar el registro ACTUAL sin depender de la fecha:
        // 1) el que está pendiente (recién creado, workflow corriendo)
        // 2) el que matchea el Prompt que acabamos de enviar
        // 3) último recurso: el más nuevo por Created_Time
        const current =
          recs.find((r) => r.Status === REQUEST_STATUS.PENDING || r.Status === REQUEST_STATUS.PROCESSING) ||
          recs.find((r) => r.Prompt === prompt) ||
          recs.sort((a, b) => toTimestamp(b.Created_Time) - toTimestamp(a.Created_Time))[0];
        if (!current) continue;
        pollId = current.ID;
        recs = [current];
      }
      console.log("[LM2Chatbot] poll:", { mode: pollId ? "by-id" : "filter-js", recs: recs });
    } catch (err) {
      lastError = err;
      console.error("[LM2Chatbot] poll error:", err);
      continue;
    }
    recs.sort((a, b) => toTimestamp(b.Created_Time) - toTimestamp(a.Created_Time));
    const latest = recs[0];
    if (!latest) continue;
    const status = String(latest.Status || "");
    if (status === REQUEST_STATUS.ANSWERED) {
      // Fallback si el reporte no expone Reply: último mensaje ai del hilo
      let reply = latest.Reply || "";
      if (!reply) reply = await replyFallback(convId);
      return { ok: true, reply: reply };
    }
    if (status === REQUEST_STATUS.FAILED) {
      return { ok: false, error: latest.Error || "Error en el servidor." };
    }
  }
  return {
    ok: false,
    error: lastError
      ? "No se pudo contactar el servidor. Revisa la conexión e intenta de nuevo."
      : "La solicitud tardó demasiado (" +
        Math.round(CONFIG.pollTimeoutMs / 1000) +
        " s). Por favor intenta de nuevo.",
  };
}

// El widget JS API (SDK v1) deleteRecord NO acepta formName+id: su contrato es
// reportName + criteria (obligatorio). El éxito llega en res.result[] con
// code 3000 por registro (o res.code 3000 a nivel superior).
function deleteRecordOk(res) {
  if (!res || res.timedOut) return false;
  if (Number(res.code) === 3000) return true;
  if (Array.isArray(res.result)) {
    return (
      res.result.length > 0 &&
      res.result.every((r) => Number(r && r.code) === 3000)
    );
  }
  return false;
}

// Borra TODAS las sesiones que comparten Session_ID (el backend puede
// crear varias por mensaje — ver replyFallback). Devuelve:
//   { deleted: n, ok: true }  si todos los deleteRecord confirmaron
//   { deleted: n, ok: false } si algún deleteRecord falló o expiró
async function deleteSessionOnServer(convId) {
  // Sin criteria string (mismo motivo: 3330 en el live). Filtrado en JS.
  let ok = true;
  async function deleteByIds(reportName, recs) {
    for (const rec of recs) {
      const res = await clientApi("deleteRecord", {
        appName: CONFIG.appName,
        reportName: reportName,
        criteria: "ID == " + rec.ID,
      });
      if (!deleteRecordOk(res)) {
        // El widgets SDK puede ejecutar el borrado pero nunca responder
        // (bug observado en addRecord) o devolver un error real; en ambos
        // casos no podemos dar por borrado algo que el servidor aún tiene.
        console.warn(
          "[LM2Chatbot] deleteRecord failed",
          reportName,
          rec.ID,
          res
        );
        ok = false;
      }
    }
  }

  const allSessions = await apiGetAll(CONFIG.chatSessionsReport, { limit: 200 });
  // Puede haber VARIAS sesiones con el mismo Session_ID (bug del backend
  // que crea una por mensaje): borrarlas TODAS o reaparecen al recargar.
  const sessions = (allSessions || []).filter((s) => s.Session_ID === convId);
  for (const session of sessions) {
    const msgs = await apiGetAll(CONFIG.chatMessagesReport, {
      criteria: "Session == " + session.ID,
      limit: 200,
    });
    await deleteByIds(CONFIG.chatMessagesReport, msgs);
    await deleteByIds(CONFIG.chatSessionsReport, [session]);
  }
  let reqs = await apiGetAll(CONFIG.chatRequestsReport, { limit: 200 });
  reqs = (reqs || []).filter((r) => r.Session_ID === convId);
  await deleteByIds(CONFIG.chatRequestsReport, reqs);

  return { deleted: sessions.length, ok: ok };
}

// Si el reporte ChatRequests no expone Reply en el live, lee el último
// mensaje "ai" del hilo desde ChatMessages_Report.
async function replyFallback(convId) {
  try {
    const sessions = await apiGetAll(CONFIG.chatSessionsReport, { limit: 200 });
    // Puede haber VARIAS sesiones con el mismo Session_ID (bug del backend
    // que crea una sesión por mensaje). Con .find() agarraba SIEMPRE la
    // primera sesión → respondía lo mismo a todo. Usar la MÁS RECIENTE.
    const session = (sessions || [])
      .filter((s) => s.Session_ID === convId)
      .sort((a, b) => toTimestamp(b.Created_Time) - toTimestamp(a.Created_Time))[0];
    if (!session) return "";
    const msgs = await apiGetAll(CONFIG.chatMessagesReport, {
      criteria: "Session == " + session.ID,
      limit: 50,
    });
    const ai = (msgs || [])
      .filter((m) => String(m.Role || "").toLowerCase() === "ai")
      .sort((a, b) => toTimestamp(b.Created_Time) - toTimestamp(a.Created_Time))[0];
    return (ai && ai.Content) || "";
  } catch (err) {
    console.error("[LM2Chatbot] replyFallback failed:", err);
    return "";
  }
}
