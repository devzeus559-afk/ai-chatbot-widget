/**
 * ui-helpers.js — helpers de formato y piezas de UI (toast, ítems del sidebar).
 *
 * Script clásico (sin módulos ES): comparte el ámbito global con los demás
 * archivos de js/ y depende del ORDEN de carga definido en widget.html.
 */

// ------------------------------------------------------------------
// Utilidades
// ------------------------------------------------------------------
// ==== 3.5  Helpers de formato y UI ====
function truncate(str, max) {
  const s = String(str || "").replace(/\s+/g, " ").trim();
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

function timeAgo(ts) {
  if (!ts) return "";
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return mins + "m ago";
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + "h ago";
  const days = Math.floor(hrs / 24);
  if (days < 7) return days + "d ago";
  return new Date(ts).toLocaleDateString();
}

let toastTimer = null;
function showToast(msg) {
  toast.textContent = msg;
  toast.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("visible"), 2200);
}

// ------------------------------------------------------------------
// Sidebar de historial
// ------------------------------------------------------------------
function sidebarEmptyEl() {
  const el = document.createElement("div");
  el.className = "sidebar-empty";
  el.textContent = "No conversations yet";
  return el;
}

function conversationItemEl(conv) {
  const el = document.createElement("div");
  el.className =
    "conversation-item" + (conv.id === state.currentConv?.id ? " active" : "");
  el.dataset.id = conv.id;

  const main = document.createElement("div");
  main.className = "conversation-main";

  const title = document.createElement("div");
  title.className = "conversation-title";
  title.textContent = conv.title || "Untitled";

  const last = conv.messages[conv.messages.length - 1];
  const preview = document.createElement("div");
  preview.className = "conversation-preview";
  if (last) preview.textContent = truncate(last.content, 60);
  preview.style.display = last ? "" : "none"; // server: sin mensajes aún

  const time = document.createElement("div");
  time.className = "conversation-time";
  time.textContent = timeAgo(conv.updatedAt);

  main.appendChild(title);
  main.appendChild(preview);
  main.appendChild(time);

  const del = document.createElement("button");
  del.className = "conversation-delete";
  del.title = "Delete conversation";
  del.setAttribute("aria-label", "Delete conversation");
  del.textContent = "\u00d7";

  el.appendChild(main);
  el.appendChild(del);
  return el;
}
