/**
 * conversations.js — sidebar, conversaciones y modo responsive (móvil/escritorio).
 *
 * Script clásico (sin módulos ES): comparte el ámbito global con los demás
 * archivos de js/ y depende del ORDEN de carga definido en widget.html.
 */

// ==== 3.6  Sidebar y conversaciones ====
function renderSidebar() {
  conversationList.innerHTML = "";
  const convs = historyStore.list();
  if (!convs.length) {
    conversationList.appendChild(sidebarEmptyEl());
    return;
  }
  convs.forEach((conv) => conversationList.appendChild(conversationItemEl(conv)));
}

function newChat() {
  if (state.isLoading) return;
  state.currentConv = null;
  messageList.innerHTML = "";
  messageList.classList.add("hidden");
  welcomeScreen.classList.remove("hidden");
  renderSidebar();
  chatInput.focus();
}

async function selectConversation(id) {
  if (state.isLoading) return;
  let conv;
  try {
    conv = await historyStore.load(id);
  } catch (err) {
    console.error("selectConversation", err);
    showToast("Failed to load conversation");
    return;
  }
  if (!conv) return;
  state.currentConv = conv;
  welcomeScreen.classList.add("hidden");
  messageList.classList.remove("hidden");
  messageList.innerHTML = "";
  conv.messages.forEach((m) => renderMessageNode(m.content, m.role));
  scrollToBottom();
  renderSidebar();
}

async function deleteConversation(id) {
  if (state.currentConv?.id === id && state.isLoading) return;
  const removed = await historyStore.remove(id);
  if (removed === false) {
    showToast("No se pudo eliminar la conversación en el servidor");
    renderSidebar();
    return;
  }
  showToast("Conversación eliminada");
  if (state.currentConv?.id === id) {
    newChat();
  } else {
    renderSidebar();
  }
}

function ensureCurrentConversation() {
  if (state.currentConv) return;
  const now = Date.now();
  const id =
    window.crypto && crypto.randomUUID
      ? crypto.randomUUID()
      : "c_" + now + "_" + Math.random().toString(36).slice(2, 8);
  state.currentConv = { id, title: "", createdAt: now, updatedAt: now, messages: [] };
  historyStore.create(state.currentConv);
  renderSidebar();
}

function persistCurrentConversation() {
  if (!state.currentConv) return;
  const conv = state.currentConv;
  conv.updatedAt = Date.now();
  if (!conv.title && conv.messages.length) {
    const first = conv.messages.find((m) => m.role === "user");
    if (first) conv.title = truncate(first.content, 42);
  }
  historyStore.update(conv);
  renderSidebar();
}

// ------------------------------------------------------------------
// Drawer responsive (sidebar superpuesta en pantallas pequeñas)
// ------------------------------------------------------------------
// ==== 3.7  Viewport responsive (móvil / escritorio) ====
const mq = window.matchMedia("(max-width: 768px)");

function applyViewportMode() {
  if (mq.matches) {
    sidebar.classList.remove("collapsed");
    sidebar.classList.remove("open");
    backdrop.classList.remove("visible");
  } else {
    sidebar.classList.remove("open");
    backdrop.classList.remove("visible");
    let collapsed = false;
    try {
      collapsed = localStorage.getItem(COLLAPSED_KEY) === "1";
    } catch (err) {
      console.error(err);
    }
    sidebar.classList.toggle("collapsed", collapsed);
  }
}

mq.addEventListener("change", applyViewportMode);
