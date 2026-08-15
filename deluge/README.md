# Backend Deluge — Chatbot Zia Assistant

Backend del widget de chat para agencia internacional de **paquetería, remesas y recargas telefónicas**.

Se define en Deluge y se pega en la app de **Zoho Creator**. No consume llamadas a API de Creator:
usa la tarea `Zia` de Deluge (solo disponible en Creator) y **acceso nativo a datos server-side**
(sintaxis `Form[Field == valor]`, `insert into` y mutación en memoria vía `deluge/core/data_access.deluge`),
sin ninguna llamada `zoho.creator.*` — 0 llamadas externas y 0 Developer API por turno de chat.

**Patrón de filtrado (gate 5.1)**: `Form[criteriaVar]` (criterio como variable de texto) es INVÁLIDO
en Creator. El filtrado usa pares explícitos (campo literal, valor variable) con tres ramas:
0 condiciones → `Form[ID != 0]`; 1 condición → igualdad inline `Form[Field == valor]`; 2+ condiciones
(AND) → IDs por condición (`Form[Field == valor].ID.getAll()`), `addAll` en el primero e `intersect`
en los siguientes, guard de lista vacía y fetch final `Form[ID in targetIDs]`. La tarea Zia se
invoca con la sintaxis oficial SIN comas (cada parámetro nombrado en su propia línea).

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
                                     │     │     └─ data_access (fetch/insert nativo server-side)
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
│   └── chat_config.deluge     ← configuración central (link names + catálogo de tools)
├── core/
│   ├── chat_common.deluge     ← helpers: parseo JSON robusto, composición y formato de respuestas
│   ├── data_access.deluge     ← acceso nativo a datos (fetch/insert/mutate; helpers tipados con campos literales; 0 llamadas zoho.creator.*)
│   ├── chat_intent.deluge     ← router: Zia task → JSON de intención
│   ├── chat_invoke.deluge     ← orquestador + persistencia de sesión/mensajes
│   └── chat_list.deluge       ← índice de conversaciones para la sidebar
├── tools/
│   ├── tool_track_package.deluge  ← estado de paquete por tracking number
│   ├── tool_services.deluge       ← servicios disponibles (filtros opcionales)
│   ├── tool_offices.deluge        ← oficinas comerciales (ciudad/país)
│   ├── tool_coverage.deluge       ← cobertura de países/proveedores por servicio
│   ├── tool_contacts.deluge       ← búsqueda de contactos (remitente/receptor)
│   └── tool_report_top_customers.deluge ← clientes más frecuentes (top N, ventana fija de 30 días)
└── workflow/
    └── on_submit_chatrequests.deluge  ← script del workflow On Submit de ChatRequests
```

## Funciones a crear en Creator (una por cada definición del archivo)

| Archivo | Funciones |
|---|---|
| `chat_config.deluge` | `chat_config` |
| `chat_common.deluge` | `parse_json_strict`, `compose_reply`, `format_tracking`, `format_services`, `format_offices`, `format_coverage`, `format_contacts`, `format_top_customers` |
| `data_access.deluge` | `fetch_chat_requests_by_id`, `fetch_chat_sessions_by_session_id`, `fetch_chat_sessions_by_id`, `fetch_chat_sessions_by_user`, `insert_chat_session`, `fetch_chat_messages_by_session`, `insert_chat_message`, `fetch_packages_by_tracking`, `fetch_services_ids_by_type/_by_destination`, `fetch_services_by_ids`, `fetch_services_all`, `fetch_services_count_by_date_window/_ids_by_date_window/_by_date_window`, `fetch_offices_by_ids`, `fetch_offices_all`, `fetch_coverage_by_ids`, `fetch_coverage_all`, `fetch_vendors_ids_by_type/_by_name`, `fetch_vendors_by_ids`, `fetch_vendors_all`, `fetch_contacts_ids_by_full_name/phone/document`, `fetch_contacts_by_ids`, `fetch_contacts_all` |
| `chat_intent.deluge` | `chat_intent`, `build_intent_prompt` |
| `chat_invoke.deluge` | `chat_invoke`, `resolve_reply`, `dispatch_tool`, `compose_with_ai`, `get_or_create_session`, `create_message`, `get_recent_history`, `update_session` |
| `chat_list.deluge` | `chat_list` |
| `tools/*.deluge` | `tool_track_package`, `tool_services`, `tool_offices`, `tool_coverage`, `tool_contacts`, `tool_report_top_customers` (+ helpers `insert_ranked_entry`, `build_empty_report`) |

> El nombre de la función en el editor de Creator debe coincidir EXACTAMENTE con el nombre
> definido en el archivo (por ejemplo, crear la función `chat_invoke`, no `chat_invoke.deluge`).

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
   `workflow/on_submit_chatrequests.deluge`.

## Configuración

Abrir `config/chat_config.deluge` y reemplazar los **link names** por los reales de tu app.
Los link names se ven en la URL del módulo/form dentro de Creator (por ejemplo
`https://creator.zoho.com/.../form/Package` → link name `Package`). El backend ya NO
necesita `appName`: todo el acceso a datos es nativo (no usa `zoho.creator.*`).

### Mapeo asumido de campos de negocio (AJUSTAR)

El backend asume esta estructura para los módulos de negocio. Si tu esquema difiere,
cambia los valores en `chat_config()` (sección `*Fields`) — los mapas `*Fields` se usan
**solo lectura** para mapear la respuesta. Los nombres de campo de las CONSULTAS son
LITERALES en `data_access.deluge`: si renombras un campo en Creator, hay que ajustarlo
en AMBOS sitios (el literal de la consulta en `data_access` y el mapa `*Fields`).

| Módulo | Campo real (link name) | Uso |
|---|---|---|
| `Package` | `Tracking_Number`, `Status` (picklist), `Sender_Address` (address), `City` (texto, destino del receptor) | seguimiento (el historial en vivo está en `Pkg_Tracking`) |
| `Service` | `Service_ID`, `Service_Type` (picklist), `City` (texto, destino), `Vendor` (→ Vendor: Vendor_Type) | catálogo de servicios (no hay Service_Name; el nombre que se muestra es el Service_ID). `Price` (Total Price, USD) EXISTE pero se omitió del mapeo por decisión de producto |
| `Commercial_Office` | `Office_Name` (único), `Address` (compuesto: address_line_1, district_city, state_province, postal_Code, country) | oficinas (city/country se leen de subfields del Address; sin Phone/Business_Hours) |
| `Coverage_Location` | `Location_ID`, `Location_Name`, `Address_Information1` (compuesto: country, state_province, ...) | zonas cubiertas por país/estado |
| `Vendor` | `Vendor_Name`, `Vendor_ID`, `Vendor_Type` (list: Transporter, Freight Forwarder, Remittance, Recharge, Remittance & Recharge), `Active` | proveedores; Vendor_Type cruza con Service.Service_Type |
| `Contacts` | `First_Name` (name: first_name, last_name), `Mobile` (único), `Email`, `DNI`, `Type_field` (Sender/Receiver/Sender & Receiver) | remitente/receptor |

> ⚠️ Los campos de tipo **composite** (`address`, `name`) NO se comparan como un TODO contra un string plano con `Form[campo == valor]`; los SUBCAMPOS sí se usan con dot-syntax en criterios (el propio app usa p. ej. `Contacts[Address.state_province == ...]`) y el filtrado en memoria sobre el subfield es el enfoque determinista elegido en las tools. `check_coverage` conecta geografía (Coverage_Location, country) con proveedores (Vendor, Vendor_Type ↔ Service.Service_Type): Coverage_Location NO tiene vendor/service_type. `Service` no tiene Service_Name y `Package` no tiene Current_Location/Estimated_Delivery; `Service.Price` (Total Price, USD) existe pero se omitió del mapeo por decisión de producto.

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
- **Límite de registros**: acceso nativo con `range from 0 to 199` (200 registros) en los
  listados de negocio, `0 to 49` (50) en contactos y los 10 más recientes en el historial
  del chat (`0 to 9`, orden `Created_Time desc`). `report_top_customers` procesa la ventana
  fija de 30 días acotada a 200 servicios: si el conteo exacto de la ventana supera 200,
  devuelve `truncated: true` y la reply avisa que el ranking es aproximado (se analizaron
  los primeros 200 por fecha de negocio).

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
`appName` ya está configurado con el link name real de la app
(`copy-1-of-logistic-management-ii`; solo lo usa la Client API del widget — el backend
ya NO usa `appName`). Si la app de destino difiere, reemplázalo por el link name real
de esa app. Los nombres de módulo `ChatSessions`/`ChatMessages`/`ChatRequests` deben
mantenerse en sincronía con `chat_config()`.

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
