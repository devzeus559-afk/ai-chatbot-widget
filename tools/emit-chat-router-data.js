#!/usr/bin/env node
/**
 * emit-chat-router-data.js
 *
 * Regenerador de `chatbot-widget/app/js/chat-router-data.js` a partir del
 * router de intención v2 en Deluge (`deluge/core/chat_router.deluge`).
 *
 * El port a JavaScript mueve la capa de REGLAS al widget (lógica pura, sin DOM,
 * sin ZOHO, sin async). Este script extrae las TABLAS de datos de las funciones
 * Deluge y emite un módulo UMD clásico (sin ES modules) que expone
 * `window.ChatRouterData` en el browser y `module.exports` en Node.
 *
 * Uso:
 *   node tools/emit-chat-router-data.js <ruta-a-chat_router.deluge>
 *
 * Ejemplo (rama feature/router-v2):
 *   git show feature/router-v2:deluge/core/chat_router.deluge > /tmp/chat_router.deluge
 *   node tools/emit-chat-router-data.js /tmp/chat_router.deluge
 *
 * Sin dependencias. Solo LEE el .deluge; nunca lo escribe.
 */

"use strict";

const fs = require("fs");
const path = require("path");

function fail(msg) {
  console.error("[emit-chat-router-data] ERROR: " + msg);
  process.exit(1);
}

const srcArg = process.argv[2];
if (!srcArg) {
  fail("uso: node tools/emit-chat-router-data.js <ruta-a-chat_router.deluge>");
}
const srcPath = path.resolve(srcArg);
if (!fs.existsSync(srcPath)) {
  fail("no existe el archivo fuente: " + srcPath);
}

const src = fs.readFileSync(srcPath, "utf8").replace(/\r\n?/g, "\n");

// --------------------------------------------------------------------------
// Extracción de cuerpos de función Deluge
// --------------------------------------------------------------------------
// Las funciones del router viven como `thisapp.chat_router.<nombre>` y se
// declaran con la forma:  <tipo> chat_router.<nombre>(<params>) { ... }
// El cierre de la función es una llave "}" sin indentación al inicio de línea
// (los bloques anidados van indentados).
function bodyOf(name) {
  // Anclar en la DECLARACIÓN (tipo de retorno + nombre), no en una llamada
  // interna tipo `thisapp.chat_router.<name>()`.
  const re = new RegExp(
    "(?:^|\\n)\\s*(?:map|list|string|int|void|number|float|boolean|bool|date|collection)\\s+" +
      "chat_router\\." + name + "\\s*\\([^)]*\\)\\s*\\{([\\s\\S]*?)\\n\\}"
  );
  const m = src.match(re);
  if (!m) fail("no se encontró la función chat_router." + name + "()");
  return m[1];
}

// --------------------------------------------------------------------------
// Parsers de tablas
// --------------------------------------------------------------------------
function parseConfig(body) {
  const out = {};
  const re = /cfg\.put\("([^"]+)",\s*([^)]+)\)\s*;/g;
  let m;
  while ((m = re.exec(body)) !== null) {
    const key = m[1];
    const raw = m[2].trim();
    if (raw === "true") out[key] = true;
    else if (raw === "false") out[key] = false;
    else if (/^-?[0-9]+(\.[0-9]+)?$/.test(raw)) out[key] = Number(raw);
    else out[key] = raw;
  }
  return out;
}

function parseStringMap(body) {
  const out = {};
  const re = /m\.put\("([^"]+)","((?:[^"\\]|\\.)*)"\)\s*;/g;
  let m;
  while ((m = re.exec(body)) !== null) {
    out[m[1]] = unescapeDeluge(m[2]);
  }
  return out;
}

// Lista plana: l = List(); l.add("a"); ... l.add("b");
function parseFlatList(body) {
  const out = [];
  const re = /l\.add\("((?:[^"\\]|\\.)*)"\)\s*;/g;
  let m;
  while ((m = re.exec(body)) !== null) {
    out.push(unescapeDeluge(m[1]));
  }
  return out;
}

// Lista de listas: l = List(); l.add(...); t.put("tool",l);
function parseListMap(body, putRe) {
  const lines = body.split("\n");
  const out = {};
  let cur = null;
  for (const line of lines) {
    let m;
    if (/l\s*=\s*List\(\)\s*;/.test(line)) {
      cur = [];
      continue;
    }
    if ((m = line.match(/l\.add\("((?:[^"\\]|\\.)*)"\)\s*;/))) {
      if (cur) cur.push(unescapeDeluge(m[1]));
      continue;
    }
    if ((m = line.match(putRe))) {
      out[m[1]] = cur || [];
      cur = null;
    }
  }
  return out;
}

// El Deluge embebido no usa escapes propios; sólo normalizamos por si acaso.
function unescapeDeluge(s) {
  return s.replace(/\\"/g, '"').replace(/\\\\/g, "\\");
}

// --------------------------------------------------------------------------
// Extracción
// --------------------------------------------------------------------------
const config = parseConfig(bodyOf("router_config"));
const smalltalk = parseStringMap(bodyOf("smalltalk_texts"));
const keywords = parseListMap(bodyOf("keyword_table"), /t\.put\("([^"]+)",l\)\s*;/);
const serviceTypes = parseFlatList(bodyOf("service_type_table"));
const periods = parseFlatList(bodyOf("period_table"));
const placeAliases = parseFlatList(bodyOf("place_alias_table"));
const toolBlurbs = parseStringMap(bodyOf("tool_blurbs"));
const toolExamples = parseListMap(bodyOf("tool_examples"), /m\.put\("([^"]+)",l\)\s*;/);

// --------------------------------------------------------------------------
// Emisión
// --------------------------------------------------------------------------
function js(value) {
  return JSON.stringify(value, null, 2).replace(/\n/g, "\n  ");
}

const outFile = path.join(
  __dirname,
  "..",
  "chatbot-widget",
  "app",
  "js",
  "chat-router-data.js"
);

const content =
  "/**\n" +
  " * chat-router-data.js — datos del router de intención (port de chat_router v2 en Deluge).\n" +
  " *\n" +
  " * Script clásico UMD (sin ES modules): expone window.ChatRouterData en el browser y\n" +
  " * module.exports en Node (los tests usan require). NO contiene lógica: solo tablas.\n" +
  " *\n" +
  " * GENERADO por tools/emit-chat-router-data.js desde deluge/core/chat_router.deluge.\n" +
  " * No editar a mano: para cambiar las tablas, edita el Deluge y regenera.\n" +
  " */\n" +
  "(function (root, factory) {\n" +
  '  if (typeof module === "object" && module.exports) {\n' +
  "    module.exports = factory();\n" +
  "  } else {\n" +
  "    root.ChatRouterData = factory();\n" +
  "  }\n" +
  '})(typeof self !== "undefined" ? self : this, function () {\n' +
  '  "use strict";\n\n' +
  "  // Umbrales del router (port de chat_router.router_config()).\n" +
  "  var CONFIG = " + js(config) + ";\n\n" +
  "  // Textos de smalltalk (port de chat_router.smalltalk_texts()).\n" +
  "  var SMALLTALK = " + js(smalltalk) + ";\n\n" +
  "  // Tabla de keywords por tool (port de chat_router.keyword_table()).\n" +
  "  // Convención de cada entrada: \"palabra\" | \"frase\" | \"raiz*\" | \"!kw=peso\" (resta).\n" +
  "  var KEYWORDS = " + js(keywords) + ";\n\n" +
  "  // Tipos de servicio canónicos (port de chat_router.service_type_table()).\n" +
  "  var SERVICE_TYPES = " + js(serviceTypes) + ";\n\n" +
  "  // Periodos soportados (port de chat_router.period_table()).\n" +
  "  var PERIODS = " + js(periods) + ";\n\n" +
  "  // Alias de país (port de chat_router.place_alias_table()).\n" +
  "  var PLACE_ALIASES = " + js(placeAliases) + ";\n\n" +
  "  // Catálogo de lugares — objeto MUTABLE que el widget rellena en runtime con\n" +
  "  // los registros de Creator (Commercial_Office / Coverage_Location). Si queda\n" +
  "  // vacío, el router degrada igual que con gazetteer vacío.\n" +
  "  var PLACES = { offices: [], cities: [], countries: [] };\n\n" +
  "  // Descripciones de una línea por tool (port de chat_router.tool_blurbs()).\n" +
  "  var TOOL_BLURBS = " + js(toolBlurbs) + ";\n\n" +
  "  // Ejemplos por tool para el prompt de elección (port de chat_router.tool_examples()).\n" +
  "  var TOOL_EXAMPLES = " + js(toolExamples) + ";\n\n" +
  "  return {\n" +
  "    CONFIG: CONFIG,\n" +
  "    SMALLTALK: SMALLTALK,\n" +
  "    KEYWORDS: KEYWORDS,\n" +
  "    SERVICE_TYPES: SERVICE_TYPES,\n" +
  "    PERIODS: PERIODS,\n" +
  "    PLACE_ALIASES: PLACE_ALIASES,\n" +
  "    PLACES: PLACES,\n" +
  "    TOOL_BLURBS: TOOL_BLURBS,\n" +
  "    TOOL_EXAMPLES: TOOL_EXAMPLES,\n" +
  "  };\n" +
  "});\n";

fs.writeFileSync(outFile, content, "utf8");

console.log(
  "[emit-chat-router-data] OK → " +
    path.relative(process.cwd(), outFile) +
    " (" +
    Object.keys(keywords).length +
    " tools con keywords, " +
    serviceTypes.length +
    " service types, " +
    periods.length +
    " periodos, " +
    placeAliases.length +
    " alias de país)"
);
