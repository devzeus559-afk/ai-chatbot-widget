# Feature: router-v3-widget — port del router de intención a JS en el widget

## Objetivo
Mover la capa de reglas del router de intención v2 (Deluge, `feature/router-v2:deluge/core/chat_router.deluge`) a JavaScript puro en el widget, eliminando el límite de 5000 statements por función en Zoho Creator y habilitando tests offline en Node. El backend Deluge consume la decisión del widget (`Route_Hint`) y solo valida/sanea/cae a Zia.

## Problema
`has_kw` revienta “statement execution limit exceed” en Creator. El router Deluge gasta miles de statements por mensaje y comparte presupuesto con el resto de `chat_invoke`.

## Por qué (decisión aprobada)
Mudar la lógica pura de ruteo (normalizar → extraer → puntuar → decidir → params) al cliente. Deluge solo valida/sanea/Zia. El widget envía la decisión en el campo nuevo `Route_Hint` de `ChatRequests`.

## Alcance
- Port completo de las 35 funciones de `chat_router.deluge` a `chat-router.js` (UMD).
- Tablas estáticas en `chat-router-data.js` (generado por `tools/emit-chat-router-data.js`).
- Golden set 46 casos + tests Node nativos.
- Integración widget: `widget.html` (scripts topológicos), `config.js`, `creator-api.js` (`Route_Hint`), `store.js`, `app.js` (routePrompt + fetchPlaces con caché sessionStorage 24h).
- Integración backend (en esta rama): `chat_invoke` consume `Route_Hint` (whitelist + saneamiento + followups vía `Tool_Last`/`Params_Last`), `data_access` expone `Route_Hint`/`Tool_Last`/`Params_Last` en sus proyecciones.

## Restricciones
- UMD, sin ES modules (server de desarrollo usa `require`).
- Sin dependencias; sin tocar `package-lock.json`; sin tocar `.gga/`.
- `Route_Hint` es propuesta NO confiable del cliente: el server solo la usa si `via ∈ {rule, followup}` y la tool pasa la whitelist; si no, cae a Zia intacto.
- Comentarios en español, consistentes con el widget.

## Checklist

- [x] T1: Emitir `chat-router-data.js` desde el Deluge (script `tools/emit-chat-router-data.js`)
- [x] T2: Portar lógica a `chatbot-widget/app/js/chat-router.js` (UMD, `ChatRouter.route`)
- [x] T3: Golden set 46 casos + `router.test.js` (node --test) → 8/8 pass
- [x] T4: Integrar en `widget.html` (scripts), `config.js`, `creator-api.js`, `store.js`, `app.js`
- [x] T5: `fetchPlaces()` con caché sessionStorage 24h (offices + coverage)
- [x] T6: `.gitignore` → ignorar `.gga`
- [x] T7: Backend — `chat_invoke.resolve_hint(request, session)` consume `Route_Hint` (whitelist `config.tools`, saneamiento espejo de `normalize_params`, `period`→fechas vía `chat_common.resolve_period`, followup fusiona `Tool_Last`/`Params_Last`)
- [x] T8: Backend — `chat_invoke.persist_last_intent` + `chat_invoke.params_to_json` (serializador JSON propio; `Map.toString()` no es JSON)
- [x] T9: Backend — `data_access` proyecciones exponen `Route_Hint` (requests) y `Tool_Last`/`Params_Last` (sessions)

## Verificación
- Widget: `node --test test/router.test.js` (desde `chatbot-widget/`) → 8 tests, 8 pass, 0 fail; `node --check` en todos los JS.
- Backend: revisión estática (balance de llaves/paréntesis; firma de cada `thisapp.chat_*` verificada contra su fuente) + `node tools/creator-parity.js` → las 3 funciones nuevas + `chat_invoke.chat_invoke` + 3 proyecciones figuran como "in repo, not in live" / "different bodies" (pendiente de desplegar en Creator).
- Manual en Creator (pendiente de deploy): enviar un ChatRequest con tracking X y verificar Status→answered; follow-up con la misma sesión reutiliza `Tool_Last`.

## Decisiones (notables)
- **Contrato de params = camelCase en ambos lados.** El JS emite `trackingNumber`/`serviceType`/`destCountry`/`period` y los tools Deluge esperan exactamente eso (`normalize_params` en `chat_intent.deluge`). NO hay mapeo snake→camel: la suposición inicial del plan (que el backend Deluge espera snake_case) quedó descartada al inspeccionar el código real.
- `normalizeText` pliega `ñ→n` (igual que Deluge) para que matcheen aliases (`espana`=Spain).
- `finalizeParams` NO resuelve period→fechas: deja `needsResolve: true`; el server lo quita y resuelve con `chat_common.resolve_period` (alias `mes pasado`→`mes_anterior`, etc.), guardando fechas como string `yyyy-MM-dd` (los tools comparan `sd != ""`; un DATE rompería esa comparación).
- `params_to_json` serializa números y numeric-strings como strings citados: en Deluge `isText("123") == false`, indistinguible, y los tools requieren TEXT para `limit != ""`. Booleanos reales (`full`) van sin comillas (`isText(boolean) == null`).
- **Proyecciones de `data_access` NO incluían los campos nuevos**, así que el patrón de `resolve_hint`/followup primero intenta `request/session.get(...)` y, si es null, hace un lookup del registro enlazado (`ChatRequests[ID == reqId].Route_Hint`). Con T9 las proyecciones ya los exponen y ese fallback queda como no-op defensivo (sin costo extra).
- Followup: si la sesión tiene `Tool_Last`, ese tool es la base (el `hint.tool` se ignora como defensa) y los params del hint pisan a `Params_Last`; si el hint trae `period` nuevo sin fechas explícitas, se descartan `startDate`/`endDate` heredados.
- Requeridos deterministas: `track_package` sin `trackingNumber` → cae a Zia; `report_top_customers` sin `serviceType` lista ≥1 → cae a Zia.
- `apply_report_scan_mode` se omite (server-side).

## Próximos pasos
- Desplegar en Creator: `chat_invoke` (+3 funciones nuevas) y las 3 proyecciones de `data_access` (celdas implicadas: `fetch_chat_requests_by_id`, `fetch_chat_sessions_by_id`, `fetch_chat_sessions_by_session_id`). Deployar callers y callees juntos.
- Verificar manualmente en Creator: mensaje con tracking → tool directa sin Zia; follow-up reutiliza params; `via` dudoso cae a Zia.
- Verificar link names reales de `officesReport`/`coverageReport` si difieren en Creator.
- Re-exportar el `.ds` tras el deploy y re-correr `creator-parity`.