# Panel ADMIN (cheat) — solo para la demo

Herramienta oculta de QA/presentación. Opera **únicamente sobre créditos virtuales** del demo ficticio.

## Cómo abrirlo
Cualquiera de estas tres formas y luego el **PIN** (por defecto `1234`, definido en `src/config.js` → `ADMIN_PIN`):

| Método | Detalle |
|---|---|
| Atajo de teclado | `Ctrl + Shift + A` |
| Código secreto | escribir `toads` con el teclado dentro del juego |
| URL | añadir `#admin` (ej. `http://localhost:8080/#admin`) |

La sesión admin dura hasta cerrar la pestaña (o pulsar *Cerrar sesión admin*). Para volver a esconderlo: `Ctrl+Shift+A` o la ×.

## Funciones
| Sección | Acciones |
|---|---|
| Créditos | +1 000 · +10 000 · Fijar cantidad · A cero |
| Forzar próximo giro | Perder · Small · Medium · Big · Mega · Bonus (3 cofres) · Scatter (3 orbes) · Anticipación (2 scatters → reels 3-5 ralentizados) |
| Modos | **Siempre gana** · **Nunca descuenta apuesta** · Mostrar FPS / partículas vivas |
| Jackpot visual | Dispara la animación de GRAND / MAJOR / MINOR / MINI |
| Celebración | Big Win FX · Mega Win FX (rayos + banner) · Lluvia de monedas |
| Toads | Cambiar personaje izquierdo / derecho · Forzar pose win / shocked / idle |
| Sesión | Girar · AUTO 50 · Cerrar sesión admin |
| Log | Últimos eventos del bus (`spin`, `reelStop`, `win`, `bigWin`, `bonus`, `scatter`, `jackpot`) |

Los giros forzados intentan primero un resultado aleatorio real del nivel pedido (para que se vea natural) y,
si no lo encuentran, usan una cuadrícula construida a mano.

## Seguridad
Es un cheat **del lado del cliente** para una demo sin dinero real: cambia el PIN antes de compartir la build
y, si quieres desactivarlo por completo, elimina la llamada `initAdmin(...)` en `src/main.js`.
