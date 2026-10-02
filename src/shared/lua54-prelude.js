/**
 * Lua 5.4 execution prelude — shared by the Node child runner and the browser worker.
 *
 * Both hosts compile the user's source with `load(source, '@name', 'bt')` (so error messages
 * and line numbers refer to the original script) and install the same sandbox mirror:
 * `print`/`io.write`/`io.stderr` are redirected to host callbacks, returned values are
 * described as structured data, and a wall-clock hook aborts a runaway script.
 *
 * Globals the host must define before running this prelude:
 *   __lumen_output(text)        receives `print` and `io.write` output
 *   __lumen_error_output(text)  receives `io.stderr` output
 *   __lumen_report(payload)     receives the final result exactly once
 *   __lumen_name                script name shown in tracebacks
 *   __lumen_source              the Lua source text to execute
 *   __lumen_hook_count          hook interval in VM instructions
 *   __lumen_timeout_ms          0 disables the soft limit
 *   __lumen_now()               host wall clock (ms)
 *   __lumen_started_ms          wall clock at which the run started
 *
 * The report payload is `{ ok, valuesJson, kind, message, traceback, interrupted }` where
 * `valuesJson` is a JSON string (encoded inside the VM, so no host marshalling limits apply).
 * `kind` is one of `syntax` | `runtime` | `timeout`.
 */

export const LUA54_PRELUDE = `
local __raw_print = __lumen_output
local __raw_error = __lumen_error_output

function print(...)
  local n = select('#', ...)
  local parts = {}
  for i = 1, n do
    parts[i] = tostring((select(i, ...)))
  end
  __raw_print(table.concat(parts, '\\t'))
end

-- File and process access is intentionally absent from this runtime; the capability panel
-- reports that honestly instead of letting calls fail silently.
io = io or {}
if io.write == nil then
  io.write = function(...)
    local n = select('#', ...)
    local parts = {}
    for i = 1, n do parts[i] = tostring((select(i, ...))) end
    __raw_print(table.concat(parts))
    return io
  end
end
if io.stderr == nil then
  io.stderr = { write = function(self, ...)
    local n = select('#', ...)
    local parts = {}
    for i = 1, n do parts[i] = tostring((select(i, ...))) end
    __raw_error(table.concat(parts))
    return self
  end }
end
if io.flush == nil then io.flush = function() return true end end
if io.read == nil then io.read = function() return nil end end

-- Minimal JSON encoder used to describe returned values without relying on host marshalling.
local __json_escapes = {
  ['"'] = '\\\\"', ['\\\\'] = '\\\\\\\\', ['\\b'] = '\\\\b', ['\\f'] = '\\\\f',
  ['\\n'] = '\\\\n', ['\\r'] = '\\\\r', ['\\t'] = '\\\\t',
}
local function __json_string(value)
  local escaped = value:gsub('[%z\\1-\\31\\\\"]', function(char)
    local mapped = __json_escapes[char]
    if mapped then return mapped end
    return string.format('\\\\u%04x', char:byte())
  end)
  return '"' .. escaped .. '"'
end

local function __json_value(value, depth, seen)
  local kind = type(value)
  if value == nil then return 'null' end
  if kind == 'boolean' then return value and 'true' or 'false' end
  if kind == 'number' then
    if value ~= value then return '"nan"' end
    if value == math.huge then return '"inf"' end
    if value == -math.huge then return '"-inf"' end
    if math.type(value) == 'integer' then return string.format('%d', value) end
    return string.format('%.14g', value)
  end
  if kind == 'string' then return __json_string(value) end
  if kind == 'table' then
    if depth >= 3 then return '"<tabla>"' end
    if seen[value] then return '"<referencia circular>"' end
    seen[value] = true
    local count = 0
    for _ in pairs(value) do
      count = count + 1
      if count > 250 then break end
    end
    local isArray = count > 0 and #value == count
    local parts = {}
    if isArray then
      for index = 1, #value do
        parts[#parts + 1] = __json_value(value[index], depth + 1, seen)
      end
      seen[value] = nil
      return '[' .. table.concat(parts, ',') .. ']'
    end
    for key, item in pairs(value) do
      local keyText
      if type(key) == 'string' then keyText = __json_string(key)
      elseif type(key) == 'number' then keyText = __json_string(tostring(key))
      else keyText = __json_string('<' .. type(key) .. '>') end
      parts[#parts + 1] = keyText .. ':' .. __json_value(item, depth + 1, seen)
      if #parts >= 250 then
        parts[#parts + 1] = __json_string('<truncado>') .. ':"…"'
        break
      end
    end
    seen[value] = nil
    if #parts == 0 then return '{}' end
    return '{' .. table.concat(parts, ',') .. '}'
  end
  return __json_string(tostring(value))
end

local __chunk, __load_err = load(__lumen_source, '@' .. __lumen_name, 'bt')

if __chunk == nil then
  __lumen_report({ ok = false, kind = 'syntax', message = tostring(__load_err), traceback = nil })
  return
end

local __timeout_flag = false
if __lumen_timeout_ms and __lumen_timeout_ms > 0 then
  -- The hook runs every N VM instructions and aborts only when the *wall clock* provided by
  -- the host exceeds the configured timeout, so long computations are not cut short by an
  -- instruction budget.
  debug.sethook(function()
    if (__lumen_now() - __lumen_started_ms) >= __lumen_timeout_ms then
      __timeout_flag = true
      error('__LUMEN_SOFT_TIMEOUT__', 0)
    end
  end, '', __lumen_hook_count)
end

local function __handler(err)
  return tostring(err) .. '\\n' .. debug.traceback('', 2)
end

local __packed = table.pack(xpcall(__chunk, __handler))
debug.sethook()

if __packed[1] then
  local values = {}
  for index = 2, __packed.n do
    local value = __packed[index]
    local ok_json, encoded = pcall(__json_value, value, 0, {})
    values[#values + 1] = '{' .. '"type":' .. __json_string(type(value)) .. ',"value":'
      .. (ok_json and encoded or __json_string('<no serializable>')) .. '}'
  end
  __lumen_report({ ok = true, valuesJson = '[' .. table.concat(values, ',') .. ']' })
else
  local message = tostring(__packed[2])
  __lumen_report({
    ok = false,
    kind = __timeout_flag and 'timeout' or 'runtime',
    message = message,
    traceback = message,
    interrupted = __timeout_flag,
  })
end
`;

/** Options accepted by both hosts (documented once, used by runner and worker). */
export const LUA54_DEFAULT_OPTIONS = Object.freeze({
  timeoutMs: 5000,
  outputLimitBytes: 256 * 1024,
  interruptLimit: 1_000_000,
  memoryLimitBytes: null,
});

/**
 * Normalises execution options, so the Node runner and the browser worker behave identically.
 * @param {object} options
 */
export function normalizeLua54Options(options = {}) {
  return {
    timeoutMs: Number.isFinite(options.timeoutMs) && options.timeoutMs > 0 ? options.timeoutMs : 0,
    outputLimitBytes: Number.isFinite(options.outputLimitBytes) && options.outputLimitBytes > 0
      ? options.outputLimitBytes
      : LUA54_DEFAULT_OPTIONS.outputLimitBytes,
    interruptLimit: Number.isFinite(options.interruptLimit)
      ? Math.max(10_000, options.interruptLimit)
      : LUA54_DEFAULT_OPTIONS.interruptLimit,
    memoryLimitBytes: Number.isFinite(options.memoryLimitBytes) && options.memoryLimitBytes > 0
      ? options.memoryLimitBytes
      : null,
  };
}
