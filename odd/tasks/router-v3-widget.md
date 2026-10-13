# Feature: router-v3-widget — port del router de intención a JS en el widget

## Objetivo
Mover la capa de reglas del router de intención v2 (Deluge, `feature/router-v2:deluge/core/chat_router.deluge`) a JavaScript puro en el widget, eliminando el límite de 5000 statements por función en Zoho Creator y habilitando tests offline en Node.

## Problema
`has_kw` revienta “statement execution limit exceed” en Creator. El router Deluge gasta miles de statements por mensaje y comparte presupuesto con el resto de `chat_invoke`.

## Por qué (decisión aprobada)
Mudar la lógica pura de ruteo (normalizar → extraer → puntuar → decidir → params) al cliente. Deluge solo valida/sanea/Zia. El widget envía la decisión en el campo nuevo `Route_Hint` de `ChatRequests`.

## Alcance
- Port completo de las 35 funciones de `chat_router.deluge` a `chat-router.js` (UMD).
- Tablas estáticas en `chat-router-data.js` (generado por `tools/emit-chat-router-data.js`).
- Golden set 46 casos + tests Node nativos.
- Integración: `widget.html` (scripts topológicos), `config.js`, `creator-api.js` (`Route_Hint`), `store.js`, `app.js` (routePrompt + fetchPlaces con caché sessionStorage 24h).
- Fuera de alcance (pendiente, backend): consumir `Route_Hint` en `chat_invoke`, sanitizar params (snake_case), guardar `Tool_Last`/`Params_Last` en `ChatSessions`.

## Restricciones
- UMD, sin ES modules (server de desarrollo usa `require`).
- Sin dependencias; sin tocar `package-lock.json`; sin tocar `deluge/**` en esta rama; sin tocar `.gga/`.
- Comentarios en español, consistentes con el widget.

## Checklist

- [x] T1: Emitir `chat-router-data.js` desde el Deluge (script `tools/emit-chat-router-data.js`)
- [x] T2: Portar lógica a `chatbot-widget/app/js/chat-router.js` (UMD, `ChatRouter.route`)
- [x] T3: Golden set 46 casos + `router.test.js` (node --test) → 8/8 pass
- [x] T4: Integrar en `widget.html` (scripts), `config.js`, `creator-api.js`, `store.js`, `app.js`
- [x] T5: `fetchPlaces()` con caché sessionStorage 24h (offices + coverage)
- [x] T6: `.gitignore` → ignorar `.gga` (pendiente de sesión anterior)

## Verificación
- `node --test test/router.test.js` (desde `chatbot-widget/`) → 8 tests, 8 pass, 0 fail.
- `node --check` en todos los JS nuevos/modificados → OK.
- `git status` confirma que `package-lock.json` quedó sin cambios.

## Decisiones del port (notables)
- `normalizeText` pliega `ñ→n` (igual que Deluge) para que matcheen aliases (`espana`=Spain).
- `finalizeParams` NO resuelve period→fechas: deja `needsResolve: true` (server-side con `chat_common.resolve_period`).
- `apply_report_scan_mode` se omite (server-side).
- Los follow-ups devuelven `via: "followup"` con historial (el Deluge solo chequeaba el tool string).
- Los params del golden usan camelCase (`trackingNumber`, `serviceType`) — el backend Deluge espera snake_case; mapear en la integración Deluge.

## Próximos pasos (fuera de esta rama)
- Backend: consumir `Route_Hint` en `chat_invoke` (validar whitelist, sanear params, Zia si `via` es dudoso).
- Esquema: campo `Route_Hint` (Long Text) en `ChatRequests` + `Tool_Last`/`Params_Last` en `ChatSessions`.
- Verificar link names reales de `officesReport`/`coverageReport` si difieren en Creator.