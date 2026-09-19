# Design: Hierarchical Intent Routing

## 1. Architecture

Replace the single Zia call in `chat_intent()` with a 3-step hierarchical pipeline. Each step narrows the decision space: 5 categories → 1–4 tools → exact params. Short-circuit on `clarify`/`answer` at any stage.

```
Widget ──addRecord(ChatRequests)──▶ On Submit workflow
                                        │
                              chat_invoke (UNCHANGED)
                                        │
                              chat_intent.chat_intent(prompt, history)
                                        │
                    ┌───────────────────┬┴──────────────────────┐
                    │                   │                        │
              resolve_category   resolve_tool             resolve_params
              (5 categories)    (1-4 tools)              (1 tool schema)
                    │                   │                        │
                    ▼                   ▼                        ▼
              Zia Call 1           Zia Call 2               Zia Call 3
              ~6-8s                ~4-6s                    ~4-6s
                    │                   │                        │
                    └───── short-circuit on clarify/answer ─────┘
                                        │
                              {"tool","params"} | {"answer"} | {"clarify"}
                                        │
                              dispatch_tool → compose_reply
```

**Zoho Creator constraints**: 3 Zia calls × ~6–8s = 18–24s, well under the 40s Zia timeout and 45s widget polling. No global Deluge state; each helper starts with `config = chat_config()`.

## 2. Function Signatures

```deluge
// chat_intent.deluge — facade (UNCHANGED signature)
map chat_intent.chat_intent(string userPrompt, list history)

// chat_intent.deluge — stage 1: classify into category
map chat_intent.resolve_category(string userPrompt, list history)
// Returns: {"category": "SEARCH|TRACKING|TOP_CUSTOMERS|PACKAGE_ANALYSIS|OTHER_ANALYSIS"}
//      |   {"answer": "..."}   (greeting / out-of-scope)
//      |   {"clarify": "..."}  (ambiguous)

// chat_intent.deluge — stage 2: pick tool within category
map chat_intent.resolve_tool(string userPrompt, string category, string filteredCatalog)
// Returns: {"tool": "<name>", "params": {...}} | {"clarify": "..."}

// chat_intent.deluge — stage 3: extract exact params
map chat_intent.resolve_params(string userPrompt, string toolName, string paramSchema)
// Returns: {"tool": "<name>", "params": {...}} | {"clarify": "..."}

// chat_common.deluge — period enum → date pair
list chat_common.resolve_period(string periodEnum)
// Returns: [startDate, endDate] (list of 2 dates)
```

## 3. Zia Prompt Templates

### Prompt 1 — Category (resolve_category)

```
CONTRATO DE SALIDA: Devuelve SOLO JSON válido con UNO de estos tres formatos:
1) {"category": "<NOMBRE>"} para clasificar la consulta en una categoría.
2) {"answer": "<texto>"} cuando puedas responder sin consultar datos (saludos, agradecimientos).
3) {"clarify": "<pregunta>"} cuando falte información o la consulta sea ambigua.

CATEGORÍAS DISPONIBLES:
- SEARCH: consultas sobre servicios, oficinas, cobertura o contactos.
- TRACKING: rastreo de paquetes por número de seguimiento.
- TOP_CUSTOMERS: reportes de clientes más frecuentes por tipo de servicio.
- PACKAGE_ANALYSIS: análisis de paquetes (libras, promedio diario, comparación mensual).
- OTHER_ANALYSIS: reportes de frecuencia de envío, tipo de mercancía, demorados, sin escanear.

REGLAS:
- Si el usuario saluda, agradece o pregunta algo general → responde con {"answer": "..."}.
- Si la consulta NO está relacionada con paquetería, remesas, recargas, cobertura, oficinas o contactos → devuelve {"clarify": "Lo siento, solo puedo ayudarte con temas de paquetería, remesas y recargas. ¿En qué puedo asistirte?"}.
- Si la consulta es ambigua entre categorías → devuelve {"clarify": "<pregunta breve>"}.
- NUNCA devuelvas texto fuera del JSON.

HISTORIAL RECIENTE:
{history lines}

MENSAJE ACTUAL DEL USUARIO:
{userPrompt}
```

### Prompt 2 — Tool (resolve_tool)

```
CONTRATO DE SALIDA: Devuelve SOLO JSON válido con UNO de estos dos formatos:
1) {"tool": "<nombre_tool>"} para seleccionar la herramienta exacta.
2) {"clarify": "<pregunta>"} si no puedes determinar qué herramienta usar.

CATEGORÍA: {category}

HERRAMIENTAS DISPONIBLES (solo de esta categoría):
{filteredCatalog — built by chat_config.toolsTextByCategory.get(category)}

REGLAS:
- Elige SOLO una herramienta de la lista de arriba.
- Si el usuario menciona paquetería → considera tools con "paquete" o "package" en el nombre.
- Si el usuario menciona remesas → considera tools con "remittance" en el nombre.
- Si falta un parámetro OBLIGATORIO (trackingNumber, serviceType como lista ≥1), AÚN ASÍ elige la herramienta. No pidas clarify aquí.
- NUNCA devuelvas texto fuera del JSON.

MENSAJE ACTUAL DEL USUARIO:
{userPrompt}
```

### Prompt 3 — Params (resolve_params)

```
CONTRATO DE SALIDA: Devuelve SOLO JSON válido con UNO de estos dos formatos:
1) {"params": {<parámetros>} extraídos del mensaje del usuario.
2) {"clarify": "<pregunta>"} si falta un parámetro obligatorio.

HERRAMIENTA: {toolName}

ESQUEMA DE PARÁMETROS:
{paramSchema — built by chat_config.paramSchema.get(toolName)}

REGLAS CRÍTICAS:
- Si el usuario NO especifica un parámetro opcional, OMÍTELO del JSON (no pases null ni string vacío).
- Si FALTA un parámetro OBLIGATORIO, devuelve {"clarify": "..."} pidiendo solo ese dato.
- Para herramientas con fechas: usa el PERIODO en vez de calcular fechas. Valores válidos: ultimo_mes, mes_anterior, este_mes, ultimos_7_dias.
- Si el usuario da fechas EXPLícitas (startDate/endDate), inclúyelas directamente.
- NUNCA calcules fechas tú mismo. Devuelve el enum de periodo o las fechas que el usuario dio.

MENSAJE ACTUAL DEL USUARIO:
{userPrompt}
```

## 4. chat_config Changes

Four new maps added after the existing `toolsText` builder:

| Map | Key | Value | Purpose |
|-----|-----|-------|---------|
| `taxonomy` | category name | List of tool names | Category → tool list (5 entries) |
| `toolsByCategory` | tool name | category name | Reverse lookup: tool → category |
| `toolsTextByCategory` | category name | formatted text (same pattern as `toolsText`) | Per-category Zia prompt fragment |
| `paramSchema` | tool name | schema text (required/optional + enum) | Per-tool param schema for Call 3 |

**Taxonomy entries**:
```
taxonomy:
  SEARCH: ["search_services", "find_offices", "check_coverage", "find_contacts"]
  TRACKING: ["track_package"]
  TOP_CUSTOMERS: ["report_top_customers", "report_top_package_customers", "report_top_remittance_customers"]
  PACKAGE_ANALYSIS: ["report_pounds_shipped", "report_daily_average", "report_monthly_comparison"]
  OTHER_ANALYSIS: ["report_shipping_type_frequency", "report_merchandise_type", "report_delayed_packages", "report_unscanned_packages"]
```

`toolsTextByCategory` builder reuses the existing loop pattern (`for each t in tools`) filtered by `toolsByCategory.get(t.name) == category`. `toolsText` global is preserved for fallback/compatibility.

`paramSchema` includes `period: enum(ultimo_mes|mes_anterior|este_mes|ultimos_7_dias)` for tools with date params: `report_pounds_shipped`, `report_daily_average`, `report_monthly_comparison`.

## 5. resolve_period Detail

```deluge
list chat_common.resolve_period(string periodEnum)
{
  config = thisapp.chat_config.chat_config();
  today = zoho.currentdate;
  if(periodEnum == "ultimo_mes")
  {
    return [today.subDay(30), today];
  }
  if(periodEnum == "mes_anterior")
  {
    return [thisapp.chat_common.first_of_month(today.addMonth(-1)), thisapp.chat_common.first_of_month(today).subDay(1)];
  }
  if(periodEnum == "este_mes")
  {
    return [thisapp.chat_common.first_of_month(today), today];
  }
  if(periodEnum == "ultimos_7_dias")
  {
    return [today.subDay(7), today];
  }
  // Fallback: últimos 30 días
  return [today.subDay(30), today];
}
```

**Override rule**: If the tool receives explicit `startDate`/`endDate` in params, those take precedence over the period enum. This mirrors the existing `tool_report_pounds_shipped` behavior where `sd/ed != null` overrides defaults.

## 6. Zia Call Contracts (Parsing)

Each stage follows the same pattern:

```deluge
zia_response = zia
[
message:message
context:context
parameters:{"temperature":0.1}
];
// null guard per stage
if(zia_response == null)
{
  return {"clarify": "No pude interpretar tu solicitud. ¿Puedes reformularla?"};
}
response = Map();
response.put("status", zia_response.status);
response.put("data", zia_response.data);
response.put("error", zia_response.error);
```

**Parsing per stage**:
- **Call 1 (category)**: Parse with `parse_json_strict`. Validate key is `category`, `answer`, or `clarify`. Normalize to `{"category":"..."}`, `{"answer":"..."}`, or `{"clarify":"..."}`.
- **Call 2 (tool)**: Parse with `parse_json_strict`. Validate key is `tool`. Validate tool name is in `toolsByCategory` for the given category. Return `{"tool":"...", "params":{}}`.
- **Call 3 (params)**: Parse with `parse_json_strict`. Validate key is `params` or `clarify`. For period-capable tools: if `params.period` exists, call `resolve_period()` and set `startDate`/`endDate`. Return `{"tool":"...", "params":{...}}`.

**`normalize_zia_response`**: Extended to recognize `"category"` as a valid key alongside `"tool"`, `"answer"`, `"clarify"`. Existing tool/answer/clarify logic unchanged.

## 7. File Map

| File | Action | What Changes |
|------|--------|-------------|
| `deluge/core/chat_intent.deluge` | Modify | Facade rewrite + 3 new helpers (`resolve_category`, `resolve_tool`, `resolve_params`) + 3 prompt builders (`build_category_prompt`, `build_tool_prompt`, `build_params_prompt`). `normalize_zia_response` extended for `"category"` key. `build_intent_prompt` kept but no longer used by facade (kept for backward compat with tests). |
| `deluge/config/chat_config.deluge` | Modify | +4 maps: `taxonomy`, `toolsByCategory`, `toolsTextByCategory`, `paramSchema`. `toolsText` preserved. |
| `deluge/core/chat_common.deluge` | Modify | +`resolve_period(string periodEnum)` returning `[startDate, endDate]`. |
| `deluge/core/tests_chat_intent.deluge` | Modify | +`run_live_hierarchical()` (10 cases) + `tests_intent_hierarchical` smoke suite. |
| `deluge/core/chat_invoke.deluge` | **NO CHANGE** | Orchestrator untouched — same `chat_intent(prompt, history)` call. |

## 8. Latency Risk Decision

| Factor | Value | Budget |
|--------|-------|--------|
| Zia Call 1 (5 categories, short prompt) | ~6–8s | |
| Zia Call 2 (1–4 tools, short prompt) | ~4–6s | |
| Zia Call 3 (1 tool schema, short prompt) | ~4–6s | |
| **Total worst-case** | **~20s** | 40s Zia timeout |
| **Total average** | **~15s** | 45s widget polling |

**Mitigations**:
1. **Short-circuit**: greetings/out-of-scope → 1 call (~6s). Tracking → 2 calls (~12s).
2. **Short prompts**: Each prompt is 3–10 lines vs. the current 30+ line monolithic prompt.
3. **Temperature 0.1**: Deterministic routing, no retry overhead.
4. **Null guard per stage**: Any failed Zia call returns generic clarify immediately, no cascading.

## 9. Verification

| Check | Method | Expected |
|-------|--------|----------|
| `chat_invoke.deluge` untouched | `git diff deluge/core/chat_invoke.deluge` | 0 changes |
| No `zoho.creator` API calls | `grep -r "zoho.creator" deluge/core/chat_intent.deluge` | 0 matches |
| Hierarchical smoke (10 phrases) | `tests_chat_intent.run_live_hierarchical()` in Creator | All 10 → correct tool |
| Category routing (5 categories) | Manual: one prompt per category | Each → correct category |
| Short-circuit greeting | Manual: "Hola, ¿cómo estás?" | 1 Zia call, returns answer |
| Null Zia guard | Manual: disable Zia → query | Returns generic clarify |
| Regression first-turn (15 cases) | `tests_chat_intent.run_live_first_turn()` | All existing pass |
| Regression multiturn (6 cases) | `tests_chat_intent.run_live_multiturn()` | All existing pass |
| Period resolution | Unit: `resolve_period("mes_anterior")` on known date | Correct date pair |

## 10. Rollback

`git revert <commit>` — single commit revert. Zero migration steps:
- `chat_config` taxonomy maps removed → old `toolsText` still present.
- `chat_intent` restored to 1 Zia call → `chat_invoke` signature unchanged.
- `chat_common.resolve_period` removed (only used by hierarchical pipeline).

No data migration. No Creator schema changes. No widget changes.

## Open Questions

- None — all design decisions are resolved by the proposal and specs.
