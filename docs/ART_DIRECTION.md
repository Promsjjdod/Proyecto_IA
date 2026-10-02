# TINY TOADS — Art Direction Bible

> Juego de tragamonedas **arcade ficticio / demo**. Solo créditos virtuales.
> Sin dinero real, sin apuestas reales, sin pagos ni integración con casinos.

## 1. Concepto

**"Premium Cartoon Tropical Swamp"**

Un pantano tropical de fantasía al atardecer-mágico: agua turquesa brillante,
nenúfares gigantes, juncos, luciérnagas y una familia de sapitos originales
(los *Tiny Toads*) que viven dentro de una vieja máquina de madera tallada
cubierta de raíces y musgo.

Pilares:

| Pilar | Qué significa en pantalla |
|---|---|
| Cartoon 3D glossy | Formas redondeadas, highlights especulares, materiales "de goma/caramelo" |
| Outline fuerte | Contorno oscuro (#1B2A1F) de 2–4 px a escala 1280×720 |
| Alto contraste | Fondo frío (azules/turquesa) vs. símbolos cálidos (ámbar/dorado/rojo) |
| Luz de casino arcade | Rim light cian frío + key light cálida desde arriba-izquierda |
| Magia contenida | Sparkles y glow **sólo** en reels, SPIN y WIN. El fondo respira, no grita |

## 2. Paleta maestra

### Mundo (fondo)
| Token | Hex | Uso |
|---|---|---|
| `--swamp-deep` | `#06202E` | Agua profunda, sombras |
| `--swamp-water` | `#0E7490` | Agua media |
| `--swamp-turquoise` | `#22D3EE` | Agua iluminada, rim light |
| `--swamp-foam` | `#A5F3FC` | Reflejos, espuma, highlights de agua |
| `--leaf-dark` | `#14532D` | Hojas en sombra |
| `--leaf` | `#22C55E` | Hojas, nenúfares |
| `--leaf-light` | `#86EFAC` | Highlights vegetales |

### Máquina (madera y metal)
| Token | Hex | Uso |
|---|---|---|
| `--wood-dark` | `#3B1F0E` | Marco, sombras de madera |
| `--wood` | `#7C4A1E` | Madera base |
| `--wood-light` | `#C98A4B` | Highlights de madera |
| `--brass` | `#F5B445` | Remaches, bordes metálicos |
| `--brass-light` | `#FFE7A3` | Brillo metálico |

### Acentos / UI
| Token | Hex | Uso |
|---|---|---|
| `--gold` | `#FFC930` | Ganancias, jackpot, premium |
| `--gold-deep` | `#C77A00` | Sombra de oro |
| `--magenta` | `#F43F8E` | Flores, acentos UI |
| `--violet` | `#8B5CF6` | Magia, Scatter |
| `--lime` | `#BEF264` | Botón SPIN, feedback positivo |
| `--ink` | `#1B2A1F` | Outlines, texto sobre claro |
| `--paper` | `#FFF8E7` | Texto sobre oscuro |

### Jerarquía de premios
| Nivel | Color | Material |
|---|---|---|
| GRAND | `#FFC930` oro | Oro pulido + rayos |
| MAJOR | `#F43F8E` magenta | Cristal rosa |
| MINOR | `#22D3EE` turquesa | Cristal de agua |
| MINI | `#22C55E` verde | Hoja esmaltada |

## 3. Personajes — la familia Tiny Toad

Rasgos compartidos (silueta reconocible):
- Cabeza = 55 % del cuerpo. Cuerpo en forma de gota redondeada.
- Ojos enormes semiesféricos saliendo de la cabeza, iris de color complementario.
- Patitas minúsculas de 3 dedos con ventosas redondas.
- Boca ancha con sonrisa, mejillas con rubor.
- Piel glossy con pecas/puntitos más claros en el lomo.

| Nombre | Color | Personalidad | Accesorio distintivo |
|---|---|---|---|
| **Pip** (verde) | `#4ADE80` | Alegre, líder | Hojita de nenúfar en la cabeza |
| **Bubbles** (azul) | `#38BDF8` | Soñador, tranquilo | Burbuja flotante / gotas |
| **Ember** (rojo) | `#FB7185` | Energético, impulsivo | Flor roja detrás de la oreja |
| **Mystic** (morado) | `#A78BFA` | Misterioso, mágico | Pequeñas estrellas mágicas |
| **Goldie** (dorado) | `#FACC15` | Suertudo, premium | Corona de oro diminuta |

Set de poses por personaje: `idle, blink, happy, excited, win, jump, shocked`
(8 frames en spritesheet horizontal 1×8: idle, blink, happy, excited, win, jump, shocked, +1 idle alt).

## 4. Símbolos del reel

Todos: 256×256 px, fondo transparente, outline `--ink`, sombra proyectada
suave hacia abajo-derecha, highlight especular arriba-izquierda.

**Bajos (madera tallada):** `10, J, Q, K, A` — placa de madera con letra tallada
rellena de resina de color (10 verde, J azul, Q magenta, K violeta, A dorado).

**Medios (naturaleza):** `caracol`, `pez`, `fruta tropical`, `flor acuática`,
`luciérnaga`, `libélula`.

**Altos:** `roca con musgo`, `nenúfar`, `cofre`, `rana (Pip)`.

**Especiales:**
- `WILD` — Tiny Toad dorado sobre placa "WILD" radiante.
- `SCATTER` — orbe mágico violeta con luciérnagas.
- `BONUS` — cofre abierto con luz dorada.
- `PRIZE` — moneda-nenúfar dorada (símbolo de premio especial).

Estados (procedurales en runtime): `normal`, `highlighted`, `winning`, `disabled`, `animated`.

## 5. Tipografía

| Rol | Fuente | Tratamiento |
|---|---|---|
| TITLE / LOGO | *Lilita One* | Outline ink 4 px + sombra dura + gradiente oro/lima |
| JACKPOT | *Lilita One* | Gradiente del nivel + glow |
| WIN | *Lilita One* | Escala con bounce, gradiente oro |
| BUTTON | *Fredoka* 700 | Mayúsculas, tracking +4 % |
| HUD | *Fredoka* 600 | Mayúsculas pequeñas, `--paper` |
| NUMBERS | *Fredoka* 700 tabular | `font-variant-numeric: tabular-nums` |
| SMALL LABELS | *Fredoka* 500 | 11–12 px, 70 % opacidad |

## 6. Iluminación

- Key light: cálida (`#FFE7A3`) desde arriba-izquierda, 35°.
- Rim light: fría (`#22D3EE`) desde abajo-derecha (reflejo del agua).
- Bloom: sólo en SPIN, WIN y jackpots. Máximo 2 capas de glow simultáneas.
- Sombras: suaves, color `--swamp-deep` al 45 %.

## 7. Presupuesto de rendimiento

- Partículas simultáneas: ≤ 180 (pool fijo).
- Fondo: 3 capas canvas (back/mid/front) + 1 overlay de agua, 30–60 fps.
- Texturas: ≤ 1024 px lado mayor para fondo, 256 px por símbolo, 2048 px spritesheet.
- `devicePixelRatio` cap = 2.
- Sin librerías externas.

## 8. Composición 1280×720

```
┌──────────────────────────────────────────────────────────────┐
│ LOGO     [GRAND] [MAJOR] [MINOR] [MINI]            ⚙ 🔊 ♪ i │  HUD top (90px)
├──────────────────────────────────────────────────────────────┤
│  Toad   ┌───────────────── REEL FRAME ─────────────────┐  Toad│
│  izq.   │  [ ][ ][ ][ ][ ]   5 columnas × 3 filas      │  der.│  Zona reels (470px)
│         │  [ ][ ][ ][ ][ ]                              │      │
│         │  [ ][ ][ ][ ][ ]                              │      │
│         └──────────────────────────────────────────────┘      │
├──────────────────────────────────────────────────────────────┤
│  CRÉDITOS  |  APUESTA −/+  |  GANANCIA   [AUTO] (  SPIN  )   │  Controles (110px)
└──────────────────────────────────────────────────────────────┘
```
