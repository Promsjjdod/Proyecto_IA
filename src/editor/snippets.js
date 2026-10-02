/**
 * Snippets — real, dialect-aware Lua/Luau templates with tab stops.
 *
 * Templates use CodeMirror's snippet syntax (`${1:placeholder}`, `${0}` final stop) and are
 * inserted through `snippetCompletion`, so Tab moves between the stops. Each snippet declares
 * which dialects it belongs to: Luau-only constructs (`task.*`, `type`, `continue`,
 * interpolated strings) never appear in a Lua 5.4 document and vice versa.
 */

export const SNIPPETS = Object.freeze([
  {
    label: 'func',
    detail: 'function',
    dialects: ['luau', 'lua54'],
    documentation: 'Declara una función local con parámetros y un bloque `end`.',
    template: 'local function ${1:nombre}(${2:...})\n\t${0}\nend',
  },
  {
    label: 'function',
    detail: 'function (global)',
    dialects: ['luau', 'lua54'],
    documentation: 'Declara una función global.',
    template: 'function ${1:nombre}(${2:...})\n\t${0}\nend',
  },
  {
    label: 'funcmethod',
    detail: 'method',
    dialects: ['luau', 'lua54'],
    documentation: 'Método que recibe `self` explícito.',
    template: 'function ${1:Tabla}:${2:metodo}(${3:...})\n\tself.${0}\nend',
  },
  {
    label: 'if',
    detail: 'if … then',
    dialects: ['luau', 'lua54'],
    documentation: 'Condicional con rama alternativa.',
    template: 'if ${1:condición} then\n\t${2}\nelse\n\t${0}\nend',
  },
  {
    label: 'ifelse',
    detail: 'if / elseif / else',
    dialects: ['luau', 'lua54'],
    documentation: 'Cadena de condiciones.',
    template: 'if ${1:condición} then\n\t${2}\nelseif ${3:otra} then\n\t${4}\nelse\n\t${0}\nend',
  },
  {
    label: 'forin',
    detail: 'for … in',
    dialects: ['luau', 'lua54'],
    documentation: 'Recorre un iterador genérico (por ejemplo `pairs`).',
    template: 'for ${1:clave}, ${2:valor} in pairs(${3:tabla}) do\n\t${0}\nend',
  },
  {
    label: 'foripairs',
    detail: 'for … ipairs',
    dialects: ['luau', 'lua54'],
    documentation: 'Recorre un array en orden con `ipairs`.',
    template: 'for ${1:índice}, ${2:valor} in ipairs(${3:lista}) do\n\t${0}\nend',
  },
  {
    label: 'fornum',
    detail: 'for numérico',
    dialects: ['luau', 'lua54'],
    documentation: 'Bucle numérico con paso.',
    template: 'for ${1:i} = ${2:1}, ${3:n}${4:, paso} do\n\t${0}\nend',
  },
  {
    label: 'whileloop',
    detail: 'while',
    dialects: ['luau', 'lua54'],
    documentation: 'Bucle mientras la condición sea verdadera.',
    template: 'while ${1:condición} do\n\t${0}\nend',
  },
  {
    label: 'repeatt',
    detail: 'repeat … until',
    dialects: ['luau', 'lua54'],
    documentation: 'Bucle que se ejecuta al menos una vez.',
    template: 'repeat\n\t${1}\nuntil ${0:condición}',
  },
  {
    label: 'pcall',
    detail: 'pcall',
    dialects: ['luau', 'lua54'],
    documentation: 'Protege una llamada y captura el error real.',
    template: 'local ${1:ok}, ${2:resultado} = pcall(function()\n\t${3}\nend)\nif not ${1:ok} then\n\t${0:warn(${2:resultado})}\nend',
  },
  {
    label: 'table',
    detail: 'local table',
    dialects: ['luau', 'lua54'],
    documentation: 'Crea una tabla local con pares y array.',
    template: 'local ${1:tabla} = {\n\t${2:clave} = ${3:valor},\n}',
  },
  {
    label: 'module',
    detail: 'module block',
    dialects: ['luau', 'lua54'],
    documentation: 'Patrón de módulo con `require` y retorno de la tabla.',
    template: 'local ${1:Módulo} = {}\n\nfunction ${1:Módulo}.new(${2:...})\n\tlocal self = setmetatable({}, { __index = ${1:Módulo} })\n\treturn self\nend\n\nreturn ${0:${1:Módulo}}',
  },
  {
    label: 'require',
    detail: 'require',
    dialects: ['luau', 'lua54'],
    documentation: 'Importa otro módulo con comprobación de tipo.',
    template: 'local ${1:nombre} = require(${0:script.Parent.Módulo})',
  },
  {
    label: 'metatable',
    detail: 'setmetatable',
    dialects: ['luau', 'lua54'],
    documentation: 'Añade una metatabla con `__index`.',
    template: 'setmetatable(${1:tabla}, { __index = ${2:clase} })${0}',
  },
  {
    label: 'annotate',
    detail: '(: type)',
    dialects: ['luau'],
    documentation: 'Anotación de tipo local.',
    template: 'local ${1:nombre}: ${2:number} = ${0:0}',
  },
  {
    label: 'typealias',
    detail: 'type alias',
    dialects: ['luau'],
    documentation: 'Declara un alias de tipo exportado.',
    template: 'export type ${1:Nombre} = {\n\t${2:campo}: ${3:string},\n}',
  },
  {
    label: 'genericfunc',
    detail: 'generic function',
    dialects: ['luau'],
    documentation: 'Función genérica con parámetro de tipo.',
    template: 'local function ${1:identidad}<${2:T}>(${3:valor}: ${2:T}): ${2:T}\n\treturn ${0:valor}\nend',
  },
  {
    label: 'task',
    detail: 'task.spawn',
    dialects: ['luau'],
    documentation: 'Lanza una tarea concurrente (Luau).',
    template: 'task.spawn(function()\n\t${0}\nend)',
  },
  {
    label: 'taskdelay',
    detail: 'task.delay',
    dialects: ['luau'],
    documentation: 'Ejecuta una función tras un retardo (Luau).',
    template: 'task.delay(${1:1}, function()\n\t${0}\nend)',
  },
  {
    label: 'contype',
    detail: 'continue',
    dialects: ['luau'],
    documentation: 'Salta a la siguiente iteración (Luau).',
    template: 'if ${1:condición} then\n\tcontinue\nend\n${0}',
  },
  {
    label: 'interp',
    detail: 'interpolated string',
    dialects: ['luau'],
    documentation: 'Cadena interpolada de Luau.',
    template: '`${1:texto} {${2:valor}}`${0}',
  },
  {
    label: 'typeofcheck',
    detail: 'typeof check',
    dialects: ['luau'],
    documentation: 'Comprueba el tipo en tiempo de ejecución.',
    template: 'if typeof(${1:valor}) == ${2:"string"} then\n\t${0}\nend',
  },
  {
    label: 'vector',
    detail: 'vector',
    dialects: ['luau'],
    documentation: 'Crea un vector de Luau.',
    template: 'local ${1:v} = vector.create(${2:x}, ${3:y}, ${4:z})',
  },
  {
    label: 'buffer',
    detail: 'buffer',
    dialects: ['luau'],
    documentation: 'Reserva un buffer binario de Luau.',
    template: 'local ${1:buf} = buffer.create(${2:64})\nbuffer.writeu8(${1:buf}, 0, ${3:255})',
  },
  {
    label: 'print',
    detail: 'print',
    dialects: ['luau', 'lua54'],
    documentation: 'Escribe en la consola de la aplicación (stdout del script).',
    template: 'print(${1:mensaje})${0}',
  },
  {
    label: 'assert',
    detail: 'assert',
    dialects: ['luau', 'lua54'],
    documentation: 'Falla con un mensaje claro cuando la condición no se cumple.',
    template: 'assert(${1:condición}, ${2:"mensaje"})${0}',
  },
  {
    label: 'benchmark',
    detail: 'benchmark block',
    dialects: ['luau', 'lua54'],
    documentation: 'Mide el tiempo real de un bloque con `os.clock`/`os.clock` equivalente.',
    template: 'local ${1:inicio} = os.clock()\n${2}\nprint(string.format("tiempo: %.4f s", os.clock() - ${1:inicio}))${0}',
  },
]);

/** Snippets available for a dialect. */
export function snippetsFor(dialect) {
  return SNIPPETS.filter((snippet) => snippet.dialects.includes(dialect));
}

export const KEYWORD_COMPLETIONS = Object.freeze([
  { label: 'and', type: 'keyword' }, { label: 'break', type: 'keyword' }, { label: 'do', type: 'keyword' },
  { label: 'else', type: 'keyword' }, { label: 'elseif', type: 'keyword' }, { label: 'end', type: 'keyword' },
  { label: 'for', type: 'keyword' }, { label: 'function', type: 'keyword' }, { label: 'if', type: 'keyword' },
  { label: 'in', type: 'keyword' }, { label: 'local', type: 'keyword' }, { label: 'nil', type: 'keyword' },
  { label: 'not', type: 'keyword' }, { label: 'or', type: 'keyword' }, { label: 'repeat', type: 'keyword' },
  { label: 'return', type: 'keyword' }, { label: 'then', type: 'keyword' }, { label: 'until', type: 'keyword' },
  { label: 'while', type: 'keyword' }, { label: 'goto', type: 'keyword', dialects: ['lua54'] },
  { label: 'continue', type: 'keyword', dialects: ['luau'] }, { label: 'type', type: 'keyword', dialects: ['luau'] },
  { label: 'export', type: 'keyword', dialects: ['luau'] }, { label: 'typeof', type: 'function', dialects: ['luau'] },
]);

export const STDLIB_COMPLETIONS = Object.freeze([
  'print', 'type', 'tostring', 'tonumber', 'pairs', 'ipairs', 'next', 'select', 'pcall', 'xpcall',
  'error', 'assert', 'setmetatable', 'getmetatable', 'rawget', 'rawset', 'rawequal', 'rawlen',
  'require', 'unpack', 'coroutine', 'string', 'table', 'math', 'io', 'os', 'utf8', 'debug',
  'task', 'bit32', 'buffer', 'vector', 'warn', 'tick',
]);
