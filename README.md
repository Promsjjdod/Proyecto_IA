# 🐸 TINY TOADS — Premium Cartoon Tropical Swamp Arcade Demo

> **AVISO IMPORTANTE:** **TINY TOADS** es un **videojuego arcade ficticio / demostración visual interactiva**. Funciona **exclusivamente con créditos virtuales** de entretenimiento. No implementa dinero real, apuestas reales, pagos, retiros ni integración con casinos.

---

## 🎨 1. Dirección Artística: *"Premium Cartoon Tropical Swamp"*

El proyecto implementa la identidad visual completa, los assets 2D/3D-cartoon en alta definición (tanto en formato vectorial escalable `.svg` como en mapa de bits con fondo transparente `.png`), el sistema de partículas con *object pooling*, y la interfaz jugable 5×3 diseñada sobre una composición base de **1280×720** adaptable a **1920×1080**, **1366×768**, **Tablet** y **Móvil Horizontal**.

### Características Visuales Principales
- **5 Personajes Originales (Familia *Tiny Toads*):**
  1. **Tiny Toad Verde (*Hoppy*)** — Explorador del Nenúfar
  2. **Tiny Toad Azul (*Splash*)** — Guardián de la Laguna
  3. **Tiny Toad Rojo (*Blaze*)** — Cazador de Tesoros
  4. **Tiny Toad Morado (*Mystic*)** — Hechicera Bioluminiscente
  5. **Tiny Toad Dorado (*King Croak*)** — Rey del Pantano Dorado
  - Cada personaje cuenta con **7 estados de animación independientes**: `idle`, `blink`, `happy`, `excited`, `win`, `jump` y `shocked`.
- **19 Símbolos Originales del Reel (× 5 Estados):**
  - **Comunes en Madera Tallada del Pantano:** `A`, `K`, `Q`, `J`, `10`.
  - **Especiales Temáticos:** `rana`, `nenúfar`, `cofre`, `roca`, `libélula`, `luciérnaga`, `flor acuática`, `caracol`, `pez`, `fruta tropical`.
  - **Especiales de Mecánica:** `Wild`, `Bonus`, `Scatter`, `Prize`.
  - Estados incluidos por símbolo: `normal`, `highlighted`, `winning`, `disabled` y `animated`.
- **Máquina 5×3 Integrada en el Pantano:** Marco de madera oscura de manglar (`assets/reels/reel_frame.png`) con raíces, hojas tropicales, remaches dorados y separadores verticales iluminados.
- **Fondo Multi-Capa Animado:** Separación en capas `BACKGROUND`, `MIDGROUND`, `FOREGROUND` y `water_overlay` combinadas con ilustración de pantano tropical (`assets/background/swamp_background.png`).
- **UI Superior & Inferior Arcade:**
  - 4 paneles superiores de jackpot virtual (`GRAND`, `MAJOR`, `MINOR`, `MINI`).
  - Controles inferiores de saldo virtual, selector de apuesta virtual, botón **AUTO**, tabla de premios, catálogo interactivo de assets (**🎨 ASSETS**), ajustes, sonido y música.
  - **Botón Circular SPIN** con estados `IDLE`, `HOVER`, `PRESSED`, `SPINNING`, `WIN` y `DISABLED`.
- **Niveles de Celebración de Victoria:** `SMALL WIN`, `MEDIUM WIN`, `BIG WIN` y `MEGA WIN` a pantalla completa.

---

## 📂 2. Estructura del Repositorio

```text
/
├── index.html                        # Escenario principal 1280x720 + UI + Modales
├── package.json                      # Scripts de inicio y generación de assets
├── docs/
│   └── ART_DIRECTION.md              # Biblia de Dirección de Arte y Paleta Oficial
├── scripts/
│   └── generate_assets.mjs           # Pipeline generador de los 375+ assets SVG y PNG
├── src/
│   ├── styles/
│   │   └── main.css                  # Sistema visual, animaciones de reels, UI y responsive
│   └── js/
│       ├── config.js                 # Catálogo de símbolos, líneas de pago y personajes
│       ├── particles.js              # Sistema de partículas HTML5 Canvas con Object Pooling
│       ├── visualSound.js            # Sincronizador de Sonido Visual + sintetizador WebAudio
│       └── game.js                   # Física 5x3 de los reels, estados y celebraciones
└── assets/
    ├── characters/                   # 5 Tiny Toads × 7 estados (.png y .svg transparentes)
    ├── symbols/                      # 19 símbolos × 5 estados (.png y .svg transparentes)
    ├── background/                   # Fondo pintado + capas BACKGROUND, MIDGROUND, FOREGROUND, water_overlay
    ├── reels/                        # reel_frame.png / .svg (marco 5x3 de madera oscura y raíces)
    ├── ui/                           # Paneles GRAND, MAJOR, MINOR, MINI
    ├── buttons/                      # Botón SPIN en sus 6 estados
    ├── particles/                    # 8 tipos de partículas (sparkle, bubble, leaf, star, droplet, dust, coin, glow)
    ├── effects/                      # Rayos de celebración win_rays_burst
    ├── logo/                         # 6 variantes oficiales del logo TINY TOADS + Splash Art
    ├── icons/                        # Iconos de interfaz
    └── animations/                   # animations_manifest.json
```

---

## 🚀 3. Ejecución Local

```bash
npm start
# Abre http://localhost:8080 en el navegador
```
