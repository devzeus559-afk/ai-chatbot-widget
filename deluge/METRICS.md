# Metrics — ai-chatbot-widget

Métricas de marketing sobre `Service` (ventana `Date_field1`, `Sender_field` remitente, `Service_Type`, `Price`).

| Métrica | Descripción breve | Estado |
|---|---|---|
| **report_top_customers** | Clientes más frecuentes (top N por cantidad de servicios en últimos 30 días). `serviceType` **obligatorio** como `List<string>` con ≥1 elemento (solo Locker, Store, Recharge, Online Store, Other Services). Falta/vacío/string → `{"ok":false,"kind":"clarify"}`. Multi-tipo = unión de IDs por tipo (`addAll`) + `intersect` con ventana. Ranking `count desc` con desempate por `firstDate` más antigua. `truncated` según path (`full=false` acota a 200; default recorre la ventana hasta el tope de 400). Paquetería → `report_top_package_customers`; remesas → `report_top_remittance_customers`. | **Implementada** — `deluge/tools/tool_report_top_customers.deluge` + `data_access:fetch_services_*_by_date_window` materializado `List<Map>` |
| **report_top_customers_by_revenue** | Top por ingresos (top N por suma `Price` USD en 30/60 días). Mismo filtro `serviceType`. | Propuesta — reusa ventana + `sum(Price)` por sender |
| **report_service_mix** | Mix por tipo (conteo y % por `Service_Type` en 30 días). | Propuesta |
| **report_top_destinations** | Top destinos (top N ciudades `City` por volumen en 30 días, opcional `serviceType`). | Propuesta |
| **report_repeat_rate** | Tasa de repetición (% clientes con ≥2 servicios en 30 días + lista). | Propuesta |
| **report_avg_ticket** | Ticket promedio por tipo (`avg = sum Price / count` por `Service_Type`). | Propuesta |
| **report_inactive_customers** | Inactivos (con servicio en 31-90 días y 0 en últimos 30). Params `inactiveDays`/`lookbackDays`. | Propuesta — 2 ventanas + diferencia `prev \ recent` |
| **report_vip_customers** | VIP (umbral `minRevenue`/`minCount` en 60-90 días, ranking por `totalRevenue`). | Propuesta — extiende top_by_revenue |

**Arquitectura:** `chat_data_access` materializa `Service[Date_field1>=...]`, `Service[Service_Type==...]` y `r.Price`/`r.City`/`r.Sender_field` a `List<Map>` (dot notation dentro del fetch, por `Invalid collection` cross-namespace); `chat_tools` consume keys lógicas y filtra/agrupa en memoria; `chat_intent` decide `params` con/sin `serviceType` según catálogo. Límite Creator `range 0-199`: los rankings de clientes sobre `Service` recorren la ventana por defecto con cursor sobre `ID` en lotes de 200 (`fetch_all_services_report_by_ids`), **acotados a `service_scan_batches` × 200 = 400 servicios** por el techo de sentencias de Deluge; `full=false` cae a la cohorte de 200. El flag `truncated` de los tres rankings sale de `service_scan_truncated` (no de `report_scan_truncated`, compartido con paquetes, cuyo tope sigue siendo 25 lotes = 5000). Ninguno de los dos fetchers de reporte precarga el catálogo de referencias (`prefetch_service_refs`): los tres tools de ranking solo consumen `customerId`/`date`/`serviceType` (+`totalWeight`/`amount`) de cada fila.

## Techo de sentencias de Deluge (por qué el ranking es acotado)

Deluge limita la cantidad de sentencias **ejecutadas** por ejecución (~5000 en el plan base;
plan-dependent). Cada vuelta de un `for each` vuelve a contar todas las sentencias de su
cuerpo, así que un loop sobre N registros multiplica su costo por N. Los rankings de
clientes sobre `Service` cuestan ~25 sentencias por registro (materializar + agregar), así
que una cohorte de miles agota el presupuesto **dentro de `chat_invoke`**: el On Submit no
llega a persistir `Status="failed"`, el `ChatRequest` queda en `pending` para siempre y el
widget muestra su cartel de timeout a los 45 s. Ese es el fallo que el tope evita.

El tope vive en un solo lugar: `chat_data_access.service_scan_batches()` (hoy **`8`** lotes = **1.600 servicios**). Lo leen el fetcher y el chequeo de `truncated`.

**Techo medido en esta cuenta: 40.000 sentencias** (probado con la sonda; 40.000 completó, 50.000 excedió). Fórmula aplicada: `floor(40.000 / 25 / 200) = 8` lotes. Con este tope, la cohorte máxima de 1.500 paquetes/mes queda cubierta completa (`1.500 < 1.600`), `truncated = false` en ambos paths (global y filtrado por oficina), y los rankings son comparables.

### Sonda para medir el techo real de la cuenta

El techo depende del plan y no está expuesto en ningún lado, así que hay que medirlo. Crear
una función temporal en Creator (Functions → New), correrla una vez desde el editor y subir
la longitud del contador (`4999` → `9995` → `49995`…) hasta que Creator tire *"Number of
statement execution limit exceeded"*. El último valor que completa es, aproximadamente, el
techo de sentencias de la cuenta:

```
int prueba_limite_sentencias()
{
  veces = 0;
  contador = leftpad("1",4999).replaceAll(" ","1,").toList(",");
  for each  idx in contador
  {
    veces = veces + 1;
  }
  return veces;
}
```

Con el techo medido, el tope se recalcula dejando margen para el resto del flujo
(sesión, mensajes, formateo y el insert final comparten el mismo presupuesto):

```
service_scan_batches = techo / 25 / 200     // 25 sentencias por registro, 200 por lote
```

Ejemplo: si el techo medido fuera 5000, el tope correcto es `5000 / 25 / 200 = 1` lote (200
servicios); con 50000 daría `10` lotes (2000 servicios). Subir `service_scan_batches` sin
medir reintroduce exactamente el cuelgue de 45 s.
