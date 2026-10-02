# 🐸 TINY TOADS — Arcade Slot Demo

> **Videojuego ficticio de demostración.** Solo créditos virtuales.
> Sin dinero real, sin apuestas reales, sin pagos, retiros ni integración con casinos.

Una tragamonedas arcade 5×3 ambientada en un pantano tropical de fantasía, protagonizada por una
familia original de sapitos: **Pip, Bubbles, Ember, Mystic y Goldie**.

Estética: *Premium Cartoon Tropical Swamp* — cartoon 3D glossy, outlines gruesos, colores saturados,
iluminación de arcade y magia contenida.

## Ejecutar

Sin dependencias ni build. Cualquier servidor estático:

```bash
python3 -m http.server 8080
# abre http://localhost:8080
```

Añade `#debug` a la URL para ver en consola los hooks visuales de audio.

Controles: **SPIN** (o `Espacio`/`Enter`), **AUTO** (10 giros), **TURBO**, apuesta −/+, info (tabla de pagos), ajustes (calidad, reducir movimiento, reset de créditos).

## Arquitectura

| Capa | Tecnología | Archivos |
|---|---|---|
| Layout / HUD / botones / jackpots / modales | HTML + CSS (tokens de diseño) | `index.html`, `css/` |
| Fondo animado (3 capas independientes) | Canvas 2D procedural | `src/background.js` |
| Reels 5×3 (aceleración, blur simulado, desaceleración, bounce, settle, anticipación) | Canvas 2D | `src/reels.js` |
| Partículas (pool fijo de 180) | Canvas 2D | `src/particles.js` |
| Personajes (poses bitmap + estados procedurales) | `<img>` + CSS keyframes | `src/characters.js`, `css/animations.css` |
| Resultado y evaluación (10 líneas, wild, scatter, bonus) | JS puro | `src/outcome.js`, `src/config.js` |
| Orquestación, niveles de victoria, responsive | JS (ES Modules) | `src/main.js` |
| Bus de eventos para sincronizar audio después | JS | `src/events.js` |

**Responsive:** escenario de diseño 1280×720 escalado a cualquier viewport (1920×1080, 1366×768, tablet, móvil horizontal) manteniendo siempre visibles reels, SPIN, saldo y apuesta.

**Rendimiento:** sin librerías; `devicePixelRatio` cap 2; ajuste de calidad (alta/media/baja) que reduce partículas, elementos de fondo y la tasa de redibujado del fondo; assets web optimizados (símbolos 128 px, personajes 256 px) con versiones HD cargadas en idle.

## Assets

```
assets/
  characters/{green,blue,red,purple,gold}/   tiny_toad_<color>_<pose>.png (+ web/)
  symbols/                                   symbol_<id>.png (+ web/)
  logo/  icons/                              SVG + PNG
  _raw/                                      láminas fuente (gitignored)
tools/process_assets.py                      chroma-key, slicing, sheets, resize
docs/ART_DIRECTION.md                        biblia de arte, paleta, tipografía, composición
docs/ASSET_MANIFEST.md                       inventario y pendientes
```

Todos los personajes, símbolos, UI y branding son **originales**.
