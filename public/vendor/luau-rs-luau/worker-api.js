import { a as WorkerInputError, d as prepareCompileRequest, f as prepareDumpRequest, g as LuaVector, h as LuaOutputEvent, l as encodeResolvedModule, o as boundedErrorMessage, p as prepareExecutionRequest, r as MAX_ERROR_BYTES, s as copyJsInterop, u as prepareBytecodeExecutionRequest, v as utf8Length, y as DEFAULT_EXECUTION_OPTIONS } from "./worker-protocol-CDOAT_ZN.js";
//#region src/client.ts
const utf8 = new TextEncoder();
var WorkerClient = class {
	workerUrl;
	kind;
	worker;
	nextId = 1;
	pending;
	activeOutput;
	staleOutput;
	activeModules;
	staleModules;
	replaceBeforeNext = false;
	terminated = false;
	workerFactory;
	resolveModule;
	constructor(workerUrl, workerFactory, kind, resolveModule) {
		this.workerUrl = workerUrl;
		this.kind = kind;
		this.workerFactory = workerFactory ? new WeakRef(workerFactory) : void 0;
		this.resolveModule = resolveModule ? new WeakRef(resolveModule) : void 0;
	}
	request(prepared, signal, owner, output) {
		const { request, transfer } = prepared;
		if (this.terminated) return Promise.reject(/* @__PURE__ */ new Error("Lua client is unavailable"));
		if (this.pending) return Promise.reject(/* @__PURE__ */ new Error(`another Lua ${request.action} operation is already active`));
		if (signal !== void 0 && (typeof signal !== "object" || signal === null || typeof signal.addEventListener !== "function" || typeof signal.removeEventListener !== "function" || typeof signal.aborted !== "boolean")) return Promise.reject(/* @__PURE__ */ new TypeError("signal must be an AbortSignal"));
		if (signal?.aborted) return Promise.reject(signal.reason);
		const id = this.nextId;
		this.nextId = id >= Number.MAX_SAFE_INTEGER ? 1 : id + 1;
		if (this.replaceBeforeNext) this.replaceWorker();
		this.staleModules = this.activeModules;
		this.staleModules?.controller.abort(new DOMException("Lua execution was replaced", "AbortError"));
		this.activeModules = void 0;
		this.staleOutput = this.activeOutput;
		this.activeOutput = void 0;
		let worker;
		try {
			worker = this.worker ?? this.createWorker();
		} catch (error) {
			return Promise.reject(error);
		}
		return new Promise((resolve, reject) => {
			const outputState = request.action === "execute" || request.action === "executeBytecode" ? {
				id,
				action: request.action,
				owner: owner ? new WeakRef(owner) : void 0,
				dispatch: output,
				limitBytes: request.options?.outputLimitBytes ?? 0,
				limitEvents: request.options?.outputLimitEvents ?? 0,
				bytes: 0,
				events: 0
			} : void 0;
			const abort = signal ? () => {
				if (this.pending?.id !== id) return;
				this.clearPending()?.modules?.controller.abort(signal.reason);
				this.replaceWorker();
				reject(signal.reason);
			} : void 0;
			this.pending = {
				id,
				action: request.action,
				timing: request.timing === true,
				resolve,
				reject,
				signal,
				abort,
				output: outputState,
				modules: request.resolveModules === true ? {
					id,
					controller: new AbortController(),
					resolutions: /* @__PURE__ */ new Set()
				} : void 0,
				resultLimitBytes: request.options?.resultLimitBytes ?? 0,
				resultLimitEntries: request.options?.resultLimitEntries ?? 0
			};
			try {
				signal?.addEventListener("abort", abort, { once: true });
			} catch (error) {
				this.clearPending()?.modules?.controller.abort(error);
				this.replaceWorker();
				reject(error);
				return;
			}
			if (!this.pending) return;
			if (signal?.aborted) {
				abort();
				return;
			}
			try {
				worker.postMessage({
					...request,
					protocol: 8,
					id
				}, transfer);
			} catch (error) {
				this.clearPending()?.modules?.controller.abort(error);
				this.replaceWorker();
				reject(error);
			}
		}).then((response) => {
			if (response.error !== void 0) {
				this.replaceWorker();
				throw new Error(response.error);
			}
			return {
				result: response.result,
				durationMs: response.durationMs
			};
		});
	}
	terminate() {
		if (this.terminated) return;
		this.terminated = true;
		if (this.pending) {
			const { reject } = this.pending;
			this.clearPending()?.modules?.controller.abort(new DOMException("Lua client is unavailable", "AbortError"));
			reject(new DOMException("Lua client is unavailable", "AbortError"));
		}
		this.replaceWorker();
	}
	createWorker() {
		const workerFactory = this.workerFactory?.deref();
		let workerUrl = this.workerUrl;
		if (workerUrl === void 0) {
			workerUrl = new URL("./worker.js", import.meta.url);
			workerUrl.searchParams.set("wasm", new URL("./luau_wasm_bg.wasm", import.meta.url).href);
		}
		const worker = workerFactory ? workerFactory(this.kind) : new Worker(workerUrl, {
			name: "luau-rs",
			type: "module"
		});
		if (typeof worker !== "object" && typeof worker !== "function" || worker === null || typeof worker.postMessage !== "function" || typeof worker.terminate !== "function") throw new TypeError("worker factory must return a Worker");
		this.worker = worker;
		try {
			worker.onmessage = (event) => {
				this.receive(worker, event.data);
			};
			worker.onerror = (event) => {
				event.preventDefault();
				const message = event.error instanceof Error ? event.error.message : event.message;
				this.failWorker(worker, new Error(message || "the Lua worker failed"));
			};
			worker.onmessageerror = () => {
				this.failWorker(worker, /* @__PURE__ */ new Error("the Lua worker returned an unreadable response"));
			};
		} catch (error) {
			this.worker = void 0;
			try {
				worker.terminate();
			} catch {}
			throw error;
		}
		return worker;
	}
	receive(worker, value) {
		if (worker !== this.worker) return;
		if (typeof value === "object" && value !== null && value.action === "resolveModule") {
			this.resolveModuleRequest(worker, value);
			return;
		}
		const id = typeof value === "object" && value !== null ? value.id : void 0;
		const pending = this.pending?.id === id ? this.pending : void 0;
		const outputState = pending?.output ?? (this.activeOutput?.id === id ? this.activeOutput : void 0) ?? (this.staleOutput?.id === id ? this.staleOutput : void 0);
		const action = pending?.action ?? outputState?.action;
		if (action === void 0) {
			this.failWorker(worker, /* @__PURE__ */ new Error("the Lua worker returned an unexpected response"));
			return;
		}
		let message;
		try {
			message = validateWorkerMessage(value, id, action, pending?.timing ?? false, outputState?.limitBytes, outputState?.limitEvents, outputState?.bytes, outputState?.events, pending?.resultLimitBytes, pending?.resultLimitEntries);
		} catch (error) {
			this.failWorker(worker, error);
			return;
		}
		if ("events" in message) {
			if (!outputState) {
				this.failWorker(worker, /* @__PURE__ */ new Error("the Lua worker returned unexpected output"));
				return;
			}
			for (const event of message.events) {
				outputState.bytes += utf8.encode(event.text).byteLength + 1;
				outputState.events += 1;
				if (outputState === this.staleOutput) continue;
				const owner = outputState.owner?.deref();
				if (!owner || !outputState.dispatch) {
					if (outputState === this.activeOutput) this.replaceWorker();
					continue;
				}
				outputState.dispatch(owner, event.event, event.text);
			}
			return;
		}
		if (!pending) {
			this.failWorker(worker, /* @__PURE__ */ new Error("the Lua worker returned a duplicate response"));
			return;
		}
		this.clearPending();
		this.staleOutput = void 0;
		this.staleModules = void 0;
		const result = message.result;
		const completedExecution = (pending.action === "execute" || pending.action === "executeBytecode") && result?.ok === true;
		this.activeOutput = completedExecution ? pending.output : void 0;
		if (completedExecution) this.activeModules = pending.modules;
		else pending.modules?.controller.abort(new DOMException("Lua execution failed", "AbortError"));
		this.replaceBeforeNext = message.replaceBeforeNext === true;
		if (this.replaceBeforeNext && !this.activeOutput) this.replaceWorker();
		pending.resolve(message);
	}
	clearPending() {
		const pending = this.pending;
		this.pending = void 0;
		if (pending?.signal && pending.abort) try {
			pending.signal.removeEventListener("abort", pending.abort);
		} catch {}
		return pending;
	}
	resolveModuleRequest(worker, value) {
		const id = typeof value === "object" && value !== null ? value.id : void 0;
		const pendingModules = this.pending?.modules;
		if (this.staleModules?.id === id) {
			try {
				validateModuleRequest(value, this.staleModules);
			} catch (error) {
				this.failWorker(worker, error);
			}
			return;
		}
		const modules = pendingModules?.id === id ? pendingModules : this.activeModules?.id === id ? this.activeModules : void 0;
		let request;
		const resolveModule = this.resolveModule?.deref();
		try {
			request = validateModuleRequest(value, modules);
			if (!resolveModule || !modules) throw new Error("the Lua worker requested an unavailable module resolver");
			if (modules.resolutions.has(request.resolution)) throw new Error("the Lua worker reused a module resolution id");
			if (modules.resolutions.size >= 32) throw new Error("the Lua worker exceeded the module resolution limit");
			modules.resolutions.add(request.resolution);
		} catch (error) {
			this.failWorker(worker, error);
			return;
		}
		const signal = modules.controller.signal;
		Promise.resolve().then(() => {
			if (signal.aborted) throw signal.reason;
			return resolveModule(request.specifier, {
				from: request.from,
				signal
			});
		}).then((module) => {
			try {
				const encoded = encodeResolvedModule(module);
				this.sendModuleResponse(worker, request, encoded, void 0);
			} catch (error) {
				this.sendModuleResponse(worker, request, void 0, boundedErrorMessage(error));
			}
		}, (error) => {
			this.sendModuleResponse(worker, request, void 0, boundedErrorMessage(error));
		}).catch((error) => this.failWorker(worker, error));
	}
	sendModuleResponse(worker, request, module, error) {
		if (worker !== this.worker || this.pending?.modules?.id !== request.id && this.activeModules?.id !== request.id) return;
		const response = {
			protocol: 8,
			id: request.id,
			action: "resolveModule",
			resolution: request.resolution
		};
		if (module) response.module = module;
		if (error !== void 0) response.error = error;
		worker.postMessage(response, module ? [module.source.buffer] : []);
	}
	failWorker(worker, error) {
		if (worker !== this.worker) return;
		const pending = this.clearPending();
		pending?.modules?.controller.abort(error);
		this.replaceWorker();
		pending?.reject(error);
	}
	replaceWorker() {
		const worker = this.worker;
		this.worker = void 0;
		this.activeOutput = void 0;
		this.staleOutput = void 0;
		this.activeModules?.controller.abort(new DOMException("Lua worker was terminated", "AbortError"));
		this.activeModules = void 0;
		this.staleModules = void 0;
		this.replaceBeforeNext = false;
		if (worker) try {
			worker.onmessage = null;
			worker.onerror = null;
			worker.onmessageerror = null;
		} catch {}
		try {
			worker?.terminate();
		} catch {}
	}
};
function validateModuleRequest(value, modules) {
	if (typeof value !== "object" || value === null || modules === void 0) throw new Error("the Lua worker returned an unexpected module request");
	const request = value;
	if (request.protocol !== 8 || request.id !== modules.id || request.action !== "resolveModule" || !Number.isSafeInteger(request.resolution) || (request.resolution ?? 0) < 1 || typeof request.specifier !== "string" || typeof request.from !== "string" || request.specifier.includes("\0") || request.from.includes("\0") || utf8Length(request.specifier) > 2048 || utf8Length(request.from) > 2048) throw new Error("the Lua worker returned an invalid module request");
	return request;
}
function validateWorkerMessage(value, id, action, timing, outputLimitBytes = 0, outputLimitEvents = 0, outputBytes = 0, outputEvents = 0, resultLimitBytes = 0, resultLimitEntries = 0) {
	if (typeof value !== "object" || value === null) throw new Error("the Lua worker returned an invalid response");
	const message = value;
	if (message.protocol !== 8) throw new Error("the Lua worker returned an incompatible protocol");
	if (message.id !== id) {
		if (Number.isSafeInteger(message.id) && message.id >= 1) throw new Error(`the Lua worker returned request ${message.id} while waiting for ${id}`);
		throw new Error("the Lua worker returned an invalid response");
	}
	if (message.action !== action) {
		if (message.action === "execute" || message.action === "executeBytecode" || message.action === "compile" || message.action === "dump") throw new Error(`the Lua worker returned ${message.action} for ${action}`);
		throw new Error("the Lua worker returned an invalid response");
	}
	if ("events" in message) {
		const events = message.events;
		if (action !== "execute" && action !== "executeBytecode" || !Array.isArray(events) || events.length === 0 || events.length > 64 || events.some((event) => typeof event !== "object" || event === null || event.event !== "print" || typeof event.text !== "string") || message.result !== void 0 || message.error !== void 0 || message.durationMs !== void 0 || message.replaceBeforeNext !== void 0) throw new Error("the Lua worker returned an invalid output event");
		const nextEvents = outputEvents + events.length;
		const nextBytes = outputBytes + events.reduce((total, event) => total + utf8.encode(event.text).byteLength + 1, 0);
		if (nextEvents > outputLimitEvents || nextBytes > outputLimitBytes) throw new Error("the Lua worker exceeded the requested output limit");
		return message;
	}
	const response = message;
	if (timing ? typeof response.durationMs !== "number" || !Number.isFinite(response.durationMs) || response.durationMs < 0 : response.durationMs !== void 0) throw new Error("the Lua worker returned an invalid response");
	if (response.replaceBeforeNext !== void 0 && typeof response.replaceBeforeNext !== "boolean") throw new Error("the Lua worker returned an invalid response");
	if (typeof response.error === "string" && utf8.encode(response.error).byteLength <= 65536 && response.result === void 0) return response;
	if (response.error !== void 0 || typeof response.result !== "object" || response.result === null) throw new Error("the Lua worker returned an invalid response");
	const result = response.result;
	const error = result.error;
	let validError = error === null;
	if (typeof error === "object" && error !== null) {
		const candidate = error;
		if (typeof candidate.message === "string") {
			switch (candidate.kind) {
				case "input":
				case "syntax":
				case "compile":
				case "runtime":
				case "memory":
				case "interrupted":
				case "conversion":
				case "host": validError = true;
			}
			validError &&= utf8.encode(candidate.message).byteLength <= MAX_ERROR_BYTES;
		}
	}
	if (typeof result.ok !== "boolean" || !validError || result.ok !== (error === null)) throw new Error("the Lua worker returned an invalid response");
	if (action === "compile") {
		if (result.bytecode instanceof Uint8Array && result.bytecode.byteLength <= 4194304 && (result.ok || result.bytecode.byteLength === 0)) return response;
		throw new Error("the Lua worker returned an invalid response");
	}
	if (action === "dump") {
		if (result.text instanceof Uint8Array && result.text.byteLength <= 4194304 && typeof result.textTruncated === "boolean" && (result.ok || result.text.byteLength === 0 && !result.textTruncated)) return response;
		throw new Error("the Lua worker returned an invalid response");
	}
	if (typeof result.peakLuaMemoryBytes !== "number" || !Number.isFinite(result.peakLuaMemoryBytes) || result.peakLuaMemoryBytes < 0 || !Number.isSafeInteger(result.interruptCount) || result.interruptCount < 0 || typeof result.outputTruncated !== "boolean") throw new Error("the Lua worker returned an invalid response");
	if (!Array.isArray(result.values)) throw new Error("the Lua worker returned an invalid response");
	if (!result.ok) {
		if (result.values.length !== 0) throw new Error("the Lua worker returned an invalid response");
	} else result.values = normalizeDetachedValues(result.values, resultLimitBytes, resultLimitEntries);
	return response;
}
const VECTOR_MARKER = "__luauRsVector";
function normalizeDetachedValues(values, byteLimit, entryLimit) {
	const normalizer = new DetachedValueNormalizer(byteLimit, entryLimit);
	return values.map((value) => normalizer.value(value, 0));
}
var DetachedValueNormalizer = class {
	byteLimit;
	entryLimit;
	seen = /* @__PURE__ */ new Map();
	bytes = 0;
	entries = 0;
	constructor(byteLimit, entryLimit) {
		this.byteLimit = byteLimit;
		this.entryLimit = entryLimit;
	}
	value(value, depth) {
		if (depth > 64) throw new Error("the Lua worker result exceeds the nesting limit");
		if (value === null) {
			this.consume(1);
			return null;
		}
		switch (typeof value) {
			case "boolean":
				this.consume(1);
				return value;
			case "number":
			case "bigint":
				this.consume(8);
				return value;
			case "string":
				this.consume(utf8.encode(value).byteLength * 2);
				return value;
			case "object": break;
			default: throw new Error("the Lua worker returned an invalid value");
		}
		if (value instanceof Uint8Array) {
			this.consume(value.byteLength);
			return value;
		}
		if (isDetachedVector(value)) {
			this.consume(12);
			return new LuaVector(value.x, value.y, value.z);
		}
		this.consume(16);
		const previous = this.seen.get(value);
		if (previous !== void 0) return previous;
		if (Array.isArray(value)) {
			const result = [];
			this.seen.set(value, result);
			for (const entry of value) result.push(this.value(entry, depth + 1));
			return result;
		}
		if (value instanceof Map) {
			let stringKeys = true;
			for (const key of value.keys()) if (typeof key !== "string") {
				stringKeys = false;
				break;
			}
			if (stringKeys) {
				const result = Object.create(null);
				this.seen.set(value, result);
				for (const [key, entry] of value) {
					this.consume(utf8.encode(key).byteLength * 2);
					result[key] = this.value(entry, depth + 1);
				}
				return result;
			}
			const result = /* @__PURE__ */ new Map();
			this.seen.set(value, result);
			for (const [key, entry] of value) result.set(this.value(key, depth + 1), this.value(entry, depth + 1));
			return result;
		}
		throw new Error("the Lua worker returned an invalid value");
	}
	consume(bytes) {
		this.entries += 1;
		this.bytes += bytes + 8;
		if (this.entries > this.entryLimit) throw new Error("the Lua worker result exceeds the entry limit");
		if (this.bytes > this.byteLimit) throw new Error("the Lua worker result exceeds the byte limit");
	}
};
function isDetachedVector(value) {
	return Reflect.get(value, VECTOR_MARKER) === true && typeof Reflect.get(value, "x") === "number" && typeof Reflect.get(value, "y") === "number" && typeof Reflect.get(value, "z") === "number" && Reflect.ownKeys(value).length === 4;
}
//#endregion
//#region src/index.ts
const utf8Decoder = new TextDecoder();
function dispatchOutput(owner, type, text) {
	owner.dispatchEvent(new LuaOutputEvent(type, text));
}
const luaWorkerFinalizer = new FinalizationRegistry(({ execution, compiler }) => {
	execution.terminate();
	compiler.terminate();
});
var LuaWorker = class extends EventTarget {
	executionClient;
	compilerClient;
	jsInterop;
	workerFactory;
	resolveModule;
	constructor(options = {}) {
		super();
		if (typeof options !== "object" || options === null) throw new TypeError("Lua worker options must be an object");
		const { jsInterop, resolveModule } = options;
		if (resolveModule !== void 0 && typeof resolveModule !== "function") throw new TypeError("resolveModule must be a function");
		this.jsInterop = copyJsInterop(jsInterop);
		this.workerFactory = options.worker;
		this.resolveModule = resolveModule;
		this.executionClient = new WorkerClient(options.workerUrl, options.worker, "execution", resolveModule);
		this.compilerClient = new WorkerClient(options.workerUrl, options.worker, "compiler", void 0);
		luaWorkerFinalizer.register(this, {
			execution: this.executionClient,
			compiler: this.compilerClient
		}, this);
	}
	addEventListener(type, listener, options) {
		super.addEventListener(type, listener, options);
	}
	removeEventListener(type, listener, options) {
		super.removeEventListener(type, listener, options);
	}
	execute(source, options = {}) {
		if (typeof source !== "string") return Promise.reject(/* @__PURE__ */ new TypeError("Luau source must be a string"));
		if (typeof options !== "object" || options === null) return Promise.reject(/* @__PURE__ */ new TypeError("execution options must be an object"));
		const { signal, timing = false } = options;
		if (typeof timing !== "boolean") return Promise.reject(/* @__PURE__ */ new TypeError("timing must be a boolean"));
		let prepared;
		try {
			prepared = prepareExecutionRequest(source, options, this.jsInterop, this.resolveModule !== void 0);
		} catch (error) {
			if (!(error instanceof WorkerInputError)) return Promise.reject(error);
			const result = {
				ok: false,
				error: {
					kind: "input",
					message: error.message
				},
				values: [],
				peakLuaMemoryBytes: 0,
				interruptCount: 0,
				outputTruncated: false
			};
			return Promise.resolve(timing ? {
				result,
				durationMs: 0
			} : result);
		}
		return this.executionClient.request(prepared, signal, this, dispatchOutput).then(({ result, durationMs }) => timing ? {
			result,
			durationMs
		} : result);
	}
	executeBytecode(bytecode, options = {}) {
		if (!(bytecode instanceof Uint8Array)) return Promise.reject(/* @__PURE__ */ new TypeError("Luau bytecode must be a Uint8Array"));
		if (typeof options !== "object" || options === null) return Promise.reject(/* @__PURE__ */ new TypeError("execution options must be an object"));
		const { signal, timing = false } = options;
		if (typeof timing !== "boolean") return Promise.reject(/* @__PURE__ */ new TypeError("timing must be a boolean"));
		let prepared;
		try {
			prepared = prepareBytecodeExecutionRequest(bytecode, options, this.jsInterop, this.resolveModule !== void 0);
		} catch (error) {
			if (!(error instanceof WorkerInputError)) return Promise.reject(error);
			const result = {
				ok: false,
				error: {
					kind: "input",
					message: error.message
				},
				values: [],
				peakLuaMemoryBytes: 0,
				interruptCount: 0,
				outputTruncated: false
			};
			return Promise.resolve(timing ? {
				result,
				durationMs: 0
			} : result);
		}
		return this.executionClient.request(prepared, signal, this, dispatchOutput).then(({ result, durationMs }) => timing ? {
			result,
			durationMs
		} : result);
	}
	compile(source, options = {}) {
		if (typeof source !== "string") return Promise.reject(/* @__PURE__ */ new TypeError("Luau source must be a string"));
		if (typeof options !== "object" || options === null) return Promise.reject(/* @__PURE__ */ new TypeError("compiler options must be an object"));
		const { signal, timing = false, ...compilerOptions } = options;
		if (typeof timing !== "boolean") return Promise.reject(/* @__PURE__ */ new TypeError("timing must be a boolean"));
		let prepared;
		try {
			prepared = prepareCompileRequest(source, compilerOptions, timing);
		} catch (error) {
			if (!(error instanceof WorkerInputError)) return Promise.reject(error);
			const result = {
				ok: false,
				bytecode: /* @__PURE__ */ new Uint8Array(),
				error: {
					kind: "input",
					message: error.message
				}
			};
			return Promise.resolve(timing ? {
				result,
				durationMs: 0
			} : result);
		}
		return this.compilerClient.request(prepared, signal, this).then(({ result, durationMs }) => timing ? {
			result,
			durationMs
		} : result);
	}
	dump(source, options = {}) {
		if (typeof source !== "string") return Promise.reject(/* @__PURE__ */ new TypeError("Luau source must be a string"));
		if (typeof options !== "object" || options === null) return Promise.reject(/* @__PURE__ */ new TypeError("dump options must be an object"));
		const { signal, timing = false } = options;
		if (typeof timing !== "boolean") return Promise.reject(/* @__PURE__ */ new TypeError("timing must be a boolean"));
		let prepared;
		try {
			prepared = prepareDumpRequest(source, options, timing);
		} catch (error) {
			if (!(error instanceof WorkerInputError)) return Promise.reject(error);
			const result = {
				ok: false,
				text: "",
				textTruncated: false,
				error: {
					kind: "input",
					message: error.message
				}
			};
			return Promise.resolve(timing ? {
				result,
				durationMs: 0
			} : result);
		}
		return this.compilerClient.request(prepared, signal, this).then(({ result, durationMs }) => {
			const decoded = {
				...result,
				text: utf8Decoder.decode(result.text)
			};
			return timing ? {
				result: decoded,
				durationMs
			} : decoded;
		});
	}
	terminate() {
		luaWorkerFinalizer.unregister(this);
		this.executionClient.terminate();
		this.compilerClient.terminate();
	}
	[Symbol.dispose]() {
		this.terminate();
	}
};
//#endregion
//#region src/worker-api.ts
async function serveLuaWorker(options) {
	const worker = self;
	const queued = [];
	const enqueue = (event) => queued.push(event);
	worker.addEventListener("message", enqueue);
	try {
		(await import("./worker-server-BdoVr0x2.js")).serveLuaWorkerOn({
			addEventListener(_type, listener) {
				worker.removeEventListener("message", enqueue);
				worker.addEventListener("message", listener);
				for (const event of queued.splice(0)) listener(event);
			},
			postMessage: worker.postMessage.bind(worker)
		}, options);
	} catch (error) {
		worker.removeEventListener("message", enqueue);
		throw error;
	}
}
//#endregion
export { DEFAULT_EXECUTION_OPTIONS, LuaOutputEvent, LuaVector, LuaWorker, serveLuaWorker };
