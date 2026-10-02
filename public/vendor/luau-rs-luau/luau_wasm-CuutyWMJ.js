import { t as __exportAll } from "./rolldown-runtime-D7D4PA-g.js";
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
//#region src/wasm/luau_wasm_bg.js
var WasmLua = class {
	__destroy_into_raw() {
		const ptr = this.__wbg_ptr;
		this.__wbg_ptr = 0;
		WasmLuaFinalization.unregister(this);
		return ptr;
	}
	free() {
		const ptr = this.__destroy_into_raw();
		wasm.__wbg_wasmlua_free(ptr, 0);
	}
	/**
	* @param {number} handle
	* @returns {Uint8Array}
	*/
	bufferBytes(handle) {
		const ret = wasm.wasmlua_bufferBytes(this.__wbg_ptr, handle);
		if (ret[2]) throw takeFromExternrefTable0(ret[1]);
		return takeFromExternrefTable0(ret[0]);
	}
	/**
	* @param {number} handle
	* @param {number} offset
	* @param {Uint8Array} bytes
	*/
	bufferWrite(handle, offset, bytes) {
		const ret = wasm.wasmlua_bufferWrite(this.__wbg_ptr, handle, offset, bytes);
		if (ret[1]) throw takeFromExternrefTable0(ret[0]);
	}
	/**
	* @param {number} handle
	* @param {Array<any>} _arguments
	* @param {any} abort
	* @returns {Promise<any>}
	*/
	callAsync(handle, _arguments, abort) {
		return wasm.wasmlua_callAsync(this.__wbg_ptr, handle, _arguments, abort);
	}
	/**
	* @param {number} handle
	* @param {string} name
	* @param {Array<any>} _arguments
	* @param {any} abort
	* @returns {Promise<any>}
	*/
	callFunctionAsync(handle, name, _arguments, abort) {
		const ptr0 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
		const len0 = WASM_VECTOR_LEN;
		return wasm.wasmlua_callFunctionAsync(this.__wbg_ptr, handle, ptr0, len0, _arguments, abort);
	}
	/**
	* @param {number} handle
	* @param {string} name
	* @param {Array<any>} _arguments
	* @returns {Array<any>}
	*/
	callFunction(handle, name, _arguments) {
		const ptr0 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
		const len0 = WASM_VECTOR_LEN;
		const ret = wasm.wasmlua_callFunction(this.__wbg_ptr, handle, ptr0, len0, _arguments);
		if (ret[2]) throw takeFromExternrefTable0(ret[1]);
		return takeFromExternrefTable0(ret[0]);
	}
	/**
	* @param {number} handle
	* @param {string} name
	* @param {Array<any>} _arguments
	* @param {any} abort
	* @returns {Promise<any>}
	*/
	callMethodAsync(handle, name, _arguments, abort) {
		const ptr0 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
		const len0 = WASM_VECTOR_LEN;
		return wasm.wasmlua_callMethodAsync(this.__wbg_ptr, handle, ptr0, len0, _arguments, abort);
	}
	/**
	* @param {number} handle
	* @param {string} name
	* @param {Array<any>} _arguments
	* @returns {Array<any>}
	*/
	callMethod(handle, name, _arguments) {
		const ptr0 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
		const len0 = WASM_VECTOR_LEN;
		const ret = wasm.wasmlua_callMethod(this.__wbg_ptr, handle, ptr0, len0, _arguments);
		if (ret[2]) throw takeFromExternrefTable0(ret[1]);
		return takeFromExternrefTable0(ret[0]);
	}
	/**
	* @param {number} handle
	* @param {Array<any>} _arguments
	* @returns {Array<any>}
	*/
	call(handle, _arguments) {
		const ret = wasm.wasmlua_call(this.__wbg_ptr, handle, _arguments);
		if (ret[2]) throw takeFromExternrefTable0(ret[1]);
		return takeFromExternrefTable0(ret[0]);
	}
	/**
	* @param {any} value
	* @returns {any}
	*/
	coerceInteger(value) {
		const ret = wasm.wasmlua_coerceInteger(this.__wbg_ptr, value);
		if (ret[2]) throw takeFromExternrefTable0(ret[1]);
		return takeFromExternrefTable0(ret[0]);
	}
	/**
	* @param {any} value
	* @returns {number | undefined}
	*/
	coerceNumber(value) {
		const ret = wasm.wasmlua_coerceNumber(this.__wbg_ptr, value);
		if (ret[3]) throw takeFromExternrefTable0(ret[2]);
		return ret[0] === 0 ? void 0 : ret[1];
	}
	/**
	* @param {any} value
	* @returns {any}
	*/
	coerceString(value) {
		const ret = wasm.wasmlua_coerceString(this.__wbg_ptr, value);
		if (ret[2]) throw takeFromExternrefTable0(ret[1]);
		return takeFromExternrefTable0(ret[0]);
	}
	/**
	* @param {string} source
	* @param {any} options
	* @returns {Uint8Array}
	*/
	compile(source, options) {
		const ptr0 = passStringToWasm0(source, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
		const len0 = WASM_VECTOR_LEN;
		const ret = wasm.wasmlua_compile(this.__wbg_ptr, ptr0, len0, options);
		if (ret[2]) throw takeFromExternrefTable0(ret[1]);
		return takeFromExternrefTable0(ret[0]);
	}
	/**
	* @param {Array<any>} modules
	* @param {Function | null | undefined} resolver
	* @param {boolean} sandboxed
	* @param {any} module_limits
	*/
	configureModules(modules, resolver, sandboxed, module_limits) {
		const ret = wasm.wasmlua_configureModules(this.__wbg_ptr, modules, isLikeNone(resolver) ? 0 : addToExternrefTable0(resolver), sandboxed, module_limits);
		if (ret[1]) throw takeFromExternrefTable0(ret[0]);
	}
	/**
	* @param {Function} callback
	*/
	configureOutput(callback) {
		const ret = wasm.wasmlua_configureOutput(this.__wbg_ptr, callback);
		if (ret[1]) throw takeFromExternrefTable0(ret[0]);
	}
	/**
	* @param {Array<any>} modules
	* @param {Function | null | undefined} resolver
	* @param {Function} output
	* @param {number} output_byte_limit
	* @param {number} output_event_limit
	* @param {any} module_limits
	*/
	configureWorker(modules, resolver, output, output_byte_limit, output_event_limit, module_limits) {
		const ret = wasm.wasmlua_configureWorker(this.__wbg_ptr, modules, isLikeNone(resolver) ? 0 : addToExternrefTable0(resolver), output, output_byte_limit, output_event_limit, module_limits);
		if (ret[1]) throw takeFromExternrefTable0(ret[0]);
	}
	/**
	* @param {Function} callback
	* @returns {any}
	*/
	createAsyncFunction(callback) {
		const ret = wasm.wasmlua_createAsyncFunction(this.__wbg_ptr, callback);
		if (ret[2]) throw takeFromExternrefTable0(ret[1]);
		return takeFromExternrefTable0(ret[0]);
	}
	/**
	* @param {number} size
	* @returns {any}
	*/
	createBufferWithCapacity(size) {
		const ret = wasm.wasmlua_createBufferWithCapacity(this.__wbg_ptr, size);
		if (ret[2]) throw takeFromExternrefTable0(ret[1]);
		return takeFromExternrefTable0(ret[0]);
	}
	/**
	* @param {Uint8Array} bytes
	* @returns {any}
	*/
	createBuffer(bytes) {
		const ret = wasm.wasmlua_createBuffer(this.__wbg_ptr, bytes);
		if (ret[2]) throw takeFromExternrefTable0(ret[1]);
		return takeFromExternrefTable0(ret[0]);
	}
	/**
	* @param {number} array_capacity
	* @param {number} record_capacity
	* @returns {any}
	*/
	createTableWithCapacity(array_capacity, record_capacity) {
		const ret = wasm.wasmlua_createTableWithCapacity(this.__wbg_ptr, array_capacity, record_capacity);
		if (ret[2]) throw takeFromExternrefTable0(ret[1]);
		return takeFromExternrefTable0(ret[0]);
	}
	/**
	* @param {any} initial
	* @returns {any}
	*/
	createTable(initial) {
		const ret = wasm.wasmlua_createTable(this.__wbg_ptr, initial);
		if (ret[2]) throw takeFromExternrefTable0(ret[1]);
		return takeFromExternrefTable0(ret[0]);
	}
	/**
	* @param {number} function_handle
	* @returns {any}
	*/
	createThread(function_handle) {
		const ret = wasm.wasmlua_createThread(this.__wbg_ptr, function_handle);
		if (ret[2]) throw takeFromExternrefTable0(ret[1]);
		return takeFromExternrefTable0(ret[0]);
	}
	/**
	* @param {any} token
	* @param {any} definition
	* @param {number} identity
	* @returns {any}
	*/
	createUserdata(token, definition, identity) {
		const ret = wasm.wasmlua_createUserdata(this.__wbg_ptr, token, definition, identity);
		if (ret[2]) throw takeFromExternrefTable0(ret[1]);
		return takeFromExternrefTable0(ret[0]);
	}
	/**
	* @returns {any}
	*/
	currentThread() {
		const ret = wasm.wasmlua_currentThread(this.__wbg_ptr);
		if (ret[2]) throw takeFromExternrefTable0(ret[1]);
		return takeFromExternrefTable0(ret[0]);
	}
	dispose() {
		const ret = wasm.wasmlua_dispose(this.__wbg_ptr);
		if (ret[1]) throw takeFromExternrefTable0(ret[0]);
	}
	/**
	* @param {string} source
	* @param {any} compiler_options
	* @param {any} dump_options
	* @returns {Uint8Array}
	*/
	dump(source, compiler_options, dump_options) {
		const ptr0 = passStringToWasm0(source, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
		const len0 = WASM_VECTOR_LEN;
		const ret = wasm.wasmlua_dump(this.__wbg_ptr, ptr0, len0, compiler_options, dump_options);
		if (ret[2]) throw takeFromExternrefTable0(ret[1]);
		return takeFromExternrefTable0(ret[0]);
	}
	/**
	* @param {string} source
	* @param {any} options
	* @param {Array<any>} _arguments
	* @param {any} abort
	* @returns {Promise<any>}
	*/
	executeAsync(source, options, _arguments, abort) {
		const ptr0 = passStringToWasm0(source, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
		const len0 = WASM_VECTOR_LEN;
		return wasm.wasmlua_executeAsync(this.__wbg_ptr, ptr0, len0, options, _arguments, abort);
	}
	/**
	* @param {Uint8Array} bytecode
	* @param {any} options
	* @param {Array<any>} _arguments
	* @param {any} abort
	* @returns {Promise<any>}
	*/
	executeBytecodeAsync(bytecode, options, _arguments, abort) {
		return wasm.wasmlua_executeBytecodeAsync(this.__wbg_ptr, bytecode, options, _arguments, abort);
	}
	/**
	* @param {Uint8Array} bytecode
	* @param {any} options
	* @param {number} error_limit
	* @param {number} result_byte_limit
	* @param {number} result_entry_limit
	* @returns {Promise<object>}
	*/
	executeBytecodeWorker(bytecode, options, error_limit, result_byte_limit, result_entry_limit) {
		return wasm.wasmlua_executeBytecodeWorker(this.__wbg_ptr, bytecode, options, error_limit, result_byte_limit, result_entry_limit);
	}
	/**
	* @param {Uint8Array} bytecode
	* @param {any} options
	* @param {Array<any>} _arguments
	* @returns {Array<any>}
	*/
	executeBytecode(bytecode, options, _arguments) {
		const ret = wasm.wasmlua_executeBytecode(this.__wbg_ptr, bytecode, options, _arguments);
		if (ret[2]) throw takeFromExternrefTable0(ret[1]);
		return takeFromExternrefTable0(ret[0]);
	}
	/**
	* @param {Uint8Array} source
	* @param {any} options
	* @param {number} error_limit
	* @param {number} result_byte_limit
	* @param {number} result_entry_limit
	* @returns {Promise<object>}
	*/
	executeWorker(source, options, error_limit, result_byte_limit, result_entry_limit) {
		return wasm.wasmlua_executeWorker(this.__wbg_ptr, source, options, error_limit, result_byte_limit, result_entry_limit);
	}
	/**
	* @param {string} source
	* @param {any} options
	* @param {Array<any>} _arguments
	* @returns {Array<any>}
	*/
	execute(source, options, _arguments) {
		const ptr0 = passStringToWasm0(source, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
		const len0 = WASM_VECTOR_LEN;
		const ret = wasm.wasmlua_execute(this.__wbg_ptr, ptr0, len0, options, _arguments);
		if (ret[2]) throw takeFromExternrefTable0(ret[1]);
		return takeFromExternrefTable0(ret[0]);
	}
	/**
	* @param {number} handle
	* @param {Array<any>} _arguments
	* @returns {any}
	*/
	functionBind(handle, _arguments) {
		const ret = wasm.wasmlua_functionBind(this.__wbg_ptr, handle, _arguments);
		if (ret[2]) throw takeFromExternrefTable0(ret[1]);
		return takeFromExternrefTable0(ret[0]);
	}
	/**
	* @param {number} handle
	* @returns {Array<any>}
	*/
	functionCoverage(handle) {
		const ret = wasm.wasmlua_functionCoverage(this.__wbg_ptr, handle);
		if (ret[2]) throw takeFromExternrefTable0(ret[1]);
		return takeFromExternrefTable0(ret[0]);
	}
	/**
	* @param {number} handle
	* @returns {any}
	*/
	functionDeepClone(handle) {
		const ret = wasm.wasmlua_functionDeepClone(this.__wbg_ptr, handle);
		if (ret[2]) throw takeFromExternrefTable0(ret[1]);
		return takeFromExternrefTable0(ret[0]);
	}
	/**
	* @param {number} handle
	* @returns {any}
	*/
	functionEnvironment(handle) {
		const ret = wasm.wasmlua_functionEnvironment(this.__wbg_ptr, handle);
		if (ret[2]) throw takeFromExternrefTable0(ret[1]);
		return takeFromExternrefTable0(ret[0]);
	}
	/**
	* @param {number} handle
	* @returns {number}
	*/
	functionIdentity(handle) {
		const ret = wasm.wasmlua_functionIdentity(this.__wbg_ptr, handle);
		if (ret[2]) throw takeFromExternrefTable0(ret[1]);
		return ret[0] >>> 0;
	}
	/**
	* @param {number} handle
	* @returns {object}
	*/
	functionInfo(handle) {
		const ret = wasm.wasmlua_functionInfo(this.__wbg_ptr, handle);
		if (ret[2]) throw takeFromExternrefTable0(ret[1]);
		return takeFromExternrefTable0(ret[0]);
	}
	/**
	* @param {number} handle
	* @param {number} environment
	* @returns {boolean}
	*/
	functionSetEnvironment(handle, environment) {
		const ret = wasm.wasmlua_functionSetEnvironment(this.__wbg_ptr, handle, environment);
		if (ret[2]) throw takeFromExternrefTable0(ret[1]);
		return ret[0] !== 0;
	}
	gcCollect() {
		const ret = wasm.wasmlua_gcCollect(this.__wbg_ptr);
		if (ret[1]) throw takeFromExternrefTable0(ret[0]);
	}
	/**
	* @returns {boolean}
	*/
	gcIsRunning() {
		const ret = wasm.wasmlua_gcIsRunning(this.__wbg_ptr);
		if (ret[2]) throw takeFromExternrefTable0(ret[1]);
		return ret[0] !== 0;
	}
	gcRestart() {
		const ret = wasm.wasmlua_gcRestart(this.__wbg_ptr);
		if (ret[1]) throw takeFromExternrefTable0(ret[0]);
	}
	/**
	* @returns {boolean}
	*/
	gcStep() {
		const ret = wasm.wasmlua_gcStep(this.__wbg_ptr);
		if (ret[2]) throw takeFromExternrefTable0(ret[1]);
		return ret[0] !== 0;
	}
	gcStop() {
		const ret = wasm.wasmlua_gcStop(this.__wbg_ptr);
		if (ret[1]) throw takeFromExternrefTable0(ret[0]);
	}
	/**
	* @param {number} handle
	* @param {any} key
	* @returns {any}
	*/
	get(handle, key) {
		const ret = wasm.wasmlua_get(this.__wbg_ptr, handle, key);
		if (ret[2]) throw takeFromExternrefTable0(ret[1]);
		return takeFromExternrefTable0(ret[0]);
	}
	/**
	* @returns {any}
	*/
	globals() {
		const ret = wasm.wasmlua_globals(this.__wbg_ptr);
		if (ret[2]) throw takeFromExternrefTable0(ret[1]);
		return takeFromExternrefTable0(ret[0]);
	}
	/**
	* @param {number} level
	* @returns {any}
	*/
	inspectStack(level) {
		const ret = wasm.wasmlua_inspectStack(this.__wbg_ptr, level);
		if (ret[2]) throw takeFromExternrefTable0(ret[1]);
		return takeFromExternrefTable0(ret[0]);
	}
	/**
	* @param {number} handle
	* @param {Array<any>} _arguments
	* @param {any} abort
	* @returns {any}
	*/
	invokeFunction(handle, _arguments, abort) {
		return wasm.wasmlua_invokeFunction(this.__wbg_ptr, handle, _arguments, abort);
	}
	/**
	* @returns {boolean}
	*/
	isYieldable() {
		const ret = wasm.wasmlua_isYieldable(this.__wbg_ptr);
		if (ret[2]) throw takeFromExternrefTable0(ret[1]);
		return ret[0] !== 0;
	}
	/**
	* @param {Uint8Array} bytecode
	* @param {any} options
	* @returns {any}
	*/
	loadBytecode(bytecode, options) {
		const ret = wasm.wasmlua_loadBytecode(this.__wbg_ptr, bytecode, options);
		if (ret[2]) throw takeFromExternrefTable0(ret[1]);
		return takeFromExternrefTable0(ret[0]);
	}
	/**
	* @param {any} libraries
	*/
	loadLibraries(libraries) {
		const ret = wasm.wasmlua_loadLibraries(this.__wbg_ptr, libraries);
		if (ret[1]) throw takeFromExternrefTable0(ret[0]);
	}
	/**
	* @param {string} source
	* @param {any} options
	* @returns {any}
	*/
	load(source, options) {
		const ptr0 = passStringToWasm0(source, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
		const len0 = WASM_VECTOR_LEN;
		const ret = wasm.wasmlua_load(this.__wbg_ptr, ptr0, len0, options);
		if (ret[2]) throw takeFromExternrefTable0(ret[1]);
		return takeFromExternrefTable0(ret[0]);
	}
	/**
	* @returns {any}
	*/
	mainThread() {
		const ret = wasm.wasmlua_mainThread(this.__wbg_ptr);
		if (ret[2]) throw takeFromExternrefTable0(ret[1]);
		return takeFromExternrefTable0(ret[0]);
	}
	/**
	* @returns {string | undefined}
	*/
	namecallMethod() {
		const ret = wasm.wasmlua_namecallMethod(this.__wbg_ptr);
		if (ret[3]) throw takeFromExternrefTable0(ret[2]);
		let v1;
		if (ret[0] !== 0) {
			v1 = getStringFromWasm0(ret[0], ret[1]);
			wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
		}
		return v1;
	}
	/**
	* @param {string} key
	* @returns {any}
	*/
	namedRegistryValue(key) {
		const ptr0 = passStringToWasm0(key, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
		const len0 = WASM_VECTOR_LEN;
		const ret = wasm.wasmlua_namedRegistryValue(this.__wbg_ptr, ptr0, len0);
		if (ret[2]) throw takeFromExternrefTable0(ret[1]);
		return takeFromExternrefTable0(ret[0]);
	}
	/**
	* @param {any} options
	*/
	constructor(options) {
		const ret = wasm.wasmlua_new(options);
		if (ret[2]) throw takeFromExternrefTable0(ret[1]);
		this.__wbg_ptr = ret[0];
		WasmLuaFinalization.register(this, this.__wbg_ptr, this);
		return this;
	}
	/**
	* @param {number} handle
	* @returns {any}
	*/
	objectClass(handle) {
		const ret = wasm.wasmlua_objectClass(this.__wbg_ptr, handle);
		if (ret[2]) throw takeFromExternrefTable0(ret[1]);
		return takeFromExternrefTable0(ret[0]);
	}
	/**
	* @returns {number}
	*/
	peakMemory() {
		const ret = wasm.wasmlua_peakMemory(this.__wbg_ptr);
		if (ret[2]) throw takeFromExternrefTable0(ret[1]);
		return ret[0] >>> 0;
	}
	/**
	* @param {number} handle
	* @param {any} key
	* @returns {any}
	*/
	rawGet(handle, key) {
		const ret = wasm.wasmlua_rawGet(this.__wbg_ptr, handle, key);
		if (ret[2]) throw takeFromExternrefTable0(ret[1]);
		return takeFromExternrefTable0(ret[0]);
	}
	/**
	* @param {number} handle
	* @param {any} key
	* @param {any} value
	*/
	rawSet(handle, key, value) {
		const ret = wasm.wasmlua_rawSet(this.__wbg_ptr, handle, key, value);
		if (ret[1]) throw takeFromExternrefTable0(ret[0]);
	}
	/**
	* @param {number} handle
	*/
	release(handle) {
		const ret = wasm.wasmlua_release(this.__wbg_ptr, handle);
		if (ret[1]) throw takeFromExternrefTable0(ret[0]);
	}
	removeDebugHooks() {
		const ret = wasm.wasmlua_removeDebugHooks(this.__wbg_ptr);
		if (ret[1]) throw takeFromExternrefTable0(ret[0]);
	}
	removeInterruptHooks() {
		const ret = wasm.wasmlua_removeInterruptHooks(this.__wbg_ptr);
		if (ret[1]) throw takeFromExternrefTable0(ret[0]);
	}
	requestInterrupt() {
		const ret = wasm.wasmlua_requestInterrupt(this.__wbg_ptr);
		if (ret[1]) throw takeFromExternrefTable0(ret[0]);
	}
	/**
	* @param {boolean} enabled
	*/
	sandbox(enabled) {
		const ret = wasm.wasmlua_sandbox(this.__wbg_ptr, enabled);
		if (ret[1]) throw takeFromExternrefTable0(ret[0]);
	}
	/**
	* @param {any} options
	*/
	setCompiler(options) {
		const ret = wasm.wasmlua_setCompiler(this.__wbg_ptr, options);
		if (ret[1]) throw takeFromExternrefTable0(ret[0]);
	}
	/**
	* @param {any} hooks
	*/
	setDebugHooks(hooks) {
		const ret = wasm.wasmlua_setDebugHooks(this.__wbg_ptr, hooks);
		if (ret[1]) throw takeFromExternrefTable0(ret[0]);
	}
	/**
	* @param {any} hooks
	*/
	setInterruptHooks(hooks) {
		const ret = wasm.wasmlua_setInterruptHooks(this.__wbg_ptr, hooks);
		if (ret[1]) throw takeFromExternrefTable0(ret[0]);
	}
	/**
	* @param {number} limit
	* @returns {number}
	*/
	setMemoryLimit(limit) {
		const ret = wasm.wasmlua_setMemoryLimit(this.__wbg_ptr, limit);
		if (ret[2]) throw takeFromExternrefTable0(ret[1]);
		return ret[0] >>> 0;
	}
	/**
	* @param {string} key
	* @param {any} value
	*/
	setNamedRegistryValue(key, value) {
		const ptr0 = passStringToWasm0(key, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
		const len0 = WASM_VECTOR_LEN;
		const ret = wasm.wasmlua_setNamedRegistryValue(this.__wbg_ptr, ptr0, len0, value);
		if (ret[1]) throw takeFromExternrefTable0(ret[0]);
	}
	/**
	* @param {string} type_name
	* @param {any} metatable
	*/
	setTypeMetatable(type_name, metatable) {
		const ptr0 = passStringToWasm0(type_name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
		const len0 = WASM_VECTOR_LEN;
		const ret = wasm.wasmlua_setTypeMetatable(this.__wbg_ptr, ptr0, len0, metatable);
		if (ret[1]) throw takeFromExternrefTable0(ret[0]);
	}
	/**
	* @param {number} handle
	* @param {any} key
	* @param {any} value
	*/
	set(handle, key, value) {
		const ret = wasm.wasmlua_set(this.__wbg_ptr, handle, key, value);
		if (ret[1]) throw takeFromExternrefTable0(ret[0]);
	}
	/**
	* @returns {number}
	*/
	get stateId() {
		return wasm.wasmlua_stateId(this.__wbg_ptr) >>> 0;
	}
	/**
	* @param {number} handle
	*/
	tableClear(handle) {
		const ret = wasm.wasmlua_tableClear(this.__wbg_ptr, handle);
		if (ret[1]) throw takeFromExternrefTable0(ret[0]);
	}
	/**
	* @param {number} handle
	* @param {any} key
	* @returns {boolean}
	*/
	tableContainsKey(handle, key) {
		const ret = wasm.wasmlua_tableContainsKey(this.__wbg_ptr, handle, key);
		if (ret[2]) throw takeFromExternrefTable0(ret[1]);
		return ret[0] !== 0;
	}
	/**
	* @param {number} handle
	* @returns {Array<any>}
	*/
	tableEntries(handle) {
		const ret = wasm.wasmlua_tableEntries(this.__wbg_ptr, handle);
		if (ret[2]) throw takeFromExternrefTable0(ret[1]);
		return takeFromExternrefTable0(ret[0]);
	}
	/**
	* @param {number} handle
	* @returns {boolean}
	*/
	tableIsReadonly(handle) {
		const ret = wasm.wasmlua_tableIsReadonly(this.__wbg_ptr, handle);
		if (ret[2]) throw takeFromExternrefTable0(ret[1]);
		return ret[0] !== 0;
	}
	/**
	* @param {number} handle
	* @param {boolean} raw
	* @returns {number}
	*/
	tableLength(handle, raw) {
		const ret = wasm.wasmlua_tableLength(this.__wbg_ptr, handle, raw);
		if (ret[2]) throw takeFromExternrefTable0(ret[1]);
		return ret[0];
	}
	/**
	* @param {number} handle
	* @returns {any}
	*/
	tableMetatable(handle) {
		const ret = wasm.wasmlua_tableMetatable(this.__wbg_ptr, handle);
		if (ret[2]) throw takeFromExternrefTable0(ret[1]);
		return takeFromExternrefTable0(ret[0]);
	}
	/**
	* @param {number} handle
	* @returns {any}
	*/
	tablePop(handle) {
		const ret = wasm.wasmlua_tablePop(this.__wbg_ptr, handle);
		if (ret[2]) throw takeFromExternrefTable0(ret[1]);
		return takeFromExternrefTable0(ret[0]);
	}
	/**
	* @param {number} handle
	* @param {any} value
	*/
	tablePush(handle, value) {
		const ret = wasm.wasmlua_tablePush(this.__wbg_ptr, handle, value);
		if (ret[1]) throw takeFromExternrefTable0(ret[0]);
	}
	/**
	* @param {number} handle
	* @param {number} index
	* @param {any} value
	*/
	tableRawInsert(handle, index, value) {
		const ret = wasm.wasmlua_tableRawInsert(this.__wbg_ptr, handle, index, value);
		if (ret[1]) throw takeFromExternrefTable0(ret[0]);
	}
	/**
	* @param {number} handle
	* @returns {any}
	*/
	tableRawPop(handle) {
		const ret = wasm.wasmlua_tableRawPop(this.__wbg_ptr, handle);
		if (ret[2]) throw takeFromExternrefTable0(ret[1]);
		return takeFromExternrefTable0(ret[0]);
	}
	/**
	* @param {number} handle
	* @param {any} value
	*/
	tableRawPush(handle, value) {
		const ret = wasm.wasmlua_tableRawPush(this.__wbg_ptr, handle, value);
		if (ret[1]) throw takeFromExternrefTable0(ret[0]);
	}
	/**
	* @param {number} handle
	* @param {any} key
	*/
	tableRawRemove(handle, key) {
		const ret = wasm.wasmlua_tableRawRemove(this.__wbg_ptr, handle, key);
		if (ret[1]) throw takeFromExternrefTable0(ret[0]);
	}
	/**
	* @param {number} handle
	* @param {number} index
	* @param {any} value
	*/
	tableRawSetIndex(handle, index, value) {
		const ret = wasm.wasmlua_tableRawSetIndex(this.__wbg_ptr, handle, index, value);
		if (ret[1]) throw takeFromExternrefTable0(ret[0]);
	}
	/**
	* @param {number} handle
	* @param {any} key
	*/
	tableRemove(handle, key) {
		const ret = wasm.wasmlua_tableRemove(this.__wbg_ptr, handle, key);
		if (ret[1]) throw takeFromExternrefTable0(ret[0]);
	}
	/**
	* @param {number} handle
	* @param {any} metatable
	*/
	tableSetMetatable(handle, metatable) {
		const ret = wasm.wasmlua_tableSetMetatable(this.__wbg_ptr, handle, metatable);
		if (ret[1]) throw takeFromExternrefTable0(ret[0]);
	}
	/**
	* @param {number} handle
	* @param {boolean} enabled
	*/
	tableSetReadonly(handle, enabled) {
		const ret = wasm.wasmlua_tableSetReadonly(this.__wbg_ptr, handle, enabled);
		if (ret[1]) throw takeFromExternrefTable0(ret[0]);
	}
	/**
	* @param {number} handle
	* @param {boolean} enabled
	*/
	tableSetSafeEnvironment(handle, enabled) {
		const ret = wasm.wasmlua_tableSetSafeEnvironment(this.__wbg_ptr, handle, enabled);
		if (ret[1]) throw takeFromExternrefTable0(ret[0]);
	}
	/**
	* @param {number} handle
	* @param {number} level
	* @returns {any}
	*/
	threadInspectStack(handle, level) {
		const ret = wasm.wasmlua_threadInspectStack(this.__wbg_ptr, handle, level);
		if (ret[2]) throw takeFromExternrefTable0(ret[1]);
		return takeFromExternrefTable0(ret[0]);
	}
	/**
	* @param {number} handle
	* @returns {boolean}
	*/
	threadIsYieldable(handle) {
		const ret = wasm.wasmlua_threadIsYieldable(this.__wbg_ptr, handle);
		if (ret[2]) throw takeFromExternrefTable0(ret[1]);
		return ret[0] !== 0;
	}
	/**
	* @param {number} handle
	* @returns {string | undefined}
	*/
	threadNamecallMethod(handle) {
		const ret = wasm.wasmlua_threadNamecallMethod(this.__wbg_ptr, handle);
		if (ret[3]) throw takeFromExternrefTable0(ret[2]);
		let v1;
		if (ret[0] !== 0) {
			v1 = getStringFromWasm0(ret[0], ret[1]);
			wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
		}
		return v1;
	}
	/**
	* @param {number} handle
	* @param {number} function_handle
	*/
	threadReset(handle, function_handle) {
		const ret = wasm.wasmlua_threadReset(this.__wbg_ptr, handle, function_handle);
		if (ret[1]) throw takeFromExternrefTable0(ret[0]);
	}
	/**
	* @param {number} handle
	* @param {Array<any>} _arguments
	* @param {any} abort
	* @returns {Promise<any>}
	*/
	threadResumeAsync(handle, _arguments, abort) {
		return wasm.wasmlua_threadResumeAsync(this.__wbg_ptr, handle, _arguments, abort);
	}
	/**
	* @param {number} handle
	* @param {any} error
	* @param {any} abort
	* @returns {Promise<any>}
	*/
	threadResumeErrorAsync(handle, error, abort) {
		return wasm.wasmlua_threadResumeErrorAsync(this.__wbg_ptr, handle, error, abort);
	}
	/**
	* @param {number} handle
	* @param {any} error
	* @returns {Array<any>}
	*/
	threadResumeError(handle, error) {
		const ret = wasm.wasmlua_threadResumeError(this.__wbg_ptr, handle, error);
		if (ret[2]) throw takeFromExternrefTable0(ret[1]);
		return takeFromExternrefTable0(ret[0]);
	}
	/**
	* @param {number} handle
	* @param {Array<any>} _arguments
	* @returns {Array<any>}
	*/
	threadResume(handle, _arguments) {
		const ret = wasm.wasmlua_threadResume(this.__wbg_ptr, handle, _arguments);
		if (ret[2]) throw takeFromExternrefTable0(ret[1]);
		return takeFromExternrefTable0(ret[0]);
	}
	/**
	* @param {number} handle
	* @param {boolean} enabled
	*/
	threadSetSingleStep(handle, enabled) {
		const ret = wasm.wasmlua_threadSetSingleStep(this.__wbg_ptr, handle, enabled);
		if (ret[1]) throw takeFromExternrefTable0(ret[0]);
	}
	/**
	* @param {number} handle
	* @returns {string}
	*/
	threadStatus(handle) {
		let deferred2_0;
		let deferred2_1;
		try {
			const ret = wasm.wasmlua_threadStatus(this.__wbg_ptr, handle);
			var ptr1 = ret[0];
			var len1 = ret[1];
			if (ret[3]) {
				ptr1 = 0;
				len1 = 0;
				throw takeFromExternrefTable0(ret[2]);
			}
			deferred2_0 = ptr1;
			deferred2_1 = len1;
			return getStringFromWasm0(ptr1, len1);
		} finally {
			wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
		}
	}
	/**
	* @param {number} handle
	* @param {string | null | undefined} message
	* @param {number} level
	* @returns {Uint8Array}
	*/
	threadTraceback(handle, message, level) {
		var ptr0 = isLikeNone(message) ? 0 : passStringToWasm0(message, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
		var len0 = WASM_VECTOR_LEN;
		const ret = wasm.wasmlua_threadTraceback(this.__wbg_ptr, handle, ptr0, len0, level);
		if (ret[2]) throw takeFromExternrefTable0(ret[1]);
		return takeFromExternrefTable0(ret[0]);
	}
	/**
	* @param {string | null | undefined} message
	* @param {number} level
	* @returns {Uint8Array}
	*/
	traceback(message, level) {
		var ptr0 = isLikeNone(message) ? 0 : passStringToWasm0(message, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
		var len0 = WASM_VECTOR_LEN;
		const ret = wasm.wasmlua_traceback(this.__wbg_ptr, ptr0, len0, level);
		if (ret[2]) throw takeFromExternrefTable0(ret[1]);
		return takeFromExternrefTable0(ret[0]);
	}
	/**
	* @param {string} type_name
	* @returns {any}
	*/
	typeMetatable(type_name) {
		const ptr0 = passStringToWasm0(type_name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
		const len0 = WASM_VECTOR_LEN;
		const ret = wasm.wasmlua_typeMetatable(this.__wbg_ptr, ptr0, len0);
		if (ret[2]) throw takeFromExternrefTable0(ret[1]);
		return takeFromExternrefTable0(ret[0]);
	}
	/**
	* @param {string} key
	*/
	unsetNamedRegistryValue(key) {
		const ptr0 = passStringToWasm0(key, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
		const len0 = WASM_VECTOR_LEN;
		const ret = wasm.wasmlua_unsetNamedRegistryValue(this.__wbg_ptr, ptr0, len0);
		if (ret[1]) throw takeFromExternrefTable0(ret[0]);
	}
	/**
	* @returns {number}
	*/
	usedMemory() {
		const ret = wasm.wasmlua_usedMemory(this.__wbg_ptr);
		if (ret[2]) throw takeFromExternrefTable0(ret[1]);
		return ret[0] >>> 0;
	}
	/**
	* @param {number} handle
	*/
	userdataDestroy(handle) {
		const ret = wasm.wasmlua_userdataDestroy(this.__wbg_ptr, handle);
		if (ret[1]) throw takeFromExternrefTable0(ret[0]);
	}
	/**
	* @param {number} handle
	* @returns {Array<any>}
	*/
	userdataMetatableEntries(handle) {
		const ret = wasm.wasmlua_userdataMetatableEntries(this.__wbg_ptr, handle);
		if (ret[2]) throw takeFromExternrefTable0(ret[1]);
		return takeFromExternrefTable0(ret[0]);
	}
	/**
	* @param {number} handle
	* @param {string} key
	* @returns {any}
	*/
	userdataMetatableGet(handle, key) {
		const ptr0 = passStringToWasm0(key, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
		const len0 = WASM_VECTOR_LEN;
		const ret = wasm.wasmlua_userdataMetatableGet(this.__wbg_ptr, handle, ptr0, len0);
		if (ret[2]) throw takeFromExternrefTable0(ret[1]);
		return takeFromExternrefTable0(ret[0]);
	}
	/**
	* @param {number} handle
	* @param {string} key
	* @returns {boolean}
	*/
	userdataMetatableHas(handle, key) {
		const ptr0 = passStringToWasm0(key, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
		const len0 = WASM_VECTOR_LEN;
		const ret = wasm.wasmlua_userdataMetatableHas(this.__wbg_ptr, handle, ptr0, len0);
		if (ret[2]) throw takeFromExternrefTable0(ret[1]);
		return ret[0] !== 0;
	}
	/**
	* @param {number} handle
	* @param {string} key
	* @param {any} value
	*/
	userdataMetatableSet(handle, key, value) {
		const ptr0 = passStringToWasm0(key, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
		const len0 = WASM_VECTOR_LEN;
		const ret = wasm.wasmlua_userdataMetatableSet(this.__wbg_ptr, handle, ptr0, len0, value);
		if (ret[1]) throw takeFromExternrefTable0(ret[0]);
	}
	/**
	* @param {number} handle
	*/
	userdataMetatable(handle) {
		const ret = wasm.wasmlua_userdataMetatable(this.__wbg_ptr, handle);
		if (ret[1]) throw takeFromExternrefTable0(ret[0]);
	}
	/**
	* @param {number} handle
	* @param {any} value
	*/
	userdataSetUserValue(handle, value) {
		const ret = wasm.wasmlua_userdataSetUserValue(this.__wbg_ptr, handle, value);
		if (ret[1]) throw takeFromExternrefTable0(ret[0]);
	}
	/**
	* @param {number} handle
	* @returns {any}
	*/
	userdataTake(handle) {
		const ret = wasm.wasmlua_userdataTake(this.__wbg_ptr, handle);
		if (ret[2]) throw takeFromExternrefTable0(ret[1]);
		return takeFromExternrefTable0(ret[0]);
	}
	/**
	* @param {number} handle
	* @returns {string}
	*/
	userdataTypeName(handle) {
		let deferred2_0;
		let deferred2_1;
		try {
			const ret = wasm.wasmlua_userdataTypeName(this.__wbg_ptr, handle);
			var ptr1 = ret[0];
			var len1 = ret[1];
			if (ret[3]) {
				ptr1 = 0;
				len1 = 0;
				throw takeFromExternrefTable0(ret[2]);
			}
			deferred2_0 = ptr1;
			deferred2_1 = len1;
			return getStringFromWasm0(ptr1, len1);
		} finally {
			wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
		}
	}
	/**
	* @param {number} handle
	* @returns {any}
	*/
	userdataUserValue(handle) {
		const ret = wasm.wasmlua_userdataUserValue(this.__wbg_ptr, handle);
		if (ret[2]) throw takeFromExternrefTable0(ret[1]);
		return takeFromExternrefTable0(ret[0]);
	}
	/**
	* @param {number} handle
	* @returns {any}
	*/
	userdataValue(handle) {
		const ret = wasm.wasmlua_userdataValue(this.__wbg_ptr, handle);
		if (ret[2]) throw takeFromExternrefTable0(ret[1]);
		return takeFromExternrefTable0(ret[0]);
	}
	/**
	* @param {number} left
	* @param {number} right
	* @returns {boolean}
	*/
	valueEquals(left, right) {
		const ret = wasm.wasmlua_valueEquals(this.__wbg_ptr, left, right);
		if (ret[2]) throw takeFromExternrefTable0(ret[1]);
		return ret[0] !== 0;
	}
	/**
	* @param {number} handle
	* @returns {number}
	*/
	valueIdentity(handle) {
		const ret = wasm.wasmlua_valueIdentity(this.__wbg_ptr, handle);
		if (ret[2]) throw takeFromExternrefTable0(ret[1]);
		return ret[0] >>> 0;
	}
	/**
	* @param {number} handle
	* @returns {string}
	*/
	valueToString(handle) {
		let deferred2_0;
		let deferred2_1;
		try {
			const ret = wasm.wasmlua_valueToString(this.__wbg_ptr, handle);
			var ptr1 = ret[0];
			var len1 = ret[1];
			if (ret[3]) {
				ptr1 = 0;
				len1 = 0;
				throw takeFromExternrefTable0(ret[2]);
			}
			deferred2_0 = ptr1;
			deferred2_1 = len1;
			return getStringFromWasm0(ptr1, len1);
		} finally {
			wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
		}
	}
};
if (Symbol.dispose) WasmLua.prototype[Symbol.dispose] = WasmLua.prototype.free;
/**
* @param {Uint8Array} source
* @param {any} compiler_options
* @param {number} bytecode_limit
* @param {number} error_limit
* @returns {object}
*/
function compileWorker(source, compiler_options, bytecode_limit, error_limit) {
	const ret = wasm.compileWorker(source, compiler_options, bytecode_limit, error_limit);
	if (ret[2]) throw takeFromExternrefTable0(ret[1]);
	return takeFromExternrefTable0(ret[0]);
}
/**
* @param {Uint8Array} source
* @param {any} compiler_options
* @param {any} dump_options
* @param {number} output_limit
* @param {number} error_limit
* @returns {object}
*/
function dumpWorker(source, compiler_options, dump_options, output_limit, error_limit) {
	const ret = wasm.dumpWorker(source, compiler_options, dump_options, output_limit, error_limit);
	if (ret[2]) throw takeFromExternrefTable0(ret[1]);
	return takeFromExternrefTable0(ret[0]);
}
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
/**
* @returns {number}
*/
function workerMemoryBytes() {
	return wasm.workerMemoryBytes() >>> 0;
}
function __wbg_Error_67e7344beaa85059(arg0, arg1) {
	return Error(getStringFromWasm0(arg0, arg1));
}
function __wbg___wbindgen_bigint_get_as_i64_b482365c149396c8(arg0, arg1) {
	const v = arg1;
	const ret = typeof v === "bigint" ? v : void 0;
	getDataViewMemory0().setBigInt64(arg0 + 8, isLikeNone(ret) ? BigInt(0) : ret, true);
	getDataViewMemory0().setInt32(arg0 + 0, !isLikeNone(ret), true);
}
function __wbg___wbindgen_boolean_get_7a12af2b3f899c5a(arg0) {
	const v = arg0;
	const ret = typeof v === "boolean" ? v : void 0;
	return isLikeNone(ret) ? 16777215 : ret ? 1 : 0;
}
function __wbg___wbindgen_debug_string_0e68cf47c9cbd9b0(arg0, arg1) {
	const ptr1 = passStringToWasm0(debugString(arg1), wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
	const len1 = WASM_VECTOR_LEN;
	getDataViewMemory0().setInt32(arg0 + 4, len1, true);
	getDataViewMemory0().setInt32(arg0 + 0, ptr1, true);
}
function __wbg___wbindgen_is_bigint_60fc0336cb14f5d7(arg0) {
	return typeof arg0 === "bigint";
}
function __wbg___wbindgen_is_function_fcda5e3902d732fe(arg0) {
	return typeof arg0 === "function";
}
function __wbg___wbindgen_is_null_5160b3e381865372(arg0) {
	return arg0 === null;
}
function __wbg___wbindgen_is_object_edb6b15aa3afe12e(arg0) {
	const val = arg0;
	return typeof val === "object" && val !== null;
}
function __wbg___wbindgen_is_undefined_8c687d0b90d5b524(arg0) {
	return arg0 === void 0;
}
function __wbg___wbindgen_jsval_eq_9fdcd3c0a860dd3b(arg0, arg1) {
	return arg0 === arg1;
}
function __wbg___wbindgen_number_get_1dc732b810cb937c(arg0, arg1) {
	const obj = arg1;
	const ret = typeof obj === "number" ? obj : void 0;
	getDataViewMemory0().setFloat64(arg0 + 8, isLikeNone(ret) ? 0 : ret, true);
	getDataViewMemory0().setInt32(arg0 + 0, !isLikeNone(ret), true);
}
function __wbg___wbindgen_rethrow_dba7bb2caa14ba21(arg0) {
	throw arg0;
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
function __wbg__wbg_cb_unref_997e73d32238e655(arg0) {
	arg0._wbg_cb_unref();
}
function __wbg_apply_5d9aa7604c2490a8() {
	return handleError(function(arg0, arg1, arg2) {
		return arg0.apply(arg1, arg2);
	}, arguments);
}
function __wbg_call_269c5566fbede3eb() {
	return handleError(function(arg0, arg1) {
		return arg0.call(arg1);
	}, arguments);
}
function __wbg_call_6bcf8d3e20937e46() {
	return handleError(function(arg0, arg1, arg2) {
		return arg0.call(arg1, arg2);
	}, arguments);
}
function __wbg_call_7bbd9cceba9949ad() {
	return handleError(function(arg0, arg1, arg2, arg3) {
		return arg0.call(arg1, arg2, arg3);
	}, arguments);
}
function __wbg_call_c1ad1cb1b78e8130() {
	return handleError(function(arg0, arg1, arg2, arg3, arg4) {
		return arg0.call(arg1, arg2, arg3, arg4);
	}, arguments);
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
function __wbg_from_a39669ce566077da(arg0) {
	return Array.from(arg0);
}
function __wbg_get_989d0a1309644f2b() {
	return handleError(function(arg0, arg1) {
		return Reflect.get(arg0, arg1);
	}, arguments);
}
function __wbg_get_b1f0ab13c737f856(arg0, arg1) {
	return arg0[arg1 >>> 0];
}
function __wbg_get_unchecked_363572bdd397d473(arg0, arg1) {
	return arg0[arg1 >>> 0];
}
function __wbg_instanceof_Promise_f6320f682f582ddf(arg0) {
	let result;
	try {
		result = arg0 instanceof Promise;
	} catch (_) {
		result = false;
	}
	return result;
}
function __wbg_instanceof_Uint8Array_598adc0fef426aa8(arg0) {
	let result;
	try {
		result = arg0 instanceof Uint8Array;
	} catch (_) {
		result = false;
	}
	return result;
}
function __wbg_isArray_5674713bb7b79043(arg0) {
	return Array.isArray(arg0);
}
function __wbg_is_61443cc073056436(arg0, arg1) {
	return Object.is(arg0, arg1);
}
function __wbg_keys_6efc298980178da1(arg0) {
	return Object.keys(arg0);
}
function __wbg_length_31bdaf014f5fbde2(arg0) {
	return arg0.length;
}
function __wbg_length_4e1adc0d42e23620(arg0) {
	return arg0.length;
}
function __wbg_new_227d7c05414eb861() {
	return /* @__PURE__ */ new Error();
}
function __wbg_new_8bacbcd413da85bb(arg0, arg1) {
	return new Intl.DateTimeFormat(arg0, arg1);
}
function __wbg_new_8d36e20aa758e411() {
	return /* @__PURE__ */ new Map();
}
function __wbg_new_a32a1ab6c6655abe(arg0, arg1) {
	return new Error(getStringFromWasm0(arg0, arg1));
}
function __wbg_new_bebc3f4757acf305() {
	return /* @__PURE__ */ new Object();
}
function __wbg_new_ffa92086ea89f79c() {
	return new Array();
}
function __wbg_new_from_slice_4ee02165f9de919e(arg0, arg1) {
	return new Uint8Array(getArrayU8FromWasm0(arg0, arg1));
}
function __wbg_new_typed_6f8b0d724fe26c07(arg0, arg1) {
	try {
		var state0 = {
			a: arg0,
			b: arg1
		};
		var cb0 = (arg0, arg1) => {
			const a = state0.a;
			state0.a = 0;
			try {
				return wasm_bindgen_88f4e4fb1e9bfc9___convert__closures_____invoke___js_sys_9c4f85dd2a4a6892___Function_fn_wasm_bindgen_88f4e4fb1e9bfc9___JsValue_____wasm_bindgen_88f4e4fb1e9bfc9___sys__Undefined___js_sys_9c4f85dd2a4a6892___Function_fn_wasm_bindgen_88f4e4fb1e9bfc9___JsValue_____wasm_bindgen_88f4e4fb1e9bfc9___sys__Undefined_______true_$1(a, state0.b, arg0, arg1);
			} finally {
				state0.a = a;
			}
		};
		return new Promise(cb0);
	} finally {
		state0.a = 0;
	}
}
function __wbg_new_with_length_5ffeddb9d9fbb96f(arg0) {
	return new Uint8Array(arg0 >>> 0);
}
function __wbg_new_with_length_6a9fc3631737ef8c(arg0) {
	return new Array(arg0 >>> 0);
}
function __wbg_now_d1fb6650485d7f3e() {
	return Date.now();
}
function __wbg_prototypesetcall_ae9f5e7459250748(arg0, arg1, arg2) {
	Uint8Array.prototype.set.call(getArrayU8FromWasm0(arg0, arg1), arg2);
}
function __wbg_push_bfdf956ba476f65b(arg0, arg1) {
	return arg0.push(arg1);
}
function __wbg_queueMicrotask_85c90f6987555d65(arg0) {
	return arg0.queueMicrotask;
}
function __wbg_queueMicrotask_f6a1fa10b81d1fc0(arg0) {
	queueMicrotask(arg0);
}
function __wbg_resolve_35ec7e0c6af4c82c(arg0) {
	return Promise.resolve(arg0);
}
function __wbg_resolvedOptions_a8a5a3f370c62607(arg0) {
	return arg0.resolvedOptions();
}
function __wbg_set_13d25b81ab403f5e(arg0, arg1, arg2) {
	arg0[arg1 >>> 0] = arg2;
}
function __wbg_set_a377297433dfea63() {
	return handleError(function(arg0, arg1, arg2) {
		return Reflect.set(arg0, arg1, arg2);
	}, arguments);
}
function __wbg_set_bf6dde4923b9b059(arg0, arg1, arg2) {
	return arg0.set(arg1, arg2);
}
function __wbg_stack_3b0d974bbf31e44f(arg0, arg1) {
	const ret = arg1.stack;
	const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
	const len1 = WASM_VECTOR_LEN;
	getDataViewMemory0().setInt32(arg0 + 4, len1, true);
	getDataViewMemory0().setInt32(arg0 + 0, ptr1, true);
}
function __wbg_static_accessor_GLOBAL_8eb4cd83130a11a0() {
	const ret = typeof global === "undefined" ? null : global;
	return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
}
function __wbg_static_accessor_GLOBAL_THIS_1e7044f654e934db() {
	const ret = typeof globalThis === "undefined" ? null : globalThis;
	return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
}
function __wbg_static_accessor_SELF_d8b50611246a6d92() {
	const ret = typeof self === "undefined" ? null : self;
	return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
}
function __wbg_static_accessor_WINDOW_fd0bc376bf0f8b42() {
	const ret = typeof window === "undefined" ? null : window;
	return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
}
function __wbg_then_7a850dae4493f353(arg0, arg1, arg2) {
	return arg0.then(arg1, arg2);
}
function __wbg_then_b830475380919203(arg0, arg1) {
	return arg0.then(arg1);
}
function __wbindgen_generic_0000000000000001(arg0, arg1) {
	return makeMutClosure(arg0, arg1, wasm_bindgen_88f4e4fb1e9bfc9___convert__closures_____invoke___wasm_bindgen_88f4e4fb1e9bfc9___JsValue__core_9b3796e30d99ddb7___result__Result_____wasm_bindgen_88f4e4fb1e9bfc9___JsError___true_$1);
}
function __wbindgen_generic_0000000000000002(arg0, arg1) {
	return makeMutClosure(arg0, arg1, wasm_bindgen_88f4e4fb1e9bfc9___convert__closures_____invoke_______true_$1);
}
function __wbindgen_generic_0000000000000003(arg0) {
	return arg0;
}
function __wbindgen_generic_0000000000000004(arg0) {
	return arg0;
}
function __wbindgen_generic_0000000000000005(arg0, arg1) {
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
function wasm_bindgen_88f4e4fb1e9bfc9___convert__closures_____invoke_______true_$1(arg0, arg1) {
	wasm.wasm_bindgen_88f4e4fb1e9bfc9___convert__closures_____invoke_______true_(arg0, arg1);
}
function wasm_bindgen_88f4e4fb1e9bfc9___convert__closures_____invoke___wasm_bindgen_88f4e4fb1e9bfc9___JsValue__core_9b3796e30d99ddb7___result__Result_____wasm_bindgen_88f4e4fb1e9bfc9___JsError___true_$1(arg0, arg1, arg2) {
	const ret = wasm.wasm_bindgen_88f4e4fb1e9bfc9___convert__closures_____invoke___wasm_bindgen_88f4e4fb1e9bfc9___JsValue__core_9b3796e30d99ddb7___result__Result_____wasm_bindgen_88f4e4fb1e9bfc9___JsError___true_(arg0, arg1, arg2);
	if (ret[1]) throw takeFromExternrefTable0(ret[0]);
}
function wasm_bindgen_88f4e4fb1e9bfc9___convert__closures_____invoke___js_sys_9c4f85dd2a4a6892___Function_fn_wasm_bindgen_88f4e4fb1e9bfc9___JsValue_____wasm_bindgen_88f4e4fb1e9bfc9___sys__Undefined___js_sys_9c4f85dd2a4a6892___Function_fn_wasm_bindgen_88f4e4fb1e9bfc9___JsValue_____wasm_bindgen_88f4e4fb1e9bfc9___sys__Undefined_______true_$1(arg0, arg1, arg2, arg3) {
	wasm.wasm_bindgen_88f4e4fb1e9bfc9___convert__closures_____invoke___js_sys_9c4f85dd2a4a6892___Function_fn_wasm_bindgen_88f4e4fb1e9bfc9___JsValue_____wasm_bindgen_88f4e4fb1e9bfc9___sys__Undefined___js_sys_9c4f85dd2a4a6892___Function_fn_wasm_bindgen_88f4e4fb1e9bfc9___JsValue_____wasm_bindgen_88f4e4fb1e9bfc9___sys__Undefined_______true_(arg0, arg1, arg2, arg3);
}
const WasmLuaFinalization = typeof FinalizationRegistry === "undefined" ? {
	register: () => {},
	unregister: () => {}
} : new FinalizationRegistry((ptr) => wasm.__wbg_wasmlua_free(ptr, 1));
function addToExternrefTable0(obj) {
	const idx = wasm.__externref_table_alloc();
	wasm.__wbindgen_externrefs.set(idx, obj);
	return idx;
}
const CLOSURE_DTORS = typeof FinalizationRegistry === "undefined" ? {
	register: () => {},
	unregister: () => {}
} : new FinalizationRegistry((state) => wasm.__wbindgen_destroy_closure(state.a, state.b));
function debugString(val) {
	const type = typeof val;
	if (type == "number" || type == "boolean" || val == null) return `${val}`;
	if (type == "string") return `"${val}"`;
	if (type == "symbol") {
		const description = val.description;
		if (description == null) return "Symbol";
		else return `Symbol(${description})`;
	}
	if (type == "function") {
		const name = val.name;
		if (typeof name == "string" && name.length > 0) return `Function(${name})`;
		else return "Function";
	}
	if (Array.isArray(val)) {
		const length = val.length;
		let debug = "[";
		if (length > 0) debug += debugString(val[0]);
		for (let i = 1; i < length; i++) debug += ", " + debugString(val[i]);
		debug += "]";
		return debug;
	}
	const builtInMatches = /\[object ([^\]]+)\]/.exec(toString.call(val));
	let className;
	if (builtInMatches && builtInMatches.length > 1) className = builtInMatches[1];
	else return toString.call(val);
	if (className == "Object") try {
		return "Object(" + JSON.stringify(val) + ")";
	} catch (_) {
		return "Object";
	}
	if (val instanceof Error) return `${val.name}: ${val.message}\n${val.stack}`;
	return className;
}
function getArrayU8FromWasm0(ptr, len) {
	ptr = ptr >>> 0;
	return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
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
function handleError(f, args) {
	try {
		return f.apply(this, args);
	} catch (e) {
		const idx = addToExternrefTable0(e);
		wasm.__wbindgen_exn_store(idx);
	}
}
function isLikeNone(x) {
	return x === void 0 || x === null;
}
function makeMutClosure(arg0, arg1, f) {
	const state = {
		a: arg0,
		b: arg1,
		cnt: 1
	};
	const real = (...args) => {
		state.cnt++;
		const a = state.a;
		state.a = 0;
		try {
			return f(a, state.b, ...args);
		} finally {
			state.a = a;
			real._wbg_cb_unref();
		}
	};
	real._wbg_cb_unref = () => {
		if (--state.cnt === 0) {
			wasm.__wbindgen_destroy_closure(state.a, state.b);
			state.a = 0;
			CLOSURE_DTORS.unregister(state);
		}
	};
	CLOSURE_DTORS.register(real, state, state);
	return real;
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
//#region src/wasm/luau_wasm_bg.wasm
var luau_wasm_bg_exports = /* @__PURE__ */ __exportAll({
	__abort_handler: () => __abort_handler,
	__externref_table_alloc: () => __externref_table_alloc,
	__externref_table_dealloc: () => __externref_table_dealloc,
	__instance_terminated: () => __instance_terminated,
	__wbg_wasmlua_free: () => __wbg_wasmlua_free,
	__wbindgen_destroy_closure: () => __wbindgen_destroy_closure,
	__wbindgen_exn_store: () => __wbindgen_exn_store,
	__wbindgen_externrefs: () => __wbindgen_externrefs,
	__wbindgen_free: () => __wbindgen_free,
	__wbindgen_malloc: () => __wbindgen_malloc,
	__wbindgen_realloc: () => __wbindgen_realloc,
	__wbindgen_start: () => __wbindgen_start,
	compileWorker: () => compileWorker$1,
	dumpWorker: () => dumpWorker$1,
	memory: () => memory,
	start: () => start$1,
	version: () => version$1,
	wasm_bindgen_88f4e4fb1e9bfc9___convert__closures_____invoke_______true_: () => wasm_bindgen_88f4e4fb1e9bfc9___convert__closures_____invoke_______true_,
	wasm_bindgen_88f4e4fb1e9bfc9___convert__closures_____invoke___js_sys_9c4f85dd2a4a6892___Function_fn_wasm_bindgen_88f4e4fb1e9bfc9___JsValue_____wasm_bindgen_88f4e4fb1e9bfc9___sys__Undefined___js_sys_9c4f85dd2a4a6892___Function_fn_wasm_bindgen_88f4e4fb1e9bfc9___JsValue_____wasm_bindgen_88f4e4fb1e9bfc9___sys__Undefined_______true_: () => wasm_bindgen_88f4e4fb1e9bfc9___convert__closures_____invoke___js_sys_9c4f85dd2a4a6892___Function_fn_wasm_bindgen_88f4e4fb1e9bfc9___JsValue_____wasm_bindgen_88f4e4fb1e9bfc9___sys__Undefined___js_sys_9c4f85dd2a4a6892___Function_fn_wasm_bindgen_88f4e4fb1e9bfc9___JsValue_____wasm_bindgen_88f4e4fb1e9bfc9___sys__Undefined_______true_,
	wasm_bindgen_88f4e4fb1e9bfc9___convert__closures_____invoke___wasm_bindgen_88f4e4fb1e9bfc9___JsValue__core_9b3796e30d99ddb7___result__Result_____wasm_bindgen_88f4e4fb1e9bfc9___JsError___true_: () => wasm_bindgen_88f4e4fb1e9bfc9___convert__closures_____invoke___wasm_bindgen_88f4e4fb1e9bfc9___JsValue__core_9b3796e30d99ddb7___result__Result_____wasm_bindgen_88f4e4fb1e9bfc9___JsError___true_,
	wasmlua_bufferBytes: () => wasmlua_bufferBytes,
	wasmlua_bufferWrite: () => wasmlua_bufferWrite,
	wasmlua_call: () => wasmlua_call,
	wasmlua_callAsync: () => wasmlua_callAsync,
	wasmlua_callFunction: () => wasmlua_callFunction,
	wasmlua_callFunctionAsync: () => wasmlua_callFunctionAsync,
	wasmlua_callMethod: () => wasmlua_callMethod,
	wasmlua_callMethodAsync: () => wasmlua_callMethodAsync,
	wasmlua_coerceInteger: () => wasmlua_coerceInteger,
	wasmlua_coerceNumber: () => wasmlua_coerceNumber,
	wasmlua_coerceString: () => wasmlua_coerceString,
	wasmlua_compile: () => wasmlua_compile,
	wasmlua_configureModules: () => wasmlua_configureModules,
	wasmlua_configureOutput: () => wasmlua_configureOutput,
	wasmlua_configureWorker: () => wasmlua_configureWorker,
	wasmlua_createAsyncFunction: () => wasmlua_createAsyncFunction,
	wasmlua_createBuffer: () => wasmlua_createBuffer,
	wasmlua_createBufferWithCapacity: () => wasmlua_createBufferWithCapacity,
	wasmlua_createTable: () => wasmlua_createTable,
	wasmlua_createTableWithCapacity: () => wasmlua_createTableWithCapacity,
	wasmlua_createThread: () => wasmlua_createThread,
	wasmlua_createUserdata: () => wasmlua_createUserdata,
	wasmlua_currentThread: () => wasmlua_currentThread,
	wasmlua_dispose: () => wasmlua_dispose,
	wasmlua_dump: () => wasmlua_dump,
	wasmlua_execute: () => wasmlua_execute,
	wasmlua_executeAsync: () => wasmlua_executeAsync,
	wasmlua_executeBytecode: () => wasmlua_executeBytecode,
	wasmlua_executeBytecodeAsync: () => wasmlua_executeBytecodeAsync,
	wasmlua_executeBytecodeWorker: () => wasmlua_executeBytecodeWorker,
	wasmlua_executeWorker: () => wasmlua_executeWorker,
	wasmlua_functionBind: () => wasmlua_functionBind,
	wasmlua_functionCoverage: () => wasmlua_functionCoverage,
	wasmlua_functionDeepClone: () => wasmlua_functionDeepClone,
	wasmlua_functionEnvironment: () => wasmlua_functionEnvironment,
	wasmlua_functionIdentity: () => wasmlua_functionIdentity,
	wasmlua_functionInfo: () => wasmlua_functionInfo,
	wasmlua_functionSetEnvironment: () => wasmlua_functionSetEnvironment,
	wasmlua_gcCollect: () => wasmlua_gcCollect,
	wasmlua_gcIsRunning: () => wasmlua_gcIsRunning,
	wasmlua_gcRestart: () => wasmlua_gcRestart,
	wasmlua_gcStep: () => wasmlua_gcStep,
	wasmlua_gcStop: () => wasmlua_gcStop,
	wasmlua_get: () => wasmlua_get,
	wasmlua_globals: () => wasmlua_globals,
	wasmlua_inspectStack: () => wasmlua_inspectStack,
	wasmlua_invokeFunction: () => wasmlua_invokeFunction,
	wasmlua_isYieldable: () => wasmlua_isYieldable,
	wasmlua_load: () => wasmlua_load,
	wasmlua_loadBytecode: () => wasmlua_loadBytecode,
	wasmlua_loadLibraries: () => wasmlua_loadLibraries,
	wasmlua_mainThread: () => wasmlua_mainThread,
	wasmlua_namecallMethod: () => wasmlua_namecallMethod,
	wasmlua_namedRegistryValue: () => wasmlua_namedRegistryValue,
	wasmlua_new: () => wasmlua_new,
	wasmlua_objectClass: () => wasmlua_objectClass,
	wasmlua_peakMemory: () => wasmlua_peakMemory,
	wasmlua_rawGet: () => wasmlua_rawGet,
	wasmlua_rawSet: () => wasmlua_rawSet,
	wasmlua_release: () => wasmlua_release,
	wasmlua_removeDebugHooks: () => wasmlua_removeDebugHooks,
	wasmlua_removeInterruptHooks: () => wasmlua_removeInterruptHooks,
	wasmlua_requestInterrupt: () => wasmlua_requestInterrupt,
	wasmlua_sandbox: () => wasmlua_sandbox,
	wasmlua_set: () => wasmlua_set,
	wasmlua_setCompiler: () => wasmlua_setCompiler,
	wasmlua_setDebugHooks: () => wasmlua_setDebugHooks,
	wasmlua_setInterruptHooks: () => wasmlua_setInterruptHooks,
	wasmlua_setMemoryLimit: () => wasmlua_setMemoryLimit,
	wasmlua_setNamedRegistryValue: () => wasmlua_setNamedRegistryValue,
	wasmlua_setTypeMetatable: () => wasmlua_setTypeMetatable,
	wasmlua_stateId: () => wasmlua_stateId,
	wasmlua_tableClear: () => wasmlua_tableClear,
	wasmlua_tableContainsKey: () => wasmlua_tableContainsKey,
	wasmlua_tableEntries: () => wasmlua_tableEntries,
	wasmlua_tableIsReadonly: () => wasmlua_tableIsReadonly,
	wasmlua_tableLength: () => wasmlua_tableLength,
	wasmlua_tableMetatable: () => wasmlua_tableMetatable,
	wasmlua_tablePop: () => wasmlua_tablePop,
	wasmlua_tablePush: () => wasmlua_tablePush,
	wasmlua_tableRawInsert: () => wasmlua_tableRawInsert,
	wasmlua_tableRawPop: () => wasmlua_tableRawPop,
	wasmlua_tableRawPush: () => wasmlua_tableRawPush,
	wasmlua_tableRawRemove: () => wasmlua_tableRawRemove,
	wasmlua_tableRawSetIndex: () => wasmlua_tableRawSetIndex,
	wasmlua_tableRemove: () => wasmlua_tableRemove,
	wasmlua_tableSetMetatable: () => wasmlua_tableSetMetatable,
	wasmlua_tableSetReadonly: () => wasmlua_tableSetReadonly,
	wasmlua_tableSetSafeEnvironment: () => wasmlua_tableSetSafeEnvironment,
	wasmlua_threadInspectStack: () => wasmlua_threadInspectStack,
	wasmlua_threadIsYieldable: () => wasmlua_threadIsYieldable,
	wasmlua_threadNamecallMethod: () => wasmlua_threadNamecallMethod,
	wasmlua_threadReset: () => wasmlua_threadReset,
	wasmlua_threadResume: () => wasmlua_threadResume,
	wasmlua_threadResumeAsync: () => wasmlua_threadResumeAsync,
	wasmlua_threadResumeError: () => wasmlua_threadResumeError,
	wasmlua_threadResumeErrorAsync: () => wasmlua_threadResumeErrorAsync,
	wasmlua_threadSetSingleStep: () => wasmlua_threadSetSingleStep,
	wasmlua_threadStatus: () => wasmlua_threadStatus,
	wasmlua_threadTraceback: () => wasmlua_threadTraceback,
	wasmlua_traceback: () => wasmlua_traceback,
	wasmlua_typeMetatable: () => wasmlua_typeMetatable,
	wasmlua_unsetNamedRegistryValue: () => wasmlua_unsetNamedRegistryValue,
	wasmlua_usedMemory: () => wasmlua_usedMemory,
	wasmlua_userdataDestroy: () => wasmlua_userdataDestroy,
	wasmlua_userdataMetatable: () => wasmlua_userdataMetatable,
	wasmlua_userdataMetatableEntries: () => wasmlua_userdataMetatableEntries,
	wasmlua_userdataMetatableGet: () => wasmlua_userdataMetatableGet,
	wasmlua_userdataMetatableHas: () => wasmlua_userdataMetatableHas,
	wasmlua_userdataMetatableSet: () => wasmlua_userdataMetatableSet,
	wasmlua_userdataSetUserValue: () => wasmlua_userdataSetUserValue,
	wasmlua_userdataTake: () => wasmlua_userdataTake,
	wasmlua_userdataTypeName: () => wasmlua_userdataTypeName,
	wasmlua_userdataUserValue: () => wasmlua_userdataUserValue,
	wasmlua_userdataValue: () => wasmlua_userdataValue,
	wasmlua_valueEquals: () => wasmlua_valueEquals,
	wasmlua_valueIdentity: () => wasmlua_valueIdentity,
	wasmlua_valueToString: () => wasmlua_valueToString,
	workerMemoryBytes: () => workerMemoryBytes$1
});
function __wasm_init(imports) {
	return loadWasmModule(false, new URL("luau_wasm_bg.wasm", import.meta.url), null, imports);
}
const instance = await __wasm_init({ "./luau_wasm_bg.js": {
	"__wbg_push_bfdf956ba476f65b": __wbg_push_bfdf956ba476f65b,
	"__wbg_call_6bcf8d3e20937e46": __wbg_call_6bcf8d3e20937e46,
	"__wbg_call_269c5566fbede3eb": __wbg_call_269c5566fbede3eb,
	"__wbg_length_4e1adc0d42e23620": __wbg_length_4e1adc0d42e23620,
	"__wbg_get_unchecked_363572bdd397d473": __wbg_get_unchecked_363572bdd397d473,
	"__wbg_keys_6efc298980178da1": __wbg_keys_6efc298980178da1,
	"__wbg_then_7a850dae4493f353": __wbg_then_7a850dae4493f353,
	"__wbg_new_typed_6f8b0d724fe26c07": __wbg_new_typed_6f8b0d724fe26c07,
	"__wbg_call_7bbd9cceba9949ad": __wbg_call_7bbd9cceba9949ad,
	"__wbg_instanceof_Promise_f6320f682f582ddf": __wbg_instanceof_Promise_f6320f682f582ddf,
	"__wbg_get_b1f0ab13c737f856": __wbg_get_b1f0ab13c737f856,
	"__wbg_set_13d25b81ab403f5e": __wbg_set_13d25b81ab403f5e,
	"__wbg_apply_5d9aa7604c2490a8": __wbg_apply_5d9aa7604c2490a8,
	"__wbg_call_c1ad1cb1b78e8130": __wbg_call_c1ad1cb1b78e8130,
	"__wbg_set_bf6dde4923b9b059": __wbg_set_bf6dde4923b9b059,
	"__wbg_new_227d7c05414eb861": __wbg_new_227d7c05414eb861,
	"__wbg_stack_3b0d974bbf31e44f": __wbg_stack_3b0d974bbf31e44f,
	"__wbg_error_757e9472f8410341": __wbg_error_757e9472f8410341,
	"__wbg_then_b830475380919203": __wbg_then_b830475380919203,
	"__wbg_resolve_35ec7e0c6af4c82c": __wbg_resolve_35ec7e0c6af4c82c,
	"__wbg_new_bebc3f4757acf305": __wbg_new_bebc3f4757acf305,
	"__wbg_new_ffa92086ea89f79c": __wbg_new_ffa92086ea89f79c,
	"__wbg_new_with_length_6a9fc3631737ef8c": __wbg_new_with_length_6a9fc3631737ef8c,
	"__wbg_isArray_5674713bb7b79043": __wbg_isArray_5674713bb7b79043,
	"__wbg_from_a39669ce566077da": __wbg_from_a39669ce566077da,
	"__wbg_new_a32a1ab6c6655abe": __wbg_new_a32a1ab6c6655abe,
	"__wbg_new_8d36e20aa758e411": __wbg_new_8d36e20aa758e411,
	"__wbg_now_d1fb6650485d7f3e": __wbg_now_d1fb6650485d7f3e,
	"__wbg_is_61443cc073056436": __wbg_is_61443cc073056436,
	"__wbg_length_31bdaf014f5fbde2": __wbg_length_31bdaf014f5fbde2,
	"__wbg_prototypesetcall_ae9f5e7459250748": __wbg_prototypesetcall_ae9f5e7459250748,
	"__wbg_new_with_length_5ffeddb9d9fbb96f": __wbg_new_with_length_5ffeddb9d9fbb96f,
	"__wbg_new_from_slice_4ee02165f9de919e": __wbg_new_from_slice_4ee02165f9de919e,
	"__wbg_static_accessor_GLOBAL_THIS_1e7044f654e934db": __wbg_static_accessor_GLOBAL_THIS_1e7044f654e934db,
	"__wbg_static_accessor_SELF_d8b50611246a6d92": __wbg_static_accessor_SELF_d8b50611246a6d92,
	"__wbg_static_accessor_GLOBAL_8eb4cd83130a11a0": __wbg_static_accessor_GLOBAL_8eb4cd83130a11a0,
	"__wbg_static_accessor_WINDOW_fd0bc376bf0f8b42": __wbg_static_accessor_WINDOW_fd0bc376bf0f8b42,
	"__wbg_instanceof_Uint8Array_598adc0fef426aa8": __wbg_instanceof_Uint8Array_598adc0fef426aa8,
	"__wbg_new_8bacbcd413da85bb": __wbg_new_8bacbcd413da85bb,
	"__wbg_resolvedOptions_a8a5a3f370c62607": __wbg_resolvedOptions_a8a5a3f370c62607,
	"__wbg_get_989d0a1309644f2b": __wbg_get_989d0a1309644f2b,
	"__wbg_set_a377297433dfea63": __wbg_set_a377297433dfea63,
	"__wbg_queueMicrotask_85c90f6987555d65": __wbg_queueMicrotask_85c90f6987555d65,
	"__wbg_queueMicrotask_f6a1fa10b81d1fc0": __wbg_queueMicrotask_f6a1fa10b81d1fc0,
	"__wbg___wbindgen_number_get_1dc732b810cb937c": __wbg___wbindgen_number_get_1dc732b810cb937c,
	"__wbg___wbindgen_throw_5d9e815e6fdf150f": __wbg___wbindgen_throw_5d9e815e6fdf150f,
	"__wbg___wbindgen_is_null_5160b3e381865372": __wbg___wbindgen_is_null_5160b3e381865372,
	"__wbg___wbindgen_rethrow_dba7bb2caa14ba21": __wbg___wbindgen_rethrow_dba7bb2caa14ba21,
	"__wbg___wbindgen_jsval_eq_9fdcd3c0a860dd3b": __wbg___wbindgen_jsval_eq_9fdcd3c0a860dd3b,
	"__wbg_Error_67e7344beaa85059": __wbg_Error_67e7344beaa85059,
	"__wbg___wbindgen_is_bigint_60fc0336cb14f5d7": __wbg___wbindgen_is_bigint_60fc0336cb14f5d7,
	"__wbg___wbindgen_is_object_edb6b15aa3afe12e": __wbg___wbindgen_is_object_edb6b15aa3afe12e,
	"__wbg___wbindgen_string_get_92ab86bb19cbc12f": __wbg___wbindgen_string_get_92ab86bb19cbc12f,
	"__wbg___wbindgen_boolean_get_7a12af2b3f899c5a": __wbg___wbindgen_boolean_get_7a12af2b3f899c5a,
	"__wbg___wbindgen_is_function_fcda5e3902d732fe": __wbg___wbindgen_is_function_fcda5e3902d732fe,
	"__wbg___wbindgen_is_undefined_8c687d0b90d5b524": __wbg___wbindgen_is_undefined_8c687d0b90d5b524,
	"__wbg___wbindgen_bigint_get_as_i64_b482365c149396c8": __wbg___wbindgen_bigint_get_as_i64_b482365c149396c8,
	"__wbg__wbg_cb_unref_997e73d32238e655": __wbg__wbg_cb_unref_997e73d32238e655,
	"__wbg___wbindgen_debug_string_0e68cf47c9cbd9b0": __wbg___wbindgen_debug_string_0e68cf47c9cbd9b0,
	"__wbindgen_init_externref_table": __wbindgen_init_externref_table,
	"__wbindgen_generic_0000000000000001": __wbindgen_generic_0000000000000001,
	"__wbindgen_generic_0000000000000002": __wbindgen_generic_0000000000000002,
	"__wbindgen_generic_0000000000000003": __wbindgen_generic_0000000000000003,
	"__wbindgen_generic_0000000000000004": __wbindgen_generic_0000000000000004,
	"__wbindgen_generic_0000000000000005": __wbindgen_generic_0000000000000005,
	"memory": memory$1
} });
const __wbg_wasmlua_free = instance.exports.__wbg_wasmlua_free;
const compileWorker$1 = instance.exports.compileWorker;
const dumpWorker$1 = instance.exports.dumpWorker;
const start$1 = instance.exports.start;
const version$1 = instance.exports.version;
const wasmlua_bufferBytes = instance.exports.wasmlua_bufferBytes;
const wasmlua_bufferWrite = instance.exports.wasmlua_bufferWrite;
const wasmlua_call = instance.exports.wasmlua_call;
const wasmlua_callAsync = instance.exports.wasmlua_callAsync;
const wasmlua_callFunction = instance.exports.wasmlua_callFunction;
const wasmlua_callFunctionAsync = instance.exports.wasmlua_callFunctionAsync;
const wasmlua_callMethod = instance.exports.wasmlua_callMethod;
const wasmlua_callMethodAsync = instance.exports.wasmlua_callMethodAsync;
const wasmlua_coerceInteger = instance.exports.wasmlua_coerceInteger;
const wasmlua_coerceNumber = instance.exports.wasmlua_coerceNumber;
const wasmlua_coerceString = instance.exports.wasmlua_coerceString;
const wasmlua_compile = instance.exports.wasmlua_compile;
const wasmlua_configureModules = instance.exports.wasmlua_configureModules;
const wasmlua_configureOutput = instance.exports.wasmlua_configureOutput;
const wasmlua_configureWorker = instance.exports.wasmlua_configureWorker;
const wasmlua_createAsyncFunction = instance.exports.wasmlua_createAsyncFunction;
const wasmlua_createBuffer = instance.exports.wasmlua_createBuffer;
const wasmlua_createBufferWithCapacity = instance.exports.wasmlua_createBufferWithCapacity;
const wasmlua_createTable = instance.exports.wasmlua_createTable;
const wasmlua_createTableWithCapacity = instance.exports.wasmlua_createTableWithCapacity;
const wasmlua_createThread = instance.exports.wasmlua_createThread;
const wasmlua_createUserdata = instance.exports.wasmlua_createUserdata;
const wasmlua_currentThread = instance.exports.wasmlua_currentThread;
const wasmlua_dispose = instance.exports.wasmlua_dispose;
const wasmlua_dump = instance.exports.wasmlua_dump;
const wasmlua_execute = instance.exports.wasmlua_execute;
const wasmlua_executeAsync = instance.exports.wasmlua_executeAsync;
const wasmlua_executeBytecode = instance.exports.wasmlua_executeBytecode;
const wasmlua_executeBytecodeAsync = instance.exports.wasmlua_executeBytecodeAsync;
const wasmlua_executeBytecodeWorker = instance.exports.wasmlua_executeBytecodeWorker;
const wasmlua_executeWorker = instance.exports.wasmlua_executeWorker;
const wasmlua_functionBind = instance.exports.wasmlua_functionBind;
const wasmlua_functionCoverage = instance.exports.wasmlua_functionCoverage;
const wasmlua_functionDeepClone = instance.exports.wasmlua_functionDeepClone;
const wasmlua_functionEnvironment = instance.exports.wasmlua_functionEnvironment;
const wasmlua_functionIdentity = instance.exports.wasmlua_functionIdentity;
const wasmlua_functionInfo = instance.exports.wasmlua_functionInfo;
const wasmlua_functionSetEnvironment = instance.exports.wasmlua_functionSetEnvironment;
const wasmlua_gcCollect = instance.exports.wasmlua_gcCollect;
const wasmlua_gcIsRunning = instance.exports.wasmlua_gcIsRunning;
const wasmlua_gcRestart = instance.exports.wasmlua_gcRestart;
const wasmlua_gcStep = instance.exports.wasmlua_gcStep;
const wasmlua_gcStop = instance.exports.wasmlua_gcStop;
const wasmlua_get = instance.exports.wasmlua_get;
const wasmlua_globals = instance.exports.wasmlua_globals;
const wasmlua_inspectStack = instance.exports.wasmlua_inspectStack;
const wasmlua_invokeFunction = instance.exports.wasmlua_invokeFunction;
const wasmlua_isYieldable = instance.exports.wasmlua_isYieldable;
const wasmlua_load = instance.exports.wasmlua_load;
const wasmlua_loadBytecode = instance.exports.wasmlua_loadBytecode;
const wasmlua_loadLibraries = instance.exports.wasmlua_loadLibraries;
const wasmlua_mainThread = instance.exports.wasmlua_mainThread;
const wasmlua_namecallMethod = instance.exports.wasmlua_namecallMethod;
const wasmlua_namedRegistryValue = instance.exports.wasmlua_namedRegistryValue;
const wasmlua_new = instance.exports.wasmlua_new;
const wasmlua_objectClass = instance.exports.wasmlua_objectClass;
const wasmlua_peakMemory = instance.exports.wasmlua_peakMemory;
const wasmlua_rawGet = instance.exports.wasmlua_rawGet;
const wasmlua_rawSet = instance.exports.wasmlua_rawSet;
const wasmlua_release = instance.exports.wasmlua_release;
const wasmlua_removeDebugHooks = instance.exports.wasmlua_removeDebugHooks;
const wasmlua_removeInterruptHooks = instance.exports.wasmlua_removeInterruptHooks;
const wasmlua_requestInterrupt = instance.exports.wasmlua_requestInterrupt;
const wasmlua_sandbox = instance.exports.wasmlua_sandbox;
const wasmlua_set = instance.exports.wasmlua_set;
const wasmlua_setCompiler = instance.exports.wasmlua_setCompiler;
const wasmlua_setDebugHooks = instance.exports.wasmlua_setDebugHooks;
const wasmlua_setInterruptHooks = instance.exports.wasmlua_setInterruptHooks;
const wasmlua_setMemoryLimit = instance.exports.wasmlua_setMemoryLimit;
const wasmlua_setNamedRegistryValue = instance.exports.wasmlua_setNamedRegistryValue;
const wasmlua_setTypeMetatable = instance.exports.wasmlua_setTypeMetatable;
const wasmlua_stateId = instance.exports.wasmlua_stateId;
const wasmlua_tableClear = instance.exports.wasmlua_tableClear;
const wasmlua_tableContainsKey = instance.exports.wasmlua_tableContainsKey;
const wasmlua_tableEntries = instance.exports.wasmlua_tableEntries;
const wasmlua_tableIsReadonly = instance.exports.wasmlua_tableIsReadonly;
const wasmlua_tableLength = instance.exports.wasmlua_tableLength;
const wasmlua_tableMetatable = instance.exports.wasmlua_tableMetatable;
const wasmlua_tablePop = instance.exports.wasmlua_tablePop;
const wasmlua_tablePush = instance.exports.wasmlua_tablePush;
const wasmlua_tableRawInsert = instance.exports.wasmlua_tableRawInsert;
const wasmlua_tableRawPop = instance.exports.wasmlua_tableRawPop;
const wasmlua_tableRawPush = instance.exports.wasmlua_tableRawPush;
const wasmlua_tableRawRemove = instance.exports.wasmlua_tableRawRemove;
const wasmlua_tableRawSetIndex = instance.exports.wasmlua_tableRawSetIndex;
const wasmlua_tableRemove = instance.exports.wasmlua_tableRemove;
const wasmlua_tableSetMetatable = instance.exports.wasmlua_tableSetMetatable;
const wasmlua_tableSetReadonly = instance.exports.wasmlua_tableSetReadonly;
const wasmlua_tableSetSafeEnvironment = instance.exports.wasmlua_tableSetSafeEnvironment;
const wasmlua_threadInspectStack = instance.exports.wasmlua_threadInspectStack;
const wasmlua_threadIsYieldable = instance.exports.wasmlua_threadIsYieldable;
const wasmlua_threadNamecallMethod = instance.exports.wasmlua_threadNamecallMethod;
const wasmlua_threadReset = instance.exports.wasmlua_threadReset;
const wasmlua_threadResume = instance.exports.wasmlua_threadResume;
const wasmlua_threadResumeAsync = instance.exports.wasmlua_threadResumeAsync;
const wasmlua_threadResumeError = instance.exports.wasmlua_threadResumeError;
const wasmlua_threadResumeErrorAsync = instance.exports.wasmlua_threadResumeErrorAsync;
const wasmlua_threadSetSingleStep = instance.exports.wasmlua_threadSetSingleStep;
const wasmlua_threadStatus = instance.exports.wasmlua_threadStatus;
const wasmlua_threadTraceback = instance.exports.wasmlua_threadTraceback;
const wasmlua_traceback = instance.exports.wasmlua_traceback;
const wasmlua_typeMetatable = instance.exports.wasmlua_typeMetatable;
const wasmlua_unsetNamedRegistryValue = instance.exports.wasmlua_unsetNamedRegistryValue;
const wasmlua_usedMemory = instance.exports.wasmlua_usedMemory;
const wasmlua_userdataDestroy = instance.exports.wasmlua_userdataDestroy;
const wasmlua_userdataMetatable = instance.exports.wasmlua_userdataMetatable;
const wasmlua_userdataMetatableEntries = instance.exports.wasmlua_userdataMetatableEntries;
const wasmlua_userdataMetatableGet = instance.exports.wasmlua_userdataMetatableGet;
const wasmlua_userdataMetatableHas = instance.exports.wasmlua_userdataMetatableHas;
const wasmlua_userdataMetatableSet = instance.exports.wasmlua_userdataMetatableSet;
const wasmlua_userdataSetUserValue = instance.exports.wasmlua_userdataSetUserValue;
const wasmlua_userdataTake = instance.exports.wasmlua_userdataTake;
const wasmlua_userdataTypeName = instance.exports.wasmlua_userdataTypeName;
const wasmlua_userdataUserValue = instance.exports.wasmlua_userdataUserValue;
const wasmlua_userdataValue = instance.exports.wasmlua_userdataValue;
const wasmlua_valueEquals = instance.exports.wasmlua_valueEquals;
const wasmlua_valueIdentity = instance.exports.wasmlua_valueIdentity;
const wasmlua_valueToString = instance.exports.wasmlua_valueToString;
const workerMemoryBytes$1 = instance.exports.workerMemoryBytes;
const __abort_handler = instance.exports.__abort_handler;
const __instance_terminated = instance.exports.__instance_terminated;
const wasm_bindgen_88f4e4fb1e9bfc9___convert__closures_____invoke___js_sys_9c4f85dd2a4a6892___Function_fn_wasm_bindgen_88f4e4fb1e9bfc9___JsValue_____wasm_bindgen_88f4e4fb1e9bfc9___sys__Undefined___js_sys_9c4f85dd2a4a6892___Function_fn_wasm_bindgen_88f4e4fb1e9bfc9___JsValue_____wasm_bindgen_88f4e4fb1e9bfc9___sys__Undefined_______true_ = instance.exports.wasm_bindgen_88f4e4fb1e9bfc9___convert__closures_____invoke___js_sys_9c4f85dd2a4a6892___Function_fn_wasm_bindgen_88f4e4fb1e9bfc9___JsValue_____wasm_bindgen_88f4e4fb1e9bfc9___sys__Undefined___js_sys_9c4f85dd2a4a6892___Function_fn_wasm_bindgen_88f4e4fb1e9bfc9___JsValue_____wasm_bindgen_88f4e4fb1e9bfc9___sys__Undefined_______true_;
const wasm_bindgen_88f4e4fb1e9bfc9___convert__closures_____invoke___wasm_bindgen_88f4e4fb1e9bfc9___JsValue__core_9b3796e30d99ddb7___result__Result_____wasm_bindgen_88f4e4fb1e9bfc9___JsError___true_ = instance.exports.wasm_bindgen_88f4e4fb1e9bfc9___convert__closures_____invoke___wasm_bindgen_88f4e4fb1e9bfc9___JsValue__core_9b3796e30d99ddb7___result__Result_____wasm_bindgen_88f4e4fb1e9bfc9___JsError___true_;
const wasm_bindgen_88f4e4fb1e9bfc9___convert__closures_____invoke_______true_ = instance.exports.wasm_bindgen_88f4e4fb1e9bfc9___convert__closures_____invoke_______true_;
const memory = instance.exports.memory;
const __wbindgen_malloc = instance.exports.__wbindgen_malloc;
const __wbindgen_realloc = instance.exports.__wbindgen_realloc;
const __wbindgen_exn_store = instance.exports.__wbindgen_exn_store;
const __externref_table_alloc = instance.exports.__externref_table_alloc;
const __wbindgen_externrefs = instance.exports.__wbindgen_externrefs;
const __wbindgen_free = instance.exports.__wbindgen_free;
const __wbindgen_destroy_closure = instance.exports.__wbindgen_destroy_closure;
const __externref_table_dealloc = instance.exports.__externref_table_dealloc;
const __wbindgen_start = instance.exports.__wbindgen_start;
//#endregion
//#region src/wasm/luau_wasm.js
__wbg_set_wasm(luau_wasm_bg_exports);
__wbindgen_start();
//#endregion
export { WasmLua, compileWorker, dumpWorker, start, version, workerMemoryBytes };
