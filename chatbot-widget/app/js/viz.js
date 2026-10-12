/**
 * viz.js — render de visualizaciones (tabla y barras, sin dependencias) y reparación de JSON.
 *
 * renderVisualization() llama a renderExportToolbar/resolveExportContext (export.js) en tiempo de ejecución.
 * Script clásico (sin módulos ES): comparte el ámbito global con los demás
 * archivos de js/ y depende del ORDEN de carga definido en widget.html.
 */

// --- Visualización: motor de render (bar + table, sin dependencias) ---

// Reparación de JSON con newlines literales (mensajes guardados antes del
// fix de escaping). Reemplaza \n \r \t dentro de strings JSON por sus
// secuencias escapadas, respetando el contexto de string vs fuera de string.
function repairJson(raw) {
  let out = "";
  let inStr = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === '"') {
      // Verificar si es comilla escapada (\")
      let bs = 0;
      let j = i - 1;
      while (j >= 0 && raw[j] === "\\") { bs++; j--; }
      if (bs % 2 === 0) {
        // Comilla real: alterna inStr
        inStr = !inStr;
      }
      out += ch;
    } else if (inStr) {
      if (ch === "\n") { out += "\\n"; }
      else if (ch === "\r") { out += "\\r"; }
      else if (ch === "\t") { out += "\\t"; }
      else { out += ch; }
    } else {
      out += ch;
    }
  }
  return out;
}

function renderTable(viz, container) {
  const table = document.createElement("table");
  table.className = "zc-table";
  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  // Headers: "Categoría" + nombre de cada serie
  const thLabel = document.createElement("th");
  thLabel.textContent = "Categoría";
  headRow.appendChild(thLabel);
  (viz.series || []).forEach((s) => {
    const th = document.createElement("th");
    th.textContent = s.name;
    headRow.appendChild(th);
  });
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  (viz.labels || []).forEach((label, i) => {
    const tr = document.createElement("tr");
    const tdLabel = document.createElement("td");
    tdLabel.textContent = label;
    tr.appendChild(tdLabel);
    (viz.series || []).forEach((s) => {
      const td = document.createElement("td");
      td.textContent = s.values[i] != null ? s.values[i] : "";
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  container.appendChild(table);
}

function renderBarChart(viz, container) {
  const values = (viz.series && viz.series[0] && viz.series[0].values) || [];
  const maxVal = Math.max(...values, 1);
  const chart = document.createElement("div");
  chart.className = "zc-bar-chart";

  (viz.labels || []).forEach((label, i) => {
    const val = values[i] || 0;
    const pct = (val / maxVal) * 100;
    const barWrap = document.createElement("div");
    barWrap.className = "zc-bar-wrap";
    const barValue = document.createElement("div");
    barValue.className = "zc-bar-value";
    barValue.textContent = val;
    const bar = document.createElement("div");
    bar.className = "zc-bar";
    bar.style.height = "0%";
    const barLabel = document.createElement("div");
    barLabel.className = "zc-bar-label";
    barLabel.textContent = label;
    barLabel.title = label;
    barWrap.appendChild(barValue);
    barWrap.appendChild(bar);
    barWrap.appendChild(barLabel);
    chart.appendChild(barWrap);
    // Animar entrada: height desde 0
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        bar.style.height = pct + "%";
      });
    });
  });
  container.appendChild(chart);
}

function renderVisualization(viz, container) {
  if (!viz || viz.type === "none" || !viz.type) return;
  const wrapper = document.createElement("div");
  wrapper.className = "zc-viz-container";
  if (viz.title) {
    const title = document.createElement("div");
    title.className = "zc-viz-title";
    title.textContent = viz.title;
    wrapper.appendChild(title);
  }
  switch (viz.type) {
    case "table":
      renderTable(viz, wrapper);
      break;
    case "bar":
      renderBarChart(viz, wrapper);
      break;
    // "line" se soportará en fase 2
  }
  // Toolbar de exportación en la misma wrapper solo para table/bar.
  renderExportToolbar(wrapper, resolveExportContext(null, viz));
  container.appendChild(wrapper);
}
