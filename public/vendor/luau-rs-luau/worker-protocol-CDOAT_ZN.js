//#region src/types.ts
const DEFAULT_EXECUTION_OPTIONS = Object.freeze({
	optimizationLevel: 1,
	debugLevel: 1,
	memoryLimitBytes: 33554432,
	interruptLimit: 25e4,
	outputLimitBytes: 65536,
	outputLimitEvents: 1024,
	resultLimitBytes: 1048576,
	resultLimitEntries: 16384
});
/** @internal */
const MAX_MODULE_NAME_BYTES = 2048;
/** @internal */
const MAX_MODULE_SOURCE_BYTES = 262144;
/** @internal */
const MAX_TOTAL_MODULE_SOURCE_BYTES = 1048576;
function isJsInterop(value) {
	if (!Array.isArray(value)) return false;
	for (const name of value) if (typeof name !== "string") return false;
	return true;
}
//#endregion
//#region src/utf8.ts
function isWellFormedString(value) {
	for (let index = 0; index < value.length; index += 1) {
		const code = value.charCodeAt(index);
		if (code >= 55296 && code <= 56319) {
			const next = value.charCodeAt(index + 1);
			if (!(next >= 56320 && next <= 57343)) return false;
			index += 1;
		} else if (code >= 56320 && code <= 57343) return false;
	}
	return true;
}
function assertWellFormedString(value) {
	if (!isWellFormedString(value)) throw new TypeError("JavaScript string contains an unpaired surrogate");
}
function utf8Length(value) {
	assertWellFormedString(value);
	let bytes = 0;
	for (let index = 0; index < value.length; index += 1) {
		const code = value.charCodeAt(index);
		if (code < 128) bytes += 1;
		else if (code < 2048) bytes += 2;
		else if (code >= 55296 && code <= 56319) {
			bytes += 4;
			index += 1;
		} else bytes += 3;
	}
	return bytes;
}
//#endregion
//#region src/values.ts
var LuaOutputEvent = class extends Event {
	text;
	constructor(type, text) {
		super(type);
		this.text = text;
	}
};
var LuaVector = class {
	x;
	y;
	z;
	constructor(x, y, z) {
		this.x = x;
		this.y = y;
		this.z = z;
	}
	toString() {
		return `vector(${this.x}, ${this.y}, ${this.z})`;
	}
};
//#endregion
//#region src/worker-protocol.ts
const MAX_SOURCE_BYTES = 262144;
const MAX_BYTECODE_BYTES = 4194304;
const MAX_DUMP_BYTES = 4194304;
const MAX_ERROR_BYTES = 65536;
const WORKER_RECYCLE_BYTES = 67108864;
const MAX_ENTRY_NAME_BYTES = 256;
const MAX_REQUEST_BYTES = 2097152;
const MAX_BYTECODE_REQUEST_BYTES = 6291456;
const MAX_REQUEST_ENTRIES = 4096;
const MIN_MEMORY_BYTES = 4194304;
const MAX_MEMORY_BYTES = 134217728;
const MIN_INTERRUPT_LIMIT = 1e3;
const MAX_INTERRUPT_LIMIT = 2e6;
const MIN_OUTPUT_BYTES = 1024;
const MAX_OUTPUT_BYTES = 262144;
const MIN_OUTPUT_EVENTS = 1;
const MAX_OUTPUT_EVENTS = 4096;
const MIN_RESULT_BYTES = 1024;
const MAX_RESULT_BYTES = 4194304;
const MIN_RESULT_ENTRIES = 1;
const MAX_RESULT_ENTRIES = 65536;
const utf8 = new TextEncoder();
const strictUtf8 = new TextDecoder("utf-8", { fatal: true });
var WorkerInputError = class extends RangeError {};
function encodeResolvedModule(value) {
	if (value === null || value === void 0) return void 0;
	if (typeof value !== "object" || Array.isArray(value) || !Object.hasOwn(value, "name") || !Object.hasOwn(value, "source") || Object.hasOwn(value, "value") || typeof value.name !== "string" || typeof value.source !== "string") throw new TypeError("module resolver must return a source module");
	const module = value;
	const nameBytes = utf8Length(module.name);
	if (!module.name || nameBytes > 2048 || module.name.includes("\0")) throw new WorkerInputError("resolved module name is invalid");
	const sourceBytes = utf8.encode(module.source);
	if (sourceBytes.byteLength > 262144) throw new WorkerInputError("resolved module source exceeds the per-file limit");
	return {
		name: module.name,
		source: sourceBytes
	};
}
function decodeResolvedModule(value) {
	if (value === void 0) return void 0;
	const [module] = validateModuleBytes([value]);
	return {
		name: module.name,
		source: strictUtf8.decode(module.source)
	};
}
function boundedErrorMessage(error) {
	let message = "host operation failed";
	if (typeof error === "object" && error !== null || typeof error === "function") try {
		const value = Reflect.get(error, "message");
		message = typeof value === "string" ? value : String(error);
	} catch {}
	else try {
		message = String(error);
	} catch {}
	const bytes = new Uint8Array(MAX_ERROR_BYTES);
	const { read, written } = utf8.encodeInto(message, bytes);
	const bounded = new TextDecoder().decode(bytes.subarray(0, written));
	return read === message.length ? bounded : `${bounded}\u2026`;
}
function copyJsInterop(value) {
	if (value === void 0) return value;
	if (!isJsInterop(value)) throw new TypeError("jsInterop must be an array of global names");
	if (value.length > MAX_REQUEST_ENTRIES) throw new WorkerInputError(`jsInterop contains ${value.length} names; the limit is ${MAX_REQUEST_ENTRIES}`);
	for (const name of value) if (utf8Length(name) > MAX_REQUEST_BYTES) throw new WorkerInputError("a jsInterop name exceeds the worker request limit");
	return [...value];
}
function prepareExecutionRequest(source, options, jsInterop, resolveModules) {
	const sourceBytes = encodeSource(source);
	const entryName = options.entryName ?? "main.luau";
	validateEntryName(entryName);
	const modules = encodeModules(options.modules ?? []);
	const normalized = normalizeOptions(options);
	const interop = copyJsInterop(jsInterop);
	enforceRequestBudget(sourceBytes, entryName, modules, normalized, interop);
	return {
		request: {
			action: "execute",
			input: sourceBytes,
			options: normalized,
			entryName,
			modules,
			resolveModules,
			jsInterop: interop,
			timing: options.timing ?? false
		},
		transfer: [sourceBytes.buffer, ...modules.map(({ source }) => source.buffer)]
	};
}
function prepareBytecodeExecutionRequest(bytecode, options, jsInterop, resolveModules) {
	if (!(bytecode instanceof Uint8Array)) throw new TypeError("Luau bytecode must be a Uint8Array");
	validateBytecodeBytes(bytecode);
	const transfer = options.transfer ?? false;
	if (typeof transfer !== "boolean") throw new TypeError("transfer must be a boolean");
	if (transfer && (!(bytecode.buffer instanceof ArrayBuffer) || bytecode.byteOffset !== 0 || bytecode.byteLength !== bytecode.buffer.byteLength)) throw new TypeError("transferred bytecode must cover its entire ArrayBuffer");
	const input = transfer ? bytecode : new Uint8Array(bytecode);
	const entryName = options.entryName ?? "main.luau";
	validateEntryName(entryName);
	const modules = encodeModules(options.modules ?? []);
	const normalized = normalizeOptions(options);
	const interop = copyJsInterop(jsInterop);
	enforceRequestBudget(input, entryName, modules, normalized, interop, MAX_BYTECODE_REQUEST_BYTES);
	return {
		request: {
			action: "executeBytecode",
			input,
			options: normalized,
			entryName,
			modules,
			resolveModules,
			jsInterop: interop,
			timing: options.timing ?? false
		},
		transfer: [input.buffer, ...modules.map(({ source }) => source.buffer)]
	};
}
function prepareCompileRequest(source, options, timing) {
	const sourceBytes = encodeSource(source);
	const normalized = normalizeCompilerOptions(options);
	enforceRequestBudget(sourceBytes, void 0, [], normalized, void 0);
	return {
		request: {
			action: "compile",
			input: sourceBytes,
			options: normalized,
			timing
		},
		transfer: [sourceBytes.buffer]
	};
}
function prepareDumpRequest(source, options, timing) {
	const sourceBytes = encodeSource(source);
	const normalized = normalizeCompilerOptions(options);
	const dumpOptions = normalizeDumpOptions(options);
	enforceRequestBudget(sourceBytes, void 0, [], normalized, void 0);
	return {
		request: {
			action: "dump",
			input: sourceBytes,
			options: normalized,
			dumpOptions,
			timing
		},
		transfer: [sourceBytes.buffer]
	};
}
function validateWorkerRequest(value) {
	if (typeof value !== "object" || value === null) throw new TypeError("worker request must be an object");
	const request = value;
	if (request.protocol !== 8) throw new TypeError("worker request uses an incompatible protocol");
	if (!Number.isSafeInteger(request.id) || (request.id ?? 0) < 1) throw new TypeError("worker request id must be a positive safe integer");
	if (request.action !== "execute" && request.action !== "executeBytecode" && request.action !== "compile" && request.action !== "dump") throw new TypeError("worker request action is invalid");
	if (!(request.input instanceof Uint8Array)) throw new TypeError("worker request input must be a Uint8Array");
	if (request.action === "executeBytecode") validateBytecodeBytes(request.input);
	else validateSourceBytes(request.input);
	if (request.timing !== void 0 && typeof request.timing !== "boolean") throw new TypeError("worker request timing must be a boolean");
	if (request.action === "compile" || request.action === "dump") {
		const options = normalizeCompilerOptions(request.options);
		if (request.entryName !== void 0 || request.modules !== void 0 || request.resolveModules !== void 0 || request.jsInterop !== void 0) throw new TypeError("compiler requests contain execution-only fields");
		if (request.action === "compile" && request.dumpOptions !== void 0) throw new TypeError("compiler requests cannot contain dump options");
		const dumpOptions = request.action === "dump" ? normalizeDumpOptions(request.dumpOptions) : void 0;
		enforceRequestBudget(request.input, void 0, [], options, void 0);
		return {
			...request,
			options,
			dumpOptions
		};
	}
	const options = normalizeOptions(request.options);
	if (typeof request.entryName !== "string") throw new TypeError("worker entry name must be a string");
	if (request.dumpOptions !== void 0) throw new TypeError("execution requests cannot contain dump options");
	if (typeof request.resolveModules !== "boolean") throw new TypeError("worker resolveModules must be a boolean");
	validateEntryName(request.entryName);
	if (!Array.isArray(request.modules)) throw new TypeError("worker modules must be an array");
	const modules = validateModuleBytes(request.modules);
	const jsInterop = copyJsInterop(request.jsInterop);
	enforceRequestBudget(request.input, request.entryName, modules, options, jsInterop, request.action === "executeBytecode" ? MAX_BYTECODE_REQUEST_BYTES : MAX_REQUEST_BYTES);
	return {
		...request,
		options,
		modules,
		jsInterop
	};
}
function normalizeOptions(options = {}) {
	if (typeof options !== "object" || options === null || Array.isArray(options)) throw new TypeError("Lua options must be an object");
	return {
		...normalizeCompilerOptions(options),
		memoryLimitBytes: boundedInteger(options.memoryLimitBytes, DEFAULT_EXECUTION_OPTIONS.memoryLimitBytes, MIN_MEMORY_BYTES, MAX_MEMORY_BYTES, "memoryLimitBytes"),
		interruptLimit: boundedInteger(options.interruptLimit, DEFAULT_EXECUTION_OPTIONS.interruptLimit, MIN_INTERRUPT_LIMIT, MAX_INTERRUPT_LIMIT, "interruptLimit"),
		outputLimitBytes: boundedInteger(options.outputLimitBytes, DEFAULT_EXECUTION_OPTIONS.outputLimitBytes, MIN_OUTPUT_BYTES, MAX_OUTPUT_BYTES, "outputLimitBytes"),
		outputLimitEvents: boundedInteger(options.outputLimitEvents, DEFAULT_EXECUTION_OPTIONS.outputLimitEvents, MIN_OUTPUT_EVENTS, MAX_OUTPUT_EVENTS, "outputLimitEvents"),
		resultLimitBytes: boundedInteger(options.resultLimitBytes, DEFAULT_EXECUTION_OPTIONS.resultLimitBytes, MIN_RESULT_BYTES, MAX_RESULT_BYTES, "resultLimitBytes"),
		resultLimitEntries: boundedInteger(options.resultLimitEntries, DEFAULT_EXECUTION_OPTIONS.resultLimitEntries, MIN_RESULT_ENTRIES, MAX_RESULT_ENTRIES, "resultLimitEntries")
	};
}
function normalizeCompilerOptions(options = {}) {
	if (typeof options !== "object" || options === null || Array.isArray(options)) throw new TypeError("compiler options must be an object");
	return {
		optimizationLevel: boundedInteger(options.optimizationLevel, DEFAULT_EXECUTION_OPTIONS.optimizationLevel, 0, 2, "optimizationLevel"),
		debugLevel: boundedInteger(options.debugLevel, DEFAULT_EXECUTION_OPTIONS.debugLevel, 0, 2, "debugLevel"),
		typeInfoLevel: boundedInteger(options.typeInfoLevel, 0, 0, 1, "typeInfoLevel"),
		coverageLevel: boundedInteger(options.coverageLevel, 0, 0, 2, "coverageLevel"),
		vectorConstructor: optionalString(options.vectorConstructor, "vectorConstructor"),
		vectorType: optionalString(options.vectorType, "vectorType"),
		mutableGlobals: stringArray(options.mutableGlobals, "mutableGlobals"),
		userdataTypes: stringArray(options.userdataTypes, "userdataTypes"),
		disabledBuiltins: stringArray(options.disabledBuiltins, "disabledBuiltins"),
		libraryConstants: libraryConstants(options.libraryConstants)
	};
}
function normalizeDumpOptions(options) {
	if (options === void 0) options = {};
	if (typeof options !== "object" || options === null || Array.isArray(options)) throw new TypeError("dump options must be an object");
	return {
		code: optionalBoolean(options.code, true, "code"),
		lines: optionalBoolean(options.lines, true, "lines"),
		source: optionalBoolean(options.source, false, "source"),
		locals: optionalBoolean(options.locals, false, "locals"),
		remarks: optionalBoolean(options.remarks, false, "remarks"),
		types: optionalBoolean(options.types, false, "types"),
		constants: optionalBoolean(options.constants, false, "constants")
	};
}
function encodeSource(source) {
	if (typeof source !== "string") throw new TypeError("Luau source must be a string");
	if (utf8Length(source) > 262144) throw new WorkerInputError(`source exceeds the ${MAX_SOURCE_BYTES}-byte worker limit`);
	return utf8.encode(source);
}
function validateSourceBytes(source) {
	if (source.byteLength > 262144) throw new WorkerInputError(`source is ${source.byteLength} bytes; the worker limit is ${MAX_SOURCE_BYTES} bytes`);
	try {
		strictUtf8.decode(source);
	} catch {
		throw new WorkerInputError("worker source must be valid UTF-8");
	}
}
function validateBytecodeBytes(bytecode) {
	if (bytecode.byteLength > 4194304) throw new WorkerInputError(`bytecode is ${bytecode.byteLength} bytes; the worker limit is ${MAX_BYTECODE_BYTES} bytes`);
}
function validateEntryName(name) {
	const bytes = utf8Length(name);
	if (!name || bytes > MAX_ENTRY_NAME_BYTES || name.includes("\0")) throw new WorkerInputError(`invalid entry name; expected 1 to ${MAX_ENTRY_NAME_BYTES} UTF-8 bytes without NUL`);
}
function encodeModules(modules) {
	if (!Array.isArray(modules)) throw new TypeError("modules must contain string names and sources");
	if (modules.length > 32) throw new WorkerInputError(`the worker accepts at most 32 modules`);
	const encoded = [];
	for (const module of modules) {
		if (typeof module !== "object" || module === null || typeof module.name !== "string" || typeof module.source !== "string") throw new TypeError("modules must contain string names and sources");
		if (utf8Length(module.source) > 262144) throw new WorkerInputError(`module ${JSON.stringify(module.name)} exceeds the ${MAX_MODULE_SOURCE_BYTES}-byte per-file limit`);
		encoded.push({
			name: module.name,
			source: utf8.encode(module.source)
		});
	}
	return validateModules(encoded);
}
function validateModuleBytes(modules) {
	if (modules.length > 32) throw new WorkerInputError(`the worker accepts at most 32 modules`);
	return validateModules(modules.map((module) => {
		if (typeof module !== "object" || module === null || typeof module.name !== "string" || !(module.source instanceof Uint8Array)) throw new TypeError("worker modules must contain names and Uint8Array sources");
		return {
			name: module.name,
			source: module.source
		};
	}));
}
function validateModules(modules) {
	if (modules.length > 32) throw new WorkerInputError(`the worker accepts at most 32 modules`);
	const names = /* @__PURE__ */ new Set();
	let totalBytes = 0;
	for (const module of modules) {
		const nameBytes = utf8Length(module.name);
		if (!module.name || nameBytes > 2048 || module.name.includes("\0")) throw new WorkerInputError(`invalid module name ${JSON.stringify(module.name)}`);
		if (names.has(module.name)) throw new WorkerInputError(`duplicate module name ${JSON.stringify(module.name)}`);
		names.add(module.name);
		if (module.source.byteLength > 262144) throw new WorkerInputError(`module ${JSON.stringify(module.name)} is ${module.source.byteLength} bytes; the per-file limit is ${MAX_MODULE_SOURCE_BYTES} bytes`);
		try {
			strictUtf8.decode(module.source);
		} catch {
			throw new WorkerInputError(`module ${JSON.stringify(module.name)} must be valid UTF-8`);
		}
		totalBytes += module.source.byteLength;
	}
	if (totalBytes > 1048576) throw new WorkerInputError(`module sources total ${totalBytes} bytes; the worker limit is ${MAX_TOTAL_MODULE_SOURCE_BYTES} bytes`);
	return modules;
}
function enforceRequestBudget(input, entryName, modules, options, jsInterop, byteLimit = MAX_REQUEST_BYTES) {
	let bytes = input.byteLength + 256;
	let entries = 1;
	const add = (value) => {
		bytes += utf8Length(value) + 8;
		entries += 1;
	};
	if (entryName !== void 0) add(entryName);
	for (const module of modules) {
		add(module.name);
		bytes += module.source.byteLength;
		entries += 1;
	}
	add(options.vectorConstructor);
	add(options.vectorType);
	for (const values of [
		options.mutableGlobals,
		options.userdataTypes,
		options.disabledBuiltins
	]) for (const value of values) add(value);
	for (const [name, value] of Object.entries(options.libraryConstants)) {
		add(name);
		if (typeof value === "string") add(value);
		else entries += 1;
	}
	for (const name of jsInterop ?? []) add(name);
	if (entries > MAX_REQUEST_ENTRIES) throw new WorkerInputError(`worker request contains ${entries} entries; the limit is ${MAX_REQUEST_ENTRIES}`);
	if (bytes > byteLimit) throw new WorkerInputError(`worker request is at least ${bytes} bytes; the limit is ${byteLimit} bytes`);
}
function boundedInteger(value, fallback, minimum, maximum, name) {
	if (value === void 0) return fallback;
	if (typeof value !== "number" || !Number.isFinite(value)) throw new TypeError(`${name} must be a finite number`);
	return Math.min(maximum, Math.max(minimum, Math.trunc(value)));
}
function optionalString(value, name) {
	if (value === void 0) return "";
	if (typeof value !== "string") throw new TypeError(`${name} must be a string`);
	return value;
}
function optionalBoolean(value, fallback, name) {
	if (value === void 0) return fallback;
	if (typeof value !== "boolean") throw new TypeError(`${name} must be a boolean`);
	return value;
}
function stringArray(value, name) {
	if (value === void 0) return [];
	if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) throw new TypeError(`${name} must be an array of strings`);
	if (value.length > MAX_REQUEST_ENTRIES) throw new WorkerInputError(`${name} contains ${value.length} entries; the limit is ${MAX_REQUEST_ENTRIES}`);
	return [...value];
}
function libraryConstants(value) {
	if (value === void 0) return {};
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError("libraryConstants must be an object");
	const names = Object.keys(value);
	if (names.length > MAX_REQUEST_ENTRIES) throw new WorkerInputError(`libraryConstants contains ${names.length} entries; the limit is ${MAX_REQUEST_ENTRIES}`);
	const result = Object.create(null);
	for (const name of names) {
		const constant = value[name];
		if (constant !== null && typeof constant !== "boolean" && typeof constant !== "number" && typeof constant !== "bigint" && typeof constant !== "string") throw new TypeError(`library constant ${JSON.stringify(name)} has an invalid value`);
		if (typeof constant === "number" && !Number.isFinite(constant)) throw new TypeError(`library constant ${JSON.stringify(name)} must be finite`);
		if (typeof constant === "bigint" && (constant < -9223372036854775808n || constant > 9223372036854775807n)) throw new RangeError(`library constant ${JSON.stringify(name)} is outside the Lua integer range`);
		result[name] = constant;
	}
	return result;
}
//#endregion
export { MAX_TOTAL_MODULE_SOURCE_BYTES as S, assertWellFormedString as _, WorkerInputError as a, MAX_MODULE_NAME_BYTES as b, decodeResolvedModule as c, prepareCompileRequest as d, prepareDumpRequest as f, LuaVector as g, LuaOutputEvent as h, WORKER_RECYCLE_BYTES as i, encodeResolvedModule as l, validateWorkerRequest as m, MAX_DUMP_BYTES as n, boundedErrorMessage as o, prepareExecutionRequest as p, MAX_ERROR_BYTES as r, copyJsInterop as s, MAX_BYTECODE_BYTES as t, prepareBytecodeExecutionRequest as u, utf8Length as v, MAX_MODULE_SOURCE_BYTES as x, DEFAULT_EXECUTION_OPTIONS as y };
