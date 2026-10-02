# TINY TOADS — Asset Manifest

Todos los assets son **originales**, generados para este proyecto bajo la dirección de arte
de `docs/ART_DIRECTION.md`. Fuentes crudas (láminas con fondo chroma magenta) en `assets/_raw/`
(ignoradas por git; se re-cortan con `tools/process_assets.py`).

Leyenda: ✅ bitmap generado · 🧮 procedural (CSS/Canvas/SVG) · ⏳ pendiente de versión bitmap

## /assets/characters — Familia Tiny Toad
| Personaje | Carpeta | idle | happy | shocked | jump | blink | excited | win |
|---|---|---|---|---|---|---|---|---|
| Pip (verde) | `green/` | ✅ | ✅ | ✅ | ✅ | 🧮 squash | 🧮 shake | 🧮 jump↔happy |
| Bubbles (azul) | `blue/` | ✅ | ✅ | ✅ | ✅ | 🧮 | 🧮 | 🧮 |
| Ember (rojo) | `red/` | ✅ | ✅ | ✅ | ✅ | 🧮 | 🧮 | 🧮 |
| Mystic (morado) | `purple/` | ✅ | ✅ | ✅ | ✅ | 🧮 | 🧮 | 🧮 |
| Goldie (dorado) | `gold/` | ✅ | ✅ | ✅ | ✅ | 🧮 | 🧮 | 🧮 |

Formato: `tiny_toad_{color}_{pose}.png` 512×512 HD + `web/` 256×256 optimizado.
Las poses procedurales están en `css/animations.css` (`.anim-*`) y `src/characters.js`.

## /assets/symbols — 19 símbolos (256×256 HD + `web/` 128×128)
| Grupo | Archivos |
|---|---|
| Bajos (madera tallada) | `symbol_ten`, `symbol_j`, `symbol_q`, `symbol_k`, `symbol_a` ✅ |
| Medios (naturaleza) | `symbol_snail`, `symbol_fish`, `symbol_fruit`, `symbol_flower`, `symbol_firefly`, `symbol_dragonfly` ✅ |
| Altos | `symbol_rock`, `symbol_lilypad`, `symbol_chest`, `symbol_frog` ✅ |
| Especiales | `symbol_wild`, `symbol_scatter`, `symbol_bonus`, `symbol_prize` ✅ |

Estados `normal / highlighted / winning / disabled / animated` → 🧮 en runtime (`src/reels.js`):
glow ring + pulso de escala (winning), atenuación + desaturación (disabled), motion blur simulado (animated).

## /assets/logo
| Variante | Archivo | Estado |
|---|---|---|
| Logo completo (claro/oscuro) | `tiny_toads_logo_full_{light,dark}.svg` | 🧮 SVG |
| Logo horizontal (claro/oscuro) | `tiny_toads_logo_horizontal_{light,dark}.svg` | 🧮 SVG |
| Icono | `tiny_toads_icon_512.png` | ✅ |
| Favicon | `tiny_toads_favicon_32.png`, `/assets/icons/favicon_{32,64}.png`, `icon_192.png` | ✅ |
| Logo bitmap ilustrado (PNG con ranas 3D) | — | ⏳ |

## Procedurales (sin bitmap, por rendimiento)
| Elemento | Dónde | Bitmap pendiente |
|---|---|---|
| Fondo pantano (3 capas: back/mid/front) | `src/background.js` | ⏳ `swamp_background.png`, `water_overlay.png` (opcional; versión pintada) |
| Marco de reels (madera, raíces, remaches, hojas) | `css/components.css` `.machine__*` | ⏳ `reel_frame.png` (opcional) |
| Botón SPIN (cristal + metal + flechas) | `css/components.css` `.spin*` + SVG inline | ⏳ `spin_button_*.png` (opcional) |
| Paneles jackpot GRAND/MAJOR/MINOR/MINI | `.jackpot*` | — |
| Partículas (sparkle, bubble, leaf, star, droplet, dust, coin, glow) | `src/particles.js` (pool 180) | — |
| Rayos de luz (mega win) | `src/main.js drawRays` | — |

## Hooks visuales para audio (`src/events.js`)
`spin`, `reelStop`, `symbolLand`, `win`, `bigWin`, `jackpot`, `click`, `bonus`, `scatter`
— añade `#debug` a la URL para verlos en consola.
