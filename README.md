# Nexus AI Workspace

Espacio de trabajo de IA multimodelo autoalojado. Incluye una interfaz React/Vite, una API Express modular y persistencia SQLite local. El servidor actúa como proxy hacia las APIs que configura cada usuario: las claves no se envían ni se devuelven al navegador.

> **Estado:** versión inicial funcional, todavía en desarrollo. La compilación y las pruebas automatizadas descritas abajo se han ejecutado. No se han probado llamadas contra cuentas reales de OpenAI, Anthropic, Google, DeepSeek ni servidores Ollama de terceros; disponer de un adaptador no garantiza que una cuenta, región, modelo o plan concreto lo admita.

## Qué incluye

- **Cuentas y permisos:** registro e inicio de sesión; rol de usuario y rol admin; panel de administración para cuentas, límites, cuotas y proveedores permitidos. El alta pública crea usuarios normales. El primer administrador se crea únicamente mediante las variables de bootstrap.
- **Proveedores y modelos:** OpenAI, Anthropic, Google Gemini, DeepSeek, Ollama, OpenAI-compatible y endpoints custom. Se puede probar/listar modelos mediante el endpoint configurado, sincronizar los identificadores devueltos o añadir un modelo manualmente. La aplicación distingue los modelos detectados de los manuales. Las capacidades (visión, herramientas, audio e imágenes) son **configuración manual**, no una prueba automática.
- **Chat:** historial por cuenta, conversaciones vinculables a proyectos, transmisión SSE, regeneración, edición de mensajes, adjuntos de imágenes/texto y agentes. Los límites solicitados al proveedor dependen del modo seleccionado.
- **Modos:** `LOW`, `MEDIO`, `ALTO`, `EXTRA` y `MAX` aplican presupuestos de salida y contexto en la solicitud al proveedor; la salida se ajusta al contexto registrado para ese modelo y se rechazan configuraciones sin espacio suficiente. `MAX` solicita hasta 6 000 tokens de salida y mayor contexto, sujeto al modelo. Puede usar el proveedor/modelo preferido que configure el usuario; si no, conserva la selección del chat. **No busca ni adivina el “mejor modelo”** y no representa un plan de pago. Nexus reserva unidades internas antes de algunas operaciones y las concilia con una estimación; al cerrar la operación, limita el cargo a los créditos y cuotas diario/mensual disponibles y devuelve las unidades no usadas. Son cuotas locales, no dinero ni el coste real de la API externa.
- **Agentes:** instrucciones, modelo/modo opcionales y autorización explícita de lectura/escritura de archivos de un proyecto. Las herramientas disponibles son listar, leer y escribir archivos dentro de ese proyecto. No hay shell, ejecución arbitraria de código, navegación web ni memoria persistente de agente. Las llamadas de herramientas requieren un proveedor/modelo con protocolo compatible y la capacidad `tools` marcada por el usuario.
- **Proyectos:** hasta 25 por cuenta; directorios privados persistentes, explorador, editor de texto con números de línea, descarga ZIP/archivo e historial de versiones. Hay límites de 1 MB por archivo, 100 MB por proyecto y 100 MB por historial de versiones. La vista previa HTML se sirve a través de una ruta autenticada y un `iframe` con sandbox/CSP; no tiene acceso a las APIs de Nexus ni a la red desde el documento previsualizado. No es un IDE con compiladores o terminal.
- **Comparación:** envía una misma entrada a dos modelos en paralelo, con historiales separados y posibilidad de continuar una conversación en el chat. Ambas llamadas usan el modo `MEDIO`; si se adjuntan imágenes, los dos modelos deben tener la capacidad de visión marcada.
- **Imágenes:** hasta 250 MB de biblioteca por cuenta; una imagen PNG por solicitud usando `/images/generations` y formato OpenAI Images compatible (`b64_json`). El proveedor debe ser OpenAI, OpenAI-compatible o custom y el usuario aporta el identificador real del modelo. No se asume que un modelo de chat pueda generar imágenes. No están conectados Gemini Image, referencias, variaciones ni edición de imágenes.
- **Voz del navegador:** dictado mediante `SpeechRecognition`/`webkitSpeechRecognition` cuando el navegador lo implementa, y lectura mediante `SpeechSynthesis`. El dictado puede procesarse externamente según el navegador. No se sube audio a un proveedor de IA ni hay transcripción/síntesis propia del servidor.
- **Automatizaciones:** editor y ejecuciones manuales de flujos guardadas en SQLite. Incluye entrada, texto, transformación, condición, instrucciones de agente para nodos IA, modelo IA, lectura/escritura de archivos, salida y petición HTTPS allowlisted. No ejecuta comandos del sistema ni código arbitrario; los disparadores programados todavía no están implementados.
- **Planes:** `FREE` y cuotas internas configurables. Los planes `PRO`/`MAX` aparecen como próximos; no hay pagos, suscripciones ni compras implementados.

## Requisitos

- Node.js **20.18.1 o posterior** y npm.
- Para conversar/generar imágenes: una cuenta y credencial válida del proveedor que se vaya a conectar. El uso de una API externa puede tener costes facturados por ese proveedor.
- Para usar Ollama: Ollama accesible **desde el proceso del servidor**, no desde el navegador.

## Inicio local

```bash
npm install
cp .env.example .env
```

Edita `.env` antes de usar credenciales. En particular, define `PROVIDER_ENCRYPTION_KEY` como una cadena aleatoria privada de al menos 32 caracteres y reemplaza/elimina las credenciales ilustrativas de bootstrap. No subas `.env` al repositorio.

```bash
npm run db:init
npm run dev
```

Abre <http://localhost:5173>. El servidor API escucha por defecto en el puerto `4000`; Vite reenvía `/api` a ese puerto. Si `5173` ya está ocupado, Vite elegirá otro (por ejemplo, `5174`) y lo indicará en la terminal. Si cambias `PORT`, actualiza también el destino del proxy en `vite.config.ts`.

Para comprobar compilación y pruebas:

```bash
npm run build
npm test
```

Para ejecutar sin Vite (después de compilar el frontend):

```bash
npm run build
NODE_ENV=production npm start
```

En producción, `NODE_ENV=production` exige `PROVIDER_ENCRYPTION_KEY` de al menos 32 caracteres y las cookies de sesión llevan `Secure`; sirve la aplicación únicamente detrás de HTTPS. El proceso Express sirve `dist/` cuando existe.

## Variables de entorno

| Variable | Uso |
| --- | --- |
| `NODE_ENV` | Usa `production` para endurecer cookies y exigir la clave de cifrado. |
| `HOST` | Interfaz de red para la API y Vite (predeterminada `0.0.0.0`); usa `127.0.0.1` para restringir el acceso a este equipo. `.env.example` elige `127.0.0.1` para instalación local. |
| `PORT` | Puerto de Express (predeterminado `4000`). |
| `DATA_DIR` | Directorio local de SQLite, cargas y proyectos (predeterminado `./data`). |
| `PROVIDER_ENCRYPTION_KEY` | Clave estable para cifrado AES-256-GCM de credenciales. Obligatoria en producción; no la pierdas ni la cambies sin un proceso de rotación/descifrado, que todavía no está implementado. |
| `BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_PASSWORD` | Crea un admin al iniciar si el correo aún no existe. Contraseña mínima: 12 caracteres. No cambia una cuenta existente. |
| `OLLAMA_ALLOWED_URLS` | Lista separada por comas de orígenes Ollama exactos, incluido protocolo y puerto. Predeterminados: `localhost`, `127.0.0.1` y `::1` en el puerto `11434`. Añadir un origen es una decisión de confianza del operador; evita exponer Ollama sin protección. |
| `WORKFLOW_HTTP_ALLOWED_HOSTS` | Hostnames públicos HTTPS permitidos para nodos HTTP, separados por comas (sin esquema ni ruta). Vacío bloquea todos esos nodos. |
| `ALLOWED_PROVIDER_TYPES` | Lista inicial de tipos de proveedor permitidos; admin puede restringirla desde su panel. |

El archivo [.env.example](.env.example) contiene valores ilustrativos, **no secretos válidos de producción**.

## Integraciones: alcance y configuración

- **OpenAI / DeepSeek / compatibles / custom:** el adaptador de texto usa Chat Completions compatible; custom permite configurar la cabecera de autenticación. Confirma que la API base y el modelo soporten el endpoint concreto. El protocolo de herramientas está implementado para OpenAI, DeepSeek, Anthropic y compatibles custom/OpenAI.
- **Anthropic:** usa Messages API y la cabecera de versión configurada por el servidor. Se envían imágenes en formato base64 si el modelo está configurado con visión.
- **Google Gemini:** lista modelos y usa `generateContent`/`streamGenerateContent`. La clave se envía del servidor a Google en el parámetro de consulta del endpoint oficial. No se implementó el protocolo de herramientas de Gemini en esta versión.
- **Ollama:** se lista mediante `/api/tags` y las solicitudes de chat usan la interfaz OpenAI-compatible `/v1/chat/completions`. El origen debe estar permitido por `OLLAMA_ALLOWED_URLS`. `localhost` siempre significa el host donde se ejecuta Nexus.
- La prueba de conexión y sincronización contactan el endpoint configurado y muestran los resultados que devuelve. Un identificador añadido manualmente queda como `unknown` hasta validarlo; las capacidades no se infieren del nombre.

## Seguridad y límites operativos

- Contraseñas con scrypt; identificadores opacos de sesión guardados como hash; cookie HttpOnly/SameSite y protección CSRF en operaciones de escritura. El rol admin no se obtiene registrándose.
- Credenciales de proveedores cifradas en el backend con AES-256-GCM y nunca incluidas en las respuestas JSON del catálogo. El fallback de desarrollo es público y deliberadamente inseguro: **no despliegues sin una clave privada propia**.
- En una instalación personal de Windows conserva `HOST=127.0.0.1` para que API y Vite solo escuchen en el equipo local. No expongas los puertos `4000`/`5173` a Internet; usa `0.0.0.0` únicamente detrás de una configuración de red/proxy confiable.
- Los endpoints externos deben usar HTTPS. El servidor resuelve y valida direcciones públicas y fija las IP resueltas en la conexión para reducir DNS rebinding; bloquea redirecciones. Ollama es una excepción limitada a los orígenes explícitamente allowlisted.
- Cada consulta está limitada por usuario y propiedad de recursos. Rutas de archivos normalizadas, bloqueo de traversal/enlaces simbólicos, hasta 2 000 entradas por proyecto, 100 MB de adjuntos almacenados por cuenta y archivos de proyecto fuera de `web/` y de la raíz pública estática. Los adjuntos que no están asociados a mensajes se limpian al eliminar un chat o al iniciar el servidor.
- Los nodos HTTP están limitados por `WORKFLOW_HTTP_ALLOWED_HOSTS`, HTTPS, DNS público fijado, ausencia de redirecciones, timeout y límite de respuesta. Configura allowlists estrechas: autorizar un host permite que los usuarios que ejecuten flujos contacten ese host.
- Las vistas previas ejecutan HTML que el propio usuario guardó, dentro de un iframe sandbox sin `allow-same-origin`; no publiques su contenido en un dominio de confianza ni elimines la CSP.
- Antes de ejecutar flujos con IA/HTTP, generar imágenes o realizar acciones destructivas en la interfaz se solicita confirmación donde corresponde. La API no implementa pagos.
- El almacenamiento `sql.js` serializa SQLite a un archivo local. Es adecuado para un despliegue individual pequeño, pero no ofrece coordinación multi-proceso/alta disponibilidad. Ejecuta una sola instancia de API y respalda de forma coherente `data/nexus.sqlite`, `data/uploads/` y `data/projects/`. No publiques esos directorios.
- Las cuotas/créditos son estimaciones internas. No predicen facturas de OpenAI ni de otros proveedores. El admin tiene bypass de las cuotas internas, pero siguen aplicando los límites externos.

## Validación realizada

`npm run build` ejecuta `tsc --noEmit` y `vite build`; ambos pasaron en el estado actual. `npm test` ejecuta seis pruebas automáticas sobre cifrado, presupuestos de modo, allowlist y petición local fijada por DNS, protección contra traversal/enlaces simbólicos, revisiones de archivos, conciliación de cuotas y reembolso de reservas, limpieza de adjuntos huérfanos, persistencia/ejecución de workflows y rutas de registro/sesión/CSRF/propiedad/rol admin.

Las pruebas no llaman a proveedores reales ni validan credenciales comerciales, streaming de un modelo real, generación de imagen externa, compatibilidad de cada modelo ni restricciones de cuota del proveedor. Configura tus propias credenciales y prueba cada endpoint/modelo antes de depender de él.

## Estructura principal

```text
server/
  auth.ts, security.ts, db.ts, usage.ts    autenticación, cifrado, persistencia y cuotas
  providers/                               adaptadores, seguridad SSRF y rutas de modelos
  chats/routes.ts                          historial, streaming y herramientas de agentes
  workspaces/                              archivos, versiones y vista previa aislada
  workflows/                               validación y ejecución de flujos
  images/routes.ts, uploads.ts              imágenes y adjuntos privados
  admin.ts, profile.ts                     administración y preferencias
web/src/
  App.tsx, api.ts, styles.css               aplicación y cliente HTTP
  components/                               vistas modulares de la interfaz
 tests/core.test.ts                         pruebas de seguridad e integración
```
