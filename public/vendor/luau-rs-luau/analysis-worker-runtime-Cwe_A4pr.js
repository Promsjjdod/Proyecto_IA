import { c as AnalysisLintSchema, d as AnalysisModuleSchema, f as AnalysisOptionsSchema, h as parseAnalysisResult, i as AnalysisWorkerRequestSchema, l as AnalysisModeSchema, m as parseAnalysisInput, n as AnalysisModuleResponseSchema, o as AnalysisDefinitionSchema, p as AnalysisPositionSchema, r as AnalysisWorkerEnvelopeSchema, s as AnalysisGlobalsSchema, u as AnalysisModuleNameSchema } from "./analysis-worker-protocol-B92Xq-Cy.js";
import { safeParse } from "valibot";
//#region src/analysis-api.ts
let initialization;
function initializeAnalysisBindings() {
	return initialization ??= import("./node-analysis-worker-wasm-Bdr9BRRq.js").then((bindings) => {
		const initialize = bindings.initializeAnalysisBindings;
		return initialize === void 0 ? bindings : initialize();
	});
}
var Analysis = class Analysis {
	#state;
	constructor(state) {
		this.#state = state;
	}
	get state() {
		if (this.#state === void 0) throw new Error("analysis was disposed");
		return this.#state;
	}
	static async create(options = {}) {
		const validated = parseAnalysisInput(AnalysisOptionsSchema, options);
		const bindings = await initializeAnalysisBindings();
		const analysis = new Analysis(new bindings.WasmAnalysis(validated.mode ?? "nonstrict", validated.lint ?? false, validated.globals ?? [], validated.typeString?.maxTableLength, validated.typeString?.maxTypeLength));
		for (const definition of validated.definitions ?? []) analysis.addDefinition(definition.name, definition.source, definition.environment);
		for (const module of validated.modules ?? []) analysis.setModule(module.name, module.source, module.kind, module.environment);
		return analysis;
	}
	setMode(mode) {
		this.state.setMode(parseAnalysisInput(AnalysisModeSchema, mode));
	}
	setLint(enabled) {
		this.state.setLint(parseAnalysisInput(AnalysisLintSchema, enabled));
	}
	setGlobals(globals) {
		this.state.setGlobals(parseAnalysisInput(AnalysisGlobalsSchema, globals));
	}
	setModule(name, source, kind = "module", environment) {
		const module = parseAnalysisInput(AnalysisModuleSchema, {
			name,
			source,
			kind,
			environment
		});
		this.state.setModule(module.name, module.source, module.kind ?? "module", module.environment);
	}
	addDefinition(name, source, environment) {
		const definition = parseAnalysisInput(AnalysisDefinitionSchema, {
			name,
			source,
			environment
		});
		this.state.addDefinition(definition.name, definition.source, definition.environment);
	}
	deleteModule(name) {
		return this.state.deleteModule(parseAnalysisInput(AnalysisModuleNameSchema, name));
	}
	clearModules() {
		this.state.clearModules();
	}
	check(name) {
		const module = parseAnalysisInput(AnalysisModuleNameSchema, name);
		return parseAnalysisResult("check", this.state.check(module));
	}
	checkModules(names) {
		const modules = names.map((name) => parseAnalysisInput(AnalysisModuleNameSchema, name));
		return parseAnalysisResult("checkModules", this.state.checkModules(modules));
	}
	autocomplete(name, position) {
		const module = parseAnalysisInput(AnalysisModuleNameSchema, name);
		const at = parseAnalysisInput(AnalysisPositionSchema, position);
		return parseAnalysisResult("autocomplete", this.state.autocomplete(module, at.line, at.column));
	}
	fragmentAutocomplete(name, source, position) {
		const module = parseAnalysisInput(AnalysisModuleSchema, {
			name,
			source
		});
		const at = parseAnalysisInput(AnalysisPositionSchema, position);
		return parseAnalysisResult("fragmentAutocomplete", this.state.fragmentAutocomplete(module.name, module.source, at.line, at.column));
	}
	typeAt(name, position) {
		const module = parseAnalysisInput(AnalysisModuleNameSchema, name);
		const at = parseAnalysisInput(AnalysisPositionSchema, position);
		return this.state.typeAt(module, at.line, at.column);
	}
	expectedTypeAt(name, position) {
		const module = parseAnalysisInput(AnalysisModuleNameSchema, name);
		const at = parseAnalysisInput(AnalysisPositionSchema, position);
		return this.state.expectedTypeAt(module, at.line, at.column);
	}
	inspectAt(name, position) {
		const module = parseAnalysisInput(AnalysisModuleNameSchema, name);
		const at = parseAnalysisInput(AnalysisPositionSchema, position);
		return parseAnalysisResult("inspectAt", this.state.inspectAt(module, at.line, at.column));
	}
	decorateWithTypes(name) {
		return this.state.decorateWithTypes(parseAnalysisInput(AnalysisModuleNameSchema, name));
	}
	documentationSymbolAt(name, position) {
		const module = parseAnalysisInput(AnalysisModuleNameSchema, name);
		const at = parseAnalysisInput(AnalysisPositionSchema, position);
		return this.state.documentationSymbolAt(module, at.line, at.column);
	}
	moduleReturnType(name) {
		return this.state.moduleReturnType(parseAnalysisInput(AnalysisModuleNameSchema, name));
	}
	requiredModules(name) {
		return this.state.requiredModules(parseAnalysisInput(AnalysisModuleNameSchema, name));
	}
	/** @internal */
	beginOperation() {
		this.state.beginOperation();
	}
	/** @internal */
	takeModuleRequests() {
		return this.state.takeModuleRequests();
	}
	/** @internal */
	resolveModuleRequest(request, module) {
		this.state.resolveModule(request.from, request.specifier, module?.name, module?.source, module?.kind, module?.environment);
	}
	[Symbol.dispose]() {
		const state = this.#state;
		if (state === void 0) return;
		this.#state = void 0;
		state.free();
	}
};
//#endregion
//#region src/analysis-worker-runtime.ts
function serveAnalysisWorkerOn(port) {
	let analysis;
	let mode = "nonstrict";
	let lint = false;
	let globals = [];
	let definitions = [];
	let queue = Promise.resolve();
	let nextResolution = 1;
	const resolutions = /* @__PURE__ */ new Map();
	port.addEventListener("message", (event) => {
		const response = safeParse(AnalysisModuleResponseSchema, event.data);
		if (response.success) {
			const pending = resolutions.get(response.output.resolution);
			if (pending === void 0) return;
			resolutions.delete(response.output.resolution);
			if (response.output.error !== void 0) pending.reject(new Error(response.output.error));
			else pending.resolve(response.output.module);
			return;
		}
		queue = queue.then(() => handle(event.data));
	});
	async function handle(value) {
		const parsed = safeParse(AnalysisWorkerRequestSchema, value);
		if (!parsed.success) {
			const envelope = safeParse(AnalysisWorkerEnvelopeSchema, value);
			if (envelope.success) port.postMessage({
				protocol: 3,
				id: envelope.output.id,
				ok: false,
				error: {
					name: "TypeError",
					message: "invalid analysis worker request"
				}
			});
			return;
		}
		const request = parsed.output;
		try {
			if (analysis === void 0) {
				analysis = await Analysis.create({
					mode: request.mode,
					lint: request.lint,
					globals: request.globals,
					definitions: request.definitions,
					typeString: request.typeString
				});
				mode = request.mode;
				lint = request.lint;
				globals = request.globals;
				definitions = request.definitions;
			}
			synchronize(analysis, request);
			const result = await dispatchWithModules(analysis, request);
			port.postMessage({
				protocol: 3,
				id: request.id,
				ok: true,
				result
			});
		} catch (error) {
			port.postMessage({
				protocol: 3,
				id: request.id,
				ok: false,
				error: {
					name: error instanceof Error ? error.name : "Error",
					message: error instanceof Error ? error.message : String(error)
				}
			});
		}
	}
	function synchronize(current, request) {
		if (request.mode !== mode) {
			current.setMode(request.mode);
			mode = request.mode;
		}
		if (request.lint !== lint) {
			current.setLint(request.lint);
			lint = request.lint;
		}
		if (request.globals.length !== globals.length || request.globals.some((name, index) => name !== globals[index])) {
			current.setGlobals(request.globals);
			globals = request.globals;
		}
		if (definitions.some((definition, index) => {
			const next = request.definitions[index];
			return next === void 0 || definition.name !== next.name || definition.source !== next.source || definition.environment !== next.environment;
		})) throw new TypeError("analysis definitions cannot be removed or replaced");
		for (const definition of request.definitions.slice(definitions.length)) current.addDefinition(definition.name, definition.source, definition.environment);
		definitions = request.definitions;
		if (request.workspace.reset) current.clearModules();
		for (const name of request.workspace.removedModules) current.deleteModule(name);
		for (const module of request.workspace.modules) current.setModule(module.name, module.source, module.kind, module.environment);
	}
	async function dispatchWithModules(current, request) {
		current.beginOperation();
		while (true) {
			const result = dispatch(current, request);
			const requested = current.takeModuleRequests();
			if (requested.length === 0 || !request.resolveModules) return result;
			let resolved = false;
			for (const moduleRequest of requested) {
				const module = await resolveModule(request.id, moduleRequest);
				current.resolveModuleRequest(moduleRequest, module);
				resolved ||= module !== void 0;
			}
			if (!resolved) return result;
		}
	}
	function resolveModule(id, request) {
		const resolution = nextResolution;
		nextResolution = resolution >= Number.MAX_SAFE_INTEGER ? 1 : resolution + 1;
		return new Promise((resolve, reject) => {
			resolutions.set(resolution, {
				resolve,
				reject
			});
			try {
				port.postMessage({
					protocol: 3,
					id,
					action: "resolveModule",
					resolution,
					from: request.from,
					specifier: request.specifier
				});
			} catch (error) {
				resolutions.delete(resolution);
				reject(error);
			}
		});
	}
}
function dispatch(analysis, request) {
	switch (request.action) {
		case "check": return analysis.check(request.name);
		case "checkModules": return analysis.checkModules(request.names);
		case "autocomplete": return analysis.autocomplete(request.name, request.position);
		case "fragmentAutocomplete": return analysis.fragmentAutocomplete(request.name, request.source, request.position);
		case "typeAt": return analysis.typeAt(request.name, request.position);
		case "expectedTypeAt": return analysis.expectedTypeAt(request.name, request.position);
		case "inspectAt": return analysis.inspectAt(request.name, request.position);
		case "decorateWithTypes": return analysis.decorateWithTypes(request.name);
		case "documentationSymbolAt": return analysis.documentationSymbolAt(request.name, request.position);
		case "moduleReturnType": return analysis.moduleReturnType(request.name);
		case "requiredModules": return analysis.requiredModules(request.name);
	}
}
//#endregion
export { serveAnalysisWorkerOn };
