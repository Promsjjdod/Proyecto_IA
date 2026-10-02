import { S as MAX_TOTAL_MODULE_SOURCE_BYTES, _ as assertWellFormedString, b as MAX_MODULE_NAME_BYTES, c as decodeResolvedModule, g as LuaVector, h as LuaOutputEvent, m as validateWorkerRequest, n as MAX_DUMP_BYTES, o as boundedErrorMessage, r as MAX_ERROR_BYTES, t as MAX_BYTECODE_BYTES, v as utf8Length, x as MAX_MODULE_SOURCE_BYTES } from "./worker-protocol-CDOAT_ZN.js";
//#region src/conversion-internal.ts
const FROM_LUA = Symbol("FromLua");
const FROM_LUA_REST = Symbol("FromLua.rest");
const INTO_LUA = Symbol("IntoLua");
const INTO_LUA_MULTIPLE = Symbol("IntoLua.multiple");
function fromLuaNode(value) {
	if (typeof value !== "object" || value === null) return void 0;
	return value[FROM_LUA];
}
function fromLuaRestNode(value) {
	if (typeof value !== "object" || value === null) return void 0;
	return value[FROM_LUA_REST];
}
function intoLuaNode(value) {
	if (typeof value !== "object" || value === null) return void 0;
	return value[INTO_LUA];
}
function intoLuaMultipleValues(value) {
	if (typeof value !== "object" || value === null) return void 0;
	return value[INTO_LUA_MULTIPLE];
}
//#endregion
//#region src/from-lua-signature.ts
function fromLuaSignatures(value, label) {
	if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
	if (value.length > 0 && Array.isArray(value[0])) return value.map((signature, index) => {
		if (!Array.isArray(signature)) throw new TypeError(`${label} cannot mix arguments and overloads`);
		return fromLuaSignature(signature, `${label}[${index}]`);
	});
	if (value.some(Array.isArray)) throw new TypeError(`${label} cannot mix arguments and overloads`);
	return fromLuaSignature(value, label);
}
function signatureList(signatures) {
	return isOverloaded(signatures) ? signatures : [signatures];
}
function signatureAcceptsCount(signature, count) {
	const hasRest = fromLuaRestNode(signature.at(-1)) !== void 0;
	const fixed = hasRest ? signature.length - 1 : signature.length;
	let required = fixed;
	while (required > 0 && acceptsNil(signature[required - 1])) required--;
	return count >= required && (hasRest || count <= fixed);
}
function isFromLuaType(value) {
	return fromLuaNode(value) !== void 0 || isConstructor$1(value);
}
function acceptsNil(value) {
	return fromLuaNode(value)?.kind === "option";
}
function fromLuaSignature(value, label) {
	let optional = false;
	let rest = false;
	return value.map((item, index) => {
		const restNode = fromLuaRestNode(item);
		if (restNode) {
			if (index !== value.length - 1) throw new TypeError(`${label}[${index}] rest argument must be last`);
			if (optional) throw new TypeError(`${label}[${index}] cannot follow an optional argument`);
			if (!isFromLuaType(restNode.value)) throw new TypeError(`${label}[${index}] has an invalid rest decoder`);
			rest = true;
			return item;
		}
		if (rest || !isFromLuaType(item)) throw new TypeError(`${label}[${index}] must be a FromLua decoder`);
		if (acceptsNil(item)) optional = true;
		else if (optional) throw new TypeError(`${label}[${index}] cannot follow an optional argument`);
		return item;
	});
}
function isOverloaded(signatures) {
	return signatures.length > 0 && Array.isArray(signatures[0]);
}
function isConstructor$1(value) {
	if (value === BigInt) return true;
	if (typeof value !== "function") return false;
	try {
		Reflect.construct(Object, [], value);
		return true;
	} catch {
		return false;
	}
}
//#endregion
//#region src/userdata.ts
const BINARY_USERDATA_METAMETHODS = /* @__PURE__ */ new Set([
	"__add",
	"__sub",
	"__mul",
	"__div",
	"__idiv",
	"__mod",
	"__pow",
	"__eq",
	"__lt",
	"__le",
	"__concat"
]);
const decoratedDefinitions = /* @__PURE__ */ new WeakMap();
const USERDATA_METAMETHODS = /* @__PURE__ */ new Set([
	"__add",
	"__sub",
	"__mul",
	"__div",
	"__idiv",
	"__mod",
	"__pow",
	"__unm",
	"__eq",
	"__lt",
	"__le",
	"__len",
	"__concat",
	"__index",
	"__newindex",
	"__namecall",
	"__call",
	"__tostring",
	"__todebugstring",
	"__iter"
]);
/** @internal */
function decoratedUserdataDefinition(constructor) {
	const chain = [];
	let current = constructor;
	while (typeof current === "function" && current !== Function.prototype) {
		const definition = decoratedDefinitions.get(current);
		if (definition) chain.unshift(definition);
		current = Object.getPrototypeOf(current);
	}
	const fields = /* @__PURE__ */ new Map();
	const methods = /* @__PURE__ */ new Map();
	const metamethods = /* @__PURE__ */ new Map();
	const proxyFields = /* @__PURE__ */ new Map();
	const proxyMethods = /* @__PURE__ */ new Map();
	const proxyMetamethods = /* @__PURE__ */ new Map();
	for (const definition of chain) {
		for (const entry of definition.fields) fields.set(...entry);
		for (const entry of definition.methods) methods.set(...entry);
		for (const entry of definition.metamethods) metamethods.set(...entry);
		for (const entry of definition.proxyFields) proxyFields.set(...entry);
		for (const entry of definition.proxyMethods) proxyMethods.set(...entry);
		for (const entry of definition.proxyMetamethods) proxyMetamethods.set(...entry);
	}
	const constructorArguments = decoratedDefinitions.get(constructor)?.constructorArguments;
	if (constructorArguments !== void 0 && proxyMetamethods.has("__call")) throw new TypeError("userdata constructor conflicts with proxy metamethod __call");
	if (constructorArguments === void 0 && fields.size === 0 && methods.size === 0 && metamethods.size === 0 && proxyFields.size === 0 && proxyMethods.size === 0 && proxyMetamethods.size === 0) return;
	return {
		...constructorArguments === void 0 ? {} : { constructor: constructorArguments },
		fields: fields.size > 0 ? Object.fromEntries(fields) : void 0,
		methods: methods.size > 0 ? Object.fromEntries(methods) : void 0,
		metamethods: metamethods.size > 0 ? Object.fromEntries(metamethods) : void 0,
		proxy: proxyFields.size > 0 || proxyMethods.size > 0 || proxyMetamethods.size > 0 ? {
			fields: proxyFields.size > 0 ? Object.fromEntries(proxyFields) : void 0,
			methods: proxyMethods.size > 0 ? Object.fromEntries(proxyMethods) : void 0,
			metamethods: proxyMetamethods.size > 0 ? Object.fromEntries(proxyMetamethods) : void 0
		} : void 0
	};
}
/** @internal */
function isBinaryUserdataMetamethod(name) {
	return BINARY_USERDATA_METAMETHODS.has(name);
}
/** @internal */
function assertUserdataSurface(value, label = "userdata definition") {
	if (typeof value !== "object" || value === null) throw new TypeError(`${label} must be an object`);
	const surface = value;
	if (surface.fields !== void 0) {
		if (typeof surface.fields !== "object" || surface.fields === null) throw new TypeError(`${label}.fields must be an object`);
		for (const [name, field] of Object.entries(surface.fields)) {
			if (typeof field !== "object" || field === null) throw new TypeError(`${label}.fields.${name} must be an object`);
			if (field.get !== void 0 && typeof field.get !== "function") throw new TypeError(`${label}.fields.${name}.get must be a function`);
			if (field.set !== void 0 && typeof field.set !== "function") throw new TypeError(`${label}.fields.${name}.set must be a function`);
			if (field.type !== void 0) fromLuaType(field.type, `${label}.fields.${name}.type`);
		}
	}
	if (surface.methods !== void 0) {
		if (typeof surface.methods !== "object" || surface.methods === null) throw new TypeError(`${label}.methods must be an object`);
		for (const [name, method] of Object.entries(surface.methods)) resolveUserdataMethod(method, `${label}.methods.${name}`);
	}
	if (surface.metamethods !== void 0) {
		if (typeof surface.metamethods !== "object" || surface.metamethods === null) throw new TypeError(`${label}.metamethods must be an object`);
		for (const [name, callback] of Object.entries(surface.metamethods)) {
			if (!USERDATA_METAMETHODS.has(name)) throw new TypeError(`unknown Lua userdata metamethod ${name}`);
			if (name === "__call") resolveUserdataMethod(callback, `${label}.metamethods.${name}`);
			else if (typeof callback !== "function") throw new TypeError(`${label}.metamethods.${name} must be a function`);
		}
	}
}
/** @internal */
function assertUserdataDefinition(value, label = "userdata definition") {
	assertUserdataSurface(value, label);
	const definition = value;
	const hasConstructor = Object.hasOwn(definition, "constructor");
	if (hasConstructor) fromLuaSignatures(definition.constructor, `${label}.constructor`);
	if (definition.proxy !== void 0) assertUserdataSurface(definition.proxy, `${label}.proxy`);
	if (hasConstructor && definition.proxy?.metamethods?.__call !== void 0) throw new TypeError(`${label}.constructor conflicts with ${label}.proxy.metamethods.__call`);
}
/** @internal */
function resolveUserdataMethod(method, label = "userdata method") {
	if (typeof method === "function") return { callback: method };
	if (typeof method !== "object" || method === null) throw new TypeError(`${label} must be a function or method options`);
	if (typeof method.callback !== "function") throw new TypeError(`${label}.callback must be a function`);
	return {
		callback: method.callback,
		args: fromLuaSignatures(method.args, `${label}.args`)
	};
}
function fromLuaType(value, label) {
	if (isFromLuaType(value)) return value;
	throw new TypeError(`${label} must be a FromLua decoder`);
}
//#endregion
//#region src/direct.ts
const REF_STATE = "__luauRsState";
const REF_ID = "__luauRsRef";
const REF_TYPE = "__luauRsType";
const VECTOR_MARKER = "__luauRsVector";
const BUFFER_MARKER = "__luauRsBuffer";
const USERDATA_MARKER = "__luauRsUserdata";
const TABLE_MARKER = "__luauRsTable";
const CALLBACK_RESULT_MARKER = "__luauRsCallbackResult";
const STATE = Symbol("LuaValue.state");
const VALUE_TOKEN = Symbol("LuaValue");
const VALUE_IDENTITY = Symbol("LuaValue.identity");
const USERDATA_VALUE = Symbol("Lua.userdataValue");
/** @internal */
const CREATE_USERDATA_IDENTITY = Symbol("Lua.createUserdataIdentity");
/** @internal */
const RELEASE_LUA = Symbol("Lua.release");
/** @internal */
const INVOKE_LUA_FUNCTION = Symbol("LuaFunction.invoke");
/** @internal */
const LUA_FUNCTION_IDENTITY = Symbol("LuaFunction.identity");
const utf8Decoder = new TextDecoder();
const utf8Encoder = new TextEncoder();
const isArray$1 = Array.isArray;
let initialization;
/** @internal */
function initializeLuaBindings() {
	return initialization ??= import("./worker-wasm-Bc9IP5xV.js").then((bindings) => {
		const initializeWorker = bindings.initializeWorkerBindings;
		return initializeWorker === void 0 ? bindings : initializeWorker();
	});
}
/** @internal */
async function dumpWorker(source, compilerOptions, dumpOptions, outputLimit, errorLimit) {
	return (await initializeLuaBindings()).dumpWorker(source, compilerOptions, dumpOptions, outputLimit, errorLimit);
}
/** @internal */
async function compileWorker(source, compilerOptions, bytecodeLimit, errorLimit) {
	return (await initializeLuaBindings()).compileWorker(source, compilerOptions, bytecodeLimit, errorLimit);
}
/** @internal */
async function workerMemoryBytes() {
	return (await initializeLuaBindings()).workerMemoryBytes();
}
const luaValueFinalizer = new FinalizationRegistry(({ state, handle }) => {
	try {
		state.deref()?.release(handle);
	} catch {}
});
function liveLua(reference) {
	const lua = reference.deref();
	if (!lua) throw new Error("Lua state is unavailable");
	return lua;
}
function sourceText(source) {
	if (typeof source !== "string") throw new TypeError("Luau source must be a string");
	assertWellFormedString(source);
	return source;
}
var HostCallbacks = class {
	#originals = /* @__PURE__ */ new WeakMap();
	bridge(callback) {
		const reference = new WeakRef(callback);
		const bridge = (...args) => {
			const live = reference.deref();
			if (!live) throw new Error("Lua host callback is unavailable");
			return live(...args);
		};
		this.#originals.set(bridge, callback);
		return bridge;
	}
};
/** A rooted value owned by a direct {@link Lua} state. */
var LuaValue = class {
	lua;
	type;
	handle;
	/** @internal */
	[STATE];
	constructor(lua, state, type, handle, registerFinalizer, token) {
		this.lua = lua;
		this.type = type;
		this.handle = handle;
		if (token !== VALUE_TOKEN) throw new TypeError("Lua values are created by a Lua state");
		this[STATE] = state;
		if (registerFinalizer) luaValueFinalizer.register(this, {
			state: new WeakRef(this[STATE]),
			handle
		}, lua);
	}
	equals(other) {
		if (other.lua !== this.lua) throw new Error("Lua value belongs to another state");
		return this[STATE].valueEquals(this.handle, other.handle);
	}
	/** @internal */
	[VALUE_IDENTITY]() {
		return this[STATE].valueIdentity(this.handle);
	}
	toString() {
		return this[STATE].valueToString(this.handle);
	}
	/** @internal */
	reference(lua) {
		if (this.lua !== lua) throw new Error("Lua value belongs to another state");
		return {
			[REF_STATE]: this[STATE].stateId,
			[REF_ID]: this.handle,
			[REF_TYPE]: this.type
		};
	}
};
var LuaObjectLike = class extends LuaValue {
	get(key) {
		return this.lua.decode(this[STATE].get(this.handle, this.lua.encode(key)));
	}
	set(key, value) {
		this[STATE].set(this.handle, this.lua.encode(key), this.lua.encode(value));
	}
	call(...args) {
		return this.lua.decodeArray(this[STATE].call(this.handle, this.lua.encodeArray(args)));
	}
	async callAsync(args = [], options = {}) {
		const [abort, cleanup] = prepareAbort(options);
		try {
			return this.lua.decodeArray(await this[STATE].callAsync(this.handle, this.lua.encodeArray(args), abort));
		} finally {
			cleanup();
		}
	}
	callMethod(name, ...args) {
		return this.lua.decodeArray(this[STATE].callMethod(this.handle, name, this.lua.encodeArray(args)));
	}
	async callMethodAsync(name, args = [], options = {}) {
		const [abort, cleanup] = prepareAbort(options);
		try {
			return this.lua.decodeArray(await this[STATE].callMethodAsync(this.handle, name, this.lua.encodeArray(args), abort));
		} finally {
			cleanup();
		}
	}
	callFunction(name, ...args) {
		return this.lua.decodeArray(this[STATE].callFunction(this.handle, name, this.lua.encodeArray(args)));
	}
	async callFunctionAsync(name, args = [], options = {}) {
		const [abort, cleanup] = prepareAbort(options);
		try {
			return this.lua.decodeArray(await this[STATE].callFunctionAsync(this.handle, name, this.lua.encodeArray(args), abort));
		} finally {
			cleanup();
		}
	}
};
var LuaClass = class extends LuaObjectLike {};
var LuaObject = class extends LuaObjectLike {
	get class() {
		const value = this.lua.decode(this[STATE].objectClass(this.handle));
		if (!(value instanceof LuaClass)) throw new Error("Lua returned an invalid object class");
		return value;
	}
};
var LuaTable = class LuaTable extends LuaObjectLike {
	rawGet(key) {
		return this.lua.decode(this[STATE].rawGet(this.handle, this.lua.encode(key)));
	}
	rawSet(key, value) {
		this[STATE].rawSet(this.handle, this.lua.encode(key), this.lua.encode(value));
	}
	entries() {
		return this[STATE].tableEntries(this.handle).map((entry) => {
			if (!isArray$1(entry) || entry.length !== 2) throw new Error("Lua returned an invalid table entry");
			return [this.lua.decode(entry[0]), this.lua.decode(entry[1])];
		});
	}
	toArray() {
		const entries = this.entries();
		const result = new Array(entries.length);
		for (const [key, value] of entries) {
			const index = tableIndex(key);
			if (index === void 0 || index > entries.length || index - 1 in result) throw new TypeError("table must be a contiguous sequence");
			result[index - 1] = value;
		}
		return result;
	}
	toObject() {
		const result = Object.create(null);
		for (const [key, value] of this.entries()) {
			if (typeof key !== "string") throw new TypeError("table must have only string keys");
			result[key] = value;
		}
		return result;
	}
	toMap() {
		return new Map(this.entries());
	}
	length(options = {}) {
		return this[STATE].tableLength(this.handle, options.raw ?? false);
	}
	clear() {
		this[STATE].tableClear(this.handle);
	}
	containsKey(key) {
		return this[STATE].tableContainsKey(this.handle, this.lua.encode(key));
	}
	push(value) {
		this[STATE].tablePush(this.handle, this.lua.encode(value));
	}
	pop() {
		return this.lua.decode(this[STATE].tablePop(this.handle));
	}
	remove(key) {
		this[STATE].tableRemove(this.handle, this.lua.encode(key));
	}
	rawSetIndex(index, value) {
		this[STATE].tableRawSetIndex(this.handle, wasmUsize(index, "index"), this.lua.encode(value));
	}
	rawPush(value) {
		this[STATE].tableRawPush(this.handle, this.lua.encode(value));
	}
	rawPop() {
		return this.lua.decode(this[STATE].tableRawPop(this.handle));
	}
	rawInsert(index, value) {
		this[STATE].tableRawInsert(this.handle, wasmUsize(index, "index"), this.lua.encode(value));
	}
	rawRemove(key) {
		this[STATE].tableRawRemove(this.handle, this.lua.encode(key));
	}
	setSafeEnvironment(enabled) {
		this[STATE].tableSetSafeEnvironment(this.handle, enabled);
	}
	get readonly() {
		return this[STATE].tableIsReadonly(this.handle);
	}
	set readonly(enabled) {
		this[STATE].tableSetReadonly(this.handle, enabled);
	}
	get metatable() {
		const value = this.lua.decode(this[STATE].tableMetatable(this.handle));
		if (value === null) return null;
		if (!(value instanceof LuaTable)) throw new Error("Lua returned a non-table metatable");
		return value;
	}
	set metatable(value) {
		this[STATE].tableSetMetatable(this.handle, this.lua.encode(value));
	}
};
var LuaFunction = class LuaFunction extends LuaValue {
	get environment() {
		const value = this.lua.decode(this[STATE].functionEnvironment(this.handle));
		if (value === null) return null;
		if (!(value instanceof LuaTable)) throw new Error("Lua returned a non-table function environment");
		return value;
	}
	setEnvironment(environment) {
		if (!(environment instanceof LuaTable)) throw new TypeError("function environment must be a Lua table");
		return this[STATE].functionSetEnvironment(this.handle, environment.reference(this.lua)[REF_ID]);
	}
	deepClone() {
		const value = this.lua.decode(this[STATE].functionDeepClone(this.handle));
		if (!(value instanceof LuaFunction)) throw new Error("Lua returned a non-function clone");
		return value;
	}
	bind(...args) {
		const value = this.lua.decode(this[STATE].functionBind(this.handle, this.lua.encodeArray(args)));
		if (!(value instanceof LuaFunction)) throw new Error("Lua returned a non-function binding");
		return value;
	}
	info() {
		return this[STATE].functionInfo(this.handle);
	}
	coverage() {
		return this[STATE].functionCoverage(this.handle);
	}
	call(...args) {
		return this.lua.decodeArray(this[STATE].call(this.handle, this.lua.encodeArray(args)));
	}
	async callAsync(args = [], options = {}) {
		const [abort, cleanup] = prepareAbort(options);
		try {
			return this.lua.decodeArray(await this[STATE].callAsync(this.handle, this.lua.encodeArray(args), abort));
		} finally {
			cleanup();
		}
	}
	/** @internal */
	[INVOKE_LUA_FUNCTION](args, options = {}) {
		const [abort, cleanup] = prepareAbort(options);
		let result;
		try {
			result = this[STATE].invokeFunction(this.handle, this.lua.encodeArray(args), abort);
		} catch (error) {
			cleanup();
			throw error;
		}
		if (result instanceof Promise) return result.then((values) => this.lua.decodeArray(values)).finally(cleanup);
		cleanup();
		return this.lua.decodeArray(result);
	}
	/** @internal */
	[LUA_FUNCTION_IDENTITY]() {
		return this[STATE].functionIdentity(this.handle);
	}
	createThread() {
		const value = this.lua.decode(this[STATE].createThread(this.handle));
		if (!(value instanceof LuaThread)) throw new Error("Lua returned a non-thread value");
		return value;
	}
};
var LuaThread = class extends LuaValue {
	get status() {
		return this[STATE].threadStatus(this.handle);
	}
	get yieldable() {
		return this[STATE].threadIsYieldable(this.handle);
	}
	get namecallMethod() {
		return this[STATE].threadNamecallMethod(this.handle) ?? null;
	}
	setSingleStep(enabled) {
		if (typeof enabled !== "boolean") throw new TypeError("single-step state must be a boolean");
		this[STATE].threadSetSingleStep(this.handle, enabled);
	}
	inspectStack(level = 0) {
		const info = this[STATE].threadInspectStack(this.handle, wasmUsize(level, "stack level"));
		return info === null ? null : Object.freeze(info);
	}
	traceback(message, level = 0) {
		return utf8Decoder.decode(this[STATE].threadTraceback(this.handle, message, wasmUsize(level, "traceback level")));
	}
	resume(...args) {
		return this.lua.decodeArray(this[STATE].threadResume(this.handle, this.lua.encodeArray(args)));
	}
	reset(function_) {
		if (!(function_ instanceof LuaFunction)) throw new TypeError("thread reset requires a Lua function");
		this[STATE].threadReset(this.handle, function_.reference(this.lua)[REF_ID]);
	}
	resumeError(error) {
		return this.lua.decodeArray(this[STATE].threadResumeError(this.handle, this.lua.encode(error)));
	}
	async resumeAsync(args = [], options = {}) {
		const [abort, cleanup] = prepareAbort(options);
		try {
			const result = await this[STATE].threadResumeAsync(this.handle, this.lua.encodeArray(args), abort);
			return this.decodeResult(result);
		} finally {
			cleanup();
		}
	}
	async resumeErrorAsync(error, options = {}) {
		const [abort, cleanup] = prepareAbort(options);
		try {
			return this.decodeResult(await this[STATE].threadResumeErrorAsync(this.handle, this.lua.encode(error), abort));
		} finally {
			cleanup();
		}
	}
	[Symbol.asyncIterator]() {
		let closed = false;
		let queue = Promise.resolve();
		const thread = this;
		const enqueue = (operation) => {
			const result = queue.then(operation);
			queue = result.then(() => void 0, () => void 0);
			return result;
		};
		return {
			next(args = []) {
				return enqueue(async () => {
					if (closed) return {
						done: true,
						value: []
					};
					try {
						const result = await thread.resumeAsync(args);
						closed = result.done;
						return result;
					} catch (error) {
						closed = thread.status !== "resumable";
						throw error;
					}
				});
			},
			throw(error) {
				return enqueue(async () => {
					if (closed) throw error;
					try {
						const result = await thread.resumeErrorAsync(error);
						closed = result.done;
						return result;
					} catch (raised) {
						closed = thread.status !== "resumable";
						throw raised;
					}
				});
			},
			return(value = []) {
				return enqueue(async () => {
					closed = true;
					return {
						done: true,
						value: await value
					};
				});
			},
			[Symbol.asyncIterator]() {
				return this;
			},
			async [Symbol.asyncDispose]() {
				closed = true;
				await queue;
			}
		};
	}
	decodeResult(value) {
		if (typeof value !== "object" || value === null) throw new Error("Lua returned an invalid coroutine result");
		const result = value;
		if (typeof result.done !== "boolean" || !isArray$1(result.value)) throw new Error("Lua returned an invalid coroutine result");
		const values = this.lua.decodeArray(result.value);
		return result.done ? {
			done: true,
			value: values
		} : {
			done: false,
			value: values
		};
	}
};
var LuaBuffer = class extends LuaValue {
	get bytes() {
		return this[STATE].bufferBytes(this.handle);
	}
	write(offset, bytes) {
		this[STATE].bufferWrite(this.handle, wasmUsize(offset, "offset"), bytes);
	}
};
var LuaUserdata = class extends LuaObjectLike {
	get value() {
		return this.lua[USERDATA_VALUE](this[STATE].userdataValue(this.handle));
	}
	destroy() {
		this[STATE].userdataDestroy(this.handle);
	}
	take() {
		return this.lua[USERDATA_VALUE](this[STATE].userdataTake(this.handle));
	}
	get userValue() {
		return this.lua.decode(this[STATE].userdataUserValue(this.handle));
	}
	set userValue(value) {
		this[STATE].userdataSetUserValue(this.handle, this.lua.encode(value));
	}
	get typeName() {
		return this[STATE].userdataTypeName(this.handle);
	}
	get metatable() {
		this[STATE].userdataMetatable(this.handle);
		return LuaUserdataMetatable.create(this, this.lua, this[STATE], this.handle, VALUE_TOKEN);
	}
	isProxy(userdataClass) {
		return Object.is(this.value, userdataClass);
	}
};
var LuaUserdataMetatable = class LuaUserdataMetatable {
	owner;
	lua;
	handle;
	constructor(owner, lua, state, handle, token) {
		this.owner = owner;
		this.lua = lua;
		this.handle = handle;
		if (token !== VALUE_TOKEN) throw new TypeError("userdata metatables are created by Lua userdata");
		this.state = state;
	}
	state;
	/** @internal */
	static create(owner, lua, state, handle, token) {
		return new LuaUserdataMetatable(owner, lua, state, handle, token);
	}
	get(key) {
		return this.lua.decode(this.state.userdataMetatableGet(this.handle, key));
	}
	set(key, value) {
		this.state.userdataMetatableSet(this.handle, key, this.lua.encode(value));
	}
	has(key) {
		return this.state.userdataMetatableHas(this.handle, key);
	}
	entries() {
		return this.state.userdataMetatableEntries(this.handle).map((entry) => {
			if (!isArray$1(entry) || entry.length !== 2 || typeof entry[0] !== "string") throw new Error("Lua returned an invalid userdata metatable entry");
			return [entry[0], this.lua.decode(entry[1])];
		});
	}
};
/** @internal */
function convertLuaArguments(values, types, label = "argument") {
	if (types === void 0) return [...values];
	const matches = signatureList(types).filter((signature) => signatureAcceptsCount(signature, values.length));
	if (matches.length === 0) throw new TypeError(`${label} count does not match the declared arguments`);
	let firstError;
	for (const signature of matches) try {
		return convertLuaArgumentSignature(values, signature, (value) => value, label);
	} catch (error) {
		firstError ??= error;
	}
	if (matches.length === 1 && firstError instanceof Error) throw firstError;
	throw new TypeError(`${label}s do not match any declared overload`);
}
/** @internal */
function convertLuaStructures(values, leaf = (value) => value, label = "value") {
	return convertLuaArgumentSignature(values, void 0, leaf, label);
}
function convertLuaArgumentSignature(values, types, leaf, label) {
	const context = {
		tables: /* @__PURE__ */ new Map(),
		leaf
	};
	const rest = types ? fromLuaRestNode(types.at(-1)) : void 0;
	const fixed = types ? types.length - (rest ? 1 : 0) : values.length;
	const count = rest ? Math.max(fixed, values.length) : fixed;
	return Array.from({ length: count }, (_, index) => convertLuaArgument(values[index] ?? null, index < fixed ? types?.[index] : rest?.value, context, 0, `${label} ${index + 1}`));
}
function convertLuaArgument(value, type, context, depth, label) {
	if (depth > 64) throw new TypeError("Lua table nesting is too deep");
	const node = fromLuaNode(type);
	if (node?.kind === "option") return value === null ? void 0 : convertLuaArgument(value, node.value, context, depth, label);
	if (node?.kind === "bytes") {
		if (value instanceof Uint8Array) return value;
		if (typeof value === "string") return utf8Encoder.encode(value);
		throw new TypeError(`${label} must be a string`);
	}
	if (node?.kind === "array" || node?.kind === "tuple" || node?.kind === "map" || node?.kind === "record" || node?.kind === "object") {
		if (!(value instanceof LuaTable)) throw new TypeError(`${label} must be a table`);
		return convertLuaTable(value, type, context, depth, label);
	}
	if (type === void 0) {
		if (value instanceof LuaTable) return convertLuaTable(value, void 0, context, depth, label);
		return context.leaf(value);
	}
	if (type === Number) {
		if (typeof value === "number") return value;
		if (typeof value === "bigint" && value >= BigInt(Number.MIN_SAFE_INTEGER) && value <= BigInt(Number.MAX_SAFE_INTEGER)) return Number(value);
		throw new TypeError(`${label} must be a number`);
	}
	if (type === BigInt) {
		if (typeof value === "bigint") return value;
		if (typeof value === "number" && Number.isSafeInteger(value)) return BigInt(value);
		throw new TypeError(`${label} must be an integer`);
	}
	if (type === String) {
		if (typeof value === "string") return value;
		throw new TypeError(`${label} must be a valid UTF-8 string`);
	}
	if (type === Boolean) {
		if (typeof value === "boolean") return value;
		throw new TypeError(`${label} must be a boolean`);
	}
	if (type === Uint8Array) {
		if (value instanceof Uint8Array) return value;
		if (typeof value === "string") return utf8Encoder.encode(value);
		throw new TypeError(`${label} must be a string`);
	}
	if (type === Array || type === Object || type === Map) {
		if (!(value instanceof LuaTable)) throw new TypeError(`${label} must be a table`);
		return convertLuaTable(value, type, context, depth, label);
	}
	if (type === LuaVector) {
		if (value instanceof LuaVector) return value;
		throw new TypeError(`${label} must be a vector`);
	}
	const constructor = type;
	if (constructor === LuaValue || constructor.prototype instanceof LuaValue) {
		if (value instanceof constructor) return value;
		throw new TypeError(`${label} must be ${constructor.name}`);
	}
	if (value instanceof LuaUserdata) {
		const host = value.value;
		if (host instanceof constructor) return host;
	}
	throw new TypeError(`${label} must be ${constructor.name || "registered userdata"}`);
}
function convertLuaTable(table, decoder, context, depth, label) {
	const identity = table[VALUE_IDENTITY]();
	const converted = context.tables.get(identity);
	if (converted) {
		if (decoder !== void 0 && (converted.decoder === void 0 || !sameFromLuaType(decoder, converted.decoder))) throw new TypeError(`${label} was already converted with a different table decoder`);
		return converted.value;
	}
	const entries = table.entries();
	const indexes = entries.map(([key]) => tableIndex(key));
	const sequence = entries.length > 0 && indexes.every((index) => index !== void 0) && new Set(indexes).size === entries.length && indexes.reduce((largest, index) => Math.max(largest, index), 0) === entries.length;
	const node = fromLuaNode(decoder);
	const shape = (decoder === Array || node?.kind === "array" || node?.kind === "tuple" ? "array" : decoder === Object || node?.kind === "record" || node?.kind === "object" ? "object" : decoder === Map || node?.kind === "map" ? "map" : void 0) ?? (sequence ? "array" : entries.every(([key]) => typeof key === "string") ? "object" : "map");
	if (shape === "array") {
		if (!sequence && entries.length !== 0) throw new TypeError(`${label} must be a contiguous sequence table`);
		if (node?.kind === "tuple" && !tupleAcceptsCount(node.values, entries.length)) throw new TypeError(`${label} length does not match the declared tuple`);
		const result = new Array(node?.kind === "tuple" ? node.values.length : entries.length);
		context.tables.set(identity, {
			decoder,
			value: result
		});
		for (let index = 0; index < entries.length; index += 1) result[indexes[index] - 1] = convertLuaArgument(entries[index][1], node?.kind === "array" ? node.value : node?.kind === "tuple" ? node.values[index] : void 0, context, depth + 1, `${label}[${index}]`);
		if (node?.kind === "tuple") for (let index = entries.length; index < node.values.length; index += 1) result[index] = convertLuaArgument(null, node.values[index], context, depth + 1, `${label}[${index}]`);
		return result;
	}
	if (shape === "object") {
		if (!entries.every(([key]) => typeof key === "string")) throw new TypeError(`${label} must be a table with string keys`);
		const result = Object.create(null);
		context.tables.set(identity, {
			decoder,
			value: result
		});
		const fields = node?.kind === "object" ? node.fields : void 0;
		const present = /* @__PURE__ */ new Set();
		for (const [key, value] of entries) {
			const name = key;
			present.add(name);
			result[name] = convertLuaArgument(value, node?.kind === "record" ? node.value : fields?.[name], context, depth + 1, `${label}.${name}`);
		}
		if (fields) {
			for (const [name, field] of Object.entries(fields)) if (!present.has(name) && !acceptsNil(field)) throw new TypeError(`${label}.${name} is required`);
		}
		return result;
	}
	const result = /* @__PURE__ */ new Map();
	context.tables.set(identity, {
		decoder,
		value: result
	});
	for (const [key, value] of entries) result.set(convertLuaArgument(key, node?.kind === "map" ? node.key : void 0, context, depth + 1, `${label} key`), convertLuaArgument(value, node?.kind === "map" ? node.value : void 0, context, depth + 1, `${label} value`));
	return result;
}
function tupleAcceptsCount(values, count) {
	let required = values.length;
	while (required > 0 && acceptsNil(values[required - 1])) required--;
	return count >= required && count <= values.length;
}
function sameFromLuaType(left, right) {
	if (left === right) return true;
	const leftNode = fromLuaNode(left);
	const rightNode = fromLuaNode(right);
	if (!leftNode || !rightNode || leftNode.kind !== rightNode.kind) return false;
	switch (leftNode.kind) {
		case "bytes": return true;
		case "array":
		case "record":
		case "option": return sameFromLuaType(leftNode.value, rightNode.value);
		case "tuple": {
			const rightValues = rightNode.values;
			return leftNode.values.length === rightValues.length && leftNode.values.every((value, index) => sameFromLuaType(value, rightValues[index]));
		}
		case "map": {
			const rightMap = rightNode;
			return sameFromLuaType(leftNode.key, rightMap.key) && sameFromLuaType(leftNode.value, rightMap.value);
		}
		case "object": {
			const rightFields = rightNode.fields;
			const names = Object.keys(leftNode.fields);
			return names.length === Object.keys(rightFields).length && names.every((name) => Object.hasOwn(rightFields, name) && sameFromLuaType(leftNode.fields[name], rightFields[name]));
		}
	}
}
function isPromiseLike(value) {
	return (typeof value === "object" || typeof value === "function") && value !== null && "then" in value && typeof value.then === "function";
}
function tableIndex(value) {
	if (typeof value === "bigint") {
		if (value < 1n || value > BigInt(Number.MAX_SAFE_INTEGER)) return void 0;
		return Number(value);
	}
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 1 ? value : void 0;
}
/**
* A direct Lua state in the current JavaScript realm.
*
* Execution runs on the current thread. Browser applications running
* untrusted scripts should normally use `LuaWorker`.
*/
var Lua = class Lua extends EventTarget {
	version;
	appData = /* @__PURE__ */ new Map();
	#state;
	#callbacks;
	#userdataDefinitions = /* @__PURE__ */ new Map();
	#userdataBridges = /* @__PURE__ */ new Map();
	#userdataValues = /* @__PURE__ */ new WeakMap();
	#binaryUserdataBridges = /* @__PURE__ */ new WeakMap();
	#registerFinalizers;
	constructor(state, version, registerFinalizers, callbacks) {
		super();
		this.version = version;
		this.#state = state;
		this.#registerFinalizers = registerFinalizers;
		this.#callbacks = callbacks;
	}
	/** @internal */
	[RELEASE_LUA]() {
		luaValueFinalizer.unregister(this);
		this.#state.dispose();
		this.#state.free();
	}
	static async create(options = {}) {
		return Lua.createState(options, true);
	}
	/** @internal */
	static async createWorkerState(options = {}) {
		return Lua.createState(options, false);
	}
	static async createState(options, registerFinalizers) {
		if (typeof options !== "object" || options === null) throw new TypeError("Lua options must be an object");
		const { resolveModule, ...stateOptions } = options;
		if (resolveModule !== void 0 && typeof resolveModule !== "function") throw new TypeError("resolveModule must be a function");
		const bindings = await initializeLuaBindings();
		const callbacks = new HostCallbacks();
		const allocationObserver = stateOptions.memory?.onAllocation;
		const rawOptions = allocationObserver ? {
			...stateOptions,
			memory: {
				...stateOptions.memory,
				onAllocation: callbacks.bridge(allocationObserver)
			}
		} : stateOptions;
		const lua = new Lua(new bindings.WasmLua(rawOptions), bindings.version(), registerFinalizers, callbacks);
		const owner = new WeakRef(lua);
		lua.#state.configureOutput(callbacks.bridge((type, text) => {
			owner.deref()?.dispatchEvent(new LuaOutputEvent(type, text));
		}));
		if (resolveModule) lua.#state.configureModules([], lua.moduleResolver(resolveModule), stateOptions.sandbox === true, {
			maxModules: 32,
			maxModuleNameBytes: MAX_MODULE_NAME_BYTES,
			maxModuleSourceBytes: MAX_MODULE_SOURCE_BYTES,
			maxTotalModuleSourceBytes: MAX_TOTAL_MODULE_SOURCE_BYTES
		});
		return lua;
	}
	addEventListener(type, listener, options) {
		super.addEventListener(type, listener, options);
	}
	removeEventListener(type, listener, options) {
		super.removeEventListener(type, listener, options);
	}
	get globals() {
		const value = this.decode(this.#state.globals());
		if (!(value instanceof LuaTable)) throw new Error("Lua returned invalid globals");
		return value;
	}
	get mainThread() {
		const value = this.decode(this.#state.mainThread());
		if (!(value instanceof LuaThread)) throw new Error("Lua returned an invalid main thread");
		return value;
	}
	get currentThread() {
		const value = this.decode(this.#state.currentThread());
		if (!(value instanceof LuaThread)) throw new Error("Lua returned an invalid current thread");
		return value;
	}
	get yieldable() {
		return this.#state.isYieldable();
	}
	get namecallMethod() {
		return this.#state.namecallMethod() ?? null;
	}
	coerceString(value) {
		const result = this.decode(this.#state.coerceString(this.encode(value)));
		if (result !== null && typeof result !== "string" && !(result instanceof Uint8Array)) throw new Error("Lua returned a non-string coercion result");
		return result;
	}
	coerceInteger(value) {
		const result = this.#state.coerceInteger(this.encode(value));
		if (result !== null && typeof result !== "bigint") throw new Error("Lua returned a non-integer coercion result");
		return result;
	}
	coerceNumber(value) {
		const result = this.#state.coerceNumber(this.encode(value));
		if (result === void 0) return null;
		if (typeof result !== "number") throw new Error("Lua returned a non-number coercion result");
		return result;
	}
	typeMetatable(type) {
		const result = this.decode(this.#state.typeMetatable(type));
		if (result === null) return null;
		if (!(result instanceof LuaTable)) throw new Error("Lua returned a non-table type metatable");
		return result;
	}
	setTypeMetatable(type, metatable) {
		if (metatable !== null && !(metatable instanceof LuaTable)) throw new TypeError("type metatable must be a Lua table or null");
		this.#state.setTypeMetatable(type, this.encode(metatable));
	}
	inspectStack(level = 0) {
		const info = this.#state.inspectStack(wasmUsize(level, "stack level"));
		return info === null ? null : Object.freeze(info);
	}
	get usedMemory() {
		return this.#state.usedMemory();
	}
	get peakMemory() {
		return this.#state.peakMemory();
	}
	/** @internal */
	configureWorker(modules, resolveModule, output, outputByteLimit, outputEventLimit) {
		this.#state.configureWorker([...modules], resolveModule ? this.moduleResolver(resolveModule) : void 0, this.#callbacks.bridge(output), outputByteLimit, outputEventLimit, {
			maxModules: 32,
			maxModuleNameBytes: MAX_MODULE_NAME_BYTES,
			maxModuleSourceBytes: MAX_MODULE_SOURCE_BYTES,
			maxTotalModuleSourceBytes: MAX_TOTAL_MODULE_SOURCE_BYTES
		});
	}
	moduleResolver(resolveModule) {
		const callback = this.#callbacks.bridge(resolveModule);
		const owner = new WeakRef(this);
		const encode = (module) => {
			const lua = liveLua(owner);
			if (module === null || module === void 0) return module;
			if (typeof module !== "object" || Array.isArray(module)) throw new TypeError("module resolver must return a module object");
			if (typeof module.name !== "string") throw new TypeError("resolved module name must be a string");
			if (!module.name || module.name.includes("\0") || utf8Length(module.name) > 2048) throw new TypeError("resolved module name is invalid");
			const hasSource = Object.hasOwn(module, "source");
			if (hasSource === Object.hasOwn(module, "value")) throw new TypeError("module resolver must return exactly one of source or value");
			if (hasSource) {
				if (typeof module.source !== "string") throw new TypeError("resolved module source must be a string");
				const source = module.source;
				if (utf8Length(source) > 262144) throw new RangeError("resolved module source exceeds the per-file limit");
				return {
					name: module.name,
					source
				};
			}
			const value = module.value;
			if (value === void 0) throw new TypeError("resolved module value is required");
			return {
				name: module.name,
				value: lua.encode(value)
			};
		};
		return (specifier, from) => {
			const lua = liveLua(owner);
			const module = callback(specifier, {
				from,
				lua
			});
			return isPromiseLike(module) ? Promise.resolve(module).then(encode) : encode(module);
		};
	}
	/** @internal */
	executeWorker(source, options, errorLimit, resultByteLimit, resultEntryLimit) {
		return this.#state.executeWorker(source, options, errorLimit, resultByteLimit, resultEntryLimit);
	}
	/** @internal */
	executeBytecodeWorker(bytecode, options, errorLimit, resultByteLimit, resultEntryLimit) {
		return this.#state.executeBytecodeWorker(bytecode, options, errorLimit, resultByteLimit, resultEntryLimit);
	}
	get gcRunning() {
		return this.#state.gcIsRunning();
	}
	createTable(initial) {
		const value = this.decode(this.#state.createTable(this.encode(initial ?? null)));
		if (!(value instanceof LuaTable)) throw new Error("Lua returned a non-table value");
		return value;
	}
	createTableWithCapacity(arrayCapacity, recordCapacity) {
		const value = this.decode(this.#state.createTableWithCapacity(wasmUsize(arrayCapacity, "array capacity"), wasmUsize(recordCapacity, "record capacity")));
		if (!(value instanceof LuaTable)) throw new Error("Lua returned a non-table value");
		return value;
	}
	createBuffer(bytes) {
		const value = this.decode(typeof bytes === "number" ? this.#state.createBufferWithCapacity(wasmUsize(bytes, "buffer size")) : this.#state.createBuffer(bytes));
		if (!(value instanceof LuaBuffer)) throw new Error("Lua returned a non-buffer value");
		return value;
	}
	loadLibraries(libraries) {
		this.#state.loadLibraries(libraries);
	}
	createFunction(callback, options) {
		if (typeof callback !== "function") throw new TypeError("callback must be a function");
		let types;
		if (options !== void 0) {
			if (typeof options !== "object" || options === null) throw new TypeError("function options must be an object");
			types = fromLuaSignatures(options.args, "function options.args");
		}
		const owner = new WeakRef(this);
		const hostCallback = this.#callbacks.bridge(callback);
		const bridge = (...args) => {
			const lua = liveLua(owner);
			return lua.encodeCallbackReturn(hostCallback(...convertLuaArguments(args.map((value) => lua.decode(value)), types, "function argument")));
		};
		const value = this.decode(this.#state.createAsyncFunction(bridge));
		if (!(value instanceof LuaFunction)) throw new Error("Lua returned a non-function value");
		return value;
	}
	createUserdata(value) {
		const bridge = this.userdataBridge(value) ?? this.bridgeUserdataDefinition({});
		const userdata = this.decode(this.#state.createUserdata(this.storeUserdata(value), bridge, 0));
		if (!(userdata instanceof LuaUserdata)) throw new Error("Lua returned a non-userdata value");
		return userdata;
	}
	createProxy(userdataClass, surface) {
		if (surface !== void 0) assertUserdataSurface(surface, "userdata proxy definition");
		const definition = surface ? surface : this.userdataProxyDefinition(userdataClass, this.userdataDefinition(userdataClass));
		const bridge = this.bridgeUserdataDefinition(definition);
		const value = this.decode(this.#state.createUserdata(this.storeUserdata(userdataClass), bridge, 0));
		if (!(value instanceof LuaUserdata)) throw new Error("Lua returned a non-userdata proxy");
		return value;
	}
	registerUserdata(userdataClass, definition) {
		assertUserdataDefinition(definition);
		const stored = Object.hasOwn(definition, "constructor") ? {
			...definition,
			constructor: fromLuaSignatures(definition.constructor, "userdata definition.constructor")
		} : definition;
		this.#userdataDefinitions.set(userdataClass, stored);
		this.#userdataBridges.clear();
	}
	/** @internal */
	[CREATE_USERDATA_IDENTITY](value, identity, surface) {
		const bridge = surface ? this.bridgeUserdataDefinition(surface) : this.userdataBridge(value) ?? this.bridgeUserdataDefinition({});
		const userdata = this.decode(this.#state.createUserdata(this.storeUserdata(value), bridge, wasmUsize(identity, "userdata identity")));
		if (!(userdata instanceof LuaUserdata)) throw new Error("Lua returned a non-userdata value");
		return userdata;
	}
	load(source, options = {}) {
		const encodedOptions = {
			...options,
			environment: options.environment ? this.encode(options.environment) : void 0
		};
		const value = this.decode(this.#state.load(sourceText(source), encodedOptions));
		if (!(value instanceof LuaFunction)) throw new Error("Lua returned a non-function value");
		return value;
	}
	loadBytecode(bytecode, options = {}) {
		const encodedOptions = {
			...options,
			environment: options.environment ? this.encode(options.environment) : void 0
		};
		const value = this.decode(this.#state.loadBytecode(bytecode, encodedOptions));
		if (!(value instanceof LuaFunction)) throw new Error("Lua returned a non-function value");
		return value;
	}
	execute(source, options = {}, ...args) {
		const encodedOptions = {
			...options,
			environment: options.environment ? this.encode(options.environment) : void 0
		};
		return this.decodeArray(this.#state.execute(sourceText(source), encodedOptions, this.encodeArray(args)));
	}
	async executeAsync(source, options = {}, ...args) {
		const [abort, cleanup] = prepareAbort(options);
		const { signal: _signal, ...executeOptions } = options;
		const encodedOptions = {
			...executeOptions,
			environment: options.environment ? this.encode(options.environment) : void 0
		};
		try {
			return this.decodeArray(await this.#state.executeAsync(sourceText(source), encodedOptions, this.encodeArray(args), abort));
		} finally {
			cleanup();
		}
	}
	executeBytecode(bytecode, options = {}, ...args) {
		const encodedOptions = {
			...options,
			environment: options.environment ? this.encode(options.environment) : void 0
		};
		return this.decodeArray(this.#state.executeBytecode(bytecode, encodedOptions, this.encodeArray(args)));
	}
	async executeBytecodeAsync(bytecode, options = {}, ...args) {
		const [abort, cleanup] = prepareAbort(options);
		const { signal: _signal, ...executeOptions } = options;
		const encodedOptions = {
			...executeOptions,
			environment: options.environment ? this.encode(options.environment) : void 0
		};
		try {
			return this.decodeArray(await this.#state.executeBytecodeAsync(bytecode, encodedOptions, this.encodeArray(args), abort));
		} finally {
			cleanup();
		}
	}
	compile(source, options = {}) {
		return this.#state.compile(sourceText(source), this.encodeCompilerOptions(options));
	}
	dump(source, options = {}) {
		return utf8Decoder.decode(this.#state.dump(sourceText(source), this.encodeCompilerOptions(options), options));
	}
	setCompiler(options) {
		this.#state.setCompiler(this.encodeCompilerOptions(options));
	}
	sandbox(enabled = true) {
		this.#state.sandbox(enabled);
	}
	setMemoryLimit(bytes) {
		return this.#state.setMemoryLimit(wasmUsize(bytes, "memory limit"));
	}
	gcStop() {
		this.#state.gcStop();
	}
	gcRestart() {
		this.#state.gcRestart();
	}
	gcCollect() {
		this.#state.gcCollect();
	}
	gcStep() {
		return this.#state.gcStep();
	}
	traceback(message, level = 0) {
		return utf8Decoder.decode(this.#state.traceback(message, wasmUsize(level, "traceback level")));
	}
	setNamedRegistryValue(key, value) {
		this.#state.setNamedRegistryValue(key, this.encode(value));
	}
	namedRegistryValue(key) {
		return this.decode(this.#state.namedRegistryValue(key));
	}
	unsetNamedRegistryValue(key) {
		this.#state.unsetNamedRegistryValue(key);
	}
	setInterruptHooks(hooks) {
		const execution = hooks.execution ? this.#callbacks.bridge(hooks.execution) : void 0;
		const pattern = hooks.pattern ? this.#callbacks.bridge(hooks.pattern) : void 0;
		const garbageCollection = hooks.garbageCollection ? this.#callbacks.bridge(hooks.garbageCollection) : void 0;
		this.#state.setInterruptHooks({
			mode: hooks.mode,
			execution,
			pattern,
			garbageCollection
		});
	}
	removeInterruptHooks() {
		this.#state.removeInterruptHooks();
	}
	requestInterrupt() {
		this.#state.requestInterrupt();
	}
	setDebugHooks(hooks) {
		const step = hooks.step ? this.#callbacks.bridge(hooks.step) : void 0;
		const breakpoint = hooks.breakpoint ? this.#callbacks.bridge(hooks.breakpoint) : void 0;
		const interrupt = hooks.interrupt ? this.#callbacks.bridge(hooks.interrupt) : void 0;
		const protectedError = hooks.protectedError ? this.#callbacks.bridge(hooks.protectedError) : void 0;
		this.#state.setDebugHooks({
			singleStep: hooks.singleStep,
			step,
			breakpoint,
			interrupt,
			protectedError
		});
	}
	removeDebugHooks() {
		this.#state.removeDebugHooks();
	}
	/** @internal */
	encode(value, depth = 0, context = {
		tables: /* @__PURE__ */ new WeakMap(),
		nextTableId: 1
	}) {
		if (depth > 64) throw new TypeError("value nesting is too deep");
		if (value === void 0 || value === null) return null;
		const conversion = intoLuaNode(value);
		if (conversion) switch (conversion.kind) {
			case "buffer": return {
				[BUFFER_MARKER]: true,
				bytes: conversion.bytes
			};
			case "userdata": return {
				[USERDATA_MARKER]: true,
				value: this.storeUserdata(conversion.value),
				definition: this.bridgeUserdataDefinition({})
			};
			case "callback": return (conversion.args ? this.createFunction(conversion.callback, { args: conversion.args }) : this.createFunction(conversion.callback)).reference(this);
		}
		if (value instanceof LuaValue) return value.reference(this);
		if (value instanceof LuaVector) return {
			[VECTOR_MARKER]: true,
			x: value.x,
			y: value.y,
			z: value.z
		};
		if (typeof value === "string") {
			assertWellFormedString(value);
			return value;
		}
		if (typeof value === "boolean" || typeof value === "number" || typeof value === "bigint" || value instanceof Uint8Array) return value;
		if (typeof value === "function") return {
			[USERDATA_MARKER]: true,
			value: this.storeUserdata(value),
			definition: this.userdataBridge(value) ?? this.bridgeUserdataDefinition({})
		};
		if (isArray$1(value)) {
			const reference = context.tables.get(value);
			if (reference !== void 0) return {
				[TABLE_MARKER]: true,
				reference
			};
			const id = nextTableId(context);
			context.tables.set(value, id);
			return {
				[TABLE_MARKER]: true,
				id,
				array: value.map((item) => this.encode(item, depth + 1, context))
			};
		}
		if (typeof value === "object") {
			if (value instanceof Map) {
				const reference = context.tables.get(value);
				if (reference !== void 0) return {
					[TABLE_MARKER]: true,
					reference
				};
				const id = nextTableId(context);
				context.tables.set(value, id);
				return {
					[TABLE_MARKER]: true,
					id,
					entries: [...value].map(([key, item]) => [this.encode(key, depth + 1, context), this.encode(item, depth + 1, context)])
				};
			}
			const definition = this.userdataBridge(value);
			if (definition) return {
				[USERDATA_MARKER]: true,
				value: this.storeUserdata(value),
				definition
			};
			const reference = context.tables.get(value);
			if (reference !== void 0) return {
				[TABLE_MARKER]: true,
				reference
			};
			const id = nextTableId(context);
			context.tables.set(value, id);
			return {
				[TABLE_MARKER]: true,
				id,
				entries: Object.entries(value).map(([key, item]) => {
					assertWellFormedString(key);
					return [key, this.encode(item, depth + 1, context)];
				})
			};
		}
		throw new TypeError(`unsupported JavaScript value of type ${typeof value}`);
	}
	/** @internal */
	encodeArray(values) {
		const context = {
			tables: /* @__PURE__ */ new WeakMap(),
			nextTableId: 1
		};
		return values.map((value) => this.encode(value, 0, context));
	}
	/** @internal */
	decode(value) {
		if (isRawReference(value)) {
			if (value[REF_STATE] !== this.#state.stateId) throw new Error("Lua value belongs to another state");
			return this.wrapReference(value[REF_ID], value[REF_TYPE]);
		}
		if (isRawVector(value)) return new LuaVector(value.x, value.y, value.z);
		if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "bigint" || typeof value === "string" || value instanceof Uint8Array) return value;
		throw new Error("Lua returned a value that cannot cross into JavaScript");
	}
	/** @internal */
	decodeArray(values) {
		return values.map((value) => this.decode(value));
	}
	wrapReference(handle, type) {
		switch (type) {
			case "table": return new LuaTable(this, this.#state, type, handle, this.#registerFinalizers, VALUE_TOKEN);
			case "function": return new LuaFunction(this, this.#state, type, handle, this.#registerFinalizers, VALUE_TOKEN);
			case "thread": return new LuaThread(this, this.#state, type, handle, this.#registerFinalizers, VALUE_TOKEN);
			case "buffer": return new LuaBuffer(this, this.#state, type, handle, this.#registerFinalizers, VALUE_TOKEN);
			case "userdata": return new LuaUserdata(this, this.#state, type, handle, this.#registerFinalizers, VALUE_TOKEN);
			case "class": return new LuaClass(this, this.#state, type, handle, this.#registerFinalizers, VALUE_TOKEN);
			case "object": return new LuaObject(this, this.#state, type, handle, this.#registerFinalizers, VALUE_TOKEN);
			default: return new LuaValue(this, this.#state, type, handle, this.#registerFinalizers, VALUE_TOKEN);
		}
	}
	encodeCallbackResult(result) {
		const multiple = intoLuaMultipleValues(result);
		const values = result === void 0 ? [] : multiple ? multiple : [result];
		return {
			[CALLBACK_RESULT_MARKER]: true,
			values: this.encodeArray(values)
		};
	}
	encodeCallbackReturn(result) {
		if (isPromiseLike(result)) return Promise.resolve(result).then((value) => this.encodeCallbackResult(value));
		return this.encodeCallbackResult(result);
	}
	encodeCompilerOptions(options) {
		return {
			...options,
			libraryConstants: options.libraryConstants ? Object.fromEntries(Object.entries(options.libraryConstants).map(([name, value]) => [name, this.encode(value)])) : void 0
		};
	}
	userdataBridge(value) {
		const prototype = Object.getPrototypeOf(value);
		if (prototype === null || prototype === Object.prototype) return void 0;
		const constructor = prototype ? Reflect.get(prototype, "constructor") : void 0;
		if (typeof constructor === "function") {
			const bridge = this.#userdataBridges.get(constructor);
			if (bridge) return bridge;
		}
		const definition = typeof constructor === "function" ? this.userdataDefinition(constructor) : void 0;
		const bridge = this.bridgeUserdataDefinition(definition ?? {});
		if (definition && typeof constructor === "function") this.#userdataBridges.set(constructor, bridge);
		return bridge;
	}
	userdataDefinition(constructor) {
		let current = constructor;
		while (typeof current === "function" && current !== Function.prototype) {
			const definition = this.#userdataDefinitions.get(current);
			if (definition) {
				if (current !== constructor && Object.hasOwn(definition, "constructor")) {
					const { constructor: _constructor, ...inherited } = definition;
					return inherited;
				}
				return definition;
			}
			current = Object.getPrototypeOf(current);
		}
		return decoratedUserdataDefinition(constructor);
	}
	userdataProxyDefinition(userdataClass, definition) {
		const proxy = definition?.proxy ?? {};
		if (!definition || !Object.hasOwn(definition, "constructor")) return proxy;
		return {
			...proxy,
			metamethods: {
				...proxy.metamethods,
				__call: {
					args: definition.constructor,
					callback: (_class, ...args) => Reflect.construct(userdataClass, args)
				}
			}
		};
	}
	storeUserdata(value) {
		const token = Object.create(null);
		this.#userdataValues.set(token, value);
		return token;
	}
	[USERDATA_VALUE](token) {
		if (typeof token !== "object" || token === null) throw new Error("Lua returned an invalid userdata token");
		const value = this.#userdataValues.get(token);
		if (!value) throw new Error("Lua userdata value is unavailable");
		return value;
	}
	bridgeUserdataDefinition(definition) {
		assertUserdataSurface(definition);
		const owner = new WeakRef(this);
		return {
			fields: definition.fields ? Object.fromEntries(Object.entries(definition.fields).map(([name, field]) => {
				const getter = field.get ? this.#callbacks.bridge(field.get) : void 0;
				const setter = field.set ? this.#callbacks.bridge(field.set) : void 0;
				return [name, {
					get: getter ? (token) => {
						const lua = liveLua(owner);
						return lua.encode(getter(lua[USERDATA_VALUE](token)));
					} : void 0,
					set: setter ? (token, fieldValue) => {
						const lua = liveLua(owner);
						const [value] = convertLuaArguments([lua.decode(fieldValue)], field.type ? [field.type] : void 0, `userdata field ${name}`);
						setter(lua[USERDATA_VALUE](token), value);
					} : void 0
				}];
			})) : void 0,
			methods: definition.methods ? Object.fromEntries(Object.entries(definition.methods).map(([name, method]) => {
				const resolved = resolveUserdataMethod(method);
				const callback = this.#callbacks.bridge(resolved.callback);
				return [name, (token, ...args) => {
					const lua = liveLua(owner);
					return lua.encodeCallbackReturn(callback(lua[USERDATA_VALUE](token), ...convertLuaArguments(args.map((argument) => lua.decode(argument)), resolved.args, `userdata method ${name} argument`)));
				}];
			})) : void 0,
			metamethods: definition.metamethods ? Object.fromEntries(Object.entries(definition.metamethods).map(([name, metamethod]) => {
				if (!metamethod) throw new TypeError(`userdata metamethod ${name} is undefined`);
				if (isBinaryUserdataMetamethod(name)) {
					const binaryMetamethod = metamethod;
					let bridge = this.#binaryUserdataBridges.get(binaryMetamethod);
					if (!bridge) {
						const callback = this.#callbacks.bridge(binaryMetamethod);
						bridge = (token, other, ownerIsRight) => {
							const lua = liveLua(owner);
							const value = lua[USERDATA_VALUE](token);
							const [decoded] = convertLuaArguments([lua.decode(other)]);
							const operand = decoded instanceof LuaUserdata ? decoded.value : decoded;
							return lua.encodeCallbackResult(ownerIsRight ? callback(operand, value) : callback(value, operand));
						};
						this.#binaryUserdataBridges.set(binaryMetamethod, bridge);
					}
					return [name, bridge];
				}
				const resolved = name === "__call" ? resolveUserdataMethod(metamethod) : { callback: metamethod };
				const callback = this.#callbacks.bridge(resolved.callback);
				return [name, (token, ...args) => {
					const lua = liveLua(owner);
					const result = callback(lua[USERDATA_VALUE](token), ...convertLuaArguments(args.map((argument) => lua.decode(argument)), resolved.args, `userdata metamethod ${name} argument`));
					return name === "__call" || name === "__namecall" ? lua.encodeCallbackReturn(result) : lua.encodeCallbackResult(result);
				}];
			})) : void 0
		};
	}
};
function isRawReference(value) {
	return typeof value === "object" && value !== null && typeof value[REF_STATE] === "number" && typeof value[REF_ID] === "number" && typeof value[REF_TYPE] === "string";
}
function isRawVector(value) {
	return typeof value === "object" && value !== null && value[VECTOR_MARKER] === true && typeof value.x === "number" && typeof value.y === "number" && typeof value.z === "number";
}
function nextTableId(context) {
	const id = context.nextTableId;
	if (id > 4294967295) throw new RangeError("too many tables in one value");
	context.nextTableId += 1;
	return id;
}
function wasmUsize(value, name) {
	if (!Number.isInteger(value) || value < 0 || value > 4294967295) throw new RangeError(`${name} must be an integer between 0 and 4294967295`);
	return value;
}
function prepareAbort(options) {
	if (typeof options !== "object" || options === null) throw new TypeError("options must be an object");
	const { signal } = options;
	if (signal === void 0) return [null, () => void 0];
	if (typeof signal !== "object" || signal === null || typeof signal.addEventListener !== "function" || typeof signal.removeEventListener !== "function" || typeof signal.aborted !== "boolean") throw new TypeError("signal must be an AbortSignal");
	if (signal.aborted) throw signal.reason;
	let abort;
	const promise = new Promise((resolve) => {
		abort = () => resolve(signal.reason);
		signal.addEventListener("abort", abort, { once: true });
	});
	if (signal.aborted) abort();
	return [promise, () => {
		try {
			signal.removeEventListener("abort", abort);
		} catch {}
	}];
}
//#endregion
//#region src/javascript.ts
const MAX_CONVERSION_DEPTH = 64;
const JS_INTEROP = Symbol("JavaScript interop");
const isArray = Array.isArray;
const ordinaryHasInstance = Function.prototype[Symbol.hasInstance];
const apply = Reflect.apply;
var JsReference = class {
	value;
	access;
	constructor(value, access) {
		this.value = value;
		this.access = access;
	}
};
const FORBIDDEN_GLOBALS = /* @__PURE__ */ new Set([
	"Function",
	"Promise",
	"Proxy",
	"Reflect",
	"WorkerGlobalScope",
	"DedicatedWorkerGlobalScope",
	"Bun",
	"Deno",
	"addEventListener",
	"close",
	"dispatchEvent",
	"eval",
	"frames",
	"global",
	"globalThis",
	"importScripts",
	"module",
	"onmessage",
	"onmessageerror",
	"opener",
	"parent",
	"postMessage",
	"process",
	"queueMicrotask",
	"removeEventListener",
	"require",
	"setInterval",
	"setTimeout",
	"self",
	"top",
	"window"
]);
const FORBIDDEN_PROPERTIES = /* @__PURE__ */ new Set([
	"__proto__",
	"__defineGetter__",
	"__defineSetter__",
	"__lookupGetter__",
	"__lookupSetter__",
	"addEventListener",
	"arguments",
	"callee",
	"catch",
	"caller",
	"constructor",
	"dispatchEvent",
	"finally",
	"frames",
	"global",
	"importScripts",
	"onmessage",
	"onmessageerror",
	"opener",
	"parent",
	"postMessage",
	"prototype",
	"queueMicrotask",
	"removeEventListener",
	"setInterval",
	"setTimeout",
	"then",
	"top",
	"window"
]);
const OBJECT_META_OPERATIONS = /* @__PURE__ */ new Set([
	"assign",
	"create",
	"defineProperties",
	"defineProperty",
	"freeze",
	"getOwnPropertyDescriptor",
	"getOwnPropertyDescriptors",
	"getOwnPropertyNames",
	"getOwnPropertySymbols",
	"getPrototypeOf",
	"isExtensible",
	"isFrozen",
	"isSealed",
	"preventExtensions",
	"seal",
	"setPrototypeOf"
]);
const FUNCTION_META_OPERATIONS = /* @__PURE__ */ new Set([
	"apply",
	"bind",
	"call"
]);
/** @internal */
function exposeJsGlobalsScoped(lua, allow, options = {}) {
	if (typeof options !== "object" || options === null) throw new TypeError("options must be an object");
	const { globals: globalObject = globalThis, filter } = options;
	if (typeof globalObject !== "object" && typeof globalObject !== "function" || globalObject === null) throw new TypeError("globals must be an object");
	if (!isArray(allow)) throw new TypeError("allow must be an array of global names");
	for (const name of allow) if (typeof name !== "string") throw new TypeError("allow must be an array of global names");
	if (filter !== void 0 && typeof filter !== "function") throw new TypeError("filter must be a function");
	if (lua.appData.has(JS_INTEROP)) throw new Error("JavaScript globals are already exposed to this Lua state");
	if (allow.length === 0) return { close: async () => void 0 };
	const globals = lua.globals;
	if (globals.metatable !== null) throw new Error("exposing JavaScript globals requires an unmodified Lua globals metatable");
	let objectConstructor = Object;
	try {
		objectConstructor = Reflect.get(globalObject, "Object") ?? Object;
	} catch {}
	const forbiddenValues = /* @__PURE__ */ new Set([
		globalObject,
		globalThis,
		Function,
		Proxy,
		Reflect,
		eval
	]);
	forbiddenValues.add(Object.getPrototypeOf(async function() {}).constructor);
	forbiddenValues.add(Object.getPrototypeOf(function* () {}).constructor);
	forbiddenValues.add(Object.getPrototypeOf(async function* () {}).constructor);
	for (const name of OBJECT_META_OPERATIONS) {
		forbiddenValues.add(Reflect.get(Object, name));
		if (objectConstructor !== Object) try {
			forbiddenValues.add(Reflect.get(Object(objectConstructor), name));
		} catch {}
	}
	for (const name of FORBIDDEN_GLOBALS) {
		try {
			forbiddenValues.add(Reflect.get(globalObject, name));
		} catch {}
		if (globalObject !== globalThis) try {
			forbiddenValues.add(Reflect.get(globalThis, name));
		} catch {}
	}
	const allowedGlobals = new Set(allow);
	for (const name of allowedGlobals) {
		if (FORBIDDEN_GLOBALS.has(name)) throw new TypeError(`JavaScript global ${name} cannot be exposed`);
		let exists;
		let value;
		try {
			exists = Reflect.has(globalObject, name);
			value = Reflect.get(globalObject, name, globalObject);
		} catch {
			throw new TypeError(`JavaScript global ${name} is not accessible`);
		}
		if (!exists) throw new TypeError(`JavaScript global ${name} is not available`);
		if (forbiddenValues.has(value)) throw new TypeError(`JavaScript global ${name} cannot be exposed`);
	}
	const references = /* @__PURE__ */ new WeakMap();
	const weakSymbols = /* @__PURE__ */ new WeakMap();
	const strongSymbols = /* @__PURE__ */ new Map();
	let nextIdentity = 1;
	let closed = false;
	let closing;
	const controller = new AbortController();
	const callbacks = /* @__PURE__ */ new Map();
	const pending = /* @__PURE__ */ new Set();
	const listeners = /* @__PURE__ */ new Set();
	const callbackFinalizer = new FinalizationRegistry(({ identity, token }) => {
		if (callbacks.get(identity)?.token === token) callbacks.delete(identity);
	});
	const allocateIdentity = () => {
		const identity = nextIdentity++;
		if (identity > 4294967295) throw new Error("too many JavaScript identities");
		return identity;
	};
	const identityFor = (value, access = "readonly") => {
		if (typeof value === "symbol") {
			const registered = Symbol.keyFor(value) !== void 0;
			try {
				const stored = registered ? strongSymbols.get(value) : weakSymbols.get(value);
				if (stored !== void 0) return stored;
				const identity = allocateIdentity();
				if (registered) strongSymbols.set(value, identity);
				else weakSymbols.set(value, identity);
				return identity;
			} catch (error) {
				if (!(error instanceof TypeError) || registered) throw error;
				const stored = strongSymbols.get(value);
				if (stored !== void 0) return stored;
				const identity = allocateIdentity();
				strongSymbols.set(value, identity);
				return identity;
			}
		}
		let identities = references.get(value);
		const stored = identities?.[access];
		if (stored !== void 0) return stored;
		const identity = allocateIdentity();
		if (identities) identities[access] = identity;
		else {
			identities = { [access]: identity };
			references.set(value, identities);
		}
		return identity;
	};
	const listenerFlags = (options) => {
		if (typeof options === "boolean") return {
			capture: options,
			once: false
		};
		if (typeof options !== "object" || options === null) return {
			capture: false,
			once: false
		};
		try {
			return {
				capture: Boolean(Reflect.get(options, "capture")),
				once: Boolean(Reflect.get(options, "once"))
			};
		} catch {
			return {
				capture: false,
				once: false
			};
		}
	};
	const updateListeners = (target, property, args) => {
		if (property !== "addEventListener" && property !== "removeEventListener" || typeof target !== "object" && typeof target !== "function" || target === null || typeof args[1] !== "object" && typeof args[1] !== "function" || args[1] === null) return;
		const type = String(args[0]);
		const callback = args[1];
		const { capture, once } = listenerFlags(args[2]);
		for (const listener of listeners) {
			if (!(listener.target.deref() === target && listener.type === type && listener.callback.deref() === callback && listener.capture === capture)) continue;
			if (property === "removeEventListener") listeners.delete(listener);
			return;
		}
		if (property === "addEventListener") listeners.add({
			target: new WeakRef(target),
			type,
			callback: new WeakRef(callback),
			capture,
			once
		});
	};
	const forgetOnceListener = (callback, event) => {
		if (typeof event !== "object" || event === null) return;
		let target;
		let type;
		try {
			target = Reflect.get(event, "currentTarget");
			type = Reflect.get(event, "type");
		} catch {
			return;
		}
		for (const listener of listeners) if (listener.once && listener.target.deref() === target && listener.type === type && listener.callback.deref() === callback) listeners.delete(listener);
	};
	const eventListenerAccess = (target, property) => (property === "addEventListener" || property === "removeEventListener") && typeof EventTarget !== "undefined" && (typeof target === "object" || typeof target === "function") && target !== null && apply(ordinaryHasInstance, EventTarget, [target]);
	const permits = (operation, target, property) => {
		if (typeof property === "string" && FORBIDDEN_PROPERTIES.has(property) && !eventListenerAccess(target, property) || (target === Object || target === objectConstructor) && typeof property === "string" && OBJECT_META_OPERATIONS.has(property) || typeof target === "function" && typeof property === "string" && FUNCTION_META_OPERATIONS.has(property)) return false;
		if (target === globalObject && typeof property === "string") {
			if (FORBIDDEN_GLOBALS.has(property)) return false;
			if (!allowedGlobals.has(property)) return false;
		}
		return !filter || filter({
			operation,
			target,
			property
		}) === true;
	};
	const permittedValue = (value, target, property) => !forbiddenValues.has(value) || eventListenerAccess(target, property);
	const wrap = (value, receiver, access = "readonly", structural = /* @__PURE__ */ new WeakMap(), depth = 0) => {
		if (!permittedValue(value)) return null;
		if (value === void 0 || value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "bigint" || typeof value === "string" || value instanceof Uint8Array || value instanceof LuaValue || value instanceof LuaVector) return value ?? null;
		let plainObject = false;
		if (!isArray(value) && typeof value === "object") try {
			const prototype = Object.getPrototypeOf(value);
			plainObject = prototype === null || prototype === Object.prototype;
		} catch {}
		if (isArray(value) || value instanceof Map || plainObject) {
			if (depth >= MAX_CONVERSION_DEPTH) throw new TypeError("value nesting is too deep");
			const existing = structural.get(value);
			if (existing !== void 0) return existing;
			if (isArray(value)) {
				const result = [];
				structural.set(value, result);
				for (const item of value) result.push(wrap(item, void 0, "readonly", structural, depth + 1));
				return result;
			}
			if (value instanceof Map) {
				const result = /* @__PURE__ */ new Map();
				structural.set(value, result);
				for (const [key, item] of value) result.set(wrap(key, void 0, "readonly", structural, depth + 1), wrap(item, void 0, "readonly", structural, depth + 1));
				return result;
			}
			const result = Object.create(null);
			structural.set(value, result);
			for (const name of Object.keys(value)) {
				if (!permits("get", value, name)) continue;
				const item = Reflect.get(value, name, value);
				result[name] = wrap(item, value, "readonly", structural, depth + 1);
			}
			return result;
		}
		if (typeof value === "function" && receiver === globalObject && isConstructor(value)) return proxyFor(value);
		if (typeof value === "function") return lua.createFunction((...args) => {
			if (!permits("call", value)) throw new TypeError(`${String(value)} is not callable`);
			return wrapResult(apply(value, receiver, unwrapArguments(args)));
		});
		const identity = identityFor(value, access);
		return lua[CREATE_USERDATA_IDENTITY](new JsReference(value, access), identity);
	};
	const wrapResult = (value, receiver, access = "readonly") => {
		if (value !== null && (typeof value === "object" || typeof value === "function") && "then" in value && typeof value.then === "function") return Promise.resolve(value).then((resolved) => wrap(resolved, receiver, access));
		return wrap(value, receiver, access);
	};
	const callbackFor = (value) => {
		const identity = value[LUA_FUNCTION_IDENTITY]();
		const existing = callbacks.get(identity)?.callback.deref();
		if (existing) return existing;
		const callback = (...args) => {
			if (closed) throw new Error("Lua callback is unavailable");
			forgetOnceListener(callback, args[0]);
			const invocation = value[INVOKE_LUA_FUNCTION](args.map((argument) => wrap(argument)), { signal: controller.signal });
			const decode = (results) => {
				if (results.length === 0) return void 0;
				const values = unwrapArguments(results);
				return values.length === 1 ? values[0] : values;
			};
			if (!(invocation instanceof Promise)) return decode(invocation);
			const result = invocation.then(decode);
			pending.add(result);
			result.then(() => pending.delete(result), () => pending.delete(result));
			return result;
		};
		const token = {};
		callbacks.set(identity, {
			callback: new WeakRef(callback),
			token
		});
		callbackFinalizer.register(callback, {
			identity,
			token
		});
		return callback;
	};
	const unwrapLeaf = (value) => {
		if (value instanceof LuaUserdata) {
			const host = value.value;
			return host instanceof JsReference ? host.value : host;
		}
		if (value instanceof LuaFunction) return callbackFor(value);
		if (value instanceof LuaBuffer) return value.bytes;
		if (value instanceof LuaVector) return {
			x: value.x,
			y: value.y,
			z: value.z
		};
		return value;
	};
	const unwrapArguments = (values) => convertLuaStructures(values, unwrapLeaf);
	const unwrap = (value) => unwrapArguments([value])[0];
	const callMember = (target, property, member, args, stripReceiver, access) => {
		const values = unwrapArguments(args);
		if (stripReceiver && values[0] === target) values.shift();
		if (property === "removeEventListener" && typeof values[2] === "boolean") values[2] = { capture: values[2] };
		const result = apply(member, target, values);
		updateListeners(target, property, values);
		return wrapResult(result, void 0, result === target ? access : "readonly");
	};
	const stringifyReference = (reference) => {
		if (!permits("stringify", reference.value)) throw new TypeError("value cannot be converted to a string");
		return String(reference.value);
	};
	lua.registerUserdata(JsReference, { metamethods: {
		__index: (reference, key) => {
			const target = Object(reference.value);
			const property = toPropertyKey(unwrap(key));
			if (!permits("get", reference.value, property)) return null;
			const value = Reflect.get(target, property, reference.value);
			if (typeof value === "function" && permittedValue(value, reference.value, property)) return lua.createFunction((...args) => {
				if (!permits("call", reference.value, property)) throw new TypeError(`cannot call property ${String(property)}`);
				return callMember(reference.value, property, value, args, true, reference.access);
			});
			return wrap(value, reference.value, value === reference.value ? reference.access : "readonly");
		},
		__newindex: (reference, key, value) => {
			const target = Object(reference.value);
			const property = toPropertyKey(unwrap(key));
			if (reference.access !== "instance" || !permits("set", reference.value, property)) throw new TypeError(`cannot assign property ${String(property)}`);
			if (!Reflect.set(target, property, unwrap(value), reference.value)) throw new TypeError(`cannot assign property ${String(property)}`);
		},
		__namecall: (reference, name, ...args) => {
			const property = toPropertyKey(unwrap(name));
			if (!permits("get", reference.value, property)) return null;
			const value = Reflect.get(Object(reference.value), property, reference.value);
			if (typeof value !== "function" || !permittedValue(value, reference.value, property) || !permits("call", reference.value, property)) throw new TypeError(`property ${String(property)} is not callable`);
			return callMember(reference.value, property, value, args, false, reference.access);
		},
		__len: (reference) => {
			if (!permits("get", reference.value, "length")) throw new TypeError("cannot read property length");
			const length = Reflect.get(Object(reference.value), "length", reference.value);
			if (typeof length !== "number") throw new TypeError(`${String(reference.value)} has no numeric length`);
			return length;
		},
		__tostring: stringifyReference,
		__todebugstring: stringifyReference
	} });
	function proxyFor(value) {
		const userdataClass = value;
		const construct = lua.createFunction((...args) => {
			if (!permits("construct", value)) throw new TypeError(`${String(value)} is not constructable`);
			return wrap(Reflect.construct(value, unwrapArguments(args)), void 0, "instance");
		});
		const stringifyProxy = () => {
			if (!permits("stringify", value)) throw new TypeError("value cannot be converted to a string");
			return String(value);
		};
		return lua[CREATE_USERDATA_IDENTITY](userdataClass, identityFor(value), { metamethods: {
			__index: (_proxy, key) => {
				const property = toPropertyKey(unwrap(key));
				if (property === "new") return construct;
				if (!permits("get", value, property)) return null;
				const propertyValue = Reflect.get(value, property, value);
				if (typeof propertyValue === "function" && permittedValue(propertyValue, value, property)) return lua.createFunction((...args) => {
					if (!permits("call", value, property)) throw new TypeError(`cannot call property ${String(property)}`);
					return callMember(value, property, propertyValue, args, true, "readonly");
				});
				return wrap(propertyValue, value);
			},
			__newindex: (_proxy, key, _propertyValue) => {
				const property = toPropertyKey(unwrap(key));
				throw new TypeError(`cannot assign property ${String(property)}`);
			},
			__namecall: (_proxy, name, ...args) => {
				const property = toPropertyKey(unwrap(name));
				if (!permits("get", value, property)) return null;
				const propertyValue = Reflect.get(value, property, value);
				if (typeof propertyValue !== "function" || !permittedValue(propertyValue, value, property) || !permits("call", value, property)) throw new TypeError(`property ${String(property)} is not callable`);
				return callMember(value, property, propertyValue, args, false, "readonly");
			},
			__tostring: stringifyProxy,
			__todebugstring: stringifyProxy
		} });
	}
	const metatable = lua.createTable();
	metatable.rawSet("__index", lua.createFunction((_globals, key) => {
		const property = toPropertyKey(unwrap(key));
		if (!permits("get", globalObject, property)) return null;
		const value = Reflect.get(globalObject, property, globalObject);
		return value === void 0 ? null : wrap(value, globalObject);
	}));
	globals.metatable = metatable;
	lua.appData.set(JS_INTEROP, true);
	return { close() {
		if (closing) return closing;
		closed = true;
		for (const listener of listeners) {
			const target = listener.target.deref();
			const callback = listener.callback.deref();
			if (!target || !callback) continue;
			try {
				const remove = Reflect.get(target, "removeEventListener");
				if (typeof remove === "function") apply(remove, target, [
					listener.type,
					callback,
					{ capture: listener.capture }
				]);
			} catch {}
		}
		listeners.clear();
		controller.abort(/* @__PURE__ */ new Error("JavaScript interop scope closed"));
		closing = Promise.allSettled([...pending]).then(() => {
			callbacks.clear();
		});
		return closing;
	} };
}
function toPropertyKey(value) {
	if (typeof value === "symbol") return value;
	if (typeof value === "string") return value;
	return String(value);
}
function isConstructor(value) {
	try {
		Reflect.construct(Function, [], value);
		return true;
	} catch {
		return false;
	}
}
//#endregion
//#region src/worker-runtime.ts
const WORKER_LIBRARIES = [
	"base",
	"coroutine",
	"table",
	"string",
	"math",
	"utf8",
	"bit32",
	"buffer",
	"vector",
	"integer",
	"class"
];
const now = performance.now.bind(performance);
const defer = queueMicrotask.bind(globalThis);
function serveLuaWorkerOn(endpoint, options = {}) {
	validateServerOptions(options);
	const reply = endpoint.postMessage.bind(endpoint);
	let active;
	let remoteResolver;
	let busy = false;
	endpoint.addEventListener("message", async (event) => {
		if (typeof event.data === "object" && event.data !== null && event.data.action === "resolveModule") {
			remoteResolver?.receive(event.data);
			return;
		}
		let request;
		try {
			request = validateWorkerRequest(event.data);
		} catch (error) {
			replyToInvalidRequest(reply, event.data, error);
			return;
		}
		if (busy) {
			reply({
				protocol: 8,
				id: request.id,
				action: request.action,
				error: "another worker operation is already active"
			});
			return;
		}
		busy = true;
		const started = request.timing ? now() : void 0;
		const output = new OutputBatch(request, reply);
		let next;
		let operationResolver;
		try {
			const previous = active;
			active = void 0;
			await previous?.close();
			remoteResolver = void 0;
			let result;
			if (request.action === "execute" || request.action === "executeBytecode") {
				if (request.resolveModules && !options.resolveModule) {
					operationResolver = new RemoteModuleResolver(request.id, reply);
					remoteResolver = operationResolver;
				}
				const execution = await execute(request, options, output, operationResolver);
				result = execution.result;
				next = execution.session;
			} else if (request.action === "compile") result = await compile(request);
			else result = await dump(request);
			output.flush();
			await respond(reply, request, result, started);
			if (next) {
				active = next;
				remoteResolver = operationResolver;
				output.stream();
			} else {
				operationResolver?.close();
				remoteResolver = void 0;
			}
		} catch (error) {
			try {
				await next?.close();
			} catch (cleanupError) {
				error = cleanupError;
			}
			operationResolver?.close(error);
			remoteResolver = void 0;
			output.flush();
			await respond(reply, request, void 0, started, boundedErrorMessage(error));
		} finally {
			busy = false;
		}
	});
}
async function execute(request, server, output, remoteResolver) {
	if (request.action !== "execute" && request.action !== "executeBytecode") throw new TypeError("worker request is not executable");
	const bytecode = request.action === "executeBytecode";
	const options = request.options;
	let interruptCount = 0;
	let interrupted = false;
	const lua = await Lua.createWorkerState({
		libraries: WORKER_LIBRARIES,
		memory: { limitBytes: options.memoryLimitBytes }
	});
	let interop;
	let cleanup;
	let ownsLua = true;
	try {
		const { memoryLimitBytes: _memoryLimitBytes, interruptLimit, outputLimitBytes, outputLimitEvents, resultLimitBytes, resultLimitEntries, ...compilerOptions } = options;
		lua.setCompiler(compilerOptions);
		lua.configureWorker(request.modules, server.resolveModule ?? remoteResolver?.resolve, output.push, outputLimitBytes, outputLimitEvents);
		const configured = await server.configure?.(lua);
		if (typeof configured === "function") cleanup = configured;
		else if (configured !== void 0) throw new TypeError("Lua worker configure callback must return a function or undefined");
		interop = installJsInterop(lua, request, server.jsInterop);
		const consumeInterrupt = () => {
			interruptCount = Math.min(4294967295, interruptCount + 1);
			interrupted = interruptCount >= interruptLimit;
			return interrupted ? "break" : "continue";
		};
		lua.setInterruptHooks({
			mode: "continuous",
			execution: consumeInterrupt,
			pattern: () => {
				if (consumeInterrupt() === "break") throw new Error("execution interrupted");
			}
		});
		lua.sandbox(true);
		const result = await (bytecode ? lua.executeBytecodeWorker(request.input, {
			name: request.entryName,
			sandboxed: true
		}, MAX_ERROR_BYTES, resultLimitBytes, resultLimitEntries) : lua.executeWorker(request.input, {
			name: request.entryName,
			sandboxed: true
		}, MAX_ERROR_BYTES, resultLimitBytes, resultLimitEntries));
		const execution = {
			ok: result.ok,
			error: result.ok ? null : interrupted ? {
				kind: "interrupted",
				message: "execution stopped after reaching the worker interrupt budget"
			} : {
				kind: result.errorKind ?? "runtime",
				message: result.errorMessage ?? "Lua execution failed"
			},
			values: result.ok ? result.values : [],
			peakLuaMemoryBytes: result.peakLuaMemoryBytes,
			interruptCount,
			outputTruncated: result.outputTruncated
		};
		if (execution.ok) {
			ownsLua = false;
			return {
				result: execution,
				session: new WorkerSession(lua, interop, cleanup, output, remoteResolver)
			};
		}
		ownsLua = false;
		await releaseLua(lua, interop, cleanup);
		return { result: execution };
	} catch (error) {
		if (ownsLua) await releaseLua(lua, interop, cleanup);
		throw error;
	}
}
async function releaseLua(lua, interop, cleanup) {
	let failure;
	let failed = false;
	try {
		await cleanup?.();
	} catch (error) {
		failure = error;
		failed = true;
	}
	try {
		await interop?.close();
	} catch (error) {
		if (!failed) failure = error;
		failed = true;
	}
	try {
		lua[RELEASE_LUA]();
	} catch (error) {
		if (!failed) failure = error;
		failed = true;
	}
	if (failed) throw failure;
}
async function compile(request) {
	const result = await compileWorker(request.input, request.options, MAX_BYTECODE_BYTES, MAX_ERROR_BYTES);
	return result.ok ? {
		ok: true,
		bytecode: result.bytecode,
		error: null
	} : {
		ok: false,
		bytecode: /* @__PURE__ */ new Uint8Array(),
		error: {
			kind: "compile",
			message: result.errorMessage ?? "compilation failed"
		}
	};
}
async function dump(request) {
	const result = await dumpWorker(request.input, request.options, request.dumpOptions, MAX_DUMP_BYTES, MAX_ERROR_BYTES);
	return result.ok ? {
		ok: true,
		text: result.text,
		textTruncated: result.textTruncated,
		error: null
	} : {
		ok: false,
		text: /* @__PURE__ */ new Uint8Array(),
		textTruncated: false,
		error: {
			kind: "compile",
			message: result.errorMessage ?? "compilation failed"
		}
	};
}
async function respond(reply, request, result, started, error) {
	const response = {
		protocol: 8,
		id: request.id,
		action: request.action
	};
	if (result !== void 0) response.result = result;
	if (error !== void 0) response.error = error;
	if (started !== void 0) response.durationMs = now() - started;
	response.replaceBeforeNext = result !== void 0 && result.error?.kind === "host" || await workerMemoryBytes() >= 67108864;
	reply(response, { transfer: result?.ok ? request.action === "compile" ? [result.bytecode.buffer] : request.action === "dump" ? [result.text.buffer] : resultBuffers(result.values) : [] });
}
function resultBuffers(values) {
	const buffers = /* @__PURE__ */ new Set();
	const seen = /* @__PURE__ */ new Set();
	const pending = [...values];
	while (pending.length !== 0) {
		const value = pending.pop();
		if (value instanceof Uint8Array) {
			if (value.buffer instanceof ArrayBuffer) buffers.add(value.buffer);
		} else if (Array.isArray(value)) {
			if (seen.has(value)) continue;
			seen.add(value);
			for (const entry of value) pending.push(entry);
		} else if (value instanceof Map) {
			if (seen.has(value)) continue;
			seen.add(value);
			for (const [key, entry] of value) pending.push(key, entry);
		}
	}
	return [...buffers];
}
function installJsInterop(lua, request, server) {
	if (!request.jsInterop?.length) return void 0;
	return exposeJsGlobalsScoped(lua, request.jsInterop, server === void 0 ? void 0 : { filter: server.filter });
}
var RemoteModuleResolver = class {
	requestId;
	reply;
	resolve = (specifier, { from }) => new Promise((resolve, reject) => {
		if (this.closed) {
			reject(/* @__PURE__ */ new Error("module resolver is unavailable"));
			return;
		}
		const resolution = this.nextResolution++;
		this.pending.set(resolution, {
			resolve,
			reject
		});
		try {
			this.reply({
				protocol: 8,
				id: this.requestId,
				action: "resolveModule",
				resolution,
				specifier,
				from
			});
		} catch (error) {
			this.pending.delete(resolution);
			reject(error);
		}
	});
	nextResolution = 1;
	pending = /* @__PURE__ */ new Map();
	closed = false;
	constructor(requestId, reply) {
		this.requestId = requestId;
		this.reply = reply;
	}
	receive(value) {
		let response;
		try {
			if (typeof value !== "object" || value === null) throw new Error();
			response = value;
			if (response.protocol !== 8 || response.id !== this.requestId || response.action !== "resolveModule" || !Number.isSafeInteger(response.resolution) || response.resolution < 1 || response.error !== void 0 && (typeof response.error !== "string" || utf8Length(response.error) > 65536 || response.module !== void 0)) throw new Error();
			const pending = this.pending.get(response.resolution);
			if (!pending) throw new Error();
			this.pending.delete(response.resolution);
			if (response.error !== void 0) pending.reject(new Error(response.error));
			else pending.resolve(decodeResolvedModule(response.module));
		} catch {
			this.close(/* @__PURE__ */ new Error("the Lua client returned an invalid module response"));
		}
	}
	close(error = /* @__PURE__ */ new Error("module resolver is unavailable")) {
		if (this.closed) return;
		this.closed = true;
		for (const { reject } of this.pending.values()) reject(error);
		this.pending.clear();
	}
};
var OutputBatch = class {
	request;
	reply;
	push = (event, text) => {
		if (!this.accepting) return;
		this.events.push({
			event,
			text
		});
		if (this.events.length >= 64) this.flush();
		else if (this.streaming && !this.scheduled) {
			this.scheduled = true;
			defer(() => {
				this.scheduled = false;
				if (this.accepting) this.flush();
			});
		}
	};
	events = [];
	accepting = true;
	streaming = false;
	scheduled = false;
	constructor(request, reply) {
		this.request = request;
		this.reply = reply;
	}
	flush() {
		if (this.events.length === 0) return;
		if (this.request.action !== "execute" && this.request.action !== "executeBytecode") return;
		this.reply({
			protocol: 8,
			id: this.request.id,
			action: this.request.action,
			events: this.events
		});
		this.events = [];
	}
	stream() {
		this.streaming = true;
		this.flush();
	}
	close() {
		this.accepting = false;
		this.events = [];
	}
};
var WorkerSession = class {
	lua;
	interop;
	cleanup;
	output;
	resolver;
	constructor(lua, interop, cleanup, output, resolver) {
		this.lua = lua;
		this.interop = interop;
		this.cleanup = cleanup;
		this.output = output;
		this.resolver = resolver;
	}
	async close() {
		this.output.close();
		this.resolver?.close();
		await releaseLua(this.lua, this.interop, this.cleanup);
	}
};
function validateServerOptions(options) {
	if (typeof options !== "object" || options === null) throw new TypeError("Lua worker server options must be an object");
	if (options.configure !== void 0 && typeof options.configure !== "function") throw new TypeError("Lua worker configure callback must be a function");
	if (options.resolveModule !== void 0 && typeof options.resolveModule !== "function") throw new TypeError("resolveModule must be a function");
	if (options.jsInterop !== void 0) {
		if (typeof options.jsInterop !== "object" || options.jsInterop === null) throw new TypeError("jsInterop options must be an object");
		if (typeof options.jsInterop.filter !== "function") throw new TypeError("jsInterop.filter must be a function");
	}
}
function replyToInvalidRequest(reply, value, error) {
	if (typeof value !== "object" || value === null) return;
	const request = value;
	if (request.protocol !== 8 || !Number.isSafeInteger(request.id) || request.id < 1 || request.action !== "execute" && request.action !== "executeBytecode" && request.action !== "compile" && request.action !== "dump") return;
	reply({
		protocol: 8,
		id: request.id,
		action: request.action,
		error: boundedErrorMessage(error)
	});
}
//#endregion
export { serveLuaWorkerOn };
