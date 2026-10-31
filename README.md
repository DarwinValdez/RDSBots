# AI Betting Analyst

Plataforma de inteligencia deportiva que combina datos reales (API-Sports, The Odds API), modelos estadísticos cuantitativos validados y Claude para explicar los resultados. **Las probabilidades salen siempre del modelo estadístico; Claude solo interpreta y explica.** Si una fuente no está configurada, la interfaz lo indica: no se generan datos simulados.

> Herramienta de análisis, no un operador de apuestas. +18. Ninguna predicción es segura.

---

## 1. Arquitectura

```
                 ┌────────────── Vercel ──────────────────────────────────────┐
 Navegador ──►   │ proxy.ts (redirige a /setup si falta configuración)         │
                 │ App Router (Server Components)  ──► servicios (server-only)│
                 │ Route Handlers /api/*  (zod + rate limit + logs)            │
                 │ Vercel Cron ──► /api/cron/[job] (Bearer CRON_SECRET)        │
                 └───────┬───────────────┬────────────────┬───────────────────┘
                         │               │                │
                 Supabase Postgres   API-Sports /     Claude API
                 (service role)      The Odds API     (explicación + chat con tools)
```

Flujo de datos:

1. **sync-fixtures** — calendario y resultados por liga desde API-Sports → `teams`, `matches`.
2. **sync-odds** — cuotas de The Odds API → enlaza eventos con partidos (equipos + hora, fuzzy matching con alias) → guarda solo los precios que cambian en `odds_snapshots` (historial = movimiento de cuotas y línea de cierre). Los torneos de tenis se descubren automáticamente.
3. **predict** — reentrena un modelo por competición (`model_runs`, con backtest walk-forward diario) y **registra una sola vez** la predicción de cada selección de línea principal de los partidos dentro de la ventana configurada (`predictions`).
4. **settle** — resultados de competiciones sin proveedor estadístico (tenis) vía The Odds API, liquida predicciones (ganada / perdida / anulada / medio ganada / medio perdida), registra cuota de cierre y CLV.

Las vistas (dashboard, value bets, partido, parlays) calculan **en vivo** con el último modelo y las últimas cuotas; el historial muestra únicamente las predicciones registradas antes del inicio.

## 2. Estructura de carpetas

```
supabase/migrations/0001_init.sql   Esquema, triggers de integridad, RLS, seeds
src/proxy.ts                        Redirección a /setup sin configuración (Next 16 "proxy")
src/app/
  (app)/dashboard                   Dashboard principal con filtros deporte/liga/fecha
  (app)/sports/[sport]              Sección por deporte
  (app)/matches/[id]                Análisis completo + explicación con Claude
  (app)/value-bets                  Value Bet Finder (ordenable, filtrable)
  (app)/parlay                      Constructor de parlays con correlación
  (app)/history                     Historial, ROI, yield, win rate, CLV, calibración
  (app)/chat                        Asistente IA con herramientas de la plataforma
  (app)/admin/*                     Panel admin (APIs, ligas, ajustes, modelos, logs)
  api/cron/[job]                    Jobs programados
  api/{chat,parlay,matches/[id]/analysis,admin/*}
  setup, legal                      Estado de configuración, aviso legal
src/lib/
  model/        Núcleo cuantitativo puro (sin I/O) + tests
    grid.ts       Distribuciones conjuntas de marcador (Poisson/Dixon–Coles, NB, normal bivariada, binaria)
    ratings.ts    Ajuste ataque/defensa con decaimiento temporal y shrinkage
    elo.ts        Elo para tenis
    markets.ts    Liquidación por celda (1X2, totals, hándicap asiático, BTTS), EV
    odds.ts       Probabilidad implícita, margen, de-vig de Shin, pooling logarítmico, CLV
    engine.ts     Precio de selecciones: prob. estimada/implícita, margen, EV, edge, confianza
    parlay.ts     Probabilidad conjunta exacta en el mismo evento
    backtest.ts, metrics.ts  Validación walk-forward, Brier, log loss, calibración
  providers/    Clientes HTTP (timeout, reintentos, registro de consumo y cuota restante)
  services/     Sync, jobs, predicción/liquidación, análisis de partido, rendimiento, ajustes, rate limit, logs
  ai/           Claude: explicación de partidos y chat con tool use
  supabase/     Cliente service role (solo en servidor)
src/components/ UI (tarjetas, tablas, gráficos Recharts, formularios admin)
```

## 3. Base de datos

| Tabla | Contenido |
|---|---|
| `profiles` | Rol (`user`/`admin`), estado, confirmación +18 y términos. Se crea por trigger al registrarse. |
| `sports`, `leagues` | Catálogo; IDs de API-Sports y claves de The Odds API por competición. |
| `teams`, `team_aliases` | Equipos/jugadores y alias aprendidos al enlazar feeds. |
| `matches` | Partidos con estado y marcador (fútbol: 90 minutos). |
| `odds_snapshots` (+ vista `latest_odds`) | Cada cambio de precio por casa/mercado/selección/línea. |
| `model_runs` | Parámetros ajustados por competición + métricas de backtest. |
| `predictions` | Registro inmutable: prob. del modelo, del mercado y final, cuota, casa, margen, EV, edge, confianza; liquidación, cierre, CLV, beneficio. |
| `ai_analyses` | Caché de explicaciones (hash de la entrada). |
| `app_settings` | Módulos, parámetros del modelo, frecuencias, regiones/mercados. |
| `api_usage`, `error_logs`, `activity_logs`, `job_runs`, `rate_limits` | Operación y auditoría. |

**Integridad del historial** (trigger `guard_predictions`, aplica también al service role): no se puede insertar una predicción después del inicio del evento; los campos originales son inmutables; el resultado se escribe una sola vez; no se pueden borrar filas. Índice único por selección y línea.

**RLS**: lectura de datos deportivos para usuarios autenticados; escritura solo con service role (jobs/rutas admin verificadas). Logs y consumo solo para admins. Un usuario no puede cambiar su rol, estado ni email (trigger). `check_rate_limit` solo es ejecutable por el service role.

## 4. Configuración

Variables (ver `.env.example`). Todas salvo las `NEXT_PUBLIC_*` son solo de servidor.

| Variable | Uso |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | URL del proyecto |
| `SUPABASE_SERVICE_ROLE_KEY` | Acceso a datos desde el servidor (nunca llega al navegador) |
| `API_SPORTS_KEY` | API-Football, Basketball (NBA), Baseball (MLB), American Football (NFL), Hockey (NHL) |
| `ODDS_API_KEY` | Cuotas (h2h, totals, spreads) y resultados de tenis |
| `ANTHROPIC_API_KEY`, `CLAUDE_MODEL` (opcional, por defecto `claude-opus-5-5`) | Explicaciones y chat |
| `CRON_SECRET` | Autenticación de Vercel Cron |

Pasos:

1. Crear el proyecto en Supabase y ejecutar `supabase/migrations/0001_init.sql` (SQL editor o `supabase db push`).
2. Configurar las variables en Vercel e importar el repositorio. `vercel.json` define los cron (el plan Hobby solo permite cron diarios; usa Pro o lanza los procesos desde el panel admin).
3. Abrir la app (entra directo, sin login) → Panel admin → revisar temporadas de cada liga → **Importar temporadas históricas** (añade antes temporadas en «Históricas») → **Sincronizar cuotas** → **Entrenar modelos y registrar predicciones**.

Desarrollo local: `npm install`, `cp .env.example .env.local`, `npm run dev`. Tests: `npm test`. Tipos: `npm run typecheck`.

## 5. Metodología estadística

- **Fútbol**: Poisson con corrección Dixon–Coles (ρ por máxima verosimilitud). **MLB/NHL**: binomial negativa (sobredispersión por momentos; Poisson si no hay). **NBA/NFL**: normal bivariada discretizada (σ y correlación de residuos). **Tenis**: Elo con K decreciente.
- Ratings multiplicativos de ataque/defensa con ventaja local, ajustados por punto fijo de máxima verosimilitud ponderada, **decaimiento exponencial** (vida media configurable) y shrinkage hacia la media.
- Todos los mercados y los parlays del mismo partido se derivan de **una única distribución conjunta de marcadores**, por lo que la correlación entre selecciones es exacta (no se asume independencia). Entre partidos distintos sí se asume, y se indica.
- **Mercado**: margen = Σ1/cuota − 1; probabilidades sin margen por el método de **Shin**, promediadas entre casas. La probabilidad final es un **pool logarítmico** modelo/mercado (peso configurable; 0 = solo modelo).
- **EV** por unidad, exacto con devoluciones y medias apuestas de líneas asiáticas; EV > 0 ⇔ prob. > 1/cuota.
- **Confianza** (baja/media/alta): tamaño de muestra efectivo de ambos equipos, discrepancia con el consenso y número de casas. Nunca se marca como value una selección de confianza baja.
- **Validación**: backtest walk-forward (reajuste semanal solo con datos previos) contra un modelo de frecuencias base: Brier, log loss, error de calibración y skill. En producción se mide con las predicciones registradas: ROI, yield, win rate, CLV, Brier y diagrama de fiabilidad.
- Definiciones con stake plano de 1u: **yield** = beneficio / volumen apostado; **ROI** = beneficio / bankroll de referencia (configurable); **CLV** = cuota tomada / mejor cuota de cierre − 1.

## 6. Claude

- `explainMatch`: recibe el JSON del análisis (modelo, mercados, forma 5/10, local/visitante, descanso, H2H, movimiento de cuotas, lesiones cuando API-Football las tiene) con reglas que prohíben inventar datos o probabilidades. Resultados en caché.
- Chat: bucle de tool use sobre herramientas de la plataforma (`list_matches`, `get_value_bets`, `analyze_match`, `compare_odds`, `model_performance`, `soccer_player_stats`); si una herramienta no devuelve datos, el asistente lo dice.
- Pensamiento adaptativo, `effort` medio (análisis) / bajo (chat) y fallback de rechazo del lado del servidor (`fallbacks: "default"`).

## 7. Acceso y seguridad

**Sin login**: la app abre directamente en el dashboard y cualquier visitante tiene acceso completo, incluido el panel de administración (ejecutar procesos, cambiar ajustes). Si despliegas en una URL pública, protégela a nivel de hosting, por ejemplo con **Vercel Deployment Protection** (contraseña o acceso solo para tu cuenta de Vercel); si no, cualquiera con la URL podría consumir tus cuotas de API y de Claude.

Se mantienen: claves solo en servidor (`server-only`) y redactadas en los logs, rate limiting por IP en Postgres (chat, análisis IA, parlays, procesos manuales), validación con zod, cabeceras de seguridad, errores sin detalles internos, registro de actividad y errores, y RLS activado (sin sesión, el navegador no puede leer la base de datos; el servidor usa la service role). El cron sigue protegido con `CRON_SECRET`. Las tablas `profiles`/roles del esquema quedan sin uso, por si en el futuro se reactiva la autenticación.

## 8. Limitaciones conocidas del MVP

- BTTS se calcula con el modelo, pero las cuotas BTTS requieren el endpoint por evento de The Odds API (no incluido para ahorrar cuota), así que no se evalúa EV en ese mercado.
- El modelo de tenis se construye con los resultados que la plataforma va registrando (The Odds API solo ofrece 3 días de resultados), por lo que necesita tiempo para tener muestra; mientras tanto se indica «historial insuficiente».
- Lesiones: solo fútbol (API-Football). Estadísticas individuales: máximos goleadores por liga.
- Ligas sin `API_SPORTS_KEY` funcionan en modo «solo cuotas» (fixtures desde The Odds API); si después se añade la clave, conviene reiniciar esas ligas para evitar duplicados.
- No se ha probado todavía contra un proyecto de Supabase real ni contra las APIs con claves reales: el esquema y los triggers se validaron en PostgreSQL 16 y el motor estadístico con tests unitarios.
