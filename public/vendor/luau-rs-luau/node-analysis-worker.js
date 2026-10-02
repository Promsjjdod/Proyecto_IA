import { a as AnalysisWorkerResponseSchema, c as AnalysisLintSchema, d as AnalysisModuleSchema, f as AnalysisOptionsSchema, h as parseAnalysisResult, l as AnalysisModeSchema, m as parseAnalysisInput, o as AnalysisDefinitionSchema, p as AnalysisPositionSchema, s as AnalysisGlobalsSchema, t as AnalysisModuleRequestSchema, u as AnalysisModuleNameSchema } from "./analysis-worker-protocol-B92Xq-Cy.js";
import { Worker as Worker$1, parentPort } from "node:worker_threads";
import { custom, function as function$1, instance, is, object, optional, safeParse, string, union } from "valibot";
//#region src/worker-protocol.ts
const MAX_ERROR_BYTES = 65536;
const utf8 = new TextEncoder();
new TextDecoder("utf-8", { fatal: true });
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
//#endregion
//#region src/analysis-worker.ts
const WorkerShape = object({
	postMessage: function$1(),
	terminate: function$1()
});
const WorkerInstanceSchema = custom((value) => is(WorkerShape, value), "worker factory must return a Worker");
const WorkerOptionsSchema = object({
	...AnalysisOptionsSchema.entries,
	resolveModule: optional(custom((value) => typeof value === "function", "resolveModule must be a function")),
	worker: optional(custom((value) => typeof value === "function", "worker must be a function")),
	workerUrl: optional(union([string(), instance(URL)]))
});
const RequestOptionsSchema = object({ signal: optional(instance(AbortSignal, "signal must be an AbortSignal")) }, "analysis request options must be an object");
const analysisWorkerFinalizer = new FinalizationRegistry((state) => state.worker?.terminate());
var AnalysisWorker$1 = class {
	modules = /* @__PURE__ */ new Map();
	workerFactory;
	resolveModule;
	workerUrl;
	finalizerState = {};
	worker;
	synchronizedModules;
	pending;
	nextId = 1;
	terminated = false;
	mode;
	lint;
	globals;
	definitions;
	typeString;
	constructor(options = {}) {
		const validated = parseAnalysisInput(WorkerOptionsSchema, options);
		this.mode = validated.mode ?? "nonstrict";
		this.lint = validated.lint ?? false;
		this.globals = validated.globals ?? [];
		this.definitions = validated.definitions ?? [];
		this.typeString = validated.typeString;
		this.resolveModule = validated.resolveModule;
		this.workerUrl = validated.workerUrl;
		this.workerFactory = validated.worker;
		for (const module of validated.modules ?? []) this.modules.set(module.name, {
			...module,
			kind: module.kind ?? "module"
		});
		analysisWorkerFinalizer.register(this, this.finalizerState, this);
	}
	setMode(mode) {
		this.mode = parseAnalysisInput(AnalysisModeSchema, mode);
	}
	setLint(enabled) {
		this.lint = parseAnalysisInput(AnalysisLintSchema, enabled);
	}
	setGlobals(globals) {
		this.globals = parseAnalysisInput(AnalysisGlobalsSchema, globals);
	}
	addDefinition(name, source, environment) {
		this.definitions.push(parseAnalysisInput(AnalysisDefinitionSchema, {
			name,
			source,
			environment
		}));
	}
	setModule(name, source, kind = "module", environment) {
		const module = parseAnalysisInput(AnalysisModuleSchema, {
			name,
			source,
			kind,
			environment
		});
		this.modules.set(module.name, module);
	}
	deleteModule(name) {
		return this.modules.delete(parseAnalysisInput(AnalysisModuleNameSchema, name));
	}
	clearModules() {
		this.modules.clear();
	}
	check(name, options) {
		return this.request({
			action: "check",
			name: parseAnalysisInput(AnalysisModuleNameSchema, name)
		}, options);
	}
	checkModules(names, options) {
		return this.request({
			action: "checkModules",
			names: names.map((name) => parseAnalysisInput(AnalysisModuleNameSchema, name))
		}, options);
	}
	autocomplete(name, position, options) {
		return this.request({
			action: "autocomplete",
			name: parseAnalysisInput(AnalysisModuleNameSchema, name),
			position: parseAnalysisInput(AnalysisPositionSchema, position)
		}, options);
	}
	fragmentAutocomplete(name, source, position, options) {
		const module = parseAnalysisInput(AnalysisModuleSchema, {
			name,
			source
		});
		return this.request({
			action: "fragmentAutocomplete",
			name: module.name,
			source: module.source,
			position: parseAnalysisInput(AnalysisPositionSchema, position)
		}, options);
	}
	typeAt(name, position, options) {
		return this.request({
			action: "typeAt",
			name: parseAnalysisInput(AnalysisModuleNameSchema, name),
			position: parseAnalysisInput(AnalysisPositionSchema, position)
		}, options);
	}
	expectedTypeAt(name, position, options) {
		return this.request({
			action: "expectedTypeAt",
			name: parseAnalysisInput(AnalysisModuleNameSchema, name),
			position: parseAnalysisInput(AnalysisPositionSchema, position)
		}, options);
	}
	inspectAt(name, position, options) {
		return this.request({
			action: "inspectAt",
			name: parseAnalysisInput(AnalysisModuleNameSchema, name),
			position: parseAnalysisInput(AnalysisPositionSchema, position)
		}, options);
	}
	decorateWithTypes(name, options) {
		return this.request({
			action: "decorateWithTypes",
			name: parseAnalysisInput(AnalysisModuleNameSchema, name)
		}, options);
	}
	documentationSymbolAt(name, position, options) {
		return this.request({
			action: "documentationSymbolAt",
			name: parseAnalysisInput(AnalysisModuleNameSchema, name),
			position: parseAnalysisInput(AnalysisPositionSchema, position)
		}, options);
	}
	moduleReturnType(name, options) {
		return this.request({
			action: "moduleReturnType",
			name: parseAnalysisInput(AnalysisModuleNameSchema, name)
		}, options);
	}
	requiredModules(name, options) {
		return this.request({
			action: "requiredModules",
			name: parseAnalysisInput(AnalysisModuleNameSchema, name)
		}, options);
	}
	terminate() {
		if (this.terminated) return;
		this.terminated = true;
		analysisWorkerFinalizer.unregister(this);
		this.rejectPending(/* @__PURE__ */ new Error("analysis worker was terminated"));
		this.worker?.terminate();
		this.worker = void 0;
		this.finalizerState.worker = void 0;
	}
	[Symbol.dispose]() {
		this.terminate();
	}
	request(operation, options) {
		if (this.terminated) return Promise.reject(/* @__PURE__ */ new Error("analysis worker is unavailable"));
		if (this.pending !== void 0) return Promise.reject(/* @__PURE__ */ new Error("another analysis operation is active"));
		const signal = options === void 0 ? void 0 : parseAnalysisInput(RequestOptionsSchema, options).signal;
		if (signal?.aborted) return Promise.reject(signal.reason);
		const id = this.nextId;
		this.nextId = id >= Number.MAX_SAFE_INTEGER ? 1 : id + 1;
		const modules = new Map(this.modules);
		const request = {
			protocol: 3,
			id,
			mode: this.mode,
			lint: this.lint,
			globals: this.globals,
			definitions: this.definitions,
			typeString: this.typeString,
			resolveModules: this.resolveModule !== void 0,
			workspace: this.workspace(modules),
			...operation
		};
		let worker;
		try {
			worker = this.worker ?? this.createWorker();
		} catch (error) {
			return Promise.reject(error);
		}
		return new Promise((resolve, reject) => {
			const controller = new AbortController();
			const abort = signal ? () => {
				controller.abort(signal.reason);
				this.replaceWorker();
				this.rejectPending(signal.reason);
			} : void 0;
			this.pending = {
				action: operation.action,
				id,
				modules,
				resolve,
				reject,
				signal,
				abort,
				controller,
				resolutions: /* @__PURE__ */ new Set()
			};
			if (signal !== void 0 && abort !== void 0) signal.addEventListener("abort", abort, { once: true });
			try {
				worker.postMessage(request);
			} catch (error) {
				this.takePending();
				this.replaceWorker();
				reject(error);
			}
		});
	}
	createWorker() {
		let url = this.workerUrl;
		if (url === void 0) {
			url = new URL("./analysis-worker-entry.js", import.meta.url);
			url.searchParams.set("wasm", new URL("./luau_analysis_wasm_bg.wasm", import.meta.url).href);
		}
		const factory = this.workerFactory;
		const worker = factory ? factory(url) : new Worker(url, {
			type: "module",
			name: "luau-analysis"
		});
		parseAnalysisInput(WorkerInstanceSchema, worker);
		const owner = new WeakRef(this);
		worker.onmessage = (event) => owner.deref()?.handleMessage(worker, event.data);
		worker.onerror = (event) => {
			const client = owner.deref();
			if (client === void 0 || client.worker !== worker) return;
			event.preventDefault();
			client.replaceWorker();
			client.rejectPending(event.error ?? new Error(event.message));
		};
		worker.onmessageerror = () => {
			const client = owner.deref();
			if (client === void 0 || client.worker !== worker) return;
			client.replaceWorker();
			client.rejectPending(/* @__PURE__ */ new Error("analysis worker returned an invalid message"));
		};
		this.worker = worker;
		this.finalizerState.worker = worker;
		return worker;
	}
	handleMessage(worker, value) {
		if (worker !== this.worker || this.pending === void 0) return;
		const moduleRequest = safeParse(AnalysisModuleRequestSchema, value);
		if (moduleRequest.success) {
			this.resolveModuleRequest(worker, moduleRequest.output);
			return;
		}
		let response;
		try {
			response = parseAnalysisInput(AnalysisWorkerResponseSchema, value);
		} catch {
			this.replaceWorker();
			this.rejectPending(/* @__PURE__ */ new Error("analysis worker returned an invalid response"));
			return;
		}
		if (response.id !== this.pending.id) {
			this.replaceWorker();
			this.rejectPending(/* @__PURE__ */ new Error("analysis worker returned an invalid response"));
			return;
		}
		const pending = this.takePending();
		if (pending === void 0) return;
		this.synchronizedModules = pending.modules;
		if (response.ok) try {
			pending.resolve(parseAnalysisResult(pending.action, response.result));
		} catch {
			this.replaceWorker();
			pending.reject(/* @__PURE__ */ new Error("analysis worker returned an invalid result"));
		}
		else {
			const error = new Error(response.error.message);
			error.name = response.error.name;
			pending.reject(error);
		}
	}
	rejectPending(reason) {
		this.takePending()?.reject(reason);
	}
	takePending() {
		const pending = this.pending;
		this.pending = void 0;
		pending?.controller.abort(new DOMException("analysis operation finished", "AbortError"));
		if (pending?.abort !== void 0) pending.signal?.removeEventListener("abort", pending.abort);
		return pending;
	}
	replaceWorker() {
		this.pending?.controller.abort(new DOMException("analysis worker was terminated", "AbortError"));
		this.worker?.terminate();
		this.worker = void 0;
		this.synchronizedModules = void 0;
		this.finalizerState.worker = void 0;
	}
	resolveModuleRequest(worker, request) {
		const pending = this.pending;
		const resolveModule = this.resolveModule;
		if (pending === void 0 || pending.id !== request.id || resolveModule === void 0 || pending.resolutions.has(request.resolution)) {
			this.replaceWorker();
			this.rejectPending(/* @__PURE__ */ new Error("analysis worker requested an invalid module resolution"));
			return;
		}
		pending.resolutions.add(request.resolution);
		const signal = pending.controller.signal;
		Promise.resolve().then(() => resolveModule(request.specifier, {
			from: request.from,
			signal
		})).then((value) => {
			let module;
			try {
				if (value !== null && value !== void 0) {
					module = parseAnalysisInput(AnalysisModuleSchema, value);
					module.kind ??= "module";
					pending.modules.set(module.name, module);
					this.modules.set(module.name, module);
				}
				this.sendModuleResponse(worker, request, module);
			} catch (error) {
				this.sendModuleResponse(worker, request, void 0, boundedErrorMessage(error));
			}
		}, (error) => {
			this.sendModuleResponse(worker, request, void 0, boundedErrorMessage(error));
		});
	}
	sendModuleResponse(worker, request, module, error) {
		if (worker !== this.worker || this.pending?.id !== request.id) return;
		const response = {
			protocol: 3,
			id: request.id,
			action: "resolveModule",
			resolution: request.resolution
		};
		if (module !== void 0) response.module = module;
		if (error !== void 0) response.error = error;
		try {
			worker.postMessage(response);
		} catch (error) {
			this.replaceWorker();
			this.rejectPending(error);
		}
	}
	workspace(modules) {
		const synchronized = this.synchronizedModules;
		if (synchronized === void 0) return {
			reset: true,
			modules: Array.from(modules.values()),
			removedModules: []
		};
		return {
			reset: false,
			modules: Array.from(modules.values()).filter((module) => {
				const previous = synchronized.get(module.name);
				return previous?.source !== module.source || previous.kind !== module.kind || previous.environment !== module.environment;
			}),
			removedModules: Array.from(synchronized.keys()).filter((name) => !modules.has(name))
		};
	}
};
//#endregion
//#region src/node-worker-adapter.ts
var NodeWorkerAdapter = class {
	onmessage = null;
	onerror = null;
	onmessageerror = null;
	worker;
	terminated = false;
	constructor(url, name, label) {
		this.worker = new Worker$1(url, {
			name,
			execArgv: []
		});
		this.worker.on("message", (data) => this.onmessage?.({ data }));
		this.worker.on("messageerror", (error) => this.onmessageerror?.({ data: error }));
		this.worker.on("error", (error) => this.report(error));
		this.worker.on("exit", (code) => {
			if (!this.terminated) this.report(/* @__PURE__ */ new Error(`${label} exited with code ${code}`));
		});
	}
	postMessage(message, transfer = []) {
		this.worker.postMessage(message, transfer);
	}
	terminate() {
		this.terminated = true;
		this.worker.terminate();
	}
	report(error) {
		this.onerror?.({
			error,
			message: error.message,
			preventDefault() {}
		});
	}
};
//#endregion
//#region src/node-analysis-worker.ts
async function serveAnalysisWorker() {
	if (parentPort === null) throw new Error("analysis worker requires a parent port");
	const port = parentPort;
	const queued = [];
	const enqueue = (message) => queued.push(message);
	port.on("message", enqueue);
	try {
		(await import("./analysis-worker-runtime-Cwe_A4pr.js")).serveAnalysisWorkerOn({
			addEventListener(_type, listener) {
				port.off("message", enqueue);
				port.on("message", (data) => listener({ data }));
				for (const data of queued.splice(0)) listener({ data });
			},
			postMessage(message) {
				port.postMessage(message);
			}
		});
	} catch (error) {
		port.off("message", enqueue);
		throw error;
	}
}
var AnalysisWorker = class extends AnalysisWorker$1 {
	constructor(options = {}) {
		const worker = options.worker ?? (() => new NodeWorkerAdapter(options.workerUrl ?? new URL("./node-analysis-worker-entry.js", import.meta.url), "luau-analysis", "analysis worker"));
		super({
			...options,
			worker
		});
	}
};
//#endregion
export { AnalysisWorker, serveAnalysisWorker };
