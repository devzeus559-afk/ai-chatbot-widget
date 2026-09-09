# Metrics — ai-chatbot-widget

Métricas de marketing sobre `Service` (ventana `Date_field1`, `Sender_field` remitente, `Service_Type`, `Price`).

| Métrica | Descripción breve | Estado |
|---|---|---|
| **report_top_customers** | Clientes más frecuentes (top N por cantidad de servicios en últimos 30 días). `serviceType` **obligatorio** como `List<string>` con ≥1 elemento (solo Locker, Store, Recharge, Online Store, Other Services). Falta/vacío/string → `{"ok":false,"kind":"clarify"}`. Multi-tipo = unión de IDs por tipo (`addAll`) + `intersect` con ventana. Ranking `count desc` con desempate por `firstDate` más antigua. `truncated` si intersección >200. Paquetería → `report_top_package_customers`; remesas → `report_top_remittance_customers`. | **Implementada** — `deluge/tools/tool_report_top_customers.deluge` + `data_access:fetch_services_*_by_date_window` materializado `List<Map>` |
| **report_top_customers_by_revenue** | Top por ingresos (top N por suma `Price` USD en 30/60 días). Mismo filtro `serviceType`. | Propuesta — reusa ventana + `sum(Price)` por sender |
| **report_service_mix** | Mix por tipo (conteo y % por `Service_Type` en 30 días). | Propuesta |
| **report_top_destinations** | Top destinos (top N ciudades `City` por volumen en 30 días, opcional `serviceType`). | Propuesta |
| **report_repeat_rate** | Tasa de repetición (% clientes con ≥2 servicios en 30 días + lista). | Propuesta |
| **report_avg_ticket** | Ticket promedio por tipo (`avg = sum Price / count` por `Service_Type`). | Propuesta |
| **report_inactive_customers** | Inactivos (con servicio en 31-90 días y 0 en últimos 30). Params `inactiveDays`/`lookbackDays`. | Propuesta — 2 ventanas + diferencia `prev \ recent` |
| **report_vip_customers** | VIP (umbral `minRevenue`/`minCount` en 60-90 días, ranking por `totalRevenue`). | Propuesta — extiende top_by_revenue |

**Arquitectura:** `chat_data_access` materializa `Service[Date_field1>=...]`, `Service[Service_Type==...]` y `r.Price`/`r.City`/`r.Sender_field` a `List<Map>` (dot notation dentro del fetch, por `Invalid collection` cross-namespace); `chat_tools` consume keys lógicas y filtra/agrupa en memoria; `chat_intent` decide `params` con/sin `serviceType` según catálogo. Límite Creator `range 0-199` → `truncated` cuando `count>200`.
