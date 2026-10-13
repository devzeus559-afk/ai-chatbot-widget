/**
 * router.test.js — suite del router de intención (port JS del chat_router Deluge).
 *
 * Runner NATIVO de Node (`node --test test/router.test.js`), sin dependencias.
 * Porta los 46 casos golden de `deluge/core/tests_chat_router.deluge`
 * (rule_case) + los unit tests de normalize/has_kw/extract/build_params/parse_choice.
 *
 * El gazetteer de prueba replica `tests_chat_router.test_gaz()` para no tocar
 * datos reales; el router recibe los lugares por argumento.
 */

"use strict";

const { test } = require("node:test");
const assert = require("node:assert");

const ChatRouter = require("../app/js/chat-router.js");
require("../app/js/chat-router-data.js"); // asegura el módulo de datos (mismo require que el router)
const golden = require("./golden.json");

// Gazetteer de prueba (idéntico a tests_chat_router.test_gaz()).
const TEST_GAZ = {
  offices: ["Elizabeth", "Miami", "Tampa"],
  cities: [
    "Miami",
    "New Jersey",
    "Tampa",
    "Madrid",
    "Barcelona",
    "La Habana",
    "Bogotá",
    "Buenos Aires",
  ],
  countries: ["Cuba", "Colombia", "Argentina", "Spain", "United States", "Mexico"],
};

// --------------------------------------------------------------------------
// Golden set: 46 casos {prompt, history, expected}
// --------------------------------------------------------------------------
test("golden set: via/tool/params/candidates por caso", () => {
  assert.ok(Array.isArray(golden) && golden.length === 46, "el golden debe tener 46 casos");

  for (const c of golden) {
    const res = ChatRouter.route(c.prompt, {
      places: TEST_GAZ,
      history: c.history || [],
    });

    assert.strictEqual(res.via, c.expected.via, "[" + c.id + "] via");
    assert.strictEqual(res.tool, c.expected.tool, "[" + c.id + "] tool");
    assert.deepStrictEqual(res.params, c.expected.params, "[" + c.id + "] params");

    if (Object.prototype.hasOwnProperty.call(c.expected, "candidates")) {
      assert.deepStrictEqual(res.candidates, c.expected.candidates, "[" + c.id + "] candidates");
    }
  }
});

// --------------------------------------------------------------------------
// Unit tests (port de tests_chat_router.run_unit)
// --------------------------------------------------------------------------
test("unit: normalize_text — acentos, signos, bordes", () => {
  assert.strictEqual(
    ChatRouter.normalizeText("¿Qué MERCANCÍA envían?"),
    " que mercancia envian "
  );
});

test("unit: has_kw — palabra completa y raíces", () => {
  assert.strictEqual(ChatRouter.hasKw(" paquetes de marzo ", "mar"), 0);
  assert.strictEqual(ChatRouter.hasKw(" por mar ", "mar"), 1);
  assert.strictEqual(ChatRouter.hasKw(" cajas demorados ", "demora*"), 1);
  assert.strictEqual(ChatRouter.hasKw(" search ", "sea"), 0);
  assert.strictEqual(
    ChatRouter.hasKw(ChatRouter.normalizeText("OFICINAS en Miami"), "oficina*"),
    1
  );
});

test("unit: extract_tracking", () => {
  assert.strictEqual(
    ChatRouter.extractTracking("Rastrea mi paquete ABC123456"),
    "ABC123456"
  );
  assert.strictEqual(ChatRouter.extractTracking("Dónde está P-123456?"), "P-123456");
  assert.strictEqual(ChatRouter.extractTracking("hola, quiero rastrear"), "");
});

test("unit: extract_entities — limit/period/types/office/place/country", () => {
  const p = ChatRouter.normalizeText(
    "top 5 clientes de recargas el mes pasado en la oficina Tampa"
  );
  const e = ChatRouter.extractEntities(
    "top 5 clientes de recargas el mes pasado en la oficina Tampa",
    p,
    TEST_GAZ
  );
  assert.strictEqual(e.limit, "5");
  assert.strictEqual(e.period, "mes_anterior");
  assert.strictEqual(e.types[0], "Recharge");
  assert.strictEqual(e.office, "Tampa");
  assert.strictEqual(e.place, "");

  const p2 = ChatRouter.normalizeText("servicios de tienda online a Madrid");
  const e2 = ChatRouter.extractEntities("servicios de tienda online a Madrid", p2, TEST_GAZ);
  assert.strictEqual(e2.types[0], "Online Store");
  assert.strictEqual(e2.types.length, 1, "'online store' no debe generar además 'Store'");
  assert.strictEqual(e2.place, "Madrid");

  const p3 = ChatRouter.normalizeText("oficinas en USA");
  const e3 = ChatRouter.extractEntities("oficinas en USA", p3, TEST_GAZ);
  assert.strictEqual(e3.country, "United States");
});

test("unit: build_params + validate_required", () => {
  const p4 = ChatRouter.normalizeText("Busca el contacto Juan Pérez teléfono 5551234");
  const e4 = ChatRouter.extractEntities(
    "Busca el contacto Juan Pérez teléfono 5551234",
    p4,
    TEST_GAZ
  );
  const bp = ChatRouter.buildParams(
    "find_contacts",
    e4,
    p4,
    "Busca el contacto Juan Pérez teléfono 5551234"
  );
  assert.strictEqual(bp.name, "Juan Pérez");
  assert.strictEqual(bp.phone, "5551234");

  const p = ChatRouter.normalizeText(
    "top 5 clientes de recargas el mes pasado en la oficina Tampa"
  );
  const e = ChatRouter.extractEntities(
    "top 5 clientes de recargas el mes pasado en la oficina Tampa",
    p,
    TEST_GAZ
  );
  const bp2 = ChatRouter.buildParams(
    "report_top_customers",
    e,
    p,
    "top 5 clientes de recargas el mes pasado en la oficina Tampa"
  );
  assert.strictEqual(bp2.serviceType[0], "Recharge");
  assert.strictEqual(bp2.limit, "5");
  assert.strictEqual(bp2.office, "Tampa");

  const reqTxt = ChatRouter.validateRequired("track_package", {});
  assert.ok(reqTxt !== "", "track_package sin número debe pedir el seguimiento");
});

test("degradación: catálogo vacío no explota y cae a llm_*", () => {
  const emptyGaz = { offices: [], cities: [], countries: [] };
  // Prompt sin keywords ni lugares → llm_all, sin excepción.
  const r1 = ChatRouter.route("xyzzy plugh foobar", { places: emptyGaz, history: [] });
  assert.strictEqual(r1.via, "llm_all");
  assert.strictEqual(r1.tool, "");

  // Prompt de reporte sin datos de lugares sigue resolviendo por keyword.
  const r2 = ChatRouter.route("cajas demoradas", { places: emptyGaz, history: [] });
  assert.strictEqual(r2.via, "rule");
  assert.strictEqual(r2.tool, "report_delayed_packages");

  // Sin opciones (ni places ni history) tampoco debe romper.
  const r3 = ChatRouter.route("gracias");
  assert.strictEqual(r3.via, "smalltalk");
});

test("unit: parse_choice", () => {
  const opts = ["find_offices", "check_coverage"];
  assert.strictEqual(ChatRouter.parseChoice("2", opts), "check_coverage");
  assert.strictEqual(ChatRouter.parseChoice("1.", opts), "find_offices");
  assert.strictEqual(ChatRouter.parseChoice("3", opts), "ninguna");
  assert.strictEqual(ChatRouter.parseChoice("Respuesta: check_coverage", opts), "check_coverage");
  assert.strictEqual(ChatRouter.parseChoice("no se", opts), "");
});
