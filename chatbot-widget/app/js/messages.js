/**
 * messages.js — render de mensajes, indicador 'thinking' y scroll.
 *
 * Script clásico (sin módulos ES): comparte el ámbito global con los demás
 * archivos de js/ y depende del ORDEN de carga definido en widget.html.
 */

function renderMessageNode(content, role) {
  // Intentar parsear JSON envelope (text + visualization) de mensajes AI
  let text = content;
  let viz = null;
  let rawJson = null;
  if (role === "ai" && typeof content === "string") {
    try {
      const parsed = JSON.parse(content);
      if (parsed && typeof parsed === "object" && parsed.text != null) {
        text = parsed.text;
        viz = parsed.visualization || null;
        rawJson = parsed; // Guardar el JSON completo (text + visualization)
      }
    } catch (e) {
      // Fallback: reparar JSON con newlines literales (mensajes de DB)
      try {
        const repaired = repairJson(content);
        const parsed = JSON.parse(repaired);
        if (parsed && typeof parsed === "object" && parsed.text != null) {
          text = parsed.text;
          viz = parsed.visualization || null;
          rawJson = parsed;
        }
      } catch (e2) {
        // Texto plano — respuesta de answer/clarify/error (sin viz)
      }
    }
  }
  const div = document.createElement("div");
  div.className = `message ${role}`;

  // Header con label de rol + botón JSON (solo AI)
  const header = document.createElement("div");
  header.className = "message-header";
  const roleLabel = document.createElement("span");
  roleLabel.className = "role-label";
  roleLabel.textContent = role === "ai" ? "Assistant" : "You";
  header.appendChild(roleLabel);

  if (role === "ai" && rawJson) {
    // Guardar el JSON crudo en el elemento para acceso posterior
    div.dataset.rawJson = JSON.stringify(rawJson);
    const jsonToggle = document.createElement("button");
    jsonToggle.className = "json-toggle";
    jsonToggle.setAttribute("aria-label", "Toggle raw JSON");
    jsonToggle.setAttribute("aria-expanded", "false");
    jsonToggle.title = "Show raw JSON";
    jsonToggle.textContent = "JSON";
    jsonToggle.addEventListener("click", () => {
      const panel = div.querySelector(".json-panel");
      const isOpen = panel.classList.toggle("open");
      jsonToggle.setAttribute("aria-expanded", isOpen);
      jsonToggle.title = isOpen ? "Hide raw JSON" : "Show raw JSON";
      if (isOpen) {
        // Pretty-print JSON solo al abrir (cache en data-pretty)
        if (!panel.dataset.pretty) {
          try {
            const raw = JSON.parse(div.dataset.rawJson);
            panel.textContent = JSON.stringify(raw, null, 2);
            panel.dataset.pretty = "1";
          } catch (e) {
            panel.textContent = div.dataset.rawJson;
          }
        }
      }
    });
    header.appendChild(jsonToggle);
  }
  div.appendChild(header);

  // Texto del mensaje
  const textDiv = document.createElement("div");
  textDiv.textContent = text;
  div.appendChild(textDiv);

  // Panel JSON colapsable (solo AI con rawJson)
  if (role === "ai" && rawJson) {
    const jsonPanel = document.createElement("pre");
    jsonPanel.className = "json-panel";
    jsonPanel.setAttribute("aria-hidden", "true");
    div.appendChild(jsonPanel);
  }

  messageList.appendChild(div);

  if (viz && viz.type && viz.type !== "none") {
    renderVisualization(viz, messageList);
    scrollToBottom();
  } else if (role === "ai") {
    // Ruta track_package: sin viz, el control sale bajo el mensaje de texto.
    renderExportToolbar(div, resolveExportContext(text, viz));
  }
}

function addMessage(content, role) {
  // Ocultar bienvenida si es el primer mensaje
  if (welcomeScreen) {
    welcomeScreen.classList.add("hidden");
    messageList.classList.remove("hidden");
  }

  renderMessageNode(content, role);
  state.messages.push({ role, content });
  persistCurrentConversation();
  scrollToBottom();
}

let stillWorkingTimer = null;

function showThinking() {
  const div = document.createElement("div");
  div.className = "thinking";
  div.id = "thinkingIndicator";
  div.innerHTML =
    '<span class="dots">' +
    '<span class="dot"></span><span class="dot"></span><span class="dot"></span>' +
    "</span>" +
    '<span class="thinking-label">Thinking…</span>';
  messageList.appendChild(div);
  scrollToBottom();

  // Señal de vida: si el agente tarda, avisar que sigue trabajando
  clearTimeout(stillWorkingTimer);
  stillWorkingTimer = setTimeout(() => {
    const indicator = document.getElementById("thinkingIndicator");
    if (indicator) {
      indicator.classList.add("still-working");
      const label = indicator.querySelector(".thinking-label");
      if (label) label.textContent = "Still working…";
    }
  }, 10000);
}

function removeThinking() {
  clearTimeout(stillWorkingTimer);
  const indicator = document.getElementById("thinkingIndicator");
  if (indicator) indicator.remove();
}

function scrollToBottom() {
  chatContainer.scrollTop = chatContainer.scrollHeight;
}
