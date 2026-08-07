# Widget de chat IA — Zoho Creator (Zia Assistant)

Chat widget para agencia internacional de **paquetería, remesas y recargas telefónicas**.
Se embebe en una app de Zoho Creator y responde con datos reales de la aplicación
(seguimiento de paquetes, servicios, oficinas, cobertura, contactos) **sin consumir
llamadas a API de Creator desde el frontend**: el backend corre en Deluge (server-side)
con la tarea `Zia`, y el widget se comunica por la Client API con un patrón de job asíncrono.

## Quick path

1. Reemplazar los link names reales: `appName` en `LM2Chatbot/app/widget.html` (`CONFIG`,
   solo para la Client API del widget). El backend Deluge usa **acceso nativo a datos**
   (`Form[criterio]`, `insert into`) y ya NO necesita `appName` ni `zoho.creator.*`.
2. En la consola de Creator: habilitar la tarea Zia de Deluge (Zoho GenAI recomendado).
3. Crear los 3 módulos de persistencia (`ChatSessions`, `ChatMessages`, `ChatRequests`)
   según el esquema del README del backend.
4. Pegar las funciones Deluge (una por cada definición de `deluge/`) y crear el workflow
   On Submit de `ChatRequests`.
5. Embeber `LM2Chatbot/app/widget.html` en la app y probar un mensaje de seguimiento.

## Arquitectura

```
Widget (Client API)                    Creator (server-side)
─────────────────────                  ─────────────────────
addRecord(ChatRequests)  ───────────▶  On Submit workflow
   { Session_ID, Prompt }               │
                                        ├─ chat_invoke(requestId)
   │                                    │     ├─ get_or_create_session()
   │                                    │     ├─ create_message(user)
   │                                    │     ├─ chat_intent()          ← tarea Zia (sin API Creator)
   │                                    │     │     └─ {tool,params} | {answer} | {clarify}
    │                                    │     ├─ dispatch_tool()        ← switch a tool_*
    │                                    │     │     └─ data_access (fetch/insert nativo server-side)
    │                                    │     ├─ compose_reply()        ← plantilla o Zia
   │                                    │     └─ create_message(ai) + update_session()
   │                                    │
poll(Status: pending→answered|failed) ◀─┘     Respuesta en ChatRequests.Reply
```

Principios de diseño:

- **Sin API de Creator desde el widget**: solo Client API (CRUD) y polling.
- **Job asíncrono**: el widget crea `ChatRequests`; el workflow On Submit ejecuta
  `chat_invoke`; el widget hace polling del `Status` (timeout 45 s).
- **Zia como router, no como clasificador**: la tarea Zia devuelve JSON estricto
  (`{"tool","params"}` / `{"answer"}` / `{"clarify"}`) y Deluge hace el `switch`.
- **Composición por plantilla por defecto**: `composeWithAI: false` → respuestas
  deterministas baratas (el timeout de Zia es 40 s).

## Estructura del repo

| Ruta | Contenido |
|---|---|
| `LM2Chatbot/app/widget.html` | Widget completo (UI + sidebar de historial + adapter Client API) |
| `LM2Chatbot/` | Paquete de la extensión Zoho (app, server, manifest) — sin scripts Deluge |
| `deluge/README.md` | Setup del backend: esquema de módulos, funciones, mapeo de campos |
| `deluge/config/chat_config.deluge` | Configuración central: link names, campos, catálogo de 5 tools |
| `deluge/core/` | `data_access` (acceso nativo a datos), `chat_common` (helpers), `chat_intent` (router Zia), `chat_invoke` (orquestador), `chat_list` (índice server-side) |
| `deluge/tools/` | `tool_track_package`, `tool_services`, `tool_offices`, `tool_coverage`, `tool_contacts` |
| `deluge/workflow/` | `on_submit_chatrequests.deluge` (script del workflow) |

## Flujo del widget (historyStore)

| Modo | Cuándo | Comportamiento |
|---|---|---|
| `server` | `ZOHO.CREATOR.API` disponible (dentro de Creator) | sidebar desde `ChatSessions`; hilos desde `ChatMessages`; envío = `addRecord(ChatRequests)` + polling |
| `local` | fuera de Creator (preview) | `localStorage` + respuesta simulada |

El borrado de una conversación elimina sesión + mensajes + requests en servidor.
El título de sesión (primer prompt) lo fija el servidor y el widget lo refresca tras
cada intercambio. La Client API no invoca funciones custom: `chat_list()` del backend
queda como helper server-side para otros consumidores.

## Configuración (checklist)

- [ ] `CONFIG.appName` en `widget.html` con el link name real (solo Client API del widget; el backend es acceso nativo, sin `appName`)
- [ ] Módulos de negocio: validar que los `*Fields` de `chat_config()` coinciden con el esquema real
- [ ] Módulos de chat creados según el esquema del `deluge/README.md`
- [ ] Funciones Deluge creadas con el MISMO nombre que en los archivos
- [ ] Workflow On Submit en `ChatRequests` con el script del backend
- [ ] Tarea Zia habilitada con Zoho GenAI

## Seguridad y límites

- **PII**: la tarea Zia envía el prompt (incluido historial) al LLM. Con Zoho GenAI los
  datos no salen de la organización; con LLM externos sí. `tool_contacts` devuelve PII:
  solo exponerla si el LLM es GenAI o el caso de uso lo justifica.
- **Timeout**: Zia devuelve en máx 40 s; el widget espera 45 s por polling.
- **Throttling**: Zoho GenAI permite 7 requests simultáneas por usuario y 10 por org;
  el widget bloquea envíos mientras hay una respuesta en vuelo.
- **Límites de lectura**: acceso nativo con `range` — 200 registros en listados de negocio,
  50 en contactos, 10 (más recientes) en historial.
- **`ChatRequests` acumula** un registro por mensaje; depurar periódicamente.

## Estado

| Pieza | Estado |
|---|---|
| Widget frontend (sidebar + thinking + adapter) | ✅ committeado en `develop` |
| Backend Deluge (config, core, tools, workflow) | ✅ committeado en `develop` (3 commits por capa) |
| Review externo de fiabilidad del backend | ⏭️ omitido por decisión del usuario (riesgo asumido) |
| Prueba dentro de Zoho Creator | 🔲 pendiente — valida supuestos de Client API y sintaxis Deluge |

## Next step

Configurar la app en Zoho Creator (checklist de arriba) y probar el primer mensaje.
Ante cualquier error de despliegue, ajustar `chat_config()` o el adapter del widget.
