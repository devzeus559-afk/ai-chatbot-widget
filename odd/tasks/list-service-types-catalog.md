# Feature: list-service-types-catalog

## Objective

"¿Cuáles servicios ofrecen?" / "¿Qué servicios tienen?" debe responder con el **catálogo de tipos de servicio** que ofrece la agencia (determinístico, sin Zia ni base de datos), no con el listado de registros `Service` prestados a clientes.

## Background / Problem

- Hoy `keyword_search_tool` (chat_intent.deluge:453-455) y la regla SEARCH de `build_tool_prompt` (chat_intent.deluge:175) mapean cualquier "servicios" → `search_services`.
- Con params vacíos, `search_services({})` → `fetch_services_all()` → devuelve TODOS los registros de clientes (s01234, s05432...) formateados por `format_services`.
- Los 7 tipos reales del módulo (dump): `Package Receipt`, `Locker`, `Store`, `Remittance`, `Recharge`, `Online Store`, `Other Services`.

## Solution (variante A — elegida por el usuario)

Nuevo tool determinista `list_service_types`: devuelve el catálogo estático de tipos de servicio, sin Zia ni data_access. Routing desambiguado:

- Pregunta de catálogo ("qué servicios ofrecen", "qué servicios tienen", "tipos de servicio", "servicios disponibles") → `list_service_types`
- Búsqueda con filtro ("servicios de paquetería a Madrid") → `search_services` (sin cambios)

## Scope / Constraints

- `search_services` NO cambia su comportamiento.
- Todos los archivos en `deluge/` — código Deluge, sin runner local. Verificación: revisión estática + checks manuales en Creator.
- Formato de respuesta en español (igual que `format_services`).
- El tool registrado en `chat_config`: tools, taxonomy SEARCH, toolsByCategory, paramSchema — para que `built_tool_prompt` (vía toolsTextByCategory) y `normalize_tool` lo reconozcan.
- commit: conventional, `feat(deluge): ...`, branch develop.

## Checklist

- [x] T-1 Register `list_service_types` in chat_config.deluge (tools list + taxonomy SEARCH + toolsByCategory + paramSchema)
- [x] T-2 Create tool file `deluge/tools/tool_service_types.deluge` with `map chat_tools.list_service_types(map params)` returning static catalog {type, label} sin Zia ni datos
- [x] T-3 Add dispatch case in chat_invoke.deluge `dispatch_tool`
- [x] T-4 Add `format_service_types` in chat_common.deluge + `compose_reply` case
- [x] T-5 Update `keyword_search_tool` disambiguation (catalog → list_service_types) y regla SEARCH de `build_tool_prompt`
- [x] T-6 Update tests_chat_intent.deluge (keyword "¿Qué servicios tienen?" → list_service_types; add "servicios de paquetería a Madrid" → search_services)
- [x] T-7 Add test list_service_types en tests_native_data_access.deluge (ok=true, 7 entries, contains "Package Receipt")
- [x] T-8 Static verification + manual Creator checks list

## Verification evidence

- Writer self-verification (general agent): brace balance BALANCED en los 6 archivos Deluge editados/nuevo (chat_intent tiene desigualdad pre-existente en strings/comentarios, delta de mi diff balanceado); name/file mapping confirmado; grep list_service_types 19 ocurrencias intencionales.
- Parent spot check: simulación JS del keyword fallback — 8 casos: catálogo → list_service_types (3), filtro → search_services (4), sin keyword → null (1). ALL PASS. Braces chat_intent 266/265 (pre-existente).
- Assess nativo RDD: risk medium (razón: executable_change en creatorapp-backup/Logistic_Management_II.ds — dump del usuario, NO se commitea). Gate medium → writer self-verification + spot check completos.

## Manual Creator checks (pendientes del usuario)

1. "¿cuáles servicios ofrecen?" → debe responder con el catálogo de 7 tipos ("Ofrecemos estos tipos de servicio: 1. Paquetería (Package Receipt)...").
2. "¿Qué servicios tienen?" → catálogo, NO registros de clientes (s01234...).
3. "¿Qué servicios de paquetería hay a Madrid?" → search_services filtrado.
4. "¿Qué servicio tienen para remesas a Colombia?" → search_services filtrado (singular + tipo).
5. tests_native_data_access.run_tools_services() → incluye test_list_service_types (ok=true, 7 entries, primero Package Receipt).

## Work units

- [x] Commit 1: 4853b66 feat(deluge): add deterministic list_service_types catalog tool (branch feat/list-service-types)