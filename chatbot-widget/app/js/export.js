/**
 * export.js — exportación de visualizaciones (CSV nativo + XLSX vía SheetJS bajo demanda).
 *
 * Script clásico (sin módulos ES): comparte el ámbito global con los demás
 * archivos de js/ y depende del ORDEN de carga definido en widget.html.
 */

// ================================================================
// 3.8b  Exportación de visualizaciones (CSV nativo + XLSX via SheetJS)
// ================================================================
// El envelope de la respuesta es estrictamente {text, visualization}; no
// llega ni tool name ni objeto crudo. La tool se resuelve con titlePrefix
// sobre EXPORT_TEMPLATES; track_package se reconstruye parseando el texto
// determinista de format_tracking. CSV y XLSX comparten la misma matriz,
// de modo que ambos formatos exportan exactamente lo que ve el usuario.

// RFC 4180: escapa comillas, comas y saltos de línea.
function csvEscape(v) {
  const s = v == null ? "" : String(v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

// Matriz [][] = fila de headers + filas de datos. Fuente de verdad:
// {labels, series} cuando está disponible; si no, el objeto track_package
// se vierte como fila única.
function buildExportMatrix(ctx) {
  if (ctx.obj) {
    const tpl = ctx.template;
    const cols = (tpl && tpl.columns) || [];
    const header = cols.map((c) => c.header);
    const row = cols.map((c) => (ctx.obj[c.key] != null ? ctx.obj[c.key] : ""));
    return [header, row];
  }
  const viz = ctx.viz;
  const header = ["Categoría", ...(viz.series || []).map((s) => s.name)];
  const rows = (viz.labels || []).map((label, i) => [
    label,
    ...(viz.series || []).map((s) => (s.values[i] != null ? s.values[i] : "")),
  ]);
  return [header, ...rows];
}

// BOM UTF-8 (Excel abre acentos bien) + filas separadas por CRLF.
function buildCsv(matrix) {
  return (
    "\uFEFF" +
    matrix.map((row) => row.map(csvEscape).join(",")).join("\r\n")
  );
}

// Descarga vía objectURL + <a download> + revoke (mismo patrón que exportBtn).
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// Fecha LOCAL (nunca UTC — evitaría desfase de día cerca de medianoche).
function localIsoDate() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
}

// export-{toolName}-{YYYY-MM-DD}.{ext} → p. ej. export-report_top_customers-2026-08-28.csv
function exportFilename(toolName, ext) {
  const tpl = CONFIG.EXPORT_TEMPLATES[toolName] || GENERIC_EXPORT_TEMPLATE;
  const fn = (tpl.filename || "export-{toolName}-{date}")
    .replace("{toolName}", toolName)
    .replace("{date}", localIsoDate());
  return fn + "." + ext;
}

// Plantilla por tool; desconocida → genérica.
function resolveTemplate(toolName) {
  return CONFIG.EXPORT_TEMPLATES[toolName] || GENERIC_EXPORT_TEMPLATE;
}

// Reconstruye el objeto de track_package desde el texto determinista de
// format_tracking. Las líneas opcionales pueden faltar → se dejan en "".
function parseTrackingText(text) {
  const lines = String(text).split("\n");
  const pick = (prefix) => {
    const line = lines.find((l) => l.indexOf(prefix) === 0);
    return line ? line.slice(prefix.length).trim() : "";
  };
  return {
    trackingNumber: pick("Paquete "),
    status: pick("Estado: "),
    lastUpdate: pick("Fecha actualización: "),
    origin: pick("Origen: "),
    destination: pick("Destino: "),
  };
}

// Resuelve el contexto de exportación. Devuelve null si no hay control
// (viz type none/faltante y texto que no es track_package).
function resolveExportContext(text, viz) {
  if (!viz || viz.type === "none" || !viz.type) {
    // Ruta track_package: sin viz, pero texto determinista de format_tracking.
    if (typeof text === "string" && /^Paquete .+\nEstado: /.test(text)) {
      const toolName = "track_package";
      return {
        toolName,
        viz: null,
        obj: parseTrackingText(text),
        template: resolveTemplate(toolName),
      };
    }
    return null;
  }
  // Ruta visualización: resolver tool por titlePrefix exacto sobre EXPORT_TEMPLATES.
  const title = viz.title || "";
  let toolName = null;
  Object.keys(CONFIG.EXPORT_TEMPLATES).forEach((key) => {
    if (toolName) return;
    const entry = CONFIG.EXPORT_TEMPLATES[key];
    if (entry && entry.titlePrefix && title.indexOf(entry.titlePrefix) === 0) {
      toolName = key;
    }
  });
  if (!toolName) toolName = "viz"; // sin entrada → nombre genérico + plantilla genérica
  return { toolName, viz, obj: null, template: resolveTemplate(toolName) };
}

// Carga perezosa de SheetJS: se inyecta el script solo al pedir XLSX por
// primera vez; xlsxPromise se resetea en error/timeout para reintentar.
let xlsxPromise = null;
function loadSheetJS() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  if (xlsxPromise) return xlsxPromise;
  xlsxPromise = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = CONFIG.SHEETJS_CDN;
    s.onload = () => {
      if (window.XLSX) {
        resolve(window.XLSX);
      } else {
        xlsxPromise = null;
        reject(new Error("XLSX missing after load"));
      }
    };
    s.onerror = () => {
      xlsxPromise = null;
      reject(new Error("SheetJS CDN failed"));
    };
    document.head.appendChild(s);
    setTimeout(() => {
      xlsxPromise = null;
      reject(new Error("SheetJS load timeout"));
    }, 10000);
  });
  return xlsxPromise;
}

// Construye el workbook desde la matriz (misma que el CSV): headers,
// anchos, autoFilter, freeze y estilo del header según la plantilla.
function buildWorkbook(matrix, tpl) {
  const ws = XLSX.utils.aoa_to_sheet(matrix);
  if (tpl.columns && tpl.columns.length) {
    ws["!cols"] = tpl.columns.map((c) => ({ wch: c.width }));
  }
  if (tpl.autoFilter) ws["!autofilter"] = { ref: ws["!ref"] };
  if (tpl.freezePane) {
    ws["!freeze"] = Object.assign({ xSplit: 0, topLeftCell: "A2" }, tpl.freezePane);
  }
  if (tpl.headerStyle) {
    const range = XLSX.utils.decode_range(ws["!ref"]);
    for (let c = range.s.c; c <= range.e.c; c++) {
      const addr = XLSX.utils.encode_cell({ r: 0, c });
      if (!ws[addr]) ws[addr] = { t: "s", v: "" };
      const cellStyle = { font: { bold: !!tpl.headerStyle.bold } };
      if (tpl.headerStyle.bg) {
        cellStyle.fill = { patternType: "solid", fgColor: { rgb: tpl.headerStyle.bg } };
      }
      if (tpl.headerStyle.color) {
        cellStyle.font.color = { rgb: tpl.headerStyle.color };
      }
      ws[addr].s = cellStyle;
    }
  }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, (tpl.sheetName || "Datos").slice(0, 31));
  return wb;
}

// Dispara una exportación. Nunca rompe el pipeline del chat: todo va en
// try/catch; si XLSX falla, hace fallback automático a CSV de la misma matriz.
async function runExport(ctx, format) {
  try {
    const matrix = buildExportMatrix(ctx);
    if (format === "xlsx") {
      try {
        const XLSXLib = await loadSheetJS();
        const wb = buildWorkbook(matrix, ctx.template);
        const data = XLSXLib.write(wb, { type: "array", bookType: "xlsx" });
        const blob = new Blob([data], {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        });
        downloadBlob(blob, exportFilename(ctx.toolName, "xlsx"));
        showToast("Exported " + ctx.toolName + " as XLSX");
      } catch (err) {
        console.error("xlsx export", err);
        showToast("XLSX unavailable — exported CSV instead");
        const csv = buildCsv(matrix);
        downloadBlob(new Blob([csv], { type: "text/csv;charset=utf-8;" }), exportFilename(ctx.toolName, "csv"));
      }
      return;
    }
    const csv = buildCsv(matrix);
    downloadBlob(new Blob([csv], { type: "text/csv;charset=utf-8;" }), exportFilename(ctx.toolName, "csv"));
    showToast("Exported " + ctx.toolName + " as CSV");
  } catch (err) {
    console.error("export", err);
    showToast("Export failed");
  }
}

// Toolbar Export ▾ con submenú [CSV / XLSX]. Cierra con click fuera o Escape;
// los ítems se deshabilitan mientras corre una exportación.
function renderExportToolbar(parentEl, ctx) {
  if (!ctx) return;

  const toolbar = document.createElement("div");
  toolbar.className = "zc-viz-toolbar";

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "zc-export-btn";
  btn.textContent = "Export ▾";
  btn.title = "Export visualization";
  btn.setAttribute("aria-haspopup", "menu");
  btn.setAttribute("aria-expanded", "false");

  const menu = document.createElement("div");
  menu.className = "zc-export-menu";
  menu.setAttribute("role", "menu");

  let busy = false;
  function setBusy(b) {
    busy = b;
    btn.disabled = b;
    Array.prototype.forEach.call(menu.querySelectorAll("button"), (it) => {
      it.disabled = b;
    });
  }

  function onDocClick(e) {
    if (!toolbar.contains(e.target)) closeMenu();
  }
  function onDocKey(e) {
    if (e.key === "Escape") closeMenu();
  }
  function closeMenu() {
    menu.classList.remove("open");
    btn.setAttribute("aria-expanded", "false");
    document.removeEventListener("click", onDocClick);
    document.removeEventListener("keydown", onDocKey);
  }
  function openMenu() {
    menu.classList.add("open");
    btn.setAttribute("aria-expanded", "true");
    document.addEventListener("click", onDocClick);
    document.addEventListener("keydown", onDocKey);
  }

  function addItem(label, format) {
    const item = document.createElement("button");
    item.type = "button";
    item.textContent = label;
    item.setAttribute("role", "menuitem");
    item.addEventListener("click", () => {
      closeMenu();
      setBusy(true);
      runExport(ctx, format).then(() => setBusy(false));
    });
    menu.appendChild(item);
  }

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (busy) return;
    if (menu.classList.contains("open")) closeMenu();
    else openMenu();
  });

  addItem("CSV", "csv");
  addItem("XLSX", "xlsx");

  toolbar.appendChild(btn);
  toolbar.appendChild(menu);
  parentEl.appendChild(toolbar);
}
