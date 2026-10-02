//#region \0rolldown/runtime.js
var __defProp = Object.defineProperty;
var __exportAll = (all, no_symbols) => {
	let target = {};
	for (var name in all) __defProp(target, name, {
		get: all[name],
		enumerable: true
	});
	if (!no_symbols) __defProp(target, Symbol.toStringTag, { value: "Module" });
	return target;
};
//#endregion
//#region \0wasm-helpers.js
function instantiate(source, imports, stream) {
	const instantiate = WebAssembly[stream ? "instantiateStreaming" : "instantiate"];
	return instantiate(source, imports).then(({ instance }) => instance);
}
function loadWasmModule(sync, fileUrl, src, imports) {
	let buf = null;
	const isNode = typeof process !== "undefined" && process.versions != null && process.versions.node != null;
	if (fileUrl && isNode) {
		const { readFile } = process.getBuiltinModule("fs/promises");
		return readFile(fileUrl).then((buffer) => instantiate(buffer, imports));
	} else if (fileUrl) return instantiate(fetch(fileUrl), imports, true);
	if (isNode) buf = Buffer.from(src, "base64");
	else {
		const raw = globalThis.atob(src);
		const len = raw.length;
		buf = new Uint8Array(new ArrayBuffer(len));
		for (let i = 0; i < len; i++) buf[i] = raw.charCodeAt(i);
	}
	if (sync) {
		const mod = new WebAssembly.Module(buf);
		return new WebAssembly.Instance(mod, imports);
	} else return instantiate(buf, imports);
}
//#endregion
//#region src/wasm-analysis/luau_analysis_wasm_bg.js
var WasmAnalysis = class {
	__destroy_into_raw() {
		const ptr = this.__wbg_ptr;
		this.__wbg_ptr = 0;
		WasmAnalysisFinalization.unregister(this);
		return ptr;
	}
	free() {
		const ptr = this.__destroy_into_raw();
		wasm.__wbg_wasmanalysis_free(ptr, 0);
	}
	/**
	* @param {string} name
	* @param {string} source
	* @param {string | null} [environment]
	*/
	addDefinition(name, source, environment) {
		const ptr0 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
		const len0 = WASM_VECTOR_LEN;
		const ptr1 = passStringToWasm0(source, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
		const len1 = WASM_VECTOR_LEN;
		var ptr2 = isLikeNone(environment) ? 0 : passStringToWasm0(environment, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
		var len2 = WASM_VECTOR_LEN;
		const ret = wasm.wasmanalysis_addDefinition(this.__wbg_ptr, ptr0, len0, ptr1, len1, ptr2, len2);
		if (ret[1]) throw takeFromExternrefTable0(ret[0]);
	}
	/**
	* @param {string} name
	* @param {number} line
	* @param {number} column
	* @returns {any}
	*/
	autocomplete(name, line, column) {
		const ptr0 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
		const len0 = WASM_VECTOR_LEN;
		const ret = wasm.wasmanalysis_autocomplete(this.__wbg_ptr, ptr0, len0, line, column);
		if (ret[2]) throw takeFromExternrefTable0(ret[1]);
		return takeFromExternrefTable0(ret[0]);
	}
	beginOperation() {
		wasm.wasmanalysis_beginOperation(this.__wbg_ptr);
	}
	/**
	* @param {string[]} names
	* @returns {any}
	*/
	checkModules(names) {
		const ptr0 = passArrayJsValueToWasm0(names, wasm.__wbindgen_malloc);
		const len0 = WASM_VECTOR_LEN;
		const ret = wasm.wasmanalysis_checkModules(this.__wbg_ptr, ptr0, len0);
		if (ret[2]) throw takeFromExternrefTable0(ret[1]);
		return takeFromExternrefTable0(ret[0]);
	}
	/**
	* @param {string} name
	* @returns {any}
	*/
	check(name) {
		const ptr0 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
		const len0 = WASM_VECTOR_LEN;
		const ret = wasm.wasmanalysis_check(this.__wbg_ptr, ptr0, len0);
		if (ret[2]) throw takeFromExternrefTable0(ret[1]);
		return takeFromExternrefTable0(ret[0]);
	}
	clearModules() {
		wasm.wasmanalysis_clearModules(this.__wbg_ptr);
	}
	/**
	* @param {string} name
	* @returns {string | undefined}
	*/
	decorateWithTypes(name) {
		const ptr0 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
		const len0 = WASM_VECTOR_LEN;
		const ret = wasm.wasmanalysis_decorateWithTypes(this.__wbg_ptr, ptr0, len0);
		if (ret[3]) throw takeFromExternrefTable0(ret[2]);
		let v2;
		if (ret[0] !== 0) {
			v2 = getStringFromWasm0(ret[0], ret[1]);
			wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
		}
		return v2;
	}
	/**
	* @param {string} name
	* @returns {boolean}
	*/
	deleteModule(name) {
		const ptr0 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
		const len0 = WASM_VECTOR_LEN;
		return wasm.wasmanalysis_deleteModule(this.__wbg_ptr, ptr0, len0) !== 0;
	}
	/**
	* @param {string} name
	* @param {number} line
	* @param {number} column
	* @returns {string | undefined}
	*/
	documentationSymbolAt(name, line, column) {
		const ptr0 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
		const len0 = WASM_VECTOR_LEN;
		const ret = wasm.wasmanalysis_documentationSymbolAt(this.__wbg_ptr, ptr0, len0, line, column);
		if (ret[3]) throw takeFromExternrefTable0(ret[2]);
		let v2;
		if (ret[0] !== 0) {
			v2 = getStringFromWasm0(ret[0], ret[1]);
			wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
		}
		return v2;
	}
	/**
	* @param {string} name
	* @param {number} line
	* @param {number} column
	* @returns {string | undefined}
	*/
	expectedTypeAt(name, line, column) {
		const ptr0 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
		const len0 = WASM_VECTOR_LEN;
		const ret = wasm.wasmanalysis_expectedTypeAt(this.__wbg_ptr, ptr0, len0, line, column);
		if (ret[3]) throw takeFromExternrefTable0(ret[2]);
		let v2;
		if (ret[0] !== 0) {
			v2 = getStringFromWasm0(ret[0], ret[1]);
			wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
		}
		return v2;
	}
	/**
	* @param {string} name
	* @param {string} source
	* @param {number} line
	* @param {number} column
	* @returns {any}
	*/
	fragmentAutocomplete(name, source, line, column) {
		const ptr0 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
		const len0 = WASM_VECTOR_LEN;
		const ptr1 = passStringToWasm0(source, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
		const len1 = WASM_VECTOR_LEN;
		const ret = wasm.wasmanalysis_fragmentAutocomplete(this.__wbg_ptr, ptr0, len0, ptr1, len1, line, column);
		if (ret[2]) throw takeFromExternrefTable0(ret[1]);
		return takeFromExternrefTable0(ret[0]);
	}
	/**
	* @param {string} name
	* @param {number} line
	* @param {number} column
	* @returns {any}
	*/
	inspectAt(name, line, column) {
		const ptr0 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
		const len0 = WASM_VECTOR_LEN;
		const ret = wasm.wasmanalysis_inspectAt(this.__wbg_ptr, ptr0, len0, line, column);
		if (ret[2]) throw takeFromExternrefTable0(ret[1]);
		return takeFromExternrefTable0(ret[0]);
	}
	/**
	* @param {string} name
	* @returns {string | undefined}
	*/
	moduleReturnType(name) {
		const ptr0 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
		const len0 = WASM_VECTOR_LEN;
		const ret = wasm.wasmanalysis_moduleReturnType(this.__wbg_ptr, ptr0, len0);
		if (ret[3]) throw takeFromExternrefTable0(ret[2]);
		let v2;
		if (ret[0] !== 0) {
			v2 = getStringFromWasm0(ret[0], ret[1]);
			wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
		}
		return v2;
	}
	/**
	* @param {string} mode
	* @param {boolean} lint
	* @param {string[]} globals
	* @param {number | null} [max_table_length]
	* @param {number | null} [max_type_length]
	*/
	constructor(mode, lint, globals, max_table_length, max_type_length) {
		const ptr0 = passStringToWasm0(mode, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
		const len0 = WASM_VECTOR_LEN;
		const ptr1 = passArrayJsValueToWasm0(globals, wasm.__wbindgen_malloc);
		const len1 = WASM_VECTOR_LEN;
		const ret = wasm.wasmanalysis_new(ptr0, len0, lint, ptr1, len1, isLikeNone(max_table_length) ? Number.MAX_SAFE_INTEGER : max_table_length >>> 0, isLikeNone(max_type_length) ? Number.MAX_SAFE_INTEGER : max_type_length >>> 0);
		if (ret[2]) throw takeFromExternrefTable0(ret[1]);
		this.__wbg_ptr = ret[0];
		WasmAnalysisFinalization.register(this, this.__wbg_ptr, this);
		return this;
	}
	/**
	* @param {string} name
	* @returns {string[]}
	*/
	requiredModules(name) {
		const ptr0 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
		const len0 = WASM_VECTOR_LEN;
		const ret = wasm.wasmanalysis_requiredModules(this.__wbg_ptr, ptr0, len0);
		if (ret[3]) throw takeFromExternrefTable0(ret[2]);
		var v2 = getArrayJsValueFromWasm0(ret[0], ret[1]);
		wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
		return v2;
	}
	/**
	* @param {string} from
	* @param {string} specifier
	* @param {string | null} [name]
	* @param {string | null} [source]
	* @param {string | null} [kind]
	* @param {string | null} [environment]
	*/
	resolveModule(from, specifier, name, source, kind, environment) {
		const ptr0 = passStringToWasm0(from, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
		const len0 = WASM_VECTOR_LEN;
		const ptr1 = passStringToWasm0(specifier, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
		const len1 = WASM_VECTOR_LEN;
		var ptr2 = isLikeNone(name) ? 0 : passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
		var len2 = WASM_VECTOR_LEN;
		var ptr3 = isLikeNone(source) ? 0 : passStringToWasm0(source, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
		var len3 = WASM_VECTOR_LEN;
		var ptr4 = isLikeNone(kind) ? 0 : passStringToWasm0(kind, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
		var len4 = WASM_VECTOR_LEN;
		var ptr5 = isLikeNone(environment) ? 0 : passStringToWasm0(environment, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
		var len5 = WASM_VECTOR_LEN;
		const ret = wasm.wasmanalysis_resolveModule(this.__wbg_ptr, ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, ptr4, len4, ptr5, len5);
		if (ret[1]) throw takeFromExternrefTable0(ret[0]);
	}
	/**
	* @param {string[]} globals
	*/
	setGlobals(globals) {
		const ptr0 = passArrayJsValueToWasm0(globals, wasm.__wbindgen_malloc);
		const len0 = WASM_VECTOR_LEN;
		wasm.wasmanalysis_setGlobals(this.__wbg_ptr, ptr0, len0);
	}
	/**
	* @param {boolean} lint
	*/
	setLint(lint) {
		wasm.wasmanalysis_setLint(this.__wbg_ptr, lint);
	}
	/**
	* @param {string} mode
	*/
	setMode(mode) {
		const ptr0 = passStringToWasm0(mode, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
		const len0 = WASM_VECTOR_LEN;
		const ret = wasm.wasmanalysis_setMode(this.__wbg_ptr, ptr0, len0);
		if (ret[1]) throw takeFromExternrefTable0(ret[0]);
	}
	/**
	* @param {string} name
	* @param {string} source
	* @param {string} kind
	* @param {string | null} [environment]
	*/
	setModule(name, source, kind, environment) {
		const ptr0 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
		const len0 = WASM_VECTOR_LEN;
		const ptr1 = passStringToWasm0(source, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
		const len1 = WASM_VECTOR_LEN;
		const ptr2 = passStringToWasm0(kind, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
		const len2 = WASM_VECTOR_LEN;
		var ptr3 = isLikeNone(environment) ? 0 : passStringToWasm0(environment, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
		var len3 = WASM_VECTOR_LEN;
		const ret = wasm.wasmanalysis_setModule(this.__wbg_ptr, ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3);
		if (ret[1]) throw takeFromExternrefTable0(ret[0]);
	}
	/**
	* @returns {any}
	*/
	takeModuleRequests() {
		const ret = wasm.wasmanalysis_takeModuleRequests(this.__wbg_ptr);
		if (ret[2]) throw takeFromExternrefTable0(ret[1]);
		return takeFromExternrefTable0(ret[0]);
	}
	/**
	* @param {string} name
	* @param {number} line
	* @param {number} column
	* @returns {string | undefined}
	*/
	typeAt(name, line, column) {
		const ptr0 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
		const len0 = WASM_VECTOR_LEN;
		const ret = wasm.wasmanalysis_typeAt(this.__wbg_ptr, ptr0, len0, line, column);
		if (ret[3]) throw takeFromExternrefTable0(ret[2]);
		let v2;
		if (ret[0] !== 0) {
			v2 = getStringFromWasm0(ret[0], ret[1]);
			wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
		}
		return v2;
	}
};
if (Symbol.dispose) WasmAnalysis.prototype[Symbol.dispose] = WasmAnalysis.prototype.free;
function start() {
	wasm.start();
}
/**
* @returns {string}
*/
function version() {
	let deferred1_0;
	let deferred1_1;
	try {
		const ret = wasm.version();
		deferred1_0 = ret[0];
		deferred1_1 = ret[1];
		return getStringFromWasm0(ret[0], ret[1]);
	} finally {
		wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
	}
}
function __wbg_Error_67e7344beaa85059(arg0, arg1) {
	return Error(getStringFromWasm0(arg0, arg1));
}
function __wbg_String_8564e559799eccda(arg0, arg1) {
	const ptr1 = passStringToWasm0(String(arg1), wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
	const len1 = WASM_VECTOR_LEN;
	getDataViewMemory0().setInt32(arg0 + 4, len1, true);
	getDataViewMemory0().setInt32(arg0 + 0, ptr1, true);
}
function __wbg___wbindgen_string_get_92ab86bb19cbc12f(arg0, arg1) {
	const obj = arg1;
	const ret = typeof obj === "string" ? obj : void 0;
	var ptr1 = isLikeNone(ret) ? 0 : passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
	var len1 = WASM_VECTOR_LEN;
	getDataViewMemory0().setInt32(arg0 + 4, len1, true);
	getDataViewMemory0().setInt32(arg0 + 0, ptr1, true);
}
function __wbg___wbindgen_throw_5d9e815e6fdf150f(arg0, arg1) {
	throw new Error(getStringFromWasm0(arg0, arg1));
}
function __wbg_error_757e9472f8410341(arg0, arg1) {
	let deferred0_0;
	let deferred0_1;
	try {
		deferred0_0 = arg0;
		deferred0_1 = arg1;
		console.error(getStringFromWasm0(arg0, arg1));
	} finally {
		wasm.__wbindgen_free(deferred0_0, deferred0_1, 1);
	}
}
function __wbg_new_227d7c05414eb861() {
	return /* @__PURE__ */ new Error();
}
function __wbg_new_bebc3f4757acf305() {
	return /* @__PURE__ */ new Object();
}
function __wbg_new_ffa92086ea89f79c() {
	return new Array();
}
function __wbg_now_d1fb6650485d7f3e() {
	return Date.now();
}
function __wbg_set_13d25b81ab403f5e(arg0, arg1, arg2) {
	arg0[arg1 >>> 0] = arg2;
}
function __wbg_set_6be42768c690e380(arg0, arg1, arg2) {
	arg0[arg1] = arg2;
}
function __wbg_stack_3b0d974bbf31e44f(arg0, arg1) {
	const ret = arg1.stack;
	const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
	const len1 = WASM_VECTOR_LEN;
	getDataViewMemory0().setInt32(arg0 + 4, len1, true);
	getDataViewMemory0().setInt32(arg0 + 0, ptr1, true);
}
function __wbindgen_generic_0000000000000001(arg0) {
	return arg0;
}
function __wbindgen_generic_0000000000000002(arg0, arg1) {
	return getStringFromWasm0(arg0, arg1);
}
function __wbindgen_init_externref_table() {
	const table = wasm.__wbindgen_externrefs;
	const offset = table.grow(4);
	table.set(0, void 0);
	table.set(offset + 0, void 0);
	table.set(offset + 1, null);
	table.set(offset + 2, true);
	table.set(offset + 3, false);
}
const memory$1 = new WebAssembly.Memory({ initial: 32 });
const WasmAnalysisFinalization = typeof FinalizationRegistry === "undefined" ? {
	register: () => {},
	unregister: () => {}
} : new FinalizationRegistry((ptr) => wasm.__wbg_wasmanalysis_free(ptr, 1));
function addToExternrefTable0(obj) {
	const idx = wasm.__externref_table_alloc();
	wasm.__wbindgen_externrefs.set(idx, obj);
	return idx;
}
function getArrayJsValueFromWasm0(ptr, len) {
	ptr = ptr >>> 0;
	const mem = getDataViewMemory0();
	const result = [];
	for (let i = ptr; i < ptr + 4 * len; i += 4) result.push(wasm.__wbindgen_externrefs.get(mem.getUint32(i, true)));
	wasm.__externref_drop_slice(ptr, len);
	return result;
}
let cachedDataViewMemory0 = null;
function getDataViewMemory0() {
	if (cachedDataViewMemory0 === null || cachedDataViewMemory0.buffer.detached === true || cachedDataViewMemory0.buffer.detached === void 0 && cachedDataViewMemory0.buffer !== wasm.memory.buffer) cachedDataViewMemory0 = new DataView(wasm.memory.buffer);
	return cachedDataViewMemory0;
}
function getStringFromWasm0(ptr, len) {
	return decodeText(ptr >>> 0, len);
}
let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
	if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
	return cachedUint8ArrayMemory0;
}
function isLikeNone(x) {
	return x === void 0 || x === null;
}
function passArrayJsValueToWasm0(array, malloc) {
	const ptr = malloc(array.length * 4, 4) >>> 0;
	for (let i = 0; i < array.length; i++) {
		const add = addToExternrefTable0(array[i]);
		getDataViewMemory0().setUint32(ptr + 4 * i, add, true);
	}
	WASM_VECTOR_LEN = array.length;
	return ptr;
}
function passStringToWasm0(arg, malloc, realloc) {
	if (realloc === void 0) {
		const buf = cachedTextEncoder.encode(arg);
		const ptr = malloc(buf.length, 1) >>> 0;
		getUint8ArrayMemory0().subarray(ptr, ptr + buf.length).set(buf);
		WASM_VECTOR_LEN = buf.length;
		return ptr;
	}
	let len = arg.length;
	let ptr = malloc(len, 1) >>> 0;
	const mem = getUint8ArrayMemory0();
	let offset = 0;
	for (; offset < len; offset++) {
		const code = arg.charCodeAt(offset);
		if (code > 127) break;
		mem[ptr + offset] = code;
	}
	if (offset !== len) {
		if (offset !== 0) arg = arg.slice(offset);
		ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;
		const view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len);
		const ret = cachedTextEncoder.encodeInto(arg, view);
		offset += ret.written;
		ptr = realloc(ptr, len, offset, 1) >>> 0;
	}
	WASM_VECTOR_LEN = offset;
	return ptr;
}
function takeFromExternrefTable0(idx) {
	const value = wasm.__wbindgen_externrefs.get(idx);
	wasm.__externref_table_dealloc(idx);
	return value;
}
let cachedTextDecoder = new TextDecoder("utf-8", {
	ignoreBOM: true,
	fatal: true
});
cachedTextDecoder.decode();
const MAX_SAFARI_DECODE_BYTES = 2146435072;
let numBytesDecoded = 0;
function decodeText(ptr, len) {
	numBytesDecoded += len;
	if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
		cachedTextDecoder = new TextDecoder("utf-8", {
			ignoreBOM: true,
			fatal: true
		});
		cachedTextDecoder.decode();
		numBytesDecoded = len;
	}
	return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}
const cachedTextEncoder = new TextEncoder();
if (!("encodeInto" in cachedTextEncoder)) cachedTextEncoder.encodeInto = function(arg, view) {
	const buf = cachedTextEncoder.encode(arg);
	view.set(buf);
	return {
		read: arg.length,
		written: buf.length
	};
};
let WASM_VECTOR_LEN = 0;
let wasm;
function __wbg_set_wasm(val) {
	wasm = val;
}
//#endregion
//#region src/wasm-analysis/luau_analysis_wasm_bg.wasm
var luau_analysis_wasm_bg_exports = /* @__PURE__ */ __exportAll({
	__abort_handler: () => __abort_handler,
	__externref_drop_slice: () => __externref_drop_slice,
	__externref_table_alloc: () => __externref_table_alloc,
	__externref_table_dealloc: () => __externref_table_dealloc,
	__instance_terminated: () => __instance_terminated,
	__wbg_wasmanalysis_free: () => __wbg_wasmanalysis_free,
	__wbindgen_externrefs: () => __wbindgen_externrefs,
	__wbindgen_free: () => __wbindgen_free,
	__wbindgen_malloc: () => __wbindgen_malloc,
	__wbindgen_realloc: () => __wbindgen_realloc,
	__wbindgen_start: () => __wbindgen_start,
	memory: () => memory,
	start: () => start$1,
	version: () => version$1,
	wasmanalysis_addDefinition: () => wasmanalysis_addDefinition,
	wasmanalysis_autocomplete: () => wasmanalysis_autocomplete,
	wasmanalysis_beginOperation: () => wasmanalysis_beginOperation,
	wasmanalysis_check: () => wasmanalysis_check,
	wasmanalysis_checkModules: () => wasmanalysis_checkModules,
	wasmanalysis_clearModules: () => wasmanalysis_clearModules,
	wasmanalysis_decorateWithTypes: () => wasmanalysis_decorateWithTypes,
	wasmanalysis_deleteModule: () => wasmanalysis_deleteModule,
	wasmanalysis_documentationSymbolAt: () => wasmanalysis_documentationSymbolAt,
	wasmanalysis_expectedTypeAt: () => wasmanalysis_expectedTypeAt,
	wasmanalysis_fragmentAutocomplete: () => wasmanalysis_fragmentAutocomplete,
	wasmanalysis_inspectAt: () => wasmanalysis_inspectAt,
	wasmanalysis_moduleReturnType: () => wasmanalysis_moduleReturnType,
	wasmanalysis_new: () => wasmanalysis_new,
	wasmanalysis_requiredModules: () => wasmanalysis_requiredModules,
	wasmanalysis_resolveModule: () => wasmanalysis_resolveModule,
	wasmanalysis_setGlobals: () => wasmanalysis_setGlobals,
	wasmanalysis_setLint: () => wasmanalysis_setLint,
	wasmanalysis_setMode: () => wasmanalysis_setMode,
	wasmanalysis_setModule: () => wasmanalysis_setModule,
	wasmanalysis_takeModuleRequests: () => wasmanalysis_takeModuleRequests,
	wasmanalysis_typeAt: () => wasmanalysis_typeAt
});
function __wasm_init(imports) {
	return loadWasmModule(false, new URL("luau_analysis_wasm_bg.wasm", import.meta.url), null, imports);
}
const instance = await __wasm_init({ "./luau_analysis_wasm_bg.js": {
	"__wbg_set_13d25b81ab403f5e": __wbg_set_13d25b81ab403f5e,
	"__wbg_new_227d7c05414eb861": __wbg_new_227d7c05414eb861,
	"__wbg_stack_3b0d974bbf31e44f": __wbg_stack_3b0d974bbf31e44f,
	"__wbg_error_757e9472f8410341": __wbg_error_757e9472f8410341,
	"__wbg_set_6be42768c690e380": __wbg_set_6be42768c690e380,
	"__wbg_String_8564e559799eccda": __wbg_String_8564e559799eccda,
	"__wbg_new_bebc3f4757acf305": __wbg_new_bebc3f4757acf305,
	"__wbg_new_ffa92086ea89f79c": __wbg_new_ffa92086ea89f79c,
	"__wbg_now_d1fb6650485d7f3e": __wbg_now_d1fb6650485d7f3e,
	"__wbg___wbindgen_throw_5d9e815e6fdf150f": __wbg___wbindgen_throw_5d9e815e6fdf150f,
	"__wbg_Error_67e7344beaa85059": __wbg_Error_67e7344beaa85059,
	"__wbg___wbindgen_string_get_92ab86bb19cbc12f": __wbg___wbindgen_string_get_92ab86bb19cbc12f,
	"__wbindgen_init_externref_table": __wbindgen_init_externref_table,
	"__wbindgen_generic_0000000000000001": __wbindgen_generic_0000000000000001,
	"__wbindgen_generic_0000000000000002": __wbindgen_generic_0000000000000002,
	"memory": memory$1
} });
const __wbg_wasmanalysis_free = instance.exports.__wbg_wasmanalysis_free;
const start$1 = instance.exports.start;
const version$1 = instance.exports.version;
const wasmanalysis_addDefinition = instance.exports.wasmanalysis_addDefinition;
const wasmanalysis_autocomplete = instance.exports.wasmanalysis_autocomplete;
const wasmanalysis_beginOperation = instance.exports.wasmanalysis_beginOperation;
const wasmanalysis_check = instance.exports.wasmanalysis_check;
const wasmanalysis_checkModules = instance.exports.wasmanalysis_checkModules;
const wasmanalysis_clearModules = instance.exports.wasmanalysis_clearModules;
const wasmanalysis_decorateWithTypes = instance.exports.wasmanalysis_decorateWithTypes;
const wasmanalysis_deleteModule = instance.exports.wasmanalysis_deleteModule;
const wasmanalysis_documentationSymbolAt = instance.exports.wasmanalysis_documentationSymbolAt;
const wasmanalysis_expectedTypeAt = instance.exports.wasmanalysis_expectedTypeAt;
const wasmanalysis_fragmentAutocomplete = instance.exports.wasmanalysis_fragmentAutocomplete;
const wasmanalysis_inspectAt = instance.exports.wasmanalysis_inspectAt;
const wasmanalysis_moduleReturnType = instance.exports.wasmanalysis_moduleReturnType;
const wasmanalysis_new = instance.exports.wasmanalysis_new;
const wasmanalysis_requiredModules = instance.exports.wasmanalysis_requiredModules;
const wasmanalysis_resolveModule = instance.exports.wasmanalysis_resolveModule;
const wasmanalysis_setGlobals = instance.exports.wasmanalysis_setGlobals;
const wasmanalysis_setLint = instance.exports.wasmanalysis_setLint;
const wasmanalysis_setMode = instance.exports.wasmanalysis_setMode;
const wasmanalysis_setModule = instance.exports.wasmanalysis_setModule;
const wasmanalysis_takeModuleRequests = instance.exports.wasmanalysis_takeModuleRequests;
const wasmanalysis_typeAt = instance.exports.wasmanalysis_typeAt;
const __abort_handler = instance.exports.__abort_handler;
const __instance_terminated = instance.exports.__instance_terminated;
const memory = instance.exports.memory;
const __wbindgen_malloc = instance.exports.__wbindgen_malloc;
const __wbindgen_realloc = instance.exports.__wbindgen_realloc;
const __wbindgen_free = instance.exports.__wbindgen_free;
const __wbindgen_externrefs = instance.exports.__wbindgen_externrefs;
const __externref_table_dealloc = instance.exports.__externref_table_dealloc;
const __externref_table_alloc = instance.exports.__externref_table_alloc;
const __externref_drop_slice = instance.exports.__externref_drop_slice;
const __wbindgen_start = instance.exports.__wbindgen_start;
//#endregion
//#region src/wasm-analysis/luau_analysis_wasm.js
__wbg_set_wasm(luau_analysis_wasm_bg_exports);
__wbindgen_start();
//#endregion
export { WasmAnalysis, start, version };
