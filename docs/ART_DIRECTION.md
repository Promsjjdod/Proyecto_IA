# TINY TOADS — Art Direction & Visual Identity System

## 1. Visión Artística: "Premium Cartoon Tropical Swamp"
**TINY TOADS** es un videojuego arcade ficticio de demostración (exclusivamente con créditos virtuales, sin dinero real ni apuestas reales) cuya dirección de arte fusiona la calidez del arte 2D/3D de juegos móviles casuales premium con la atmósfera mágica de un pantano tropical bioluminiscente.

### Pilares Visuales
- **Siluetas Redondeadas y Expresivas:** Proporciones *chibi/cartoon* con cabezas grandes, ojos brillantes de gran tamaño y expresiones inmediatamente legibles a cualquier escala.
- **Materiales Glossy & Orgánicos:** Contraste táctil entre madera oscura tallada de manglar, oro antiguo, cristales esmeralda/turquesa y piel anfibia satinada con *specular highlights* pronunciados.
- **Bordes Definidos (Strong Outlines):** Contornos gruesos en tonos cacao/ébano (`#1B0E07` a `#0D231E`) que separan cada elemento del fondo animado con alto contraste.
- **Iluminación Mágica de Pantano Arcade:** *Rim lighting* cálido dorado superior combinado con reflejos inferiores cian/turquesa provenientes del agua bioluminiscente.

---

## 2. Paleta de Color Oficial y Sistema Visual

| Categoría | Nombre | Hex | Uso Principal |
|---|---|---|---|
| **Agua y Magia** | Bioluminescent Cyan | `#00F5D4` | Reflejos de agua, rim light inferior, partículas mágicas |
| **Agua Profunda** | Tropical Lagoon Blue | `#00A8E8` | Agua del pantano en capa media, cristal del botón SPIN |
| **Pantano Oscuro** | Deep Swamp Teal | `#072A2C` | Sombras ambientales, viñeta de fondo, contraste de UI |
| **Vegetación** | Lush Lilypad Green | `#38E54D` | Nenúfares, hojas tropicales, Tiny Toad Verde |
| **Madera del Marco** | Dark Mangrove Wood | `#3D2111` | Marco 5x3 de los reels, paneles HUD, símbolos tallados |
| **Borde Cartoon** | Espresso Outline | `#1A0C05` | Contornos gruesos exteriores de símbolos, UI y personajes |
| **Oro Arcade** | Sunburst Gold | `#FFD100` | Borde de jackpots, monedas virtuales, Tiny Toad Dorado |
| **Jackpot Grand** | Ruby Dragonfruit | `#FF2A6D` | Panel GRAND, Tiny Toad Rojo, alertas de Mega Win |
| **Jackpot Major** | Amethyst Orchid | `#B5179E` | Panel MAJOR, Tiny Toad Morado, efectos Scatter |
| **Jackpot Minor** | Sapphire Stream | `#0096FF` | Panel MINOR, Tiny Toad Azul |
| **Jackpot Mini** | Emerald Sprout | `#2EC4B6` | Panel MINI, acentos secundarios |

---

## 3. Tipografía y Jerarquía UI

- **Display / Títulos / Logo / Jackpots / Win Banners:** `'Fredoka'`, `'Luckiest Guy'`, `'Baloo 2'`, system rounded sans-serif, peso 800–900, con *stroke* exterior oscuro (`#1A0C05`), sombra proyectada sólida y gradiente vertical dorado/crema.
- **HUD / Números / Créditos Virtuales:** Fuente tabular clara (`font-variant-numeric: tabular-nums`) con alto contraste para lectura instantánea en 1280×720, 1920×1080 y móvil horizontal.

---

## 4. Familia de Personajes: Los 5 Tiny Toads

1. **Tiny Toad Verde (Hoppy — El Explorador Alegre):** Verde esmeralda brillante (`#38E54D`), mejillas rosadas, brote de hoja tropical en la cabeza.
2. **Tiny Toad Azul (Splash — El Príncipe Acuático):** Azul zafiro (`#00B4D8`), cresta de agua cristalina, personalidad fresca y serena.
3. **Tiny Toad Rojo (Blaze — El Aventurero Entusiasta):** Rojo rubí coral (`#FF3366`), cejas expresivas y manchas cálidas naranjas, energía explosiva.
4. **Tiny Toad Morado (Mystic — La Maga del Pantano):** Púrpura amatista (`#9D4EDD`), marcas rúnicas luminosas cian y ojos estrellados.
5. **Tiny Toad Dorado (King Croak — El Guardián del Tesoro):** Oro radiante (`#FFD166` / `#FFB703`), pequeña corona de loto dorado y aura de destellos.

**Estados de animación por personaje (7 estados c/u):**
`idle`, `blink`, `happy`, `excited`, `win`, `jump`, `shocked`.

---

## 5. Símbolos del Reel (19 Símbolos Originales × 5 Estados)

- **Comunes (Madera Tallada del Pantano con Bordes Gruesos y Partículas):** `A`, `K`, `Q`, `J`, `10`.
- **Especiales Temáticos (10):** `rana` (Golden Frog Idol), `nenúfar` (Glowing Lilypad), `cofre` (Swamp Treasure Chest), `roca` (Mossy Rune Stone), `libélula` (Jeweled Dragonfly), `luciérnaga` (Lantern Firefly), `flor acuática` (Lotus Water Flower), `caracol` (Crystal Shell Snail), `pez` (Tropical Koi Fish), `fruta tropical` (Star Dragonfruit).
- **Especiales de Mecánica (4):** `Wild` (Golden Lily Wild), `Bonus` (Totem Chest Bonus), `Scatter` (Mystic Swamp Gem Scatter), `Prize` (Royal Golden Pearl Prize).
- **Estados por símbolo:** `normal`, `highlighted`, `winning`, `disabled`, `animated`.

---

## 6. Composición Base (1280×720 Escalable)

- **Zona Superior (HUD & Jackpots):** Logo *TINY TOADS* + 4 paneles de premio virtual (`GRAND`, `MAJOR`, `MINOR`, `MINI`) con iconos, contadores dinámicos, resplandor y partículas.
- **Zona Central (Máquina 5×3 + Escenario):** Marco de madera oscura de manglar con raíces entrelazadas, hojas, remaches de bronce, separadores verticales iluminados y los 5 Tiny Toads interactuando alrededor del tablero.
- **Zona Inferior (Controles Arcade):** Paneles de *CRÉDITOS VIRTUALES*, *APUESTA VIRTUAL*, indicador de *ÚLTIMA VICTORIA*, botón principal circular **SPIN** en cristal turquesa/oro con flechas orbitales, botón **AUTO**, e iconos de **Info/Tabla de Pagos**, **Ajustes**, **Sonido Visual** y **Música**.
