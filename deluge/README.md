# Backend Deluge — Chatbot Zia Assistant

Backend del widget de chat para agencia internacional de **paquetería, remesas y recargas telefónicas**.

Se define en Deluge y se pega en la app de **Zoho Creator**. No consume llamadas a API de Creator:
usa la tarea `Zia` de Deluge (solo disponible en Creator) y acceso a datos **server-side** vía
`zoho.creator.*`, que NO es una llamada de API desde el widget.

---

## Arquitectura

```
Widget (Client API)                Creator (server-side)
───────────────────                ─────────────────────
createRecord(ChatRequests)  ───▶   On Submit workflow
   { Session_ID, Prompt }            │
                                     ├─ chat_invoke(requestId)
                                     │     ├─ get_or_create_session()
                                     │     ├─ create_message(user)
                                     │     ├─ chat_intent()          ← Zia task (sin API Creator)
                                     │     │     └─ {tool,params} | {answer} | {clarify}
                                     │     ├─ dispatch_tool()        ← switch a tool_*
                                     │     │     └─ zoho.creator.getRecords (server-side)
                                     │     ├─ compose_reply()        ← plantilla o Zia
                                     │     └─ create_message(ai) + update_session()
                                     │
poll(getRecord: Status)  ◀───   Status: pending → answered | failed
```

## Estructura de carpetas

```
deluge/
├── README.md                  ← este archivo
├── config/
│   └── chat_config.dg         ← configuración central (link names + catálogo de tools)
├── core/
│   ├── chat_common.dg         ← helpers: criterios, parseo JSON robusto, formato de respuestas
│   ├── chat_intent.dg         ← router: Zia task → JSON de intención
│   ├── chat_invoke.dg         ← orquestador + persistencia de sesión/mensajes
│   └── chat_list.dg           ← índice de conversaciones para la sidebar
├── tools/
│   ├── tool_track_package.dg  ← estado de paquete por tracking number
│   ├── tool_services.dg       ← servicios disponibles (filtros opcionales)
│   ├── tool_offices.dg        ← oficinas comerciales (ciudad/país)
│   ├── tool_coverage.dg       ← cobertura de países/proveedores por servicio
│   └── tool_contacts.dg       ← búsqueda de contactos (remitente/receptor)
└── workflow/
    └── on_submit_chatrequests.dg  ← script del workflow On Submit de ChatRequests
```

## Funciones a crear en Creator (una por cada definición del archivo)

| Archivo | Funciones |
|---|---|
| `chat_config.dg` | `chat_config` |
| `chat_common.dg` | `append_criteria`, `parse_json_strict`, `compose_reply`, `format_tracking`, `format_services`, `format_offices`, `format_coverage`, `format_contacts` |
| `chat_intent.dg` | `chat_intent`, `build_intent_prompt` |
| `chat_invoke.dg` | `chat_invoke`, `resolve_reply`, `dispatch_tool`, `compose_with_ai`, `get_or_create_session`, `create_message`, `get_recent_history`, `update_session` |
| `chat_list.dg` | `chat_list` |
| `tools/*.dg` | `tool_track_package`, `tool_services`, `tool_offices`, `tool_coverage`, `tool_contacts` |

> El nombre de la función en el editor de Creator debe coincidir EXACTAMENTE con el nombre
> definido en el archivo (por ejemplo, crear la función `chat_invoke`, no `chat_invoke.dg`).

## Requisitos previos

1. **Habilitar la tarea Zia de Deluge**: en Creator → *Operations* → *Zia* → habilitar
   *Deluge Zia task* y seleccionar el LLM (Zoho GenAI recomendado: sin rate limits de vendor,
   y los datos no se usan fuera de la organización).
2. **Crear los 3 módulos de persistencia**:

   **ChatSessions**
   | Campo | Tipo | Notas |
   |---|---|---|
   | Session_ID | Texto | único; lo genera el widget (`crypto.randomUUID`) |
   | Title | Texto | título auto-generado desde el primer prompt |
   | User | Lookup → Users | dueño de la conversación |
   | Last_Activity | DateTime | para ordenar la sidebar |

   **ChatMessages**
   | Campo | Tipo |
   |---|---|
   | Session | Lookup → ChatSessions |
   | Role | Dropdown: user / ai |
   | Content | Multilínea |

   **ChatRequests**
   | Campo | Tipo | Notas |
   |---|---|---|
   | Session_ID | Texto | mismo id de sesión |
   | Prompt | Multilínea | mensaje del usuario |
   | Status | Dropdown: pending / processing / answered / failed | default: pending |
   | Reply | Multilínea | respuesta generada |
   | Error | Multilínea | mensaje de error si falla |

3. **Crear las funciones** listadas arriba pegando el contenido de cada archivo.

4. **Crear el workflow "On Submit"** en el módulo `ChatRequests` con el script de
   `workflow/on_submit_chatrequests.dg`.

## Configuración

Abrir `config/chat_config.dg` y reemplazar los **link names** por los reales de tu app.
Los link names se ven en la URL del módulo/form dentro de Creator (por ejemplo
`https://creator.zoho.com/.../form/Package` → link name `Package`).

### Mapeo asumido de campos de negocio (AJUSTAR)

El backend asume esta estructura para los módulos de negocio. Si tu esquema difiere,
cambia los valores en `chat_config()` (sección `*Fields`) — el código no cambia.

| Módulo | Campo asumido | Uso |
|---|---|---|
| `Package` | `Tracking_Number`, `Status`, `Origin`, `Destination`, `Current_Location`, `Estimated_Delivery` | seguimiento |
| `Service` | `Service_Name`, `Service_Type`, `Price`, `Currency`, `Description`, `Estimated_Time`, `Origin` (opcional), `Destination` (opcional) | catálogo de servicios |
| `Commercial_Office` | `Office_Name`, `Address`, `City`, `Country`, `Phone`, `Business_Hours` | oficinas |
| `Coverage_Location` | `Country`, `Vendor`, `Service_Type`, `Details` | cobertura por proveedor |
| `Contacts` | `Full_Name`, `Phone`, `Email`, `Document_Number`, `Role` | remitente/receptor |

## Seguridad y límites (leer)

- **PII y datos sensibles**: la tarea `Zia` envía el prompt (incluido el historial) al LLM.
  Con **Zoho GenAI** los datos no se usan fuera de tu organización. Con LLM externos
  (OpenAI/Gemini/Anthropic) la data sale a ese proveedor — evita enviar PII innecesaria
  y considera no incluir documentos personales en el historial si usas un LLM externo.
  Fuente: doc oficial de la tarea Zia (zoho.com/deluge/help/ai-tasks/zia-task.html).
- **Timeout**: la tarea Zia devuelve en máximo **40 s**. El workflow completo debe ser ágil;
  por eso la composición por plantilla (`composeWithAI: false`) es el default.
- **Throttling**: con Zoho GenAI, **7 requests simultáneas por usuario y 10 por organización**.
  El widget ya bloquea el envío mientras hay una respuesta en vuelo.
- **Scoping por usuario**: si un módulo es privado por usuario, pon el link name del campo
  lookup a Users en `ownerFields` de `chat_config()` (p. ej. `"contacts": "Owner"`) y las
  tools añadirán el filtro automáticamente.
- **Límite de registros**: `getRecords` devuelve máximo 200; `getAllRecords` pagina
  automáticamente (máx 200 por página).

## Conexión con el widget (implementada)

El widget (`LM2Chatbot/app/widget.html`) tiene el adapter `historyStore` con dos capas:

- **server** (default cuando corre dentro de Creator): usa la **Client API** (`ZOHO.CREATOR.API`)
  para leer `ChatSessions`/`ChatMessages` y crear `ChatRequests` con polling de `Status`
  (job asíncrono → workflow On Submit → `chat_invoke`).
- **local** (vista previa / fuera de Creator): fallback a `localStorage` con respuesta simulada.

**Desviación de diseño**: el widget NO usa `chat_list()` — la Client API no puede invocar
funciones custom; lee `ChatSessions` directamente (el scoping por usuario lo aplican los
permisos de Creator, no una consulta). `chat_list()` queda como helper server-side para
otros consumidores (páginas de Creator, integraciones).

**Configuración en el widget**: en `LM2Chatbot/app/widget.html` → `CONFIG`:
`appName` (REPLACE_WITH_APP_LINK_NAME — mismo link name que en `chat_config.dg`) y los
nombres de módulo `ChatSessions`/`ChatMessages`/`ChatRequests`.

**Flujo de envío**: `sendMessage()` → `addRecord(ChatRequests, {Session_ID, Prompt})` →
polling cada 1.5 s (timeout 45 s) sobre el `ChatRequests` más reciente de la sesión
(ordenado por `Created_Time` desc) hasta `Status == answered|failed` → la respuesta es
`Reply` (o `Error`).

**Notas**:
- El borrado de una conversación borra `ChatSessions` + `ChatMessages` + `ChatRequests`
  del servidor (varias llamadas `deleteRecord`).
- `ChatRequests` acumula un registro por mensaje; se pueden depurar periodicamente.
- El título de la sesión (primer prompt) lo fija el servidor; el widget lo refresca
  con `refreshSessions()` tras cada intercambio.
- Los mensajes multilínea del backend se renderizan gracias a `white-space: pre-wrap`
  en `.message`.
