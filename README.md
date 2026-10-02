# Lumen Studio

Entorno profesional de edición y ejecución de scripts **Lua 5.4** y **Luau**, con motores reales
(sin simulaciones), editor CodeMirror 6, análisis de tipos de Luau, consola, gestión de archivos en
disco, temas, plugins y API REST + eventos en vivo.

```
Navegador (interfaz)  ──HTTP/SSE──>  Servidor Node (API, motores, almacenamiento)
        │                                     │
        └── Web Workers (Luau WASM / Lua 5.4 WASM) ── ejecución en la propia pestaña
```

## Requisitos

- **Node.js 20.10 o superior** (probado con Node 22).
- Un navegador actual (Chrome/Edge/Firefox/Safari recientes) para la interfaz.
- Opcional: `electron` para la ventana de escritorio (arrastrar/minimizar/maximizar).
- Opcional: intérpretes `luau` / `lua5.4` en el `PATH` para los motores nativos.

## Instalación y arranque

```bash
npm install     # dependencias (CodeMirror, esbuild, @luau-rs/luau, wasmoon)
npm start       # compila la interfaz y arranca el servidor
```

Luego abre **http://localhost:4173/**.

Opciones útiles:

```bash
npm start -- --port 8080            # otro puerto
npm start -- --data-dir /ruta/datos # otro directorio de datos
npm run dev                         # arranque con recompilación automática (watch)
npm run build                       # solo compilar la interfaz y verificar artefactos
npm run doctor                      # diagnóstico real del entorno (capacidades, motores, rutas)
npm run setup                       # comprobar dependencias y motores
npm run setup -- --native           # intentar compilar el intérprete nativo de Luau
npm test                            # pruebas (node:test)
npm run clean                       # borrar lo generado (public/build, public/vendor)
npm run desktop                     # ventana de escritorio (requiere electron instalado)
```

## Qué hace hoy (verificado)

| Área | Estado |
| --- | --- |
| Servidor + API REST + SSE | Operativo. Arranque 10/10 pasos, errores tipados con traza. |
| Motor Luau (`@luau-rs/luau`, WASM) | Operativo en servidor (worker_thread) y en el navegador (Web Worker). |
| Motor Lua 5.4 (`wasmoon`, WASM) | Operativo en servidor (proceso hijo terminable) y en el navegador. |
| Analizador Luau | Tipos, lint y autocompletado reales, expuestos por `/api/editor/analysis/*`. |
| Scripts en disco | CRUD real con escritura atómica, respaldos, papelera e historial. |
| Ajustes y temas | Validados contra un esquema único; escritura atómica y todo o nada. |
| Almacenamiento | Directorio de datos real (configurable con `LUMEN_DATA_DIR`). |
| Consola, pestañas, diálogos, menús, atajos, notificaciones | Implementados sobre datos reales. |
| Módulos del editor (CM6) | Implementados con resaltado, plegado, autocompletado, búsqueda y minimapa. |

Limitaciones detectadas y reportadas (no simuladas): portapapeles del servidor, ventana nativa sin
Electron e intérpretes nativos ausentes. Aparecen como *no disponibles* con el motivo concreto en
`/api/capabilities` y en la sección **Ajustes → Almacenamiento**.

> Estado del ensamblado: el servidor, los motores y la capa de servicios están completos y
> verificados; el módulo `src/app/App.js` que monta las vistas sobre el DOM está en construcción.
> Mientras se termina, la API y los motores ya son utilizables (`/api/health`,
> `/api/runtime/execute`, `/api/editor/analysis/check`).

## Datos y privacidad

Todo se guarda en el directorio de datos (`data/` dentro del proyecto por defecto):

```
data/scripts/     scripts .luau/.lua (fuente de verdad)
data/meta/        ajustes, sesión, disposición, índice
data/themes/      temas personalizados
data/backups/     copias previas a cada sobrescritura
data/trash/       scripts eliminados (recuperables)
data/logs/        registros rotados
data/plugins/     plugins instalados por el usuario
```

Nada sale de tu máquina: no hay telemetría ni peticiones a servicios externos. La única conexión
opcional es la comprobación de red (`storage.checkNetwork`, desactivada por defecto).

## Estructura

```
src/shared/     constantes, errores, protocolo, esquema de ajustes, temas, preludio Lua
src/server/     servidor HTTP, API, SSE, servicios (almacenamiento, scripts, plugins…), motores
src/renderer/   cliente de API, SSE, kernel, ajustes, temas, notificaciones, atajos, runtime
src/editor/     EditorManager, CompletionManager, Formatter, SyntaxHighlighter, SearchManager, minimapa
src/features/   ScriptManager, ConsoleManager
src/ui/         iconos, diálogos, menús, barra de estado
src/app/        controladores de la aplicación (pestañas, runtime, vistas)
src/desktop/    integración con la ventana nativa
scripts/        start, build, doctor, setup, clean
tests/          pruebas con node:test
```

## Licencia

MIT.
