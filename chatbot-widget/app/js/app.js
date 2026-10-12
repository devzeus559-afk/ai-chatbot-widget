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
    const result = await historyStore.send(state.currentConv.id, content);
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
}

init();
